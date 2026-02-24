# Mask Editor — Design Document

Date: 2026-02-24

---

## Overview

A standalone mask editor modal that opens when a user double-clicks an image card. Supports two preview modes (A and B) determined strictly by the active workflow tab. Masks are painted with a soft/hard brush, stored in-memory per image/output pair, and persisted only within the session.

---

## Tab Mode Assignment

| Tab | Name       | Mode          | Notes                                              |
|-----|------------|---------------|----------------------------------------------------|
| 0   | 二次元转真人 | **Mode A**    | Color overlay on original; used for dev testing    |
| 1   | 真人精修    | **Mode B**    | A\|B realtime blend; requires selected output image |
| 2   | 精修放大    | NoMaskNeeded  | No mask icon, no editor                            |
| 3   | 快速生成视频 | NoMaskNeeded  | Video tab                                          |
| 4   | 视频放大    | NoMaskNeeded  | Video tab                                          |

---

## Entry Logic

```
double-click image card
  └─ tab is NoMaskNeeded?
        → ignore (no handler)
  └─ tab is Mode A?
        → open editor in Mode A (original image only)
  └─ tab is Mode B?
        └─ has selected output (selectedOutputIndex >= 0)?
              → open editor in Mode B (original + outputs[selectedOutputIndex])
        └─ no output selected?
              → show friendly toast: "请先执行工作流以获得结果图，再打开蒙版编辑器"
```

Entry mode is strictly determined by tab. No fallback, no override switch.

---

## Exit Logic

- Click **X** button → auto-save current mask to store → close modal
- No confirmation dialog needed
- Undo/redo history is discarded on close
- Mode B blended result is discarded on close unless user clicked Export

---

## Mask Key Convention

Masks are keyed as `"${imageId}:${outputIndex}"`:
- Mode A → `outputIndex = -1` (mask on original image)
- Mode B → `outputIndex = selectedOutputIndex` at time of opening

---

## Canvas Architecture

Three absolutely-stacked canvases inside the viewport div:

```
[canvas 3] — brush cursor preview      pointer-events: none
[canvas 2] — mask / composite output   pointer-events: none
[canvas 1] — base image display        pointer-events: none
[div]      — event capture layer       pointer-events: all
```

A single `viewTransform { x, y, scale }` applies uniformly to all layers.
Image and mask are always pixel-perfectly aligned — no drift.

### Working Resolution

On editor open, images and masks are drawn at a capped internal resolution
(longest edge ≤ 2048px). On export or save, the mask is upscaled to the
source image's original dimensions using `drawImage`.

### Mode A Rendering (per frame)

```
canvas 1: drawImage(original)
canvas 2: composite mask as one of three sub-modes:
  sub-a → dark grey overlay where mask is painted
  sub-b → darken unpainted regions, brighten painted regions
  sub-c → red overlay where mask is painted
```

Sub-mode is toggled via the SubMode button in the toolbar. Only visible in Mode A.

### Mode B Rendering (per frame)

```
canvas 1: offscreen composite → original*(1−mask) + result*mask → drawImage to canvas 1
canvas 2: unused
```

Realtime blend updates on every brush stroke frame.

---

## Brush System

### Properties

| Property  | Range   | Description                                      |
|-----------|---------|--------------------------------------------------|
| Size      | 1–500px | Radius in working-resolution pixels              |
| Hardness  | 0–1     | 1 = hard edge, 0 = fully feathered radial gradient |
| Opacity   | 0–1     | Strength of each stamp                           |

### Stroke Rendering

Each mouse-move segment stamps an offscreen radial-gradient circle:
- Add mode → `globalCompositeOperation: source-over`
- Erase mode → `globalCompositeOperation: destination-out`

Erase mode uses identical size/hardness/opacity as add mode.
Stamps spaced at ~25% of brush radius along stroke path to avoid gaps.

### Brush Cursor

Drawn on canvas 3 only. Follows mouse in real time. Sized to current brush
radius in screen-space (scales with zoom). System cursor hidden via
`cursor: none` on the viewport div only. Restored on mouse leave.

### Keyboard Shortcuts

| Input              | Action                        |
|--------------------|-------------------------------|
| `Shift` (hold)     | Switch to erase mode          |
| `Alt + scroll`     | Brush size ±5px               |
| `T + scroll`       | Opacity ±0.1                  |
| `F`                | Fit view (reset pan/zoom)     |
| `Ctrl+Z`           | Undo                          |
| `Ctrl+Y`           | Redo                          |
| `Ctrl+Shift+Z`     | Redo (alternate)              |
| Middle-drag        | Pan viewport                  |
| Middle-scroll      | Zoom around cursor            |

