# 添加新 ComfyUI 工作流指南

本文档供 Claude 阅读，用于快速了解如何将一个新的 ComfyUI API JSON 工作流接入本项目。
每次用户提供新的工作流 JSON 时，按照本文档的流程和 TODO 清单来实施。

---

## 一、必须先确认的信息

在动手写任何代码之前，确认以下信息（如果用户没有给出，**必须询问**）：

| # | 信息项 | 说明 |
|---|--------|------|
| 1 | **新 Tab ID** | 下一个可用整数（目前 0-6 已用，新的从 7 开始） |
| 2 | **工作流名称** | 显示在 UI 标签页上的中文名 |
| 3 | **JSON 文件名** | 放入 `ComfyUI_API/` 的文件名 |
| 4 | **输入节点 ID** | LoadImage / VHS_LoadVideo 节点 ID，以及对应字段名（通常是 `image` 或 `video`） |
| 5 | **输出节点 ID** | 用于产出最终文件的节点 ID（SaveImage / VHS_VideoCombine 等）；**若用户未说明，先扫描 JSON 找候选节点再询问确认** |
| 6 | **Seed 节点 ID** | 控制随机种子的节点 ID 及字段名（通常是 `seed`）；注意有些工作流有多个 KSampler，每个都要随机化 |
| 7 | **Prompt 节点 ID** | 文本提示词对应的节点 ID 及字段名（如 `text`、`prompt`） |
| 8 | **是否需要提示词** | `needsPrompt: true/false` |
| 9 | **默认基础提示词** | `basePrompt` 字符串（可以为空） |
| 10 | **提示词合并方式** | 用户输入是**追加**到 basePrompt 后面，还是**完全替换** basePrompt |
| 11 | **输入文件类型** | 图片（`image`）还是视频（`video`） |
| 12 | **输出文件类型** | 图片还是视频（影响前端播放器选择） |
| 13 | **蒙版模式** | `none` / `A` / `B`；**若用户未说明，必须询问**（见第三节详解） |
| 14 | **特殊额外输入** | 是否需要额外布尔开关、第二张图片等 |

> **关于输出节点 ID**：服务端的 `onComplete` 回调会自动遍历 ComfyUI history 中所有节点的 `images`（type=output）和 `gifs`，无需手动指定输出节点。输出节点 ID 只在需要**手动 polling history** 的特殊路由（如蒙版识别、反推提示词）中才有用。因此一般情况下确认有哪个 SaveImage 节点即可，不影响代码。

---

## 二、架构速览

```
ComfyUI_API/<workflow>.json              ← 工作流模板（从 ComfyUI 导出的 API 格式）
server/src/adapters/WorkflowNAdapter.ts  ← 适配器：打补丁 + 随机 seed
server/src/adapters/index.ts             ← 注册适配器
server/src/routes/workflow.ts            ← HTTP 路由（特殊工作流需要专用路由）
server/src/index.ts                      ← 启动时建立 output 目录
server/src/services/sessionManager.ts   ← 文件 I/O（目录自动按需创建，不需要改）
client/src/hooks/useWorkflowStore.ts     ← 前端 Zustand store
client/src/hooks/useSession.ts           ← session 序列化/恢复（含 tab 循环上限）
client/src/components/Sidebar.tsx        ← 侧边栏（GROUPS + WORKFLOW_ICONS 硬编码）
client/src/config/maskConfig.ts          ← 蒙版模式配置
client/src/components/ImageCard.tsx      ← 单卡执行逻辑（Mode A 工作流需要改）
client/src/components/PhotoWall.tsx      ← 批量执行逻辑（Mode A 工作流需要改）
```

**标准完成流程**：
1. 前端上传图片 → `POST /api/workflow/:id/execute` → 服务端调用 `adapter.buildPrompt()` → 提交给 ComfyUI
2. 前端通过 WS 发送 `register` 消息（绑定 promptId → sessionId + tabId）
3. ComfyUI WS 推送进度/完成事件，服务端转发给前端
4. 完成时：服务端拉取 history，下载所有 `type="output"` 的图片/视频，调用 `saveOutputFile` 写入 `sessions/<id>/tab-N/output/`，通过 WS 发送 `complete` 消息（含文件 URL）
5. 前端收到 `complete` → `completeTask()` → 卡片显示结果图

