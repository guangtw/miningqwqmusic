# 音源偏好与前端提醒接入

前端已在 `6d5a74a`、`51a6461` 接入 `SourceRecovery`，入口位于播放台、正在播放页及音质面板，不使用独立提醒弹窗或 Toast。首次说明实际可见满 3 秒后记住已读，本曲继续保留整句，后续歌曲使用小标签；音质面板始终保留完整说明。设置页提供音源偏好开关。现有试听、限流及明确音质回退提示继续保留。生产版本以 `/__deployment.json` 为准，GitHub 推送本身不代表已部署。

## 已实现的播放规则

1. 老用户没有 `preferUnblock` 字段时默认为 `false`，先走官方；完整可播即保留，试听、时长不足或地址异常才解灰。
2. 当前歌曲确认 `resolvedVia === 'primary'`、`level === 'exhigh'`、`preview === false` 且已经加载完毕时，用户通过现有 `setQuality()` 选择无损及以上档位，会同时保存音质和 `preferUnblock=true`。即使被点击的高档位原本已经是所选偏好，也会重取一次强制解灰地址。
3. 后续歌曲和页面刷新按保存的偏好请求 `force_on`。之后只改音质不会自动清除此偏好；仍按每次所选档位传参，不固定为 Hi-Res。
4. 当前完整解灰结果属于免费可播歌曲时，播放器设置 `canSwitchToStableSource=true`，由 `SourceRecovery` 在既有界面内显示恢复入口，播放器本身不弹提醒。
5. 用户点击展示层提供的入口后，调用 `switchToStableSource()`：本曲改为 `force_off`，保留进度、播放/暂停状态与所选音质，不清除 `preferUnblock`。本曲 URL 续签仍走官方；切歌、重新点播、清队列或刷新后恢复保存的偏好。

这些是当前浏览器的设备设置，保存在既有 `localStorage['cph.settings.v2']`。不是网易 Cookie、会员凭据或账号云设置；其他设备不会自动同步。不要从“全局已经选了母带”反推用户完成过上述主动升级步骤，也不要在每次渲染时调用 `setQuality()`。

## 给前端的状态与动作

代码入口：`src/frontend/player/player.ts`、`src/frontend/lib/settings.ts`。

| 接口 | 用途 |
| --- | --- |
| `playerStore` / `useStore(playerStore, selector)` | 使用现有外部 Store 订阅当前播放状态 |
| `state.resolvedVia` | 解析器报告的链路：`primary` 官方请求，`unblock` 解灰请求；未取得结果为 `null`，类型也兼容原有 `grace` |
| `state.unblockMode` | 本次请求策略：`auto` / `force_on` / `force_off`。不是实际命中链路，游客的强制解灰请求仍可能被后端降为官方 |
| `state.access` | `free` / `vip` / `paid`，缺少可靠信息时为 `null` |
| `state.canSwitchToStableSource` | 当前可以提供免费歌解灰纠错入口；加载中、试听、官方源、VIP、单独付费及权限未知均为 `false` |
| `state.level` / `state.preview` / `state.loading` | 当前音质报告、是否试听和是否正在换源，沿用现有状态 |
| `switchToStableSource(expectedTrackId?): boolean` | 发起本曲临时回到官方；接受操作返回 `true`。无可用入口、仍在加载或传入的 ID 已不是当前歌曲时返回 `false`，重复点击不重复发请求。返回值不是网络完成或播放成功证明，后续结果继续读 Store |
| `setQuality(level)` | 沿用现有音质选择入口；自动执行上述持久偏好规则 |
| `getSettings().preferUnblock` / `subscribeSettings` | 读取、订阅持久偏好；设置页使用 `updateSettings({ preferUnblock: false })` 关闭偏好，影响后续解析，不会自动打断当前音频 |

建议展示文字：**放的歌不对？点我暂时切换回稳定音源**。位置、出现频率、是否收起、是否用常驻入口由前端决定。最小接入示例（没有附加样式）：

