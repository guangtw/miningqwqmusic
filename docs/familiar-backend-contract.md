# 熟人暗号：后端契约

账户服务 `guangtw/miningqwqlogin` 实现，Music 同源 `/api/account/...` BFF 通用代理。前端流程和题面协议见 [熟人暗号文档](familiar-verification.md)，共享类型是 `src/types/membership.ts`。

真实题目和答案只通过管理接口写入服务器，不进本仓库（公开）。下面的示例都是合成的。

## 1. 生效边界与接入

- 账户仓库 `guangtw/miningqwqlogin`；Music 同源 `/api/account/...` BFF 继续通用代理。不要直连账户服务或建立第二套登录状态。
- 共享契约为两个仓库逐字同步的 `src/types/membership.ts`。新管理界面使用 `MembershipAdmissionAdminState`、`MembershipAdmissionPolicyChanges`；旧 `MembershipPolicyChanges` 保留三个布尔开关，旧 `MembershipAdminState` 的决策类型只用于 legacy 模式。
- 沿用 `authed()`、Bearer、Cookie 续期、响应信封、UTC ISO 时间、服务端时间校准、`Cache-Control: no-store`、429/`Retry-After`。
- 后端只识别“熟人资格有效 / 尚未验证”，不判断现实身份。邮箱、IP 和暗号不能证明自然人唯一。
- 新功能默认 `familiarVerificationEnabled=false`、`admissionMode=legacy`、`ordinaryDispatchEnabled=false`、`ordinaryReservedNormalSlots=null`。原业务开关、已有会员和队列均不改。
- 旧前端显示全局队首承诺，所以新前端上线并联调完成以前必须保持 legacy。新模式只能由管理员主动切换。

## 2. 本人资格与答题

### GET /api/account/membership/familiar

`data: FamiliarStatus`，例：

```json
{"verified":false,"verifiedAt":null,"serverTime":"2026-11-05T12:00:00.000Z","canVerify":true,"reason":null,"nextChallengeAt":null}
```

`reason` 为 `verified / unavailable / email_verification_required / null`。`canVerify` 表示入口前置条件满足；具体挑战还能否提交，看挑战的 `available` 和 `attemptsRemaining`。`nextChallengeAt` 是上次挑战固定到期时间，过去的时间表示可以申请下一组，不代表自动刷新。

资格长期有效且独立于会员。已经排队、已经获码或正在会员期内，都可以验证；不会因此提交新会员申请、加时或换码。验证不依赖 SMTP Worker 心跳，也不依赖 `applicationsOpen`，但需要已确认邮箱及独立验证开关。

### 可选“什么时候认识我”

状态响应新增 `periodOptions:[{id,label}]`，只包含管理员已启用且题目齐备的时期。普通随机时期至少有一道对应题且可凑足两题；all严格时期必须固定两题均可用。`canUseRandom`决定是否提供不限定时期的随机入口。只公开标签，不公开内部圈子分组、题量、题目列表或答案。具体标签由管理员填写，不提供预置分类。

前端先让用户选择一个时期，或选择“不确定，随机试试”；也可直接跳过答题走普通申请。时期只是自述，不是身份核验，不要求真实朋友记得精确年份。进入时若已有未到期挑战，优先恢复挑战及其时期，不因下拉选项变动而重选；恢复调用下面接口即可。

### POST /api/account/membership/familiar/challenge

可无请求体、`{}`，或提交 `{"periodId":"从periodOptions选择的UUID"}`；`periodId:null`表示不限定时期。只接受公开时期ID，客户端不得提交题号、内部圈子分组或任意 userId。

```json
{
  "challengeId":"00000000-0000-4000-8000-000000000001",
  "serverTime":"2026-11-05T12:00:00.000Z",
  "expiresAt":"2026-11-06T12:00:00.000Z",
  "nextChallengeAt":"2026-11-06T12:00:00.000Z",
  "available":true,"attemptsRemaining":3,"period":null,
  "questions":[{"slot":0,"prompt":"服务端选中的题干"},{"slot":1,"prompt":"另一道题干"}]
}
```

