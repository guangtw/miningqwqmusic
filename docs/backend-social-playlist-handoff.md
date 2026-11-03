# Echo 后端交接：私信、只读评论、自建歌单排序与封面

2026-11-03 扩展：音乐分享卡片、自动一起听邀请消息和message.updated事件已另行实现，见 [卡片与邀请交接](backend-rich-messages-handoff.md)。下文保留文字私信基础协议；扩展能力以新文档为准。

本次仅实现后端、共享 DTO、测试和发布支持。前端请在当前 `origin/main` 基础上接入，保留现有组件样式、布局、字体和动效。没有自动上线，也没有在用户数据库上应用迁移。

## 1. 代码和接口约定

- 音乐仓库 `app/api/music/track/[id]/comments` 提供只读网易云评论。
- 相邻账户仓库 `MiningQwQLogin` 实现 `messages`、`events`、歌单排序及封面归一化。前端一律请求同源 `/api/account/...`，不直连账户服务或网易云上游。
- 完整请求/响应 DTO 在两个仓库同名的 `src/types/social.ts`；评论 DTO 在音乐仓库 `src/types/music.ts`。旧 `LibraryRevisionResult` 增加可选 `records`、`removedRecordIds`，其他字段保持兼容。后续修改 social DTO 时保持两份一致。
- 使用现有 `authed()`；access token 继续仅放内存。账户接口返回 `Cache-Control: no-store`。SSE 使用带 Bearer token 的 `fetch`，不要把 token 放入 URL，也不要直接使用无法设置 Authorization 的原生 EventSource。
- 成功格式为 `{code:0,data,message:"ok",traceId}`；失败为 `{code,message,traceId,retryable,retryAfterSeconds?}`，同时使用 HTTP 状态码。限流响应的 `Retry-After` 会穿过 BFF。

## 2. 私信

### 规则

纯文字去首尾空白后 1–2000 个 UTF-16 码元（与 JS `.length` 一致）。不能发给自己。好友不限陌生人条数；非好友在未互相回复前，向同一人累计最多发送 3 条，没有每日重置。双方各发过至少一条后放开。删除好友保留历史及已互相回复的资格；若从未互相回复，历史发送条数继续占用陌生人额度。

每个发送者每分钟最多 30 条新消息，使用数据库记录计算，重启不重置。`sendPolicy` 表示关系及陌生人限额，不预先保证频率限制一定允许发送；最终以发送请求结果为准。仅成功提交的新消息占额度。

### 接口

| 方法/路径 | 请求 | `data` 类型 |
| --- | --- | --- |
| `GET /api/account/messages/conversations` | `cursor?`、`limit?`，默认30，最多100 | `ConversationPage` |
| `GET /api/account/messages/users/{userId}` | 对方 Echo 用户 ID | `DirectConversationDto` |
| `GET /api/account/messages/users/{userId}/messages` | `before?` 或 `after?`、`limit?`，默认30，最多100 | `MessagePage` |
| `POST /api/account/messages/users/{userId}/messages` | `SendDirectMessageInput` | `MessageSendResult` |
| `POST /api/account/messages/users/{userId}/read` | `MarkMessagesReadInput` | `ReadResult` |

用户 ID 可来自已有好友列表或好友搜索结果。查询一个尚未聊天的用户返回 `id:null`、`lastMessage:null`，不创建空会话。会话列表仅包含已有消息的会话，按末条消息时间、会话 ID 倒序分页；这是实时列表，翻页过程中收到新消息时应刷新顶部并按会话 ID 去重。

发送示例：

```ts
import type { MessageSendResult } from '@/src/types/social';
const clientMessageId = crypto.randomUUID(); // 一次用户发送只生成一次
const result = await authed<MessageSendResult>(
  `/api/account/messages/users/${encodeURIComponent(peerId)}/messages`,
  { method: 'POST', body: { clientMessageId, text } }
);
```

`clientMessageId` 按发送者全局唯一，最多128字符。网络超时、401刷新或用户重试同一次发送时复用原 ID 和正文；相同请求返回同一消息。更换收件人或正文必须生成新 ID，否则409。HTTP成功表示已持久化，不表示对方已读。用服务端 `message.id` 合并乐观消息和SSE消息，避免出现两条。

`sendPolicy` 示例：

```json
{
  "relationship": "stranger",
  "hasMutualMessages": false,
  "canSend": true,
  "remainingBeforeReply": 2,
  "reason": null
}
```