---

## 三、蒙版编辑器模式详解（重要，接入前必须确认）

蒙版模式在 `client/src/config/maskConfig.ts` 的 `TAB_MASK_MODE` 中配置，有三种：

### `none` — 无蒙版
- 卡片图片区无蒙版图标，双击图片无效果
- 适合：纯图生图、不需要用户标注区域的工作流
- 代码量：最少，仅需在 `TAB_MASK_MODE` 加一行

### Mode `A` — 在**原图**上绘制蒙版
- 蒙版存储 key：`maskKey(imageId, -1)`
- 使用场景：蒙版作为**输入**提交给 ComfyUI（如「解除装备」——用户涂抹要处理的区域，蒙版连同原图一起上传）
- **执行逻辑改动**：
  - 需要**专用路由**（如 `/5/execute`）接收 `image` + `mask` 两个文件
  - `ImageCard.tsx` 的 `handleExecute` 需要添加 `if (activeTab === N)` 分支，读取蒙版 blob 后 append 到 FormData
  - `PhotoWall.tsx` 的 `handleBatchExecute` 同样需要添加分支，且跳过没画蒙版的卡片
  - `hasIdleSelected` 中需要加 `if (activeTab === N && !masks[maskKey(img.id, -1)]) return false;`（让没蒙版的卡片不计入「可执行」）
- 用户体验：卡片左上角出现蒙版图标；未画蒙版时执行按钮不起作用

### Mode `B` — 在**结果图**上绘制蒙版
- 蒙版存储 key：`maskKey(imageId, selectedOutputIdx)`（selectedOutputIdx >= 0）
- 使用场景：对生成结果做**局部融合/微调**（如「真人精修」——用户在输出图上涂抹需要保留的区域，前端实时叠加显示混合效果）
- **执行逻辑不需要改动**：蒙版仅用于前端实时视觉混合（`MaskEditor` 组件），不提交给 ComfyUI
- 用户体验：卡片左上角出现蒙版图标；需要先执行一次生成才能在结果图上画蒙版；双击结果图可打开蒙版编辑器

### 如何判断需要哪种模式

| 特征 | 推荐模式 |
|------|---------|
| 蒙版需要提交给 ComfyUI 作为输入 | Mode A + 专用路由 |
| 用户需要标注原图的处理区域 | Mode A |
| 对输出结果进行局部融合/后处理 | Mode B |
| 纯文生图 / 图生图无需用户标注 | none |

**未说明时必须询问**：「这个工作流需要蒙版编辑器吗？如果需要，是让用户在原图上涂（Mode A，蒙版会作为输入提交给 ComfyUI），还是在生成结果上涂（Mode B，用于前端视觉融合）？」

---

## 四、标准工作流接入 TODO（无蒙版 / Mode B）

适用场景：`TAB_MASK_MODE = 'none'` 或 `'B'`，使用通用路由，无额外文件上传。

### Step 1 — 放置 JSON 文件
- [ ] 将 ComfyUI 导出的 API JSON 放入 `ComfyUI_API/`，命名规范：`Pix2Real-<工作流名>.json`

### Step 2 — 创建适配器 `server/src/adapters/WorkflowNAdapter.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-<工作流名>.json');