- 至少两道启用题才能开放验证。始终抽两道，有多个内部分组时优先跨分组，否则同组抽不同题。
- 普通随机时期优先抽两道对应题，只有一道时用通用题补足；all严格时期按固定逻辑题目ID选两题，不补题。未选时期的随机池排除严格题目族，不足两题时要求选择可用时期，普通申请仍可用。
- 响应新增 `period:{id,label}|null`，是创建时的快照，按响应恢复表单。每账号一组固定24小时；刷新、重登、换设备、重复请求、改选时期或改选“不确定”都返回原题和原时期，不能提前换题或重置次数。到期后才能重新选择。
- 耗尽或停题后，复用接口返回 `available=false, questions=[]`，保留同一个 challengeId 和到期时间；不重置机会。
- 到期后用户主动点击才申请下一组；不要后台自动收集题目。

### POST /api/account/membership/familiar/verify

```json
{"challengeId":"上一步UUID","answers":["第一槽位答案",""]}
```

外层必须是两个槽位，顺序对应服务端slot，至少一项非空。文本槽位支持字符串或最多两个字符串的数组，每项最多128字符，任一可接受表达匹配即算该题正确；单选槽位必须提交本题选项ID字符串。未知字段（包括userId、题号）拒绝。文本进行NFKC、转小写、移除空白后匹配，其他表达由管理员配置别名。

- any挑战任意一题正确即成功；all挑战同一次提交两题都正确才成功。返回 `{passed:true,...FamiliarStatus}`，失败不返回部分得分、答对的题或匹配别名。具体题型及规则见下面的「题型与通过规则」。
- 答错返回 HTTP200、`{passed:false,serverTime,attemptsRemaining,nextChallengeAt}`，一次提交扣一次，最多三次。
- 无效、过期、耗尽、被停用或跨账号挑战统一 HTTP400/5921。资格不可用返回409/5920。
- 已成功账号重试返回成功，不重复授予、不增加验证依据。
- 成功失败都不回显提交文本。不要把答案放入 URL、localStorage、控制台、埋点或错误上报；验证 POST 不自动重试，网络不明时先查询资格。

## 3. 申请状态与排位

原 `GET /membership/application` 增加：

```json
{"familiar":{"verified":true,"verifiedAt":"2026-11-05T12:00:00.000Z"}}
```

其余申请状态、邮箱确认、撤回、重发、兑换和授权接口不变。验证后立即刷新申请状态。

- legacy：`queuePosition` 仍为原全局位置。
- familiar-first：`queuePosition` 只计算本人所属队列内的合格申请。验证成功立即转队，保留 queuedAt 和申请 ID；各队内按 queuedAt、id 排序。
- 不返回公开通道标识、另一条队列、人数上限、占用量、保护空位或调度诊断。
- 按用户要求保留队内排位的黑箱展示，不要求向用户解释内部两队列；必须去掉“下一个就是你”“前面所有人处理后必轮到”等总体顺序承诺。使用中性的“申请位置 / 等待通知”。
- 未验证不叫“陌生人”，未通过不否定其身份。普通申请入口始终保留。
- 已获码后补做验证不修改该码时长或截止；已开通不追加时长。下一次主动申请继续享有长期资格。

## 4. 管理题库

所有管理接口使用既有服务端 `requireAdmin`，普通账号返回403/5206，无登录返回401/5204。

### GET /api/account/admin/membership/familiar/periods

返回 `FamiliarAdminPeriod[]`，按sortOrder、id排序，包含id、label、enabled、sortOrder、创建/更新时间，以及仅管理员可见的targetedQuestions、generalQuestions、available。available还要求enabled=true；验证业务开关仍独立控制。没有预置时期，不删除历史时期。

### POST 同一路径

`{"label":"管理员自行填写的年份范围或相识阶段","sortOrder":0,"enabled":false}`，修改带原id。label为1～80字符，sortOrder为0～10000整数，enabled为布尔值，三项均必填。可修改标签、排序、启停。停用时期只阻止新挑战选择它，既有挑战继续使用原题与标签快照；泄露题目应另行停题。

时期标签是公开信息，别填写不希望外传的群名或个人信息。内部group继续只供管理员和服务端使用。

### GET /api/account/admin/membership/familiar/questions?cursor=<最后一条id>

