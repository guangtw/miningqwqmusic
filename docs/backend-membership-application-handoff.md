# 会员申请与邮箱辅助登录：Claude 前端交接

本轮实现账户服务后端、Music 同源 BFF 保护、共享类型、数据库迁移、持久后台任务和测试。没有修改现有前端组件、布局、样式、字体或动效。Claude 负责在最新 origin/main 上制作前端。后端上线状态以生产 /__deployment.json 和对应 Release 为准；会员申请和自动发放默认关闭，需要完成前端联调后由管理员开启。

## 一、产品规则（已与用户确认）

- 无人数下限，不主动补足任何人数。有效永久/限时会员和全部有效未兑换码的预留名额合计为 C。
- 正常发放后 C < 10。第十个至第十五个占用属于软限制区，不是自动填满的目标。
- 软限制区仅当队首等待至少 24 小时、上次额外发放距今至少 24 小时、且未来 24 小时保守预测不能恢复正常发放时，批准队首一人，只给 3 天。
- C = 15 时不能新增名额。人工发码、人工永久授权也受硬顶约束。会员实际在线状态不影响计数。
- 正常区域按未来 8 天可用人天预算与当前合格队列人数决定 3/7 天；一次调度批次统一正常时长。具体数学规则见 membership-admission-design.md。
- 申请码是 Mining-VIP-3d-<32位随机十六进制> 或 Mining-VIP-7d-<随机标识>，绑定申请账号，创建后 24 小时内兑换。会员从兑换成功开始按 24 小时/天计算。
- 排队时不占名额。生成兑换码时占位，兑换后转为有效会员，过期/取消时先禁用码再释放预留。
- 已是有效会员不能申请或用申请码叠加时长。到期后可主动重新申请，进入队尾，无自动续期。历史人工限时码仍按原协议允许续期。
- 正常密码登录继续保留；“忘记密码/邮箱辅助登录”使用验证码登录已有账号。不会自动创建账号，也不会自动修改或重置原密码。
- 账号邮箱确认一次即可申请。邮箱验证码登录成功同时确认邮箱，不再要求为会员申请重复验证。
- 一个账号一条当前申请；验证码/兑换码不能跨用途或跨账号复用。邮箱验证不等于自然人唯一认证。
- SMTP sent 表示发信服务商接受投递，不代表进入收件箱或已阅读。请提示可查看垃圾邮件。

## 二、接入约定

账户相关请求继续走网站同源 /api/account/...，沿用现有 authed() 和账户状态恢复、Token 续期及退出流程。不要直连账户服务端口。

所有接口沿用信封：
成功：{code:0,data:...,message:"ok",traceId:"..."}
失败：{code:5905,message:"...",traceId:"...",retryable:false}
可能有 retryAfterSeconds 和 Retry-After；所有响应 Cache-Control: no-store。

共享 DTO 为两个仓库逐字一致的 src/types/membership.ts。AccountUser 新增可选 emailVerifiedAt:string|null，兼容旧缓存；缺少此字段不能当作邮箱已确认，应查询会员状态接口。时间均为 ISO UTC；界面按用户当地时区展示，倒计时使用服务端 serverTime 校准，不以客户端时间决定权限。

普通用户接口必须使用登录账号，不允许提交任意 userId 或更换收件邮箱。邮箱确认邮件发送至数据库中的账号邮箱。

## 三、邮箱辅助登录

GET /api/account/auth/email（不要求登录）
返回：
{enabled:true,available:true,codeLength:6,expiresInSeconds:600,resendAfterSeconds:60}

available 依赖邮件配置与持久 Worker 最近心跳；不可用时保留密码入口，并显示稍后重试，不要反复自动发验证码。

POST /api/account/auth/email/request（不要求登录）
请求：{email:"member@example.test"}
返回：
{
  challengeId:"3b52422b-05af-4457-9199-bb56ec49fc2a",
  expiresAt:"2026-11-04T12:10:00.000Z",
  resendAfter:"2026-11-04T12:01:00.000Z",
  serverTime:"2026-11-04T12:00:00.000Z"
}

未注册邮箱返回相同格式，但不会注册或发邮件。界面统一提示：“如该邮箱已注册，将收到登录验证码；新用户请先注册。”不能通过发送接口判断账号是否存在。每次重发会替换该邮箱同用途的旧验证码，必须保存最新 challengeId。

POST /api/account/auth/email/verify
请求：{challengeId:"上一步返回的UUID",code:"012345"}
成功 data 与现有密码登录完全一致：{accessToken,user,playbackAuthorization}，同样设置 HttpOnly 刷新 Cookie。请调用与密码登录相同的登录完成逻辑，不建立第二套登录状态或存储验证码。失败不会清理已有 Cookie，不要在失败时调用 logout。

