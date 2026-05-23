# 私有音乐源接口契约（网易云风格）

本项目前端只调用本站 BFF，BFF 再调用你的私有音乐源。  
以下是推荐的上游最小能力与字段语义，路径可通过环境变量配置。

## 1. 搜索

- 推荐路径：`/search`
- 请求参数：`keywords`, `limit`, `offset`
- 典型响应字段：
  - `result.songs[]`
  - `result.songCount`
  - 歌曲字段：`id`, `name`, `ar[]`, `al`, `dt`

## 2. 歌曲详情

- 推荐路径：`/song/detail`
- 请求参数：`ids`
- 典型响应字段：`songs[]`

## 3. 播放链接

- 推荐路径：`/song/url/v1`
- 请求参数：`id`, `level`
- 典型响应字段：
  - `data[0].url`
  - `data[0].br`
  - `data[0].time`（毫秒，可映射为 ttl）
  - `data[0].expiresAt`（可选）

## 4. 歌词

- 推荐路径：`/lyric`
- 请求参数：`id`
- 典型响应字段：`lrc.lyric`（LRC 文本）

## 5. 歌单详情

- 推荐路径：`/playlist/detail`
- 请求参数：`id`
- 典型响应字段：
  - `playlist.id`, `playlist.name`, `playlist.description`, `playlist.coverImgUrl`
  - `playlist.tracks[]`

## 6. 安全与鉴权

- 鉴权：推荐 BFF 在服务端请求头注入 `x-api-key`（若暂未启用，可留空并后续补上）。
- 前端绝不持有上游鉴权信息。
- 建议上游开启 HTTPS 与限流策略，并保留 traceId 透传能力。