返回最多50条 `FamiliarQuestionView[]`，按版本记录 id 升序。包含逻辑 questionId、版本 id/version、内部标题/分组/备注、题干、状态、答案数量、规范化版本、创建时间。**不返回答案或摘要**。每条版本记录都保留，可以展示版本历史。

### POST 同一路径

```json
{"title":"内部标题","group":"内部圈子分组","prompt":"用户可见题干","notes":"内部风险备注","status":"draft","answers":["由管理员填写的表达","另一种表达"]}
```

- 新题省略 questionId；编辑带原逻辑 questionId，始终新建版本，旧 active 版本转 retired。版本内容不可原地更改。
- title/group 各1～100字符，prompt 1～500，notes 最多500；答案1～20个，每个1～128字符，规范化后不能空。
- 新增可选 `periodIds:["时期UUID", ...]`（每题最多30个时期，可多选）。空数组表示通用题；新题省略也为通用题；编辑省略保留上一版本的时期关联，显式传空数组才清除。关联必须是服务器已存在的时期，允许暂未启用的时期用于准备题库。
- 每次保存必须提交完整答案集合；后台不能取回原答案。前端提供“替换答案集合”，不要用掩码字符串当旧答案提交。
- status 仅 `draft / active`。草稿启用也以创建新版本方式完成，需要重新输入答案。
- 普通编辑保留旧挑战在原24小时内的可验证性。泄露处理要显式停用，不要只改答案。

### DELETE 同一路径

```json
{"versionId":"要停用的版本UUID","allVersions":true}
```

默认只停所选版本；`allVersions=true` 停用该逻辑题目的全部版本，并使引用它们的未完成挑战失效。不自动撤销历史资格，不提前重置用户换题时间；不提供删除历史版本的接口。

## 5. 管理资格、验证依据与队列

### GET /api/account/admin/membership/familiar/recognitions

- 无查询或 `?cursor=<最后一条userId>`：最多50条 `FamiliarAdminAccount[]`，按 userId 升序，包含账号、资格、来源、时间、撤销与恢复限制。
- `?versionId=<题目版本UUID>&cursor=...`：筛出曾凭该版本通过的账号，包括后来已撤销的账号。
- `?userId=<账号ID>`：返回单账号 `FamiliarAdminDetail`，不可与 cursor/versionId 混用。可以先复用现有管理员账号搜索取得 ID。
- 详情包括昵称、邮箱、资格、每次成功依据、答对题目当时的标题/题干/版本、人工授予原因，以及最近20条挑战的次数/时间/失效状态/不可逆来源摘要。不展示提交明文。
- 挑战与成功依据新增periodId、periodLabel，后台标为“用户自选时期”，不要当作已核实的认识时间。成功依据保留创建挑战时的标签快照，后来重命名/停用时期或清理挑战不改变历史依据。
- 成功依据独立长期保存，不因挑战清理或180天操作审计过期而消失。账号删除时随账号级联删除。

### POST 同一路径

```json
{"userId":"账号ID","action":"revoke","reason":"简短管理原因，不填任何答案"}
```

action 为 `grant / revoke / unblock`；原因必填，最多300字符。返回最新单账号详情。

- grant：人工授予资格，记录证据和操作者，解除自行恢复限制；不会开会员。
- revoke：取消资格、阻止自行答题恢复，并作废未兑换的熟人优先码。对应 offered 申请原子回到普通 queued，queuedAt 保留、version增加、旧邮件取消、码预留释放。
- 重复 revoke 不重复重排；未兑换的 legacy/ordinary 码保留。已经兑换的会员保留，要撤会员须另用原授权撤销接口。
- unblock：只允许以后再次自行验证，不恢复优先、不取消会员申请的独立 blocked 状态。

### 原管理员接口扩展

`GET /admin/membership` 新增 `queues:{familiar,ordinary}`、`nextApplicationId`、`nextLane`、`familiar:{activeQuestions,activeRecognitions,warnings}`。数量和队列均为合格 queued；顶层 queued 仍为全部 queued。

预览使用与 Worker 相同的候选选择器。`nextDecision.allowed` 是容量/策略判断；是否实际执行仍需结合 `policy.dispatchEnabled`。新增 reason：`ordinary_paused / reserve_unconfigured / protected_capacity`。

warnings：少于2题 `insufficient_questions`，2～5题 `small_question_bank`。提醒不代表6题就安全，不限制最终题库数量。

