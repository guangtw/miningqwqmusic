# Echo Stage 界面重构进度

最后更新：2026-07-10

## 方向

将现状「黑曜石 + 紫灰玻璃编辑风」重设计为 **Echo Stage**：

- 深色舞台底 + 品牌绿 `#22d35e` 强调
- 克制玻璃（仅导航 / 播放坞 / 抽屉）
- 封面驱动环境光（绿灰 fallback）
- 清晰中文标题，信息密度适中

## 阶段

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 设计系统 token | 已完成 | `--stage-*` + brand 绿系覆盖 immersive 区 |
| 壳层与导航 | 已完成 | 哑光侧轨 + 绿指示条 active |
| 编辑首页 | 已完成 | 舞台海报 Hero、实心绿 CTA、单封面、双轨文案卡 |
| 搜索 / 音乐库 | 已完成 | 搜索：舞台融底无套盒、表头无黑条、服务端批量补封面 + 客户端兜底；库：中等页眉与分段 thumb |
| 播放坞与详情 | 已完成 | 独立 `PlayerDock` 组件；进度内嵌；实心绿播放键；详情共用 |
| 移动端 | 已完成 | Hero 收敛、底栏绿 active |
| 验证 | 已完成 | 相关单测 25/25；`npm run build` 通过；紫灰残留已清扫；详情/坞/抽屉/浅色对齐 |


## 约束（保持）

- 不修改 `/api/music/*`、`/api/account/*`
- 不改 Zustand 持久化结构
- 不重写 `use-player-controller` 播放源逻辑
- 不接入 mineradio iframe

## 关键文件

- `app/globals.css` — Echo Stage tokens 与全端壳层样式
- `src/components/immersive/editorial-home.tsx`
- `src/components/immersive/floating-nav.tsx`
- `src/components/immersive/magnetic-card.tsx`
- `src/components/immersive/search-panel.tsx` — 搜索页展示
- `src/hooks/use-search-panel.ts` — 搜索状态与分页
- `src/components/track-row.tsx` — 共用曲目行
- `src/components/player-app.tsx` — `stage-shell` class
- `src/lib/immersive-ui.ts` — ambient fallback
