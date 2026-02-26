# UI 优化批次 — 实现追踪

## 任务列表

| # | 描述 | 文件 | 状态 |
|---|------|------|------|
| 1 | 后位 LoRA 按钮图标改 Flower | ImageCard.tsx | ✅ |
| 2 | 菜单栏按钮统一包裹到 border 框 | App.tsx + SessionBar.tsx | ✅ |
| 3 | Toast 从顶部飞入动画，新消息立即替换 | global.css + useToast.ts + Toast.tsx | ✅ |
| 4 | 缩略图导航原图与结果图之间加竖杠 | ThumbnailStrip.tsx | ✅ |
| 5 | 拖拽删除区（卡片 + 结果缩略图）+ 移除 hover 删除按钮 | useDragStore.ts(新) + useWorkflowStore.ts + ImageCard.tsx + ThumbnailStrip.tsx + PhotoWall.tsx | ✅ |
| 6 | 打开文件夹 → 打开输出目录 | PhotoWall.tsx | ✅ |
| 7 | 会话列表可重命名（Pencil icon + 内联输入） | SessionBar.tsx | ✅ |
| 8 | 新建会话时弹出命名输入框 | SessionBar.tsx | ✅ |

## 关键设计

### 任务 5 架构
- `useDragStore.ts`: `dragging: { type:'card'|'output', imageId, outputIndex? } | null`
- `useWorkflowStore.ts`: 新增 `removeOutput(imageId, outputIndex)` action
- `ThumbnailStrip`: 结果缩略图（index>0）可拖拽，原图不可拖拽；`onOutputDragStart/End` 回调
- `ImageCard`: 拖拽开始设置 dragStore，移除 hover 删除按钮
- `PhotoWall`: 读取 dragging，底部中间显示淡红色删除区，drop 时执行删除 + mask 清理

### 任务 7/8 名称存储
- localStorage key: `pix2real_session_names` → `Record<sessionId, name>`
- 展示优先级: 自定义名称 > GUID 前 8 位
