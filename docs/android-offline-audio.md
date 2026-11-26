# 手机端离线音频交接

## 使用场景

| 功能 | 什么时候使用 | 用户能做什么 |
|---|---|---|
| 下载 | 通勤、旅行或出门前，主动准备要听的歌 | 按所选音质加入队列，查看进度与实际文件音质，取消、重试、删除，或从已下载列表播放。默认只允许不计量网络，单次下载可以允许计量网络。已下载文件保存在应用内，直到用户删除。 |
| 播放缓存 | 反复听歌、切换网络或短时断网 | 手动开启自动缓存，设置容量，查看占用并清理。采用播放时所选音质，记录实际文件音质。缓存默认关闭，开启后在不计量网络上后台保存通过验证的完整音源。 |

缓存上限默认 512 MiB，可设 64–1024 MiB。满额时优先腾出最近最少使用的缓存，单个文件最多 256 MiB，缓存完成七天后过期。关闭自动缓存会结束待完成缓存并保留已完成文件；清空缓存和缩小上限均只影响缓存。下载单独管理，系统管理后台传输以及连接中断后的恢复，用户重试失败记录时重新解析音源。此版本在真正开始播放后用独立的后台传输填充缓存，首播的在线播放和缓存可能各拉一次音频；只在不计量网络上填充缓存。

## 音源和串味处理

Android 客户端的日常播放请求默认 `force_on`，会员资格仍由服务端判断。解灰失败时不自动换成官方试听。无资格的账号照常走官方源。用户主动点现有的「切回稳定源」时，当前曲目切到 `force_off`，绕过本地副本并清除这首歌所有音质的播放缓存。下一首恢复默认策略。付费歌的官方源如果只提供试听，沿用播放器的试听状态。

缓存与下载分别使用现有的播放与下载接口：

- `GET /api/music/track/:id/play-url?level=<所选音质>&unblockMode=<模式>&offline=android`。在线响应的 `data.offline` 只在当前候选通过现有音源检查，且曲目为免费、音源完整、来自可识别的官方 CDN、有匹配歌曲 ID、实际音质、字节数、时长及上游 MD5 时提供。解灰路径拿到满足这些条件的官方 CDN 文件也可以缓存。第三方匹配源、付费或试听源继续遵循现有在线播放权限。
- `GET /api/music/track/:id/download-url?level=<所选音质>&offline=android`。只使用独立的官方下载接口与目录元数据，不拿解灰地址替代下载。没有可核验的完整文件时返回 `3011`，付费歌曲没有可下载的 App 离线文件。所选音质与文件实际音质可能不同，均以记录字段显示。
- `offline` 的字段为 `url`、`mime`、`bytes`、`md5`、`durationMs`、`level`。服务端不代理音频字节。原生端在私有存储中核对体积、MD5 和解码时长，通过后才是 `ready`。MD5 用于和上游提供的内容标识比对，歌曲语义无法仅凭等长音频或校验值判定。
- 联网时依然先解析当前音源，再按所选音质对应的文件校验值查找本地副本。选定音源变化时丢弃不匹配的缓存，不用本地文件改写会员选源。断网时优先找同音质，找不到时可播已有的其他音质，播放器显示文件的实际音质。一起听的远程同步继续在线取源。
- 手动下载的文件不会被「切回稳定源」或缓存清理删除。离线库可单独删除下载后重下。文件读取失败的缓存会移除，在线播放器只重试一次远程源。

## Claude 接入点

保持现有歌曲菜单、设置页、唱片架和播放器的视觉与交互。Android 的现有歌曲下载动作已调用原生队列，旧客户端与浏览器沿用现有下载方式。新增下载列表、缓存设置和断网入口由前端接入，状态优先复用项目现有的小字、进度条、音质标签和 Toast。

站内可从 `src/frontend/lib/offlineAudio.ts` 直接调用下列接口：