验证码 6 位，保留前导零；10 分钟有效，最多 5 次错误，成功后立即消耗。重新发送至少间隔 60 秒。邮箱发送额度跨登录/会员确认两种用途共享：每邮箱 10 次/24h、每来源 IP 50 次/24h、OTP 请求全站 300 次/24h。验证另有限速；实际自动邮件发送也有全站 300 次/24h 配额。配额窗口从首次操作开始计，不是本地自然日。

页面文案为“邮箱辅助登录”或“验证码登录”；此接口不是设置新密码接口。注册继续使用现有 auth/register，修改密码仍沿用原有规则。

## 四、会员申请邮箱确认

POST /api/account/membership/email/request（Bearer）
无请求体；响应与登录验证码请求相同。收件地址由服务器读取，前端不能覆盖。

POST /api/account/membership/email/verify（Bearer）
请求：{challengeId:"UUID",code:"012345"}
返回最新 MembershipStatusResponse。此验证码仅确认当前登录账号邮箱，不创建新登录会话。确认成功后还需调用提交申请接口；不会在用户只验证邮箱时擅自排队。

## 五、提交、查询、取消与邮件重发

GET /api/account/membership/application（Bearer）
返回示例：
{
  serverTime:"2026-11-04T12:00:00.000Z",
  applicationsOpen:true,
  dispatchEnabled:true,
  emailLoginEnabled:true,
  emailVerifiedAt:"2026-11-04T11:58:00.000Z",
  canApply:false,
  reason:"application_exists",
  application:{
    id:"application-id",status:"offered",version:1,
    queuedAt:"2026-11-04T11:59:00.000Z",
    offeredAt:"2026-11-04T12:00:00.000Z",
    durationDays:7,redeemBy:"2026-11-05T12:00:00.000Z",
    queuePosition:null,deliveryStatus:"pending",resendAfter:null
  }
}

reason 可为 already_member / applications_closed / email_verification_required / application_exists / application_blocked / null。application 初次为 null。前端按 reason 和 status 展示，不要仅凭 canApply=false 推断申请失败。

POST /api/account/membership/application（Bearer，无请求体）
提交当前账号申请，重复请求返回当前状态，已排队不会重新排队。状态为 expired/cancelled/redeemed 且会员已失效时，可主动重新申请；version 增加、排队时间重新计算。被管理员 blocked 的账号申请需管理员解除。

DELETE /api/account/membership/application（Bearer）
撤回 queued/offered，已发出的码同时禁用。重复撤回安全；不会撤销已经兑换获得的会员。

POST /api/account/membership/application/resend（Bearer）
重发当前有效申请码，同一张码、同一兑换截止时间，不延长期限、不增加名额。每次间隔至少 60 秒，每账号最多 5 次/24h。请求成功表示入队，仍需查询 deliveryStatus，不代表邮件已送达。

申请状态：
- queued：已排队；queuePosition 为当前队列位置，非固定编号，不承诺准确获批时间。
- offered：已预留，展示 durationDays、redeemBy 和邮件状态，提供输入兑换码入口。
- redeemed：已经开通；刷新现有 auth/me 或 entitlement 更新会员卡。
- expired：兑换机会已失效，可重新申请。
- cancelled：已撤回/管理取消，可按 canApply 再申请。
- blocked：管理限制；不显示重复提交按钮。

邮件状态独立于申请：
pending 等待发送；processing 发送处理中；sent 服务商接受；failed 自动重试耗尽，可在码有效时重发/管理员重试；cancelled 任务失效或取消。申请码仍有效但邮件失败时，不应再次申请生成新码。

建议仅在相关页面可见且状态 queued/offered 时每 15～30 秒查询，并在页面重新可见、兑换完成后立即刷新。退出登录时取消轮询。无须新增 SSE 连接。

## 六、兑换和会员卡

沿用 POST /api/account/music/unblock/redeem，请求 {inviteCode:"邮件中的码"}。
会员字段/编号/到期兼容 docs/membership-invitations.md。申请码不会在申请查询接口或管理员列表中返回明文，只通过账号邮箱获得；不提供通用公开查码接口。

redeemBy 是“最晚兑换时间”，expiresAt 是“会员到期时间”，不可混用。会员排位 memberNumber 由原有系统在首次开通时分配，不使用排队位置代替。

新规则错误：5913 / HTTP403 表示码绑定其他账号；5907 / HTTP409 表示已有有效会员，申请码不能叠加。用户贴入旧人工码时保持原兑换体验。

## 七、管理员前端

沿用管理员身份校验；不要只靠前端隐藏按钮保护接口。