`GET /admin/membership/applications?lane=familiar|ordinary&cursor=...` 查询指定队列的真实 queuedAt、id 顺序。省略 lane 保留旧全状态、id排序接口。返回新增 offerLane/offerEvidenceId 和账号当前资格元数据；发码来源快照与当前资格是两回事。

## 6. 管理策略与限速

原 `PATCH /api/account/admin/membership` 继续接受三个旧开关，另接受以下字段（全部可选，至少一个）：

| 字段 | 默认 | 范围/含义 |
| --- | --- | --- |
| admissionMode | legacy | legacy / familiar-first |
| familiarVerificationEnabled | false | 至少两道 active 题才能开启 |
| ordinaryDispatchEnabled | false | 开启前必须配置 R |
| ordinaryReservedNormalSlots | null | null 或整数0～9，由用户配置，无默认份额 |
| familiarChallengeIpDailyLimit | 20 | 1～10000，新挑战/IP/24h |
| familiarChallengeGlobalDailyLimit | 200 | 1～100000，新挑战/全站/24h |
| familiarVerifyUserDailyLimit | 12 | 1～1000，提交请求/账号/24h，包括伪造挑战ID |
| familiarVerifyIpHourlyLimit | 60 | 1～10000，提交请求/IP/小时 |
| familiarVerifyGlobalDailyLimit | 1000 | 1～100000，提交请求/全站/24h |

每挑战3次及固定24小时为产品规则，不被请求配额放大。限额跨进程、跨重启持久化；同校园/家庭IP会共享IP额度，可由管理员调整，不声称能阻止分散多账号。

生产继续要求 Nginx 覆盖真实IP、Music及账户端口仅回环、可信转发配置一致；BFF不采信客户端XFF链。来源摘要与答案摘要使用不同的HKDF用途密钥，沿用稳定JWT秘密，不需要把新秘密写入前端。

## 7. 调度与容量（只供管理员/开发者）

- legacy 保留先来先服务及原3/7天预算、软区控制，不受普通新开关影响。
- familiar-first 先选熟人；有熟人等待时不发普通，熟人软区未等满24小时也不改发普通。
- 普通只能在无合格熟人等待且 ordinaryDispatchEnabled=true、R已配置时获批，必须 `C+1 <= 9-R`，不进入软区。
- 两类仍动态发3/7天，熟人软区3天；各队列独立预算，同批次同队列冻结正常时长。
- 所有有效会员、历史权益、人工码、申请码预留照旧计入C；没有额外虚拟会员容量。
- 每次发行、撤销和兑换共用SQLite写锁。已发码不因后续资格变化加时或升级。
- 普通不承诺最终获批。严格熟人优先下可能长期等待，这是选定的策略。

## 8. 错误

新增：5920/409验证不可用；5921/400挑战无效或不可继续；5922/404题目不存在；5923/409策略配置不满足条件；5924/503安全降级；5925/409时期不可选或配置无效、404指定时期不存在；5926/400题型/选项定义错误；5927/400固定ID无效、409严格题组启用条件未满足。继续处理原限速、繁忙、账号不存在和鉴权错误，不清空登录状态或重复注册。

## 9. 迁移、切换与回滚

新增迁移 `20261105120000_familiar_membership`：4张表、申请2个可空字段、策略9个带安全默认值/可空字段。SQL仅CREATE和ADD COLUMN，不重建旧表、不清空数据库。前后schema及SQL三项SHA256、逐原表原字段摘要、外键检查、重复执行及部分结构拒绝均有校验。

Music已将新迁移接入现有精确白名单。生产发布走标准 `npm run deploy:echo -- --push`，先在线备份原库，账户源码至少是 c17dc76（支持必答题轮换，配多于两道必答题时必须用它），不要误用旧的相邻main。

认识时期另用增量迁移`20261105130000_familiar_periods`，不改已发布的上一份SQL。新增1张时期表、题目periodIds（旧题默认空数组/通用）、挑战及证据各2个可空快照字段。不填充真实时期，不重抽旧挑战，不重置答题次数，不改变旧成功资格；仍由原增量迁移器逐字段校验和整笔提交。兼容无请求体的旧客户端。

