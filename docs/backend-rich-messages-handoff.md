# 私信音乐卡片与一起听邀请：Claude 前端交接

本次只改后端、共享 DTO、测试及迁移/验收支持，未实现前端卡片界面，也未发布生产。文字私信的基础协议继续有效，参见 [原交接](backend-social-playlist-handoff.md)。新增内容以本文为准。

## 1. 已实现的能力

- 歌曲、专辑、网易云歌单分享卡片，可附带文字。
- Echo 自建歌单分享：服务端读取发送者全部分卷并保存不可变快照；完整曲目仅会话双方可读取，原歌单之后修改/删除不影响已经分享的副本。
- 现有“一起听”邀请接口自动生成一条私信消息；不需要前端额外发送文字。重复点击同一个尚待回应的邀请不重复建消息。
- 接受、拒绝、主动离开导致的取消、过期和进程重启导致的房间失效更新原邀请消息，通过持久 SSE 事件同步。
- 所有消息仍提供 `text` 文字摘要，当前旧聊天页可展示提示；原有文字请求无需修改。

本轮不包含图片、语音、文件上传、任意链接富卡片、撤回或删除消息。邀请本身仍使用既有内存房间，未把一起听房间改造成跨进程持久化服务。

## 2. 类型和兼容

完整类型在两个仓库的 `src/types/social.ts`，保持逐字一致：`SendDirectMessageInput`、`DirectMessageContent`、`SharedAlbum`、`SharedPlaylist`、`SharedMessageResource`、`ListenInvitationCard` 等。

新服务器的 `DirectMessageDto` 总是返回：

```ts
{
  id, conversationId, sequence, senderUserId, clientMessageId,
  text,       // 兼容旧页的摘要；卡片正文请读取 content.caption
  createdAt,  // 创建时间，不因邀请状态改变
  updatedAt,  // 内容更新时间；同一消息的状态更新单调前进
  kind,       // text | track | playlist | album | listen_invite
  content     // text 为 null；其他类型为带 version:1、kind 的结构化内容
}
```

类型中的 `kind/content/updatedAt` 标为可选，专门兼容本地缓存、旧 SSE 日志及现有文字测试夹具。缺少kind按text处理；未知类型或未知content.version回退显示 `text`。所有名称、正文、caption、简介均以普通文本渲染，禁止作为HTML执行。

