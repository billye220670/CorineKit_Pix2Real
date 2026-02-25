# 解除装备 Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add workflow tab 5 "解除装备" — a Mode-A mask-based inpainting workflow that uploads both the original image and a white/black mask PNG, with an optional per-card 后位 LoRA toggle.

**Architecture:** New `Workflow5Adapter` (minimal, provides metadata only). Dedicated `POST /api/workflow/5/execute` route registered before the generic `/:id/execute`, accepting two files via `upload.fields`. Client-side mask conversion (RGBA → white/black RGB PNG) happens inline before FormData submission.

**Tech Stack:** Express + multer, React + Zustand, OffscreenCanvas, lucide-react (`Footprints` icon), ComfyUI API (`Pix2Real-解除装备Fixed.json`)

**Design reference:** `docs/plans/2026-02-25-jiechuazhuangbei-workflow-design.md`

---

### Task 1: Server scaffold — Workflow5Adapter + index + output dirs

**Files:**
- Create: `server/src/adapters/Workflow5Adapter.ts`
- Modify: `server/src/adapters/index.ts`
- Modify: `server/src/routes/output.ts`
- Modify: `server/src/index.ts`

**Step 1: Create `Workflow5Adapter.ts`**

```typescript
// server/src/adapters/Workflow5Adapter.ts
import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow5Adapter: WorkflowAdapter = {
  id: 5,
  name: '解除装备',
  needsPrompt: true,
  basePrompt: '',
  outputDir: '5-解除装备',

  buildPrompt(): object {
    throw new Error('Workflow 5 uses the dedicated /5/execute route');
  },
};
```

**Step 2: Register in `server/src/adapters/index.ts`**

Add import and entry:
```typescript
import { workflow5Adapter } from './Workflow5Adapter.js';

export const adapters: Record<number, WorkflowAdapter> = {
  0: workflow0Adapter,
  1: workflow1Adapter,
  2: workflow2Adapter,
  3: workflow3Adapter,
  4: workflow4Adapter,
  5: workflow5Adapter,   // ← add
};
```

**Step 3: Add to `server/src/routes/output.ts`** — add `5: '5-解除装备'` to `WORKFLOW_DIRS`

```typescript
const WORKFLOW_DIRS: Record<number, string> = {
  0: '0-二次元转真人',
  1: '1-真人精修',
  2: '2-精修放大',
  3: '3-快速生成视频',
  4: '4-视频放大',
  5: '5-解除装备',   // ← add
};
```

**Step 4: Add to `server/src/index.ts`** — add `'5-解除装备'` to `OUTPUT_DIRS`

```typescript
const OUTPUT_DIRS = [
  '0-二次元转真人',
  '1-真人精修',
  '2-精修放大',
  '3-快速生成视频',
  '4-视频放大',
  '5-解除装备',   // ← add
];
```

**Step 5: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```
Expected: no errors.

**Step 6: Commit**

```bash
git add server/src/adapters/Workflow5Adapter.ts server/src/adapters/index.ts server/src/routes/output.ts server/src/index.ts
git commit -m "feat: add Workflow5Adapter scaffold and output dir for 解除装备"
```

---

### Task 2: Server — dedicated `/5/execute` route

**Files:**
- Modify: `server/src/routes/workflow.ts`

**Context:** This route must be registered **before** the generic `router.post('/:id/execute', ...)` at line 28. The route accepts two files (`image` = original, `mask` = white/black PNG) plus `backPose` (string `'true'`/`'false'`) and `prompt` in the body.

**Step 1: Add imports at top of `workflow.ts`**

The file already imports `fs`, `path`, `multer`, `uploadImage`, `queuePrompt`. Add the workflow5 adapter import and template path constant near the top (after the existing `releaseMemoryTemplatePath`):

```typescript
import { workflow5Adapter } from '../adapters/Workflow5Adapter.js';

const removeEquipTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-解除装备Fixed.json');
```

**Step 2: Add `upload.fields` middleware variant**

Add this constant after the existing `const upload = multer(...)` line:

```typescript
const uploadFields = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]);
```

**Step 3: Insert the `/5/execute` route BEFORE the generic `/:id/execute` route**

Insert this entire block immediately before the line `router.post('/:id/execute', ...)`:

```typescript
// POST /api/workflow/5/execute — 解除装备: requires both original image and mask
router.post('/5/execute', uploadFields, async (req, res) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.['image']?.[0];
    const maskFile  = files?.['mask']?.[0];

    if (!imageFile) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }
    if (!maskFile) {
      res.status(400).json({ error: 'No mask file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const backPose  = req.body.backPose === 'true';
    const userPrompt: string = req.body.prompt || '';

    // Upload both files to ComfyUI
    const originalFilename = await uploadImage(imageFile.buffer, imageFile.originalname);
    const maskFilename     = await uploadImage(maskFile.buffer,  maskFile.originalname);

    // Patch template
    const template = JSON.parse(fs.readFileSync(removeEquipTemplatePath, 'utf-8'));
    template['313'].inputs.image  = originalFilename;
    template['385'].inputs.image  = maskFilename;
    template['389'].inputs.boolean = backPose;
    template['315'].inputs.seed   = Math.floor(Math.random() * 1125899906842624);
    // Prompt: user text replaces default entirely; empty = keep JSON default
    if (userPrompt.trim()) {
      template['314'].inputs.text = userPrompt.trim();
    }

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId:     result.prompt_id,
      clientId,
      workflowId:   5,
      workflowName: workflow5Adapter.name,
    });
  } catch (err: any) {
    console.error('[Workflow 5 Execute Error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
```

**Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```
Expected: no errors.

**Step 5: Commit**

```bash
git add server/src/routes/workflow.ts
git commit -m "feat: add dedicated /5/execute route for 解除装备 workflow"
```

---

### Task 3: Client store — workflow 5 + backPoseToggles

**Files:**
- Modify: `client/src/hooks/useWorkflowStore.ts`

**Step 1: Add workflow 5 to `WORKFLOWS` array** (line 4–10)

```typescript
const WORKFLOWS = [
  { id: 0, name: '二次元转真人', needsPrompt: true },
  { id: 1, name: '真人精修',     needsPrompt: true },
  { id: 2, name: '精修放大',     needsPrompt: false },
  { id: 3, name: '快速生成视频', needsPrompt: true },
  { id: 4, name: '视频放大',     needsPrompt: false },
  { id: 5, name: '解除装备',     needsPrompt: true },  // ← add
];
```

**Step 2: Add `backPoseToggles` to `TabData` interface** (after `selectedOutputIndex`)

```typescript
interface TabData {
  images: ImageItem[];
  prompts: Record<string, string>;
  tasks: Record<string, TaskInfo>;
  imagePromptMap: Record<string, string>;
  selectedOutputIndex: Record<string, number>;
  backPoseToggles: Record<string, boolean>;   // ← add
}
```

**Step 3: Update `emptyTabData()`**

```typescript
function emptyTabData(): TabData {
  return {
    images: [],
    prompts: {},
    tasks: {},
    imagePromptMap: {},
    selectedOutputIndex: {},
    backPoseToggles: {},   // ← add
  };
}
```

**Step 4: Add `toggleBackPose` to the store interface** (inside `WorkflowStore`, after `clearSelection`)

```typescript
toggleBackPose: (imageId: string) => void;
```

**Step 5: Add tab 5 to initial `tabData`** (inside `create(...)`, `tabData` initial value)

```typescript
tabData: {
  0: emptyTabData(),
  1: emptyTabData(),
  2: emptyTabData(),
  3: emptyTabData(),
  4: emptyTabData(),
  5: emptyTabData(),   // ← add
},
```

**Step 6: Implement `toggleBackPose` action** (add after `clearSelection` implementation)

```typescript
toggleBackPose: (imageId) => {
  set((state) => {
    const tab = state.activeTab;
    const prev = state.tabData[tab] || emptyTabData();
    const current = prev.backPoseToggles[imageId] ?? false;
    return {
      tabData: {
        ...state.tabData,
        [tab]: {
          ...prev,
          backPoseToggles: { ...prev.backPoseToggles, [imageId]: !current },
        },
      },
    };
  });
},
```

**Step 7: Clean up `backPoseToggles` in `removeImage`**

In the `removeImage` action, destructure and exclude from the new state:
```typescript
removeImage: (id) => {
  set((state) => {
    const tab = state.activeTab;
    const prev = state.tabData[tab] || emptyTabData();
    const img = prev.images.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.previewUrl);
    const { [id]: _p, ...restPrompts }              = prev.prompts;
    const { [id]: _t, ...restTasks }                = prev.tasks;
    const { [id]: _m, ...restMap }                  = prev.imagePromptMap;
    const { [id]: _s, ...restSelectedOutputIndex }  = prev.selectedOutputIndex;
    const { [id]: _b, ...restBackPoseToggles }      = prev.backPoseToggles;  // ← add
    return {
      tabData: {
        ...state.tabData,
        [tab]: {
          images: prev.images.filter((i) => i.id !== id),
          prompts: restPrompts,
          tasks: restTasks,
          imagePromptMap: restMap,
          selectedOutputIndex: restSelectedOutputIndex,
          backPoseToggles: restBackPoseToggles,   // ← add
        },
      },
    };
  });
},
```

**Step 8: Clean up `backPoseToggles` in `removeImages`**

Add to the `removeImages` action's returned tab data:
```typescript
backPoseToggles: Object.fromEntries(
  Object.entries(prev.backPoseToggles).filter(([k]) => !idSet.has(k))
),
```
(alongside the existing `prompts`, `tasks`, `imagePromptMap`, `selectedOutputIndex` filters)

**Step 9: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors.

**Step 10: Commit**

```bash
git add client/src/hooks/useWorkflowStore.ts
git commit -m "feat: add workflow 5 and backPoseToggles to useWorkflowStore"
```

---

### Task 4: Client config — mask mode for tab 5

**Files:**
- Modify: `client/src/config/maskConfig.ts`

**Step 1: Add `5: 'A'` to `TAB_MASK_MODE`**

```typescript
export const TAB_MASK_MODE: Record<number, TabMaskMode> = {
  0: 'A',
  1: 'B',
  2: 'none',
  3: 'none',
  4: 'none',
  5: 'A',   // ← add
};
```

**Step 2: Commit**

```bash
git add client/src/config/maskConfig.ts
git commit -m "feat: enable Mode A mask editor for workflow 5"
```

---

### Task 5: Client — ImageCard 后位 toggle button + workflow 5 execute

**Files:**
- Modify: `client/src/components/ImageCard.tsx`

This is the most complex client task. Read the full file before editing.

**Step 1: Add new store selectors at the top of `ImageCard`**

After the existing `const openEditor = useMaskStore(...)` line, add:

```typescript
const maskEntryForMode = useMaskStore((s) => s.masks[maskKey(image.id, -1)]);
const backPose         = useWorkflowStore((s) => s.tabData[s.activeTab]?.backPoseToggles?.[image.id] ?? false);
const toggleBackPose   = useWorkflowStore((s) => s.toggleBackPose);
```

Note: `maskEntryForMode` uses output index `-1` because workflow 5 uses Mode A (no output image).

**Step 2: Add `Footprints` to lucide-react imports**

The existing import line is:
```typescript
import { X, Play, RotateCcw, Check, AlertCircle, Layers, ChevronDown } from 'lucide-react';
```
Add `Footprints`:
```typescript
import { X, Play, RotateCcw, Check, AlertCircle, Layers, ChevronDown, Footprints } from 'lucide-react';
```

**Step 3: Add mask-to-blob helper (inside the component, before `handleExecute`)**

```typescript
const maskEntryToBlob = useCallback(async (entry: import('../hooks/useMaskStore.js').MaskEntry): Promise<Blob> => {
  const { data, workingWidth: w, workingHeight: h } = entry;
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d')!;
  const id = new ImageData(w, h);
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i + 3] > 0 ? 255 : 0;
    id.data[i]     = v;
    id.data[i + 1] = v;
    id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return oc.convertToBlob({ type: 'image/png' });
}, []);
```

**Step 4: Replace `handleExecute` to handle workflow 5 branch**

The existing `handleExecute` (lines ~143–173) becomes:

```typescript
const handleExecute = useCallback(async () => {
  if (!clientId) return;

  // ── Workflow 5: 解除装备 ──────────────────────────────────────────
  if (activeTab === 5) {
    if (!maskEntryForMode) {
      showToast('请先在蒙版编辑器中绘制蒙版');
      return;
    }
    const maskBlob = await maskEntryToBlob(maskEntryForMode);
    const formData = new FormData();
    formData.append('image',    image.file);
    formData.append('mask',     maskBlob, 'mask.png');
    formData.append('clientId', clientId);
    formData.append('prompt',   prompts[image.id] || '');
    formData.append('backPose', String(backPose));

    try {
      const res = await fetch(`/api/workflow/5/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) { console.error('Execute failed:', await res.text()); return; }
      const data = await res.json();
      startTask(image.id, data.promptId);
      sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5 });
    } catch (err) {
      console.error('Execute error:', err);
    }
    return;
  }

  // ── Generic workflows ─────────────────────────────────────────────
  const formData = new FormData();
  formData.append('image',    image.file);
  formData.append('clientId', clientId);
  formData.append('prompt',   prompts[image.id] || '');

  try {
    const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) { console.error('Execute failed:', await res.text()); return; }
    const data = await res.json();
    startTask(image.id, data.promptId);
    sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab });
  } catch (err) {
    console.error('Execute error:', err);
  }
}, [clientId, image, activeTab, prompts, startTask, sendMessage, maskEntryForMode, backPose, maskEntryToBlob]);
```

**Step 5: Add 后位 toggle button JSX in the image overlay area**

Insert the following block **after** the closing `</div>` of the mask icon overlay block (around line 415), and **before** the remove button block:

```tsx
{/* 后位 LoRA toggle — workflow 5 only, bottom-left of image */}
{activeTab === 5 && (
  <button
    onClick={(e) => { e.stopPropagation(); toggleBackPose(image.id); }}
    title={backPose ? '后位模式：开启' : '后位模式：关闭'}
    style={{
      position: 'absolute',
      bottom: 6,
      left: 6,
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      background: backPose ? 'rgba(59,130,246,0.85)' : 'rgba(0,0,0,0.45)',
      border: backPose ? '1px solid rgba(147,197,253,0.6)' : '1px solid rgba(255,255,255,0.15)',
      borderRadius: 6,
      cursor: 'pointer',
      padding: 0,
    }}
  >
    <Footprints size={14} color={backPose ? '#dbeafe' : '#9ca3af'} />
  </button>
)}
```

**Step 6: Update textarea placeholder for workflow 5**

Find the existing placeholder logic (around line 490):
```tsx
placeholder={activeTab === 3 ? "输入提示词（留空使用默认）" : "额外提示词（可选）"}
```
Change to:
```tsx
placeholder={activeTab === 5 ? "留空使用默认提示词" : activeTab === 3 ? "输入提示词（留空使用默认）" : "额外提示词（可选）"}
```

**Step 7: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors.

**Step 8: Commit**

```bash
git add client/src/components/ImageCard.tsx
git commit -m "feat: add 后位 toggle and workflow-5 execute path to ImageCard"
```

---

### Task 6: Client — PhotoWall batch execute for workflow 5

**Files:**
- Modify: `client/src/components/PhotoWall.tsx`

**Step 1: Add store selectors for workflow 5 data**

After the existing `const masks = useMaskStore((s) => s.masks);` line, add:
```typescript
const backPoseToggles = useWorkflowStore((s) => s.tabData[s.activeTab]?.backPoseToggles ?? {});
```

**Step 2: Add a `maskEntryToBlob` helper in PhotoWall**

Add this helper inside the component (near the top, after the selectors):
```typescript
const maskEntryToBlob = useCallback(async (entry: import('../hooks/useMaskStore.js').MaskEntry): Promise<Blob> => {
  const { data, workingWidth: w, workingHeight: h } = entry;
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d')!;
  const id = new ImageData(w, h);
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i + 3] > 0 ? 255 : 0;
    id.data[i]     = v;
    id.data[i + 1] = v;
    id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return oc.convertToBlob({ type: 'image/png' });
}, []);
```

**Step 3: Update `handleBatchExecute` to handle workflow 5**

The current `handleBatchExecute` loop body skips non-idle tasks:
```typescript
const task = tasks[img.id];
if (task && task.status !== 'idle') continue;
```

For workflow 5, add an additional skip condition and a different FormData/URL path. Replace the entire `handleBatchExecute` body:

```typescript
const handleBatchExecute = async () => {
  if (!clientId) return;
  const targetImages = isMultiSelectMode
    ? images.filter((img) => selectedImageIds.includes(img.id))
    : images;

  for (const img of targetImages) {
    const task = tasks[img.id];
    if (task && task.status !== 'idle') continue;

    // ── Workflow 5: 解除装备 ──────────────────────────────────────
    if (activeTab === 5) {
      const maskEntry = masks[maskKey(img.id, -1)];
      if (!maskEntry) continue; // skip: no mask painted for this image

      const maskBlob = await maskEntryToBlob(maskEntry);
      const backPose = backPoseToggles[img.id] ?? false;

      const formData = new FormData();
      formData.append('image',    img.file);
      formData.append('mask',     maskBlob, 'mask.png');
      formData.append('clientId', clientId);
      formData.append('prompt',   prompts[img.id] || '');
      formData.append('backPose', String(backPose));

      try {
        const res = await fetch(`/api/workflow/5/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) { console.error('Execute failed:', await res.text()); continue; }
        const data = await res.json();
        startTask(img.id, data.promptId);
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5 });
      } catch (err) {
        console.error('Execute error:', err);
      }
      continue;
    }

    // ── Generic workflows ─────────────────────────────────────────
    const formData = new FormData();
    formData.append('image',    img.file);
    formData.append('clientId', clientId);
    formData.append('prompt',   prompts[img.id] || '');

    try {
      const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) { console.error('Execute failed:', await res.text()); continue; }
      const data = await res.json();
      startTask(img.id, data.promptId);
      sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab });
    } catch (err) {
      console.error('Execute error:', err);
    }
  }
};
```

**Step 4: Update `hasIdleSelected` / `hasIdle` to account for workflow 5 mask gate**

The existing `hasIdle` and `hasIdleSelected` only check task status. For workflow 5, an image without a mask is not actually executable. Update both:

```typescript
const hasIdle = images.some((img) => {
  const task = tasks[img.id];
  if (task && task.status !== 'idle') return false;
  if (activeTab === 5 && !masks[maskKey(img.id, -1)]) return false;
  return true;
});

const hasIdleSelected = images.some((img) => {
  if (!selectedImageIds.includes(img.id)) return false;
  const task = tasks[img.id];
  if (task && task.status !== 'idle') return false;
  if (activeTab === 5 && !masks[maskKey(img.id, -1)]) return false;
  return true;
});
```

This ensures the "全部执行" / "执行 N 个" button only appears when there's at least one image that both is idle AND has a mask.

**Step 5: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors.

**Step 6: Commit**

```bash
git add client/src/components/PhotoWall.tsx
git commit -m "feat: handle workflow-5 mask gate and batch execute in PhotoWall"
```

---

### Task 7: End-to-end smoke test + final commit

**Step 1: Start dev servers**

```bash
npm run dev
```

**Step 2: Manual checks in browser**

1. Tab "解除装备" appears as the 6th tab (index 5) ✓
2. Drop an image onto the tab — card renders with filename, prompt box, execute button ✓
3. Mask menu appears (Layers icon, top-left of card) → "新建蒙版" opens Mode A editor ✓
4. Clicking execute without a mask shows a toast "请先在蒙版编辑器中绘制蒙版" ✓
5. Bottom-left `Footprints` button toggles blue highlight on click ✓
6. Paint a mask in the editor, close → `hasMask` indicator turns green ✓
7. Click execute → network request to `/api/workflow/5/execute` with two files in FormData ✓
8. ComfyUI picks up the job and returns output ✓
9. Batch execute button "全部执行" only shows when ≥1 image has a mask ✓

**Step 3: Commit design doc**

```bash
git add docs/plans/
git commit -m "docs: add 解除装备 workflow design and implementation plan"
```