选择题和全对规则新增精确迁移`20261105140000_familiar_question_rules`，只ADD COLUMN七个字段，旧文本与any规则兼容。回退到不识别单选ID或all的旧版本前先关闭验证，保留新增数据；不能让旧验证器以any规则处理严格挑战。

顺序：发布兼容后端并保持legacy → 发布前端并联调 → 管理员录入真实题库 → 开启验证 → 用户自行确定R及普通开关 → 切换familiar-first。配置不是前端自动初始化行为。

回退保留新增表、资格、验证依据和后续会员数据。回到未识别新策略的旧Worker会重新FIFO发码，因此先关闭dispatchEnabled并停旧Worker；只有确认回退版本兼容后才恢复。不能恢复旧数据库覆盖新数据。

真实时期选项、题库、R和开放时间由用户决定。小题池和公开自选时期会使已外传答案更容易被定向找到，因此时期选择不增加身份可信度，仍需沿用限速、固定挑战、停题和撤销机制。

## 10. 题型与通过规则

本节覆盖上文「仅支持文本答案、任意一题即通过」的描述。

### 题型 1. 管理员保存题目

仍用 `POST /api/account/admin/membership/familiar/questions`，服务端管理员校验不变。

原字段保留；新增可选 `kind:"text"|"single_choice"`、`choices:string[]`。新题省略kind为text；编辑省略kind保留上一版。每次保存都生成不可变新版本，并要求重新提交完整answers。

填空示例（全部是合成测试示例，与真实题库无关）：

```json
{
  "title":"示例填空","group":"示例分组","prompt":"填写任意一个示例词",
  "kind":"text","answers":["示例词甲","示例词乙"],"status":"active","periodIds":[]
}
```

answers是可接受表达集合，NFKC、大小写、空白兼容沿用。一个答案匹配即可算该题正确。填空不接受非空choices。

单选示例：

```json
{
  "title":"示例单选","group":"示例分组","prompt":"请选择一个示例选项",
  "kind":"single_choice","choices":["示例选项甲","示例选项乙","示例选项丙"],
  "answers":["示例选项乙"],"status":"active","periodIds":[]
}
```

- choices为2～12个字符串，每个最多128字符；规范化后不能空或重复。
- 单选answers必须恰有一个值，并与某个选项规范化后一致。标准答案只保存HMAC摘要，不保存“正确选项”标记。
- 服务端为每个版本的每个选项生成不透明UUID；客户端不能指定选项ID或正确标记。
- 管理查询/保存返回 `kind` 和 `choices:[{id,label}]`，不返回answers、摘要或正确标记。
- 编辑单选时省略choices保留旧版的选项文字，但新版本重新生成选项ID。显式切换到text时清除选项。
- 不允许传入诸如 `{label,correct:true}` 的选项对象。

### 题型 2. 配置固定全对通道

`POST /api/account/admin/membership/familiar/periods` 新增：

```json
{
  "id":"已有时期UUID","label":"管理员配置的时期标签","sortOrder":0,"enabled":true,
  "passRule":"all","requiredQuestionIds":["题目甲逻辑UUID","题目乙逻辑UUID"]
}
```

- passRule为any或all，旧记录默认any；编辑省略保留原规则。
- requiredQuestionIds是空数组，或2～12个不同的、服务器已存在的逻辑题目ID。两个时固定考这两题；多于两个时每个挑战从中抽两题，同样优先跨内部分组，所以把强题单独放一组，它就每次必考。省略保留原集合，显式空数组清除。
- any且无固定ID时沿用时期随机抽题；any也可以配置固定两题。
- all在启用前必须配置必答题，其中至少两题active并关联本时期。不能用通用题或其他时期题补足。
- 新建时期可先disabled，录入两题并取得questionId后，再配置all、固定ID并启用。
- 题目改版不改变逻辑questionId，正常编辑的旧挑战仍使用原版本及原选项；必答题停用后只在剩下的必答题里继续抽，不足两题时新挑战不可创建，不会自动替换为其他题。
- 普通启停/改名保留原挑战。修改通过规则或固定集合会使该时期未完成挑战失效，原24小时冷却和次数不重置。
- 配成严格必答的题目族不进入“不确定/随机”或弱规则时期的候选池，包括严格时期暂停时；配置严格规则时，其他通道中引用这些题的不兼容旧挑战也会失效。
- 已经授予的长期资格不因规则改动自动撤销；仍由管理员单独审查和撤销。