好友或已互相回复时 `remainingBeforeReply:null`；额度耗尽时为0、`canSend:false`、`reason:"stranger_limit"`。本次没有拉黑、撤回、图片、音乐卡片、消息删除或后台管理接口。

### 历史和已读

- 不传游标：取最近一页；`before=N`：取序号小于N的较近一页；`after=N`：从大于N的最早新消息开始补拉。`before` 和 `after` 不能同时传。每页 `items` 始终按序号升序。
- `nextBefore` 为该页最小序号，`nextAfter` 为最大序号；空页时前者为null，增量查询的后者保留请求的after。`hasMore` 指当前查询方向是否还有一页。
- 未读数只统计对方发送、序号大于自己的 `lastReadSequence` 的消息。GET不会自动标记已读。
- 页面实际显示到某条消息后才提交 `{throughMessageId}`。已读位置只前进，不使用“当前全部已读”，避免把读取期间到达的新消息误标。对方消息和自己消息均可作为同一会话中的位置标记。
- `DirectConversationDto` 同时提供自己的和对方的已读序号。对第三人的会话、消息和已读请求无法获得其他两人的数据；返回的对方资料不包含邮箱或密码相关字段。

## 3. 账户事件与 SSE

| 方法/路径 | 参数 | 返回 |
| --- | --- | --- |
| `GET /api/account/events` | `after` 默认 `"0"`，`limit` 默认/最多100 | `AccountEventPage` |
| `GET /api/account/events/stream` | `after` 默认 `"0"`；也支持 `Last-Event-ID` | `text/event-stream` |

事件游标是十进制字符串，只能作为游标使用，不要减1或要求连续（日志为账号隔离，全局ID存在间隙）。JSON查询返回 `nextCursor` 和 `hasMore`；无事件时保持原游标。事件目前不自动清理。

```text
event: ready
data: {"traceId":"...","cursor":"0"}

id: 42
event: message.created
data: {"id":"42","type":"message.created","payload":{"message":{"id":"...","conversationId":"...","sequence":1,"senderUserId":"...","clientMessageId":"...","text":"你好","createdAt":"..."}},"createdAt":"..."}
```

- `message.created`：发送者和接收者均收到。除更新消息列表，还应更新对应会话、未读数和发送策略。
- `message.read`：双方均收到 `{conversationId,userId,lastReadSequence}`；按最大序号合并，多设备同步。刷新摘要可得到权威未读数。
- `playlist.changed`：歌单所属账号所有设备收到 `{playlistId,revision}`；`playlistId:null` 表示整个资料库快照被替换。revision比本机新时重新拉取快照，并保留本机尚未提交的变更。
- `ready` 仅确认连接及起始游标，不是新的业务事件；不要把它当作已消费完整日志的证明。
- 每15秒发送 `: keepalive` 注释；每秒检查持久化日志。SSE可重复投递，按 `event.id` 去重；只在成功处理事件后更新本机游标。
- token到期发送 `auth.expired` 并关闭，刷新token后续传。其他错误发送 `closed`（带code/message/traceId）再关闭；连接建立前的错误使用普通JSON/HTTP状态。
- 慢连接存在有界缓冲，服务器可能关闭连接；使用最后**已处理**游标重连即可，不会依赖内存保存消息。

推荐启动/重连顺序：恢复登录 → 用已保存游标分页拉 `/events` 直到 `hasMore:false` → 更新会话/歌单快照 → 从最后成功处理游标连接SSE。补拉和订阅之间产生的事件仍会由日志重放。首次登录没有游标时从0开始，不跳到未知的最新ID。

SSE解析需保留分块之间未完整的一帧，按空行分帧；不能假设一次 `reader.read()` 对应一条消息。网络失败采用有上限的退避重连。退出登录或切换账号时立即 Abort，清空旧账号内存状态；若持久化游标，键必须包含Echo用户ID。

## 4. 只读歌曲评论

```text
GET /api/music/track/186016/comments?sort=hot&limit=20
GET /api/music/track/186016/comments?sort=time&limit=20&cursor=<URL编码后的nextCursor>
```

无需Echo登录。`sort` 仅支持 `hot|time`，默认hot；`limit` 1–50，默认20。首次请求不传cursor，后续原样使用 `TrackCommentPage.nextCursor`；换歌、切排序或改limit都重置游标和列表。每页按评论ID去重（上游内容在分页期间可能变化）。

