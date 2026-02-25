# 解除装备 Workflow (ID=5) — Design

**Date:** 2026-02-25
**Branch:** feat/mask-editor

## Overview

Add a new tab "解除装备" (workflow ID 5) that:
- Uses Mode A mask editor (user paints mask, no result image required)
- Blocks generation if no mask is present for that card
- Has a per-card "后位 LoRA" toggle button (bottom-left of image)
- Sends original image + mask PNG + backPose bool + prompt to ComfyUI

## API File

`ComfyUI_API/Pix2Real-解除装备Fixed.json`

### 4 Patchable Nodes

| Node | Class | Role | Patch |
|------|-------|------|-------|
| `313` | LoadImage | Original image | `inputs.image = uploadedOriginalFilename` |
| `385` | LoadImage | Mask image (white=mask, black=background) | `inputs.image = uploadedMaskFilename` |
| `314` | CLIPTextEncode | Prompt text | `inputs.text = userPrompt || defaultFromJSON` |
| `389` | easy ifElse | 后位 LoRA toggle | `inputs.boolean = backPose (true/false)` |
| `315` | Seed (rgthree) | Random seed | `inputs.seed = random()` |

### Mask Format (Critical)

Node 387 (MaskFromColor+, threshold=10, white) reads **image output[0]** from node 385 directly (node 386 removed in Fixed version). It creates a mask where pixels ≈ white (≥245,245,245) are included.

**Required PNG format:** Plain RGB (no alpha), white `(255,255,255)` where painted, black `(0,0,0)` where not.

**Conversion from MaskEntry RGBA:** For each pixel, `A > 0 → (255,255,255)`, `A == 0 → (0,0,0)`.

## Architecture

### Server (5 files)

1. **`server/src/adapters/Workflow5Adapter.ts`** (new)
   Minimal adapter implementing `WorkflowAdapter` interface. `buildPrompt` throws (unused — dedicated route handles workflow 5). Provides `id=5, name='解除装备', outputDir='5-解除装备', needsPrompt=true`.

2. **`server/src/adapters/index.ts`**
   Add `5: workflow5Adapter`.

3. **`server/src/routes/workflow.ts`**
   Add `POST /5/execute` route **before** generic `/:id/execute`. Uses `upload.fields([{name:'image',maxCount:1},{name:'mask',maxCount:1}])`. Uploads both files to ComfyUI, patches template, queues.

4. **`server/src/routes/output.ts`**
   Add `5: '5-解除装备'` to `WORKFLOW_DIRS`.

5. **`server/src/index.ts`**
   Add `'5-解除装备'` to `OUTPUT_DIRS`.

### Client (4 files)

6. **`client/src/hooks/useWorkflowStore.ts`**
   - Add `{ id: 5, name: '解除装备', needsPrompt: true }` to `WORKFLOWS`
   - Add `5: emptyTabData()` to initial `tabData`
   - Add `backPoseToggles: Record<string, boolean>` to `TabData` interface
   - Add `toggleBackPose(imageId: string)` action
   - Clean up `backPoseToggles` in `removeImage`, `removeImages`, `clearCurrentImages`

7. **`client/src/config/maskConfig.ts`**
   Add `5: 'A'` to `TAB_MASK_MODE`.

8. **`client/src/components/ImageCard.tsx`**
   - When `activeTab === 5`: show `Footprints` icon toggle button at bottom-left of image area
     - Active (backPose=true): blue `#3b82f6` tinted background
     - Inactive: dark translucent background
     - `onClick`: `toggleBackPose(image.id)`, `stopPropagation`
   - Override `handleExecute` for workflow 5:
     - Check `maskEntry` (maskKey with outputIndex=-1) exists; if not, `showToast(...)` and return
     - Convert MaskEntry RGBA → white/black RGB PNG via OffscreenCanvas
     - Append `mask` blob + `backPose` string to FormData
     - POST to `/api/workflow/5/execute`

9. **`client/src/components/PhotoWall.tsx`**
   - `handleBatchExecute`: when `activeTab === 5`, skip images with no mask (treat as not idle), include mask blob + backPose in FormData.

## Mask Conversion (client-side helper, inline)

```ts
// Convert MaskEntry RGBA → white/black RGB PNG blob
async function maskEntryToBlob(entry: MaskEntry): Promise<Blob> {
  const { data, workingWidth: w, workingHeight: h } = entry;
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d')!;
  const id = new ImageData(w, h);
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i + 3] > 0 ? 255 : 0;
    id.data[i]     = v;
    id.data[i + 1] = v;
    id.data[i + 2] = v;
    id.data[i + 3] = 255; // fully opaque so ComfyUI reads RGB correctly
  }
  ctx.putImageData(id, 0, 0);
  return oc.convertToBlob({ type: 'image/png' });
}
```

Note: Alpha is set to 255 (fully opaque) so ComfyUI's LoadImage reads the white/black RGB values correctly rather than treating it as a transparent image.

## Prompt Behavior

Unlike other tabs (where user prompt appends to basePrompt), workflow 5 **replaces** the default:
- User types text → `template['314'].inputs.text = userPrompt`
- User leaves empty → keep JSON default `"沿边缘去除镂空绿色区域部分的衣服..."`
- Textarea placeholder: `"留空使用默认提示词"`

## No-Mask Gate

- **Single card execute**: `showToast('请先在蒙版编辑器中绘制蒙版')` and return early
- **Batch execute**: skip images without masks (same logic as skipping non-idle tasks)