export const workflowNAdapter: WorkflowAdapter = {
  id: N,
  name: '<中文名>',
  needsPrompt: true,              // 或 false
  basePrompt: '<默认提示词>',     // 无提示词时填 ''
  outputDir: 'N-<中文名>',

  buildPrompt(imageName: string, userPrompt?: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // 输入节点
    template['<INPUT_NODE_ID>'].inputs.image = imageName;

    // 提示词节点 —— 追加模式
    let prompt = this.basePrompt;
    if (userPrompt && userPrompt.trim()) prompt += ', ' + userPrompt.trim();
    template['<PROMPT_NODE_ID>'].inputs.<PROMPT_FIELD> = prompt;

    // 提示词节点 —— 替换模式（二选一）
    // const prompt = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : this.basePrompt;
    // template['<PROMPT_NODE_ID>'].inputs.<PROMPT_FIELD> = prompt;

    // Seed（有多个 KSampler 时每个都要随机化）
    template['<SEED_NODE_ID>'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
```

### Step 3 — 注册适配器 `server/src/adapters/index.ts`
- [ ] 添加 import
- [ ] 在 `adapters` 对象中添加 `N: workflowNAdapter`

### Step 4 — 建立 output 目录 `server/src/index.ts`
- [ ] 在 `OUTPUT_DIRS` 数组中添加 `'N-<中文名>'`

### Step 5 — 前端 store `client/src/hooks/useWorkflowStore.ts`
- [ ] `WORKFLOWS` 数组添加 `{ id: N, name: '<中文名>', needsPrompt: true/false }`
- [ ] `tabData` 初始化添加 `N: emptyTabData()`
- [ ] `restoreSession` 循环改为 `for (let tab = 0; tab <= N; tab++)`

### Step 6 — session 循环上限 `client/src/hooks/useSession.ts`
> **这里有 4 处独立的循环，全部要改为 `<= N`，漏改任意一处都会导致 tab N 的状态无法保存/恢复。**
- [ ] `serializeState` 中的 `for (let tab = 0; tab <= ...)` 改为 `<= N`
- [ ] 订阅回调中「检测新图片上传」的循环改为 `<= N`
- [ ] 订阅回调中「查找 mask 所属 tab」的循环改为 `<= N`
- [ ] `doRestore` 中的循环改为 `<= N`

### Step 7 — 侧边栏 `client/src/components/Sidebar.tsx`
- [ ] 从 `lucide-react` 选一个合适图标并 import
- [ ] `WORKFLOW_ICONS` 添加 `N: <Icon>`
- [ ] `GROUPS` 数组将 N 加入对应分组（图像处理 / 视频处理）

### Step 8 — 蒙版配置 `client/src/config/maskConfig.ts`
- [ ] `TAB_MASK_MODE` 添加 `N: 'none'`（或 `'B'`）

### Step 9 — 视频工作流额外处理（仅输入为视频时）
- [ ] `server/src/routes/workflow.ts` 中 `/:id/execute` 和 `/:id/batch` 的 `uploadVideo` 判断加上 `|| workflowId === N`

---

## 五、Mode A 工作流额外 TODO（蒙版作为输入提交给 ComfyUI）

在完成上述所有 Step 之后，还需要：

### Step A1 — 适配器占位
```typescript
buildPrompt(): object {
  throw new Error('Workflow N uses the dedicated /N/execute route');
},
```

### Step A2 — 专用路由 `server/src/routes/workflow.ts`
**必须放在通用 `/:id/execute` 路由之前**：
```typescript
router.post('/N/execute', uploadFields, async (req, res) => {
  // 1. 解析 image + mask 文件
  // 2. uploadImage() 上传两个文件
  // 3. patch 模板：输入图、蒙版图、seed、prompt
  // 4. queuePrompt()
  // 5. 返回 { promptId, clientId, workflowId: N, workflowName }
});
```

### Step A3 — 执行逻辑 `client/src/components/ImageCard.tsx`
在 `handleExecute` 的 `if (activeTab === 5)` 块后面，仿照其结构添加 `if (activeTab === N)` 分支：读取 `maskEntryForMode`（Mode A key = `maskKey(image.id, -1)`），转成 blob，append 到 FormData，调用 `/api/workflow/N/execute`。

### Step A4 — 批量执行 `client/src/components/PhotoWall.tsx`
- 在 `handleBatchExecute` 中添加 `if (activeTab === N)` 分支（仿照 `activeTab === 5`）
- 在 `hasIdleSelected` 的过滤条件中添加：`if (activeTab === N && !masks[maskKey(img.id, -1)]) return false;`

### Step A5 — 蒙版配置
- [ ] `TAB_MASK_MODE` 设为 `N: 'A'`（此步替代标准流程的 Step 8）

---

## 六、特殊内置路由（不用改，仅供参考）

| 路由 | 说明 | 关键节点 |
|------|------|---------|
| `POST /api/workflow/mask/auto-recognize` | SAM 蒙版自动识别，返回蒙版 PNG | 输入 `247`，输出 `394` |
| `POST /api/workflow/reverse-prompt?model=X` | LLM 反推提示词（Qwen3VL / Florence / WD-14） | 输入 `1`，输出写入临时 txt（节点 `66`/`67`） |
| `POST /api/workflow/release-memory` | 释放 GPU/RAM 显存 | 无动态节点 |

如果新工作流需要类似的「独立工具」功能，使用内部 `clientId`、polling history，单独实现路由，直接返回结果。

---

## 七、Seed 最大值参考

| 节点类型 | 最大安全 seed |
|---------|-------------|
| KSampler、WanMoeKSampler、easy seed、Seed(rgthree) 等 | `1125899906842624` |
| SeedVR2VideoUpscaler | `4294967295` |

---

## 八、提示词合并方式对照

| 工作流 | 方式 | 代码 |
|--------|------|------|
| 0（二次元转真人） | **追加** | `prompt += ', ' + userPrompt.trim()` |
| 1（真人精修） | **追加** | 同上 |
| 3（快速生成视频） | **替换**：空则用默认 | `(userPrompt?.trim()) ? userPrompt : this.basePrompt` |
| 5（解除装备） | **替换**：空则保留 JSON 原始值 | `if (userPrompt.trim()) template[id].inputs.text = userPrompt` |
| 6（真人转二次元） | **替换**：空字符串触发内部 WD14 自动反推 | `template['66'].inputs.text = userPrompt?.trim() ?? ''` |

不确定时询问用户。

---

## 九、已知曾踩过的坑（每次核查）

1. **`Sidebar.tsx` 硬编码**：`GROUPS` 和 `WORKFLOW_ICONS` 不会自动读 store，新 tab 必须手动加，否则页签不显示。

2. **`useSession.ts` 4 处循环**：每处独立硬编码 `<= 上一个最大ID`，全部必须更新，漏掉任意一处会导致该 tab 的图片/状态无法持久化。

3. **`sessionManager.ts` 目录按需创建**（已修复为自动）：`saveOutputFile`/`saveInputImage`/`saveMask` 现在各自用 `mkdirSync({ recursive: true })` 创建目录，新 tab 无需额外配置，不会再出现 ENOENT 导致静默丢失输出的问题。

4. **`onComplete` 静默丢失输出**：若 `saveOutputFile` 抛出异常（如目录不存在），异常被 catch 吞掉，outputs 为空，卡片无结果展示。排查时看服务端控制台的 `[WS] Failed to download output` 日志。

5. **Mode A 必须专用路由**：标准 `/:id/execute` 只接收单张图片，Mode A 工作流需要同时上传原图和蒙版，必须使用 `uploadFields` 的专用路由。

---

## 十、快速核查清单（每次新增工作流必做）

后端：
- [ ] `ComfyUI_API/<name>.json` 已放置
- [ ] `server/src/adapters/WorkflowNAdapter.ts` 创建完毕
- [ ] `server/src/adapters/index.ts` 已注册
- [ ] `server/src/index.ts` `OUTPUT_DIRS` 已添加
- [ ] 若 Mode A：专用路由已添加且位于 `/:id/execute` **之前**
- [ ] 若输入为视频：`workflow.ts` 中 `uploadVideo` 判断已扩展

前端：
- [ ] `useWorkflowStore.ts` `WORKFLOWS` 已添加
- [ ] `useWorkflowStore.ts` `tabData` 初始化已添加
- [ ] `useWorkflowStore.ts` `restoreSession` 循环上限已更新到 N
- [ ] `useSession.ts` 4 处循环上限全部更新到 N
- [ ] `Sidebar.tsx` `GROUPS` 已加入，`WORKFLOW_ICONS` 已添加图标
- [ ] `maskConfig.ts` `TAB_MASK_MODE` 已配置
- [ ] 若 Mode A：`ImageCard.tsx` `handleExecute` 已添加分支
- [ ] 若 Mode A：`PhotoWall.tsx` `handleBatchExecute` 和 `hasIdleSelected` 已更新

验证：
- [ ] `npm run dev` 启动无报错
- [ ] 新 Tab 在侧边栏中出现
- [ ] 上传图片 → 执行 → 进度显示 → 完成后卡片展示输出图
- [ ] `sessions/<id>/tab-N/output/` 目录中有生成的文件
- [ ] 蒙版行为符合预期（若有）