`TrackCommentPage` 为 `{trackId,sort,items,total,hasMore,nextCursor}`；`items` 使用 `TrackComment`：`id`、`author`、`content`、毫秒时间戳 `time`、`likedCount`、`replies`。`replies` 是该评论返回时已有的被回复引用，不是完整楼中楼；引用被删除时content可为null。

正文和引用一律用React文本节点渲染，禁止 `dangerouslySetInnerHTML`。没有发送框、点赞写操作或楼中楼展开接口。POST/PUT/PATCH/DELETE返回405。

后端固定上游 `/comment/new?type=0`：hot对应sortType2，time对应3；时间翻页携带上游cursor。不透传用户Cookie，返回作者公共资料，丢弃上游IP地址及其他未定义字段。沿用上游共享队列、合并、120秒缓存及冷却；上游非成功或异常格式返回错误，不降级成空列表或mock评论。缓存及上游内容决定新鲜度，不承诺秒级更新。

## 5. 自建歌单排序与封面

```ts
import type { PlaylistRecordsResult } from '@/src/types/social';
const result = await authed<PlaylistRecordsResult>(
  `/api/account/library/imported-playlists/${encodeURIComponent(id)}/order`,
  { method: 'PUT', body: { expectedRevision: libraryRevision, trackIds: orderedIds } }
);
```

仅支持当前用户的自建歌单头记录；导入链接歌单、`~k`分卷和不存在的歌单会被拒绝。trackIds必须包含该歌单全部现有歌曲，且每个ID恰好一次。空歌单可传空数组。历史记录如存在重复歌曲ID，先通过现有编辑接口整理后再排序。

服务端在一个事务中读取所有卷、校验revision及曲目、重新分卷、删除不再需要的卷、更新首曲封面并递增**一次**revision。保留 `mine-...`、`<id>~k`、`local://playlist/<id>?part=k` 及现有字段预算（默认400，切卷预留12字段）。只传ID不会触发按整首Track上传的字段上限；仍受现有JSON字节数限制。

返回 `{revision,updatedAt,records,removedRecordIds}`。records为该歌单新的所有卷，不是全资料库；原有单卷PUT/DELETE也增加可选的同名字段，旧客户端忽略它们仍可运行。快照替换返回全部规范化记录。旧changes接口的歌单变更payload会附带records和removedRecordIds；新排序action为 `playlist.reorder`。

Claude需调整现有 `src/frontend/lib/playlists.ts` 的排序保存流程：

1. 等待当前歌单已有的本地增删/改名/分卷同步完成，再取得最新资料库revision。不能同时走旧逐卷保存和新原子排序。
2. 保留排序前的副本，允许乐观展示；PUT成功后以返回records更新 `cloudParts`、`cloudSigs`、资料库revision及本地歌单，清理removedRecordIds。
3. 409/code5301时重新拉取快照，提示冲突并让用户重试；不拿旧ID列表自动覆盖新歌单。网络超时后先读取快照核对结果，避免把已成功的排序当作失败覆盖。
4. 离线排序可保留本地待处理操作；重新联网后先同步曲目变化，再基于新快照提交。旧客户端的无revision分卷PUT仍具有旧覆盖语义，前端应完成接入后使用新排序接口。

自建歌单封面始终取当前第一首的 `track.coverUrl`，再回退 `track.album.coverUrl`；首曲没有封面、或歌单为空时清除旧封面，不取后续曲目的封面。导入链接歌单保留原封面。旧单卷写入、删除分卷、快照替换、排序和快照读取均采用相同规则；读取历史陈旧封面只作投影，不递增revision。

**即时显示仍需前端接入**：当前 `playlistCover()` 优先使用旧 `pl.coverUrl`。本地增删或拖动时同步计算上述自动封面，成功后应用后端records；同时更新详情、卡片及过渡预览数据，失败时恢复或重新拉取。后端返回正确封面不等于当前页面自动重渲染。

## 6. 错误处理速查

