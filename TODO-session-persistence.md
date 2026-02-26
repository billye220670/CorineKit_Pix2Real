# Session Persistence — 实现追踪

## 目标
用户关闭/重新打开浏览器后，自动恢复上次会话（输入图片、输出结果、遮罩、提示词、选择状态）。

## 策略：事件驱动静默自动保存
- 导入图片时 → 立即拷贝到 session 目录
- 任务完成时 → 更新 session.json
- mask 绘制结束时（mouseup）→ 保存 mask PNG
- 提示词变更时（500ms debounce）→ 更新 session.json
- 页面关闭前（beforeunload）→ flush session.json

## 目录结构
```
sessions/
  <sessionId>/
    session.json                       ← 完整状态快照（不含 File 对象）
    tab-0/
      input/  <imageId>.png|jpg|...    ← 拷贝进来的原始输入图
      masks/  <maskKey>.png            ← mask PNG（maskKey = imageId:outputIndex）
    tab-1/
      input/ ...
      masks/ ...
    ...
```
输出文件不拷贝，session.json 直接记录 `/api/output/...` URL。

---

## 任务列表

### 后端

- [x] **B1** `server/src/services/sessionManager.ts`
  - `ensureSessionDirs(sessionId)` — 建目录
  - `saveInputImage(sessionId, tabId, imageId, ext, buffer)` — 存输入图
  - `saveMask(sessionId, tabId, maskKey, buffer)` — 存 mask PNG
  - `saveState(sessionId, state)` — 写 session.json
  - `loadSession(sessionId)` — 读 session.json + 列出每个 tab 下的 input 文件
  - `listSessions()` — 列出所有 session（按 updatedAt 倒序）
  - `deleteSession(sessionId)` — 删除整个 session 目录
  - `pruneOldSessions(keep=5)` — 只保留最近 N 个

- [x] **B2** `server/src/routes/session.ts`
  - `POST   /api/session/:sessionId/images`  — 上传输入图，存到 input/
  - `POST   /api/session/:sessionId/masks`   — 上传 mask，存到 masks/
  - `PUT    /api/session/:sessionId/state`   — 保存 session.json
  - `GET    /api/session/:sessionId`         — 读取 session（state + 图片 URL 列表）
  - `GET    /api/sessions`                   — 列出最近 5 个 session
  - `DELETE /api/session/:sessionId`         — 删除 session

- [x] **B3** `server/src/index.ts`
  - 注册 session 路由
  - 启动时确保 `sessions/` 目录存在
  - 静态伺服 `sessions/` → `/api/session-files/`

### 前端

- [x] **F1** `client/src/types/index.ts`
  - `ImageItem` 加 `sessionUrl?: string`（恢复后替代 Blob URL 的持久 URL）

- [x] **F2** `client/src/services/sessionService.ts`
  - 所有 session API 端点的类型化封装函数

- [x] **F3** `client/src/hooks/useWorkflowStore.ts`
  - 加 `restoreSession(data: SessionRestoreData)` action
  - 接受预分配的 imageId，不重新生成

- [x] **F4** `client/src/hooks/useMaskStore.ts`
  - 加 `restoreAllMasks(masks: Record<string, MaskEntry>)` action

- [x] **F5** `client/src/hooks/useSession.ts`
  - `initSession()` — 从 localStorage 读 sessionId，没有则生成 UUID
  - `loadAndRestoreSession()` — GET session → 重建 ImageItem（fetch → File）→ restore store + masks
  - `saveImage(tabId, imageId, file)` — 上传到 session 目录
  - `saveMask(tabId, maskKey, entry)` — 上传 mask PNG
  - `saveState()` — 序列化 store → PUT session.json
  - `debouncedSaveState()` — 500ms debounce 版本
  - `newSession()` — 生成新 UUID，写 localStorage
  - 暴露 `lastSavedAt: Date | null`

- [x] **F6** `client/src/hooks/useImageImporter.ts`
  - 导入成功后，调 `session.saveImage()` 异步上传每张图到 session 目录

- [x] **F7** `client/src/hooks/useMaskStore.ts`
  - `setMask` 完成后触发 session mask 保存（通过外部 callback 或 subscribeWithSelector）

- [x] **F8** `client/src/hooks/useWorkflowStore.ts`
  - `completeTask` / `setPrompt` / `setPrompts` 之后触发 debouncedSaveState

- [x] **F9** `client/src/components/SessionBar.tsx`
  - "上次保存：X 分钟前" 时间戳
  - "新建会话" 按钮
  - 微型 session 列表下拉（最近 5 个，可切换/删除）

- [x] **F10** `client/src/components/App.tsx`
  - 挂载时初始化 session + 恢复
  - `beforeunload` → flush saveState
  - header 加入 `<SessionBar />`

---

## 进度

| 阶段 | 状态 |
|------|------|
| B1 sessionManager | ✅ 完成 |
| B2 session routes | ✅ 完成 |
| B3 index.ts 注册 | ✅ 完成 |
| F1 types | ✅ 完成 |
| F2 sessionService | ✅ 完成 |
| F3 store restoreSession | ✅ 完成 |
| F4 maskStore restoreAllMasks | ✅ 完成 |
| F5 useSession hook | ✅ 完成 |
| F6 useImageImporter | ✅ 完成 |
| F7 mask save on setMask | ✅ 完成 |
| F8 store save triggers | ✅ 完成 |
| F9 SessionBar UI | ✅ 完成 |
| F10 App.tsx 整合 | ✅ 完成 |