| 函数 | 约定 |
|---|---|
| `hasOfflineAudio()` / `offlineCapabilities()` | 判断设备支持与协议版本，读取 `cacheEnabled` 和 `maxCacheBytes`。能力缺失时延续现在的界面。 |
| `listOfflineAudio()` | 返回配置和 `entries`。每项包含 `kind`、`status`、`bytes`、`writtenBytes`、`quality`（选择）及 `level`（实际），另有标题、艺人、时长、创建时间、最近使用时间与可选错误码。列表可在可见且有活动任务时每 1–2 秒刷新，离开即停止。 |
| `enqueueOfflineDownload(track, quality, unmeteredOnly?)` | 重新解析当前官方地址，并返回本地任务或已存在的下载。传入 `false` 才允许计量网络。失败任务可用同样的参数重试。 |
| `removeOfflineAudio(id)` | 取消或删除一项。下载删除与缓存清理应提供独立入口。 |
| `configureAudioCache(enabled, maxBytes)` / `clearAudioCache()` | 上限用字节传入，清空缓存不改变开关和上限。保存前明确新上限可能淘汰现有缓存。 |
| `invalidateTrackCache(trackId)` | 清除某首歌的所有缓存音质，适用于额外的串味反馈入口。 |
| `offlineAudioError(error)` | 将原生错误码转为用户可见文案。 |

播放已下载或缓存项调用 `src/frontend/player/player.ts` 导出的 `playOfflineEntry(entry)`。手动播放按选中的文件 ID 取本地路径，调用前应使用当前列表的 `ready` 记录。`queued` 包括等待符合条件的网络，`transferring` 表示系统正在传输，`ready` 表示校验后已经可以离线解码，`failed` 提示具体原因并可重试。`writtenBytes === bytes` 仍可能在验证中，不能用进度条走完代替 `ready`。若用户选的无损落盘实际是极高，应显示极高并可附注原选择。缓存容量未超过上限前，无需在切换选定音质时删除旧音质。

## Android 冷启动与独立鸿蒙端

原生桥使用受信任的同源主框架，协议为 `window.MiningOffline.version === 1`。调用 `window.MiningOffline.request(command, payload)` 返回 Promise，失败时 `Error.message` 为错误码。主站封装对应 `capabilities`、`list`、`start`、`find`、`remove`、`set-cache`、`clear-cache`、`invalidate` 命令。原生只返回任务 ID，`find` 命中才带本地音频 URL；浏览器可用正常的媒体 Range 请求和拖进度。已完成文件保存在应用内部，卸载会移除，桥不会返回可复用的 CDN 地址、校验值、令牌或物理路径。

现有 APK 主要在线加载站点。为断网冷启动预留了 `desktop/android/app/src/main/assets/android-offline.html`，该文件由 Claude 提供、随 APK 打包。飞行模式启动或无有效联网时发生主页面网络错误，壳会尝试加载该页。请把必要的 HTML、CSS、JS 和静态资产内联，先检查桥的能力并调用 `list`，再针对选中的记录调用 `find` 并将返回 URL 交给 `<audio>`。重新联网后可返回 `/`。桥可能在旧 WebView 的页面完成阶段才注入，入口需等待或提供重试。未加入这个前端文件的 APK 只能在已打开的播放器或仍可进入站内界面时离线播放，断网冷启动的可见入口尚未交付。

```js
const { entries } = await window.MiningOffline.request('list');
const entry = entries.find(row => row.status === 'ready');
if (entry) {
  const file = await window.MiningOffline.request('find', {
    id: entry.id,
    trackId: entry.trackId,
    quality: entry.quality,
  });
  if (file.url) audio.src = file.url;
}
```

仓库目前可见的是 Android 工程，包含 HarmonyOS 4.x 安卓应用环境兼容说明。独立鸿蒙端上传后，可在其原生边界实现同一套命令、状态字段、内容校验和清理规则，并由它提供平台自己的本地媒体 URL。Android 的存储实现与下载服务无需暴露给共享前端。

## 联调验收

1. 选择任意支持的音质、完成下载，刷新页面或重启进程后还能读到该记录。切断网络，在已打开页面进入离线库并播放、拖进度。
2. 自定义较小缓存上限，两种音质分别播放同一曲目，检查两条记录保存了各自的请求与实际音质。触发淘汰与清空后，手动下载继续可播。
3. 用新校验值替换同一歌曲的在线源，旧缓存不再命中。默认会员仍请求解灰，手动恢复会清掉该曲缓存并请求官方，试听或付费返回不会落盘。
4. 在已加入 Claude 离线页的 APK 上做飞行模式冷启动、前后台、进程退出和重启的真机验证。HarmonyOS 独立工程按同一合同重复验收。