| HTTP / code | 意义 | 前端处理 |
| --- | --- | --- |
| 401 / 5204 | 账号token失效 | 沿用合并刷新；SSE重连 |
| 400 / 5101 | 账户参数、游标或JSON字段超限 | 修正请求，不盲目重试 |
| 413 / 5102 | 请求字节数或单曲分卷预算超限 | 提示数据过大 |
| 400 / 5801 | 给自己发信 | 不提供该入口 |
| 404 / 5802 | 对方不存在 | 更新用户资料/会话状态 |
| 409 / 5803 | 复用clientMessageId但正文/收件人不同 | 为新操作生成新ID |
| 403 / 5804 | 陌生人3条已用完 | 等待回复，保留输入内容 |
| 429 / 5805 | 每分钟发送频率超限 | 遵守Retry-After，重试沿用原ID |
| 404 / 5806 | 已读目标不属于当前会话或不存在 | 重新拉取消息，不越权标记 |
| 409 / 5301 | 资料库revision冲突 | 拉新快照、提示重试 |
| 404 / 5901 | 歌单不存在 | 刷新资料库 |
| 400 / 5902 | 非自建歌单头记录 | 不显示持久排序操作 |
| 400 / 5903 | 曲目不完整、重复或不匹配 | 拉新歌单再排序 |
| 400 / 4001 | 评论参数或游标无效 | 重置分页 |
| 502 / 2006 | 评论上游失败、格式或游标异常 | 展示失败和手动重试 |
| 503/504 / 2002、2004、2008 | 上游冷却、超时或队列繁忙 | 遵守重试提示，不循环请求 |
| 503 / 2009 | 显式mock模式无评论数据 | 测试时拦截请求提供夹具 |

## 7. 数据迁移、发布与回滚

账户迁移 `20261103120000_direct_messages` 仅新增 `DirectConversation`、`DirectMessage`、`DirectReadState`、`AccountEvent`、`AccountWriteLock` 及索引/锁种子，不改旧表结构，不清会话、不换数据库。`plan.json` 固定旧schema、新schema及SQL三个归一化LF的SHA-256。

`scripts/migrate-direct-messages.mjs --apply` 要求显式SQLite DATABASE_URL，校验目标schema/SQL，拒绝部分迁移或缺少锁种子；在事务内校验原账号、会话、好友、资料库、授权的完整行数据摘要及外键。重复执行检查新增表/索引定义，不抹除消息。

继续使用 `npm run deploy:echo -- --push`。发布脚本精确匹配会员迁移→私信迁移的已知哈希链，不允许未知schema变化；在原数据库上先做包含WAL的SQLite在线备份，再迁移。应用回滚恢复旧程序/配置，**保留新增表和发布后的消息**；不自动把旧备份覆盖回线上。迁移本身失败会回滚该事务；前置会员迁移若已成功则保留其兼容新增结构。

候选及正式验收新增 `verify-social-playlist-session.cjs`：用两个随机 `@example.test` 账号验证3条限额、回复解锁、幂等、SSE/补拉、已读、好友关系、排序/封面/冲突、真实只读评论及405。最终按精确用户ID和邮箱清理测试用户，级联清理本次消息。只有发布脚本输出 `PRODUCTION_VERIFIED` 且两个commit匹配才可报告上线。

## 8. 验证与接入清单

后端夹具在账户仓库 `tests/integration/account-social-playlist-routes.test.ts`、`direct-message-migration.test.ts`；评论夹具在音乐仓库 `tests/unit/track-comments.test.ts`、`tests/integration/music-track-comments-route.test.ts`。测试使用系统临时数据库和上游桩，不测试真实用户数据。

```powershell
# 仅账户仓库：生成客户端（不连接数据库）
node node_modules/prisma/build/index.js generate
# 两个仓库分别执行：
npm run test:run -- --fileParallelism=false
npx tsc --noEmit --incremental false
npm run build
# 音乐仓库：两个生产构建完成后，启动临时本地服务验证真实HTTP
node ops/scripts/verify-social-playlist-local.cjs
```

2026-11-03 最终验证：音乐仓库30个测试文件、152项通过；账户仓库12个文件、58项通过。两个仓库TypeScript检查和Next生产构建通过，Prisma schema校验及发布脚本语法检查通过。隔离临时库的真实生产构建HTTP验收输出 `SOCIAL_COMMENTS_PLAYLIST_REGRESSION_PASSED`、`LOCAL_BACKEND_HTTP_VERIFIED`，覆盖BFF、SSE、持久补拉、限额、好友、已读、排序和封面；评论使用本地上游桩，并实测HTTP写入405。临时账号、消息及事件已清理。构建阶段禁止Prisma初始化SQLite PRAGMA，避免构建触碰开发数据库。

本次未执行生产发布或生产数据库迁移，未运行新增前端的桌面/手机交互测试；本地接口桩和HTTP验收不代替生产验收。Claude后续需完成：会话/私信入口、额度提示、未读和已读、SSE生命周期、只读评论及分页、排序写入和冲突提示、封面即时更新，并自行做桌面/手机交互验证。