```tsx
import { useStore } from '@/src/frontend/lib/store';
import { currentTrack, playerStore, switchToStableSource } from '@/src/frontend/player/player';

export function SourceRecoveryEntry() {
  const available = useStore(playerStore, s => s.canSwitchToStableSource);
  const trackId = useStore(playerStore, s => currentTrack(s)?.id);
  if (!available) return null;
  return (
    <button type="button" onClick={() => { switchToStableSource(trackId); }}>
      放的歌不对？点我暂时切换回稳定音源
    </button>
  );
}
```

不要只根据 `preferUnblock` 或 `unblockMode` 决定是否显示入口：真正命中官方、VIP 歌或权限未知时都不应冒充免费歌解灰。不要在按钮里直接修改 `audio.src`、清空音质偏好或把全局 `preferUnblock` 置为 `false`。需要调用操作时读取当前 Store，避免让旧歌曲闭包影响已经切换的新歌曲。

## BFF 契约与权限字段

`GET /api/music/track/:id/play-url?level=jymaster&unblockMode=force_on`

前端低层方法保持前四个参数兼容，新增第五个模式参数：

```ts
music.playUrl(id, level, token, signal, unblockMode); // 默认 auto
```

成功结果继续包含 `requestedLevel`、`level`、`preview`、`resolvedVia`，新增可选 `access`。`access` 从同一网易 ID 的 `/song/detail` 中 `songs[].fee` 取得，复用既有时长元数据请求与缓存，不额外增加 JSON 查询：

| 网易 `fee` | `access` | 含义 |
| --- | --- | --- |
| `0` | `free` | 免费可播 |
| `8` | `free` | 普通播放免费，高音质可能要求会员 |
| `1` | `vip` | VIP 类型 |
| `4` | `paid` | 单独付费类型，不当作免费 |
| 缺失、查询失败、其他值 | 不返回 | 未确认；前端不显示免费歌纠错入口 |

接口仍逐次校验本站解灰权限，游客和未获授权的账号最终使用 `force_off`。`access` 只供展示分类，不能用它跳过鉴权，也不代表当前账号拥有网易会员权限。

音质沿用用户已确认的约定：明确报告优先；解灰只给 URL、未给档位时，按本次请求档位回填 `level`，不展示“音质未知”。这是接口约定，不是独立的文件音质鉴定。官方若报告极高，立即显示极高，不能套用所选母带；菜单开合不改变解析结果。

“稳定音源”是官方链路，不是同录音验证承诺。点击后仍可能因版权、网络或官方试听失败，播放器沿用既有错误/试听处理；不会因为这次临时选择再次偷偷强制解灰。权限元数据沿用既有缓存时效，不能当作实时授权结果。强制解灰的上游 v1 内部也可能回落官方，本站 `resolvedVia` 表示接受的请求路径，不能据此证明底层供应商或录音身份。

## 验证与后续交接

- `tests/unit/frontend-remote-player.test.ts`：六档主动升级、已选高档位再次点击、偏好落盘与切歌恢复、不符合条件时不自动保存、纠错入口资格、临时官方切换的进度/暂停及续签。
- `tests/unit/netease-adapter.test.ts`：九档回填、明确报告优先、免费/VIP/付费/未知分类、共享详情请求、官方优先与请求预算。
- `tests/unit/frontend-integration.test.ts`：模式与取消信号传递、会话续期后的重试参数。
- `tests/e2e/record-store.spec.ts`：菜单关闭时的回退显示、解灰档位显示、主动点击升级后的请求模式及刷新保留。

展示通过上述接口接入，保留最新前端布局、样式、字体和动效。临时恢复入口的完整闭环已在播放器单元测试及桌面/手机浏览器验收中覆盖，不需要为了测试修改生产全局对象或暴露调试接口。发布仍按 `docs/release-workflow.md`，只有真实生产回执与提交一致且出现 `PRODUCTION_VERIFIED` 才能报告上线。