账户消息与事件继续使用同源 `/api/account/...` 和现有 `authed()`。SSE仍通过Bearer fetch流，沿用已有游标补拉、token续期和退出时Abort流程。详情见 [原交接](backend-social-playlist-handoff.md#3-账户事件与-sse)。

## 3. 发送音乐卡片

沿用现有接口：

`POST /api/account/messages/users/{peerUserId}/messages`

文字旧格式 `{clientMessageId,text}` 和显式 `{clientMessageId,kind:"text",text}` 均保留。

### 歌曲

```json
{
  "clientMessageId": "前端生成并保留的UUID",
  "kind": "track",
  "text": "分享给你",
  "resource": {
    "id": "186016",
    "name": "晴天",
    "artists": [{"id":"6452","name":"周杰伦"}],
    "album": {"id":"18905","name":"叶惠美"},
    "durationMs": 269000,
    "coverUrl": "https://p1.music.126.net/example.jpg"
  }
}
```

resource使用共享Track的展示字段。`album`、`coverUrl`可省略；artists最多20个，名称最多200字符，durationMs为0–86400000整数。资源ID最多128字符，仅允许字母、数字、下划线和连字符。

### 专辑和网易云歌单

```json
{
  "clientMessageId": "另一个UUID",
  "kind": "album",
  "resource": {
    "id":"18905", "name":"叶惠美",
    "artists":[{"id":"6452","name":"周杰伦"}],
    "trackCount":11
  }
}
```

```json
{
  "clientMessageId": "另一个UUID",
  "kind": "playlist",
  "resource": {"id":"3778678","name":"热歌榜","trackCount":100}
}
```

专辑和歌单均可附带text、coverUrl、trackCount；歌单可附description（最多1000字符）。歌单resource不带tracks。导入/收藏的网易云歌单使用此格式。

这三种资源的展示快照由调用方从现有音乐详情/搜索结果提取，不代表官方认证信息；打开时按资源ID重新请求权威详情。后端不会把这些字段作为播放授权依据，不接受resource里的播放URL、下载URL、Cookie及未定义字段。名称等文字可能包含HTML字面量，必须按普通文本显示，不解析或执行。不要直接把包含扩展字段的整个上游对象提交，应按DTO挑选字段。

coverUrl只允许无用户名/密码、无fragment的HTTP(S) URL，最多2048字符；不传data URL、javascript URL或本机blob URL。它只作图片地址，后端不会请求它。可省略封面让前端使用占位图。

### Echo 自建歌单

```json
{
  "clientMessageId": "另一个UUID",
  "kind": "playlist",
  "text": "这是我的通勤歌单",
  "playlistId": "mine-abc123"
}
```

`playlistId`与`resource`必须二选一。只允许分享发送者自己存在的 `local://playlist/<id>` 自建歌单头，不可指定其他用户、分卷或用此参数引用网易云链接歌单。发送前先等当前歌单待同步操作完成，后端分享的是**云端已保存状态**。

卡片响应：

```json
{
  "version":1,
  "kind":"playlist",
  "caption":"这是我的通勤歌单",
  "source":"echo_snapshot",
  "playlist":{"id":"mine-abc123","name":"通勤","trackCount":80},
  "hasSnapshot":true
}
```

完整曲目不塞进历史列表和SSE；点击卡片时由双方调用：

`GET /api/account/messages/{messageId}/resource`

返回 `{kind:"playlist",source:"echo_snapshot",playlist:{id,name,...,tracks:Track[]}}`。可以用tracks建立临时播放队列；不要把对方的mine-ID直接导航到自己的自建歌单路由。后端限制快照最多10000首、2MiB序列化JSON；超过返回413。接收者读快照无需额外成为好友，凭的是该私信会话参与者身份。第三人、未登录用户无法读取；没有公开下载链接。

同一路由对歌曲/专辑返回相应展示资源，对网易云歌单返回source=netease的引用。播放仍逐首请求现有play-url接口，会员和音源授权照常判断。

### 幂等、额度及返回值

- 卡片和文字共用陌生人3条限额、回复解锁规则及每发送者每分钟30条限制。卡片只计一条，与其附言合为一个消息。
- text在卡片请求里是可选附言，去首尾空白后最多2000字符；服务器返回的text则是附言加资源摘要。渲染卡片附言请读 `content.caption`，避免重复显示标题。
- 返回仍为 `MessageSendResult`，即 `{message,conversation}`，并向双方推送 `message.created`。
- 网络重试复用相同clientMessageId和**原请求快照**，不要重新抓取元数据后复用同一ID。正文、种类、收件人或资源字段改变应生成新ID，否则409/code5803。
- 自建歌单ID分享的重试返回第一次创建的原快照，即使源歌单随后改变或删除，也不会静默重拍。

## 4. 一起听邀请自动进私信

继续调用已有入口：

`POST /api/account/listen/rooms/{roomId}/invites`，请求 `{friendUserId}`。

也可直接沿用现有前端 `inviteFriend(friendUserId)`，它负责准备房间。服务端校验好友、房间及发起者身份后，先将邀请消息与双方事件提交，再把邀请发布到内存房间。消息事务失败时不会留下一条可接受的假邀请；邀请受同一30条/分钟发送频率限制。

成功返回原 `ListenRoomInviteSummary`，额外可选字段 `messageId`、`conversationId`，便于Claude邀请后导航聊天。普通邀请列表和操作响应不保证带这两个字段，以现有卡片保存的ID为准。

**不要再调用发送文字消息接口补发“邀请你一起听”**。服务端已自动建立消息，当前旧聊天页也会显示 `[一起听邀请] 等待回应`。

```json
{
  "kind":"listen_invite",
  "text":"[一起听邀请] 等待回应",
  "content":{
    "version":1,
    "kind":"listen_invite",
    "invitation":{
      "inviteId":"服务器生成的邀请ID",
      "roomId":"房间ID",
      "inviterUserId":"发送者Echo用户ID",
      "inviteeUserId":"接收者Echo用户ID",
      "status":"pending",
      "expiresAt":"ISO时间",
      "respondedAt":null,
      "currentTrack":{"id":"186016","name":"晴天","artists":[],"durationMs":269000}
    }
  }
}
```

卡片不暴露inviteCode，只提供合法邀请ID。禁止前端直接发送 `kind:"listen_invite"` 或客户端构造邀请状态，服务器会返回400。

### 接受、拒绝和状态

- 仅 `auth.user.id === invitation.inviteeUserId` 且status=pending时显示接受/拒绝操作。发送者显示等待状态。
- 接受调用现有 `POST /api/account/listen/invites/{inviteId}/accept`，最好复用前端已有 `acceptInvite(inviteId)`，让房间播放状态、SSE和播放器保持现有接入方式。
- 拒绝调用现有 `POST /api/account/listen/invites/{inviteId}/reject`，复用 `rejectInvite()`。
- 请求返回后可以调用新增 `GET /api/account/messages/{messageId}` 刷新原消息，也会收到 `message.updated`。不要人工另发一条状态文字。
- 同一pending邀请的重复点击重用同一inviteId/messageId；拒绝后再次邀请会生成新的邀请和消息，旧卡片保留拒绝状态。
- 同一接受请求在用户仍在该房间时可幂等重试；拒绝也可重复提交。接受后已离开不能用旧卡重新消费邀请，请发新邀请。
- 房间满员时返回409/code5506，邀请保持pending，可等空位后重试，不会提前显示已接受。
- 通过房间码加入也会同步卡片为accepted。

状态为 `pending|accepted|rejected|canceled|expired|unavailable`。后五种不再显示接受按钮。发起者离开或房间关闭会取消pending卡片；到期变expired；账户进程重启会丢失内存房间，未完成卡片变unavailable，消息历史仍保存。已接受/拒绝的历史状态不因房间消失而改写。

过期/失效会在账户事件轮询、消息查询或相关房间操作时持久化并推送；SSE通常每秒检查一次。创建提交到内存发布存在短暂窗口，房间缺失的后台判断保留5秒宽限；明确操作一个已丢失的邀请会立即返回410并标记unavailable。这里不承诺房间跨进程或重启恢复。

## 5. 前端事件和合并要求

已有 `message.created` 带完整类型化message，按ID去重并更新会话/未读。新增：

```ts
type MessageUpdatedPayload = { message: DirectMessageDto };
// SSE event: message.updated
```

- `message.updated` 应按message.id替换已存在消息；不要把它当新消息追加，不增加未读、sequence或发送额度。
- 同一ID以较新的updatedAt为准；旧缓存没有updatedAt时使用createdAt。HTTP摘要和旧created事件不应覆盖较新的邀请状态。服务端状态更新时间单调前进。
- 如果它是会话lastMessage，同步更新会话摘要text/content；不要因状态更新修改会话排序时间，createdAt和sequence没有改变。
- 旧SSE日志仍可能没有kind，需回退文字。新事件和断线补拉仍使用原持久化事件游标，status不会只存在本机内存。
- 自动接受/拒绝的状态更新不计为接收者主动发送消息，不会单独解锁“双方互相回复”规则。

Claude接入位置建议：扩展 `src/frontend/lib/messages.ts` 的发送outbox与merge逻辑，`lib/events.ts` 添加updated事件处理，`views/Chat.tsx` 根据kind渲染卡片；歌曲/歌单/专辑的现有菜单增“分享给好友”；已有一起听按钮保留原API，只利用messageId跳转或提示。保持现有字体、布局和动效，不在客户端伪造系统卡片。

## 6. 新错误码与兼容处理

| HTTP / code | 含义 |
| --- | --- |
| 400 / 5101 | 未支持的消息种类、越界/未知字段、不合法封面、歌单两种来源同时传或都不传 |
| 413 / 5102 | 自建歌单快照或请求超过预算 |
| 409 / 5803 | clientMessageId被用于另一种请求 |
| 404 / 5806 | 消息不存在或不属于当前会话参与者 |
| 404 / 5808 | 当前发送者没有该自建歌单 |
| 404 / 5809 | 该消息没有可读取的音乐资源/快照 |
| 409 / 5810 | 邀请与已记录消息身份不一致 |
| 410 / 5811 | 已知邀请的内存房间已消失 |

原5804陌生人限额、5805频率限制及Retry-After继续适用。一起听还保留5505房间关闭、5506满员、5704邀请不存在/越权、5705已处理、5706邀请人离开等错误。失败时保留outbox原始请求，按错误类别提示重试，不能把客户端重复动作变成新的邀请气泡。

## 7. 迁移与验证

迁移 `20261103160000_rich_direct_messages` 只新增 `DirectMessageContent` 表及索引，通过messageId级联引用原消息，原文字表、sequence、计数、已读、事件、用户及会话数据均保留。旧程序会忽略新元数据并显示text摘要，应用回滚保留新增表和用户新消息。

每个迁移保留target-schema快照及精确SQL/schema哈希，解决旧私信迁移→新卡片迁移连跑时校验最终schema的问题。发布脚本已经接入已知迁移链；仍应通过 `npm run deploy:echo -- --push` 备份原库、迁移、候选验证后再切换。不要使用空库替代原库，不在开发者dev.db上试迁移。

本地验证使用临时库、`@example.test`账号和上游桩；新增接口测试见账户仓库 `tests/integration/rich-direct-messages.test.ts`，迁移测试见 `rich-message-migration.test.ts`。音乐仓库 `ops/scripts/verify-social-playlist-local.cjs` 可启动两个生产构建，验证真实BFF/SSE传输和新卡片接口；服务器候选/正式验收脚本也已加入卡片与邀请检查。

2026-11-03验证结果：

- 账户仓库完整回归：15个文件、78项测试通过；新增卡片/邀请12项，增量迁移4项（含DDL完成后校验失败的事务回滚）。
- 音乐仓库合入最新私信入口前端更新后：34个文件、195项测试通过。本任务未修改任何 `src/frontend` 文件。
- 两仓库TypeScript检查及Next.js生产构建成功，Prisma schema校验通过；共享 `social.ts` 文件哈希一致。
- 两个生产构建使用隔离临时库完成真实HTTP/BFF/SSE联调：卡片created、邀请created和accepted后的updated事件均携带类型化内容，同一邀请的sequence不变；自建歌单资源、旧文字限额/已读及排序/只读评论回归通过。
- 本地验收输出 `RICH_MESSAGES_AND_LISTEN_INVITATION_REGRESSION_PASSED`、`SOCIAL_COMMENTS_PLAYLIST_REGRESSION_PASSED` 和 `LOCAL_BACKEND_HTTP_VERIFIED`，临时测试账号已清理；未迁移用户现有数据库。

本次不自动发布生产，Claude接入后仍需检查：桌面/手机卡片排版、分享菜单/outbox重试、冷启动/断线补拉、updated覆盖顺序、邀请按钮权限与重复点击、无效卡片提示及私有歌单临时播放队列。