GET /api/account/admin/membership
data：
{
 serverTime,
 policy:{version:"membership-v1",softThreshold:10,hardLimit:15,offerHours:24,
  spillWaitHours:24,spillIntervalHours:24,forecastHours:24,
  id:1,applicationsOpen:false,dispatchEnabled:false,emailLoginEnabled:true,
  lastSpillAt:null,lastDispatchAt:null,workerHeartbeatAt:null,updatedAt:"ISO"},
 capacity:{active:5,permanent:5,reserved:0,occupied:5,hardLimit:15},
 queued:0,nextDecision:null,mail:{pending:0,failed:0}
}
nextDecision 有队列时返回 allowed、reason、durationDays、spill（可缺省）、occupied、personDays、perApplicant、version。
reason 为 normal / hard_limit / soft_wait / spill_interval / release_expected / controlled_spill。

PATCH /api/account/admin/membership
请求仅允许 applicationsOpen、dispatchEnabled、emailLoginEnabled 三个布尔开关，至少一个字段。
关闭 applicationsOpen 阻止新申请/会员邮箱确认；已排队记录保留。关闭 dispatchEnabled 停止新的自动发码，邮件重试/已有码兑换/有效会员不受影响。二者都关闭用于暂停申请业务；关闭 emailLoginEnabled 单独暂停邮箱辅助登录。
硬顶固定 15，普通管理接口不能提高它；超过既有承诺时开启申请/调度会返回 5902。

GET /api/account/admin/membership/applications?cursor=<上一页最后一条id>
每页最多 50 条，按 id 升序返回数组：
{id,status,queuedAt,offeredAt,durationDays,version,
 user:{id,email,nickname},inviteCode:{expiresAt,redeemedAt}|null}
列表顺序不代表排队顺序，排队调度始终按 queuedAt、id。

POST /api/account/admin/membership/applications
{applicationId:"...",action:"cancel"|"block"|"unblock"}
cancel/block 禁用未兑换码并取消邮件；block 阻止重新申请，unblock 恢复为 cancelled，用户需主动再申请。已兑换会员请使用现有授权撤销接口，不会通过取消申请撤销权益。

GET /api/account/admin/membership/mail?cursor=<上一页最后一条id>
每页 50，按 id 降序，返回安全元数据：id,userId,applicationId,toAddress,kind,status,attempts,nextAttemptAt,expiresAt,sentAt,lastErrorCode,createdAt。
不返回加密载荷、验证码、兑换码、摘要或 SMTP 响应。

POST /api/account/admin/membership/mail
{mailId:"..."}，仅重试尚未过期、载荷仍在、状态 failed 的任务。返回 {queued:true}，每管理员最多 20 次/24h。不能借此发送任意内容或指定收件人。

GET /api/account/admin/membership/audit?cursor=<上一页最后一条id>
每页 50，按 id 降序，字段 id,actorUserId,userId,applicationId,event,details,createdAt。
自动批准含算法版本、占用量、预算、排队人数、批次时长、判断原因和兑换截止时间；不含明文码。审计保留 180 天。

管理会员名单/授权/撤销继续使用原有 admin/playback-authorizations 接口。管理界面展示 active、reserved 和 occupied，不能只显示 active 就认为还有名额。

## 八、错误处理

- 401/5204 未登录：沿用现有恢复/刷新流程。
- 403/5206 非管理员；5207 请求来源不允许。
- 409/5902 容量已满或历史预留超过硬顶；不能靠重试创建额外名额。
- 409/5904 申请关闭。
- 409/5906 需要确认邮箱。
- 409/5907 已有有效会员。
- 403/5908 管理限制申请。
- 409/5909 没有可重发/重试的有效任务。
- 400/5905 验证码无效、过期、耗尽或已使用；统一文案。
- 429/5910 限速，按服务端 Retry-After 倒计时，不立即重试。
- 503/5900 邮件配置/Worker/功能开关暂不可用。
- 503/5914 请求繁忙，可按 Retry-After 稍后重试。
- 404/5911 申请不存在；管理 unblock 的不合适状态返回409。
- 409/5912 申请已兑换，需使用会员管理操作。

输入格式错误沿用现有400验证信封。不要在请求失败后清空账号状态、撤销会员或默认重新注册。

## 九、Claude 验收清单

1. 桌面/手机的密码和邮箱辅助登录共存，验证码保留前导零，倒计时与服务端一致。
2. 邮箱登录后刷新/切页/现有播放授权检查不会掉登录；失败验证码不擦除有效 Cookie。
3. 申请关闭、待验证、排队、已发码、发送失败、过期、撤回、管理限制和已有会员都有明确状态。
4. 按钮防重复点击，但仍以服务端幂等和权限为准。
5. 展示会员期限与排位时继续使用原会员字段，不把兑换期限或队列位置当成会员期限/排位。
6. 管理开关、邮件重试和申请取消/限制遵守接口权限和错误提示。
7. 不在控制台、埋点或错误上报中记录验证码、兑换码、Token 和 Cookie。
8. 先对接测试环境，前端联调完成后再开启真实会员申请；不让 UI 自动提交申请或自动索取验证码。