### 题型 3. 本人状态与题目下发

原 `GET /api/account/membership/familiar` 新增 `canUseRandom:boolean`。如果只剩严格题组，canVerify可为true但canUseRandom=false；前端仍提供普通申请或跳过答题，不自动退回较弱题组。

创建/恢复挑战仍用 `POST /membership/familiar/challenge`，请求可以为空、`{}`、`{periodId:null}`或`{periodId:"UUID"}`。一个账号的题目、时期、选项顺序、规则和24小时截止均固定；重复请求或切换时期不重抽。

挑战新增passRule、requiredCorrectCount，以及题目kind/options：

```json
{
  "challengeId":"服务端UUID","passRule":"all","requiredCorrectCount":2,
  "serverTime":"ISO UTC","expiresAt":"ISO UTC","nextChallengeAt":"ISO UTC",
  "period":{"id":"时期UUID","label":"公开标签"},"available":true,"attemptsRemaining":3,
  "questions":[
    {"slot":0,"prompt":"服务端单选题干","kind":"single_choice","options":[
      {"id":"选项UUID甲","label":"选项文字甲"},{"id":"选项UUID乙","label":"选项文字乙"}
    ]},
    {"slot":1,"prompt":"服务端填空题干","kind":"text"}
  ]
}
```

选项仅含id、label。显示顺序由服务端用安全随机数生成并保存；前端直接按返回顺序展示，不在刷新时自行洗牌。题目版本ID、标准答案、匹配项、正确选项和部分得分都不下发。

### 题型 4. 提交与判分

仍用 `POST /api/account/membership/familiar/verify`：

```json
{"challengeId":"挑战UUID","answers":["用户选择的选项UUID","用户输入的文本"]}
```

- 外层必须是恰好两个槽位，按服务端slot对齐。
- 单选槽位只接受本题当前挑战版本内的一个选项ID字符串。直接提交正确答案文字、其他题ID、旧版本ID、任意UUID或选项ID数组都不能算答对。
- 文本槽位可为一个字符串，或最多两个字符串的数组。数组内任一项匹配该题可接受答案即算该题正确，适用于一道题两个输入框的情况；只填一个框也可以。
- 每项文本最多128字符；可以部分留空，但不能整体全空。all规则下任一题留空都不会通过。
- any要求至少一个题目匹配；all要求同一次提交两个题目都匹配。不会累计不同失败提交的部分得分。
- 每次提交最多消耗一次机会，all仅答对一题也消耗一次；最多三次。失败不创建资格或成功依据，不提前消耗整个挑战。
- 响应仍只有整体passed及次数/冷却，不泄露哪一题正确、正确数或匹配别名。成功幂等，失败次数与全站/账号/IP额度跨进程持久化。
- 失败后前端可保留用户输入，重新提交两个槽位；不要自动重试提交POST，不存入日志、埋点或localStorage。

### 题型 5. 管理追溯、错误、兼容

- 成功依据新增passRule，保留通过时规则、时期快照和答对的版本。all成功必须记录两题；不保存用户提交文本或选择ID。
- 管理员最近挑战元数据包含passRule，题目管理可查看题型及候选项；答案仍为写入后不回显。
- 5926/400：题型/选项/正确答案配置不合法。5927/400：固定题目ID非法或不存在；5927/409：启用严格时期前配置未齐备。其余错误沿用基础交接。
- 旧文本题、旧any时期、旧客户端字符串槽位、已有会员及邀请码均兼容。新客户端按kind渲染，按passRule说明要求；不要依赖标签文字猜测规则。
- 新迁移 `20261105140000_familiar_question_rules` 只ADD COLUMN七个字段，旧题为text、旧挑战/依据/时期为any，choiceOrder/choices/requiredQuestionIds为空JSON。沿用旧字段摘要、精确SHA256、外键及重复执行校验；不改已发布的旧SQL，不录入真实题库。
- 回退到不识别all规则或选择题ID的版本前，必须先关闭familiarVerificationEnabled；保留数据库新字段和后续数据，不能恢复旧库。