---

## Undo / Redo

- Strategy: **snapshot stack**
- Snapshot taken on `mouseup` (end of stroke), not during stroke
- Also recorded: Clear mask, Invert mask
- Not recorded: brush property changes
- Stack cap: **30 steps**
- History is local to editor session — discarded on close

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ 蒙版编辑器                            [Export*]    [X]  │
├─────────────────────────────────────────────────────────┤
│ [SubMode ▾*]  [Clear]  [Invert]                         │
├──────────────────────────────────────────┬──────────────┤
│                                          │  Brush       │
│                                          │              │
│                                          │  Size        │
│              VIEWPORT                    │  [slider]    │
│                                          │              │
│                                          │  Hardness    │
│                                          │  [slider]    │
│                                          │              │
│                                          │  Opacity     │
│                                          │  [slider]    │
└──────────────────────────────────────────┴──────────────┘
* Mode A only: SubMode toggle (sub-a / sub-b / sub-c)
* Mode B only: Export button in title bar
```

- Brush cursor shown only inside the viewport div
- Modal is a full-screen overlay (`position: fixed`, `z-index` above everything)
- Title: 蒙版编辑器

---

## Export (Mode B only)

1. User clicks **Export** in title bar
2. In-app dialog opens with:
   - **Path** pre-filled: `output/1-真人精修/` (server-side output dir for Tab 1)
   - **Filename** pre-filled: `{selectedOutputFilename}_Mixed.png`
   - User can edit the filename
3. On confirm: POST blended image (composited at full original resolution) to server
4. Server saves file to the output directory
5. Success toast shows full saved path
6. Blended result is **not** written back to the main window photo wall
7. Blended result is discarded on editor close if not exported

---

## Card UI Changes (Tabs 0 and 1 only)

- **Mask icon** (top-left overlay on card image):
  - Green → mask exists for currently selected image
  - Gray → no mask for currently selected image
  - Icon: `Layers` or `Brush` from lucide-react (pick most representative)
- **Chevron button** next to icon opens a dropdown:
  - "新建蒙版" / "编辑蒙版" (label depends on whether mask exists) → same logic as double-click
  - "删除蒙版" → deletes mask for current selection; grayed/disabled if no mask
- Double-click on image element (not video) triggers same entry logic as above

---

## Data Model

### New: `useMaskStore.ts` (separate Zustand store)

```typescript
interface MaskEntry {
  imageData: ImageData;    // mask pixels at working resolution
  workingWidth: number;
  workingHeight: number;
  originalWidth: number;   // source image native dimensions
  originalHeight: number;
}

interface MaskStore {
  masks: Record<string, MaskEntry>;  // key: "${imageId}:${outputIndex}"
  setMask: (key: string, entry: MaskEntry) => void;
  deleteMask: (key: string) => void;
  getMask: (key: string) => MaskEntry | undefined;
}
```

No changes to `useWorkflowStore`. Mask store is fully independent.

---

## New Files

| File | Purpose |
|------|---------|
| `client/src/hooks/useMaskStore.ts` | Zustand mask store |
| `client/src/components/MaskEditor.tsx` | Modal shell, toolbar, title bar |
| `client/src/components/MaskCanvas.tsx` | Dual-canvas viewport, pan/zoom, brush rendering |

## Modified Files

| File | Changes |
|------|---------|
| `client/src/components/ImageCard.tsx` | Double-click handler, mask icon overlay, dropdown menu |
| `server/src/routes/workflow.ts` | New POST endpoint for saving exported blend result |

---

## Performance Notes

- Working resolution capped at 2048px (longest edge) prevents slow brush rendering on high-res inputs
- Undo snapshots stored as `Uint8ClampedArray` copies (not full `ImageData` objects) to reduce GC pressure
- Brush stamp uses offscreen canvas; only final composite is drawn to the visible mask canvas
- Mode B blend composite runs on offscreen canvas each frame, not the visible canvas directly

---

## Out of Scope

- No mask expansion or global feathering (user controls feathering via brush hardness)
- No persistence between page refreshes (in-memory only)
- No mask import from external files
- Mode A not assigned to any production tab yet (Tab 0 is dev/test only)
