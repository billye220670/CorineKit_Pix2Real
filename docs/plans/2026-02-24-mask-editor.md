# Mask Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone mask editor modal that opens on double-click of an image card, supporting Mode A (color overlay) and Mode B (A|B realtime blend), with brush painting, undo/redo, and export.

**Architecture:** A new `useMaskStore` Zustand store holds all mask data (keyed by `imageId:outputIndex`) and the editor's open/close state. A `MaskEditor` modal renders in `App.tsx` via a portal when the store says it's open. Inside the modal, `MaskCanvas` manages three stacked HTML5 canvases for image display, mask composite, and brush cursor — all sharing a single viewport transform.

**Tech Stack:** React 19, TypeScript, Zustand 5, HTML5 Canvas API (no additional libraries), Lucide React (existing), Express (existing server for export endpoint)

---

## Reference

Design doc: `docs/plans/2026-02-24-mask-editor-design.md`

Tab mode assignments:
- Tab 0 → **Mode A** (dev test)
- Tab 1 → **Mode B** (A|B realtime blend, requires selected output)
- Tabs 2/3/4 → **NoMaskNeeded**

Mask key convention: `"${imageId}:${outputIndex}"` — Mode A uses `-1`, Mode B uses `selectedOutputIndex`.

---

## Task 1: Tab mode config + useMaskStore foundation

**Files:**
- Create: `client/src/config/maskConfig.ts`
- Create: `client/src/hooks/useMaskStore.ts`

**Step 1: Create tab mode config**

```typescript
// client/src/config/maskConfig.ts

export type TabMaskMode = 'A' | 'B' | 'none';

export const TAB_MASK_MODE: Record<number, TabMaskMode> = {
  0: 'A',    // dev/test — Mode A overlay
  1: 'B',    // 真人精修 — Mode B realtime blend
  2: 'none',
  3: 'none',
  4: 'none',
};

export const maskKey = (imageId: string, outputIndex: number): string =>
  `${imageId}:${outputIndex}`;
```

**Step 2: Create useMaskStore**

```typescript
// client/src/hooks/useMaskStore.ts
import { create } from 'zustand';

export interface MaskEntry {
  data: Uint8ClampedArray; // raw RGBA pixels at working resolution
  workingWidth: number;
  workingHeight: number;
  originalWidth: number;
  originalHeight: number;
}

export interface MaskEditorOpenState {
  imageId: string;
  outputIndex: number;       // -1 for Mode A (no output), >= 0 for Mode B
  mode: 'A' | 'B';
  originalUrl: string;
  resultUrl?: string;        // Mode B only — the selected output URL
  resultFilename?: string;   // Mode B only — used for export default name
}

interface MaskStore {
  masks: Record<string, MaskEntry>;
  editorState: MaskEditorOpenState | null;
  setMask: (key: string, entry: MaskEntry) => void;
  deleteMask: (key: string) => void;
  getMask: (key: string) => MaskEntry | undefined;
  openEditor: (state: MaskEditorOpenState) => void;
  closeEditor: () => void;
}

export const useMaskStore = create<MaskStore>((set, get) => ({
  masks: {},
  editorState: null,

  setMask: (key, entry) =>
    set((s) => ({ masks: { ...s.masks, [key]: entry } })),

  deleteMask: (key) =>
    set((s) => {
      const { [key]: _removed, ...rest } = s.masks;
      return { masks: rest };
    }),

  getMask: (key) => get().masks[key],

  openEditor: (state) => set({ editorState: state }),
  closeEditor: () => set({ editorState: null }),
}));
```

**Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors

**Step 4: Commit**

```bash
git add client/src/config/maskConfig.ts client/src/hooks/useMaskStore.ts
git commit -m "feat: add mask store and tab mode config"
```

---

## Task 2: ImageCard — mask icon overlay + dropdown

Add the mask icon (top-left of card image) and its dropdown menu. No click logic yet — just the visual elements.

**Files:**
- Modify: `client/src/components/ImageCard.tsx`

**Step 1: Add imports at top of ImageCard.tsx**

After the existing imports, add:
```typescript
import { Layers, ChevronDown } from 'lucide-react';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { maskKey, TAB_MASK_MODE } from '../config/maskConfig.js';
```

**Step 2: Add store selectors inside the ImageCard function body**

After the existing `const canExecute = ...` line, add:
```typescript
const tabMaskMode = TAB_MASK_MODE[activeTab] ?? 'none';
const showMaskUI = tabMaskMode !== 'none';
const currentMaskOutputIndex = tabMaskMode === 'B' ? selectedOutputIdx : -1;
const currentMaskKey = maskKey(image.id, currentMaskOutputIndex);
const hasMask = useMaskStore((s) => !!s.masks[currentMaskKey]);
const deleteMask = useMaskStore((s) => s.deleteMask);

const [maskMenuOpen, setMaskMenuOpen] = useState(false);
```

**Step 3: Add the mask icon overlay into the JSX**

Find the image container div (the one that holds the `<img>` or `<video>` element). Add this overlay as a sibling inside that container, after the image element:

```tsx
{showMaskUI && (
  <div
    style={{
      position: 'absolute',
      top: 6,
      left: 6,
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.45)',
        borderRadius: 6,
        padding: '2px 4px',
        gap: 2,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={(e) => {
        e.stopPropagation();
        setMaskMenuOpen((v) => !v);
      }}
    >
      <Layers
        size={14}
        color={hasMask ? '#4ade80' : '#9ca3af'}
      />
      <ChevronDown size={11} color="#d1d5db" />
    </div>

    {maskMenuOpen && (
      <>
        {/* Click-outside dismisser */}
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9 }}
          onClick={() => setMaskMenuOpen(false)}
        />
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 0,
            zIndex: 20,
            background: 'var(--card-bg, #1e1e1e)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            minWidth: 140,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 12px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: '#e5e7eb',
              fontSize: 13,
              cursor: 'pointer',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setMaskMenuOpen(false);
              // TODO: open editor (Task 3)
            }}
          >
            {hasMask ? '编辑蒙版' : '新建蒙版'}
          </button>
          <button
            disabled={!hasMask}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 12px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: hasMask ? '#f87171' : '#6b7280',
              fontSize: 13,
              cursor: hasMask ? 'pointer' : 'not-allowed',
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!hasMask) return;
              deleteMask(currentMaskKey);
              setMaskMenuOpen(false);
            }}
          >
            删除蒙版
          </button>
        </div>
      </>
    )}
  </div>
)}
```

**Step 4: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add client/src/components/ImageCard.tsx
git commit -m "feat: add mask icon overlay and dropdown to ImageCard"
```

---

## Task 3: ImageCard — double-click + entry logic

Wire up the editor open logic for double-click and the dropdown "新建/编辑蒙版" button.

**Files:**
- Modify: `client/src/components/ImageCard.tsx`

**Step 1: Add openEditor import**

The `useMaskStore` import already exists from Task 2. Add `useToast` if not already imported:
```typescript
import { useToast } from '../hooks/useToast.js';
```

**Step 2: Add the openEditor selector and toast**

After the `deleteMask` selector line, add:
```typescript
const openEditor = useMaskStore((s) => s.openEditor);
const { addToast } = useToast();
```

**Step 3: Add the openMaskEditor callback**

Add this function inside the ImageCard component body:
```typescript
const openMaskEditor = useCallback(() => {
  if (tabMaskMode === 'none') return;

  if (tabMaskMode === 'B') {
    if (selectedOutputIdx < 0 || !outputs[selectedOutputIdx]) {
      addToast('请先执行工作流以获得结果图，再打开蒙版编辑器', 'info');
      return;
    }
    openEditor({
      imageId: image.id,
      outputIndex: selectedOutputIdx,
      mode: 'B',
      originalUrl: image.previewUrl,
      resultUrl: outputs[selectedOutputIdx].url,
      resultFilename: outputs[selectedOutputIdx].filename,
    });
    return;
  }

  // Mode A
  openEditor({
    imageId: image.id,
    outputIndex: -1,
    mode: 'A',
    originalUrl: image.previewUrl,
  });
}, [tabMaskMode, selectedOutputIdx, outputs, image, openEditor, addToast]);
```

**Step 4: Wire the callback to double-click on the image/video element**

Find the `<img>` element that displays the original or output. Add `onDoubleClick`:
```tsx
onDoubleClick={(e) => {
  if (isVideoWorkflow) return;  // ignore double-click on video cards
  e.stopPropagation();
  openMaskEditor();
}}
```

**Step 5: Wire the dropdown "新建/编辑蒙版" button onClick**

Replace the `// TODO: open editor (Task 3)` comment with:
```typescript
openMaskEditor();
```

**Step 6: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add client/src/components/ImageCard.tsx
git commit -m "feat: wire mask editor entry logic in ImageCard"
```

---

## Task 4: MaskEditor modal shell

Build the modal frame (title bar, placeholder canvas area, close button). No real canvas yet — just the visible structure so we can test opening/closing.

**Files:**
- Create: `client/src/components/MaskEditor.tsx`
- Modify: `client/src/components/App.tsx`

**Step 1: Create MaskEditor.tsx shell**

```typescript
// client/src/components/MaskEditor.tsx
import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useMaskStore } from '../hooks/useMaskStore.js';

export function MaskEditor() {
  const editorState = useMaskStore((s) => s.editorState);
  const closeEditor = useMaskStore((s) => s.closeEditor);

  const handleClose = useCallback(() => {
    // TODO Task 9: save mask before closing
    closeEditor();
  }, [closeEditor]);

  if (!editorState) return null;

  const isModeBModal = editorState.mode === 'B';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--card-bg, #1a1a1a)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          width: 'min(92vw, 1100px)',
          height: 'min(90vh, 780px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            gap: 8,
          }}
        >
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#e5e7eb' }}>
            蒙版编辑器
            <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
              [{editorState.mode === 'A' ? '叠加模式' : 'A|B混合模式'}]
            </span>
          </span>
          {isModeBModal && (
            <button
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 6,
                color: '#93c5fd',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              onClick={() => {/* TODO Task 10: export */}}
            >
              导出
            </button>
          )}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
            onClick={handleClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {editorState.mode === 'A' && (
            <button
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#d1d5db',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              onClick={() => {/* TODO Task 6: sub-mode toggle */}}
            >
              预览模式 ▾
            </button>
          )}
          <button
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#d1d5db',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
            onClick={() => {/* TODO Task 6: clear mask */}}
          >
            清空蒙版
          </button>
          <button
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#d1d5db',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
            onClick={() => {/* TODO Task 6: invert mask */}}
          >
            反转蒙版
          </button>
        </div>

        {/* Main area: viewport + right panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Viewport placeholder */}
          <div
            style={{
              flex: 1,
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4b5563',
              fontSize: 13,
            }}
          >
            {/* TODO Task 5: MaskCanvas goes here */}
            Canvas placeholder — mode: {editorState.mode}
          </div>

          {/* Right panel: brush controls */}
          <div
            style={{
              width: 160,
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>大小</div>
              <input type="range" min={1} max={500} defaultValue={40} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>硬度</div>
              <input type="range" min={0} max={100} defaultValue={80} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>不透明度</div>
              <input type="range" min={0} max={100} defaultValue={100} style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Mount MaskEditor in App.tsx**

In `App.tsx`, add the import at the top:
```typescript
import { MaskEditor } from './MaskEditor.js';
```

At the end of the returned JSX (just before the closing tag of the root div), add:
```tsx
<MaskEditor />
```

**Step 3: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add client/src/components/MaskEditor.tsx client/src/components/App.tsx
git commit -m "feat: add MaskEditor modal shell and mount in App"
```

---

## 🧑‍💻 HUMAN CHECKPOINT A

**Test the following before continuing:**

1. Open the app on Tab 0 (二次元转真人). Every image card should show a gray `Layers` icon + chevron in the top-left corner.
2. Double-clicking a card image on Tab 0 should open the mask editor modal (showing "叠加模式").
3. The modal title bar should show "蒙版编辑器 [叠加模式]", and have a working X button that closes it.
4. Switch to Tab 1 (真人精修). For a card with **no output yet**, double-click should show a toast, not open the editor.
5. For Tab 1 cards that **have an output**, double-click should open the modal showing "[A|B混合模式]" with a "导出" button in the title bar.
6. The mask dropdown menu on each card should show "新建蒙版" / "编辑蒙版" and "删除蒙版" (grayed when no mask).
7. Tabs 2/3/4 should show NO mask icon on their cards.

**Report results before continuing.**

---

## Task 5: MaskCanvas — canvas layers + image rendering + pan/zoom

Build the core canvas viewport component. Loads images, displays them with viewport transform, handles pan and zoom.

**Files:**
- Create: `client/src/components/MaskCanvas.tsx`

**Step 1: Create MaskCanvas.tsx**

```typescript
// client/src/components/MaskCanvas.tsx
import { useRef, useEffect, useCallback, useState } from 'react';
import type { MaskEditorOpenState } from '../hooks/useMaskStore.js';

export type ModeASubMode = 'dark-overlay' | 'brighten' | 'red-overlay';

interface MaskCanvasProps {
  editorState: MaskEditorOpenState;
  subMode: ModeASubMode;
  // Refs exposed to parent for save/clear/invert operations
  maskCanvasRef: React.RefObject<OffscreenCanvas | null>;
  onReady: (workingWidth: number, workingHeight: number) => void;
  // Undo/redo signals
  undoSignal: number;      // increment to trigger undo
  redoSignal: number;      // increment to trigger redo
  clearSignal: number;     // increment to trigger clear
  invertSignal: number;    // increment to trigger invert
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  // Brush state
  brushSize: number;
  brushHardness: number;   // 0–1
  brushOpacity: number;    // 0–1
}

const MAX_WORKING_SIZE = 2048;
const MAX_HISTORY = 30;

function clampWorkingSize(w: number, h: number): [number, number] {
  const longest = Math.max(w, h);
  if (longest <= MAX_WORKING_SIZE) return [w, h];
  const scale = MAX_WORKING_SIZE / longest;
  return [Math.round(w * scale), Math.round(h * scale)];
}

export function MaskCanvas({
  editorState,
  subMode,
  maskCanvasRef,
  onReady,
  undoSignal,
  redoSignal,
  clearSignal,
  invertSignal,
  onHistoryChange,
  brushSize,
  brushHardness,
  brushOpacity,
}: MaskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvas1Ref = useRef<HTMLCanvasElement>(null); // base image
  const canvas2Ref = useRef<HTMLCanvasElement>(null); // mask overlay
  const canvas3Ref = useRef<HTMLCanvasElement>(null); // brush cursor
  const eventLayerRef = useRef<HTMLDivElement>(null);

  // Viewport transform (not state — avoid re-renders)
  const transform = useRef({ x: 0, y: 0, scale: 1 });
  const workingSize = useRef({ w: 0, h: 0 });
  const originalSize = useRef({ w: 0, h: 0 });

  // Loaded images
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const resultImageRef = useRef<HTMLImageElement | null>(null);

  // Mask canvas (offscreen, working resolution)
  const internalMaskCanvas = useRef<OffscreenCanvas | null>(null);

  // Undo/redo
  const historyStack = useRef<Uint8ClampedArray[]>([]);
  const historyIndex = useRef<number>(-1);

  // Brush state
  const isDrawing = useRef(false);
  const isErasingRef = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const mousePos = useRef<{ x: number; y: number }>({ x: -999, y: -999 });
  const isInsideViewport = useRef(false);

  const rafId = useRef<number>(0);
  const needsRender = useRef(true);

  // ─── Load images ────────────────────────────────────────────────────────────

  const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

  // ─── Fit view ────────────────────────────────────────────────────────────────

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container || workingSize.current.w === 0) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const { w, h } = workingSize.current;
    const scale = Math.min(cw / w, ch / h) * 0.92;
    transform.current = {
      x: (cw - w * scale) / 2,
      y: (ch - h * scale) / 2,
      scale,
    };
    needsRender.current = true;
  }, []);

  // ─── Coordinate helpers ──────────────────────────────────────────────────────

  const screenToCanvas = (sx: number, sy: number) => {
    const t = transform.current;
    return {
      x: (sx - t.x) / t.scale,
      y: (sy - t.y) / t.scale,
    };
  };

  // ─── Render loop ─────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    rafId.current = requestAnimationFrame(render);
    if (!needsRender.current) return;
    needsRender.current = false;

    const c1 = canvas1Ref.current;
    const c2 = canvas2Ref.current;
    const c3 = canvas3Ref.current;
    const mask = internalMaskCanvas.current;
    if (!c1 || !c2 || !c3 || !mask) return;

    const ctx1 = c1.getContext('2d')!;
    const ctx2 = c2.getContext('2d')!;
    const ctx3 = c3.getContext('2d')!;
    const { x, y, scale } = transform.current;
    const { w, h } = workingSize.current;

    // Clear all
    ctx1.clearRect(0, 0, c1.width, c1.height);
    ctx2.clearRect(0, 0, c2.width, c2.height);
    ctx3.clearRect(0, 0, c3.width, c3.height);

    const orig = originalImageRef.current;
    if (!orig) return;

    ctx1.save();
    ctx1.translate(x, y);
    ctx1.scale(scale, scale);

    if (editorState.mode === 'A') {
      // Canvas 1: original image
      ctx1.drawImage(orig, 0, 0, w, h);
      ctx1.restore();

      // Canvas 2: mask overlay based on subMode
      ctx2.save();
      ctx2.translate(x, y);
      ctx2.scale(scale, scale);
      renderModeAOverlay(ctx2, mask, w, h, subMode);
      ctx2.restore();
    } else {
      // Mode B: blend original + result using mask
      const result = resultImageRef.current;
      if (result) {
        renderModeBBlend(ctx1, orig, result, mask, w, h);
      } else {
        ctx1.drawImage(orig, 0, 0, w, h);
      }
      ctx1.restore();
    }

    // Canvas 3: brush cursor (in screen space)
    if (isInsideViewport.current) {
      const { x: mx, y: my } = mousePos.current;
      const radiusScreen = brushSize * scale;
      ctx3.beginPath();
      ctx3.arc(mx, my, radiusScreen, 0, Math.PI * 2);
      ctx3.strokeStyle = isErasingRef.current
        ? 'rgba(248,113,113,0.9)'
        : 'rgba(255,255,255,0.9)';
      ctx3.lineWidth = 1.5;
      ctx3.stroke();
      // Inner dot
      ctx3.beginPath();
      ctx3.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx3.fillStyle = 'rgba(255,255,255,0.9)';
      ctx3.fill();
    }
  }, [editorState.mode, subMode, brushSize]);

  // ─── Mode A overlay rendering ─────────────────────────────────────────────────

  function renderModeAOverlay(
    ctx: CanvasRenderingContext2D,
    mask: OffscreenCanvas,
    w: number,
    h: number,
    mode: ModeASubMode
  ) {
    const temp = new OffscreenCanvas(w, h);
    const tc = temp.getContext('2d')!;

    if (mode === 'dark-overlay') {
      // Dark grey where mask is painted
      tc.fillStyle = 'rgba(20,20,20,0.72)';
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(mask, 0, 0);
      ctx.drawImage(temp, 0, 0);
    } else if (mode === 'brighten') {
      // Dark overlay everywhere, cut out (lighten) where mask is painted
      tc.fillStyle = 'rgba(0,0,0,0.55)';
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = 'destination-out';
      tc.drawImage(mask, 0, 0);
      ctx.drawImage(temp, 0, 0);
    } else {
      // Red overlay where mask is painted
      tc.fillStyle = 'rgba(220,40,40,0.60)';
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(mask, 0, 0);
      ctx.drawImage(temp, 0, 0);
    }
  }

  // ─── Mode B blend rendering ───────────────────────────────────────────────────

  function renderModeBBlend(
    ctx: CanvasRenderingContext2D,
    orig: HTMLImageElement,
    result: HTMLImageElement,
    mask: OffscreenCanvas,
    w: number,
    h: number
  ) {
    // Draw original as base
    ctx.drawImage(orig, 0, 0, w, h);
    // Create result-masked-by-mask on temp canvas
    const temp = new OffscreenCanvas(w, h);
    const tc = temp.getContext('2d')!;
    tc.drawImage(result, 0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mask, 0, 0);
    // Composite masked result over original
    ctx.drawImage(temp, 0, 0);
  }

  // ─── Brush stroke ─────────────────────────────────────────────────────────────

  const stampBrush = (cx: number, cy: number) => {
    const mask = internalMaskCanvas.current;
    if (!mask) return;
    const mc = mask.getContext('2d')!;
    const r = brushSize;

    const stamp = new OffscreenCanvas(r * 2 + 2, r * 2 + 2);
    const sc = stamp.getContext('2d')!;
    const grad = sc.createRadialGradient(r + 1, r + 1, 0, r + 1, r + 1, r);
    const alpha = brushOpacity;
    // hardness: at hardness=1, full alpha to edge; at 0, fade from center
    const hardEdge = 0.01 + brushHardness * 0.99;
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(hardEdge, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, stamp.width, stamp.height);

    mc.save();
    mc.globalCompositeOperation = isErasingRef.current
      ? 'destination-out'
      : 'source-over';
    mc.globalAlpha = 1;
    mc.drawImage(stamp, cx - r - 1, cy - r - 1);
    mc.restore();

    needsRender.current = true;
  };

  const drawStrokeBetween = (
    ax: number, ay: number,
    bx: number, by: number
  ) => {
    const dist = Math.hypot(bx - ax, by - ay);
    const step = Math.max(1, brushSize * 0.25);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampBrush(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  };

  // ─── History helpers ──────────────────────────────────────────────────────────

  const pushSnapshot = useCallback(() => {
    const mask = internalMaskCanvas.current;
    if (!mask) return;
    const mc = mask.getContext('2d')!;
    const id = mc.getImageData(0, 0, mask.width, mask.height);
    const copy = new Uint8ClampedArray(id.data);
    // Truncate forward history
    historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
    historyStack.current.push(copy);
    if (historyStack.current.length > MAX_HISTORY) {
      historyStack.current.shift();
    }
    historyIndex.current = historyStack.current.length - 1;
    onHistoryChange(historyIndex.current > 0, false);
  }, [onHistoryChange]);

  const restoreSnapshot = useCallback((idx: number) => {
    const mask = internalMaskCanvas.current;
    if (!mask) return;
    const mc = mask.getContext('2d')!;
    const data = historyStack.current[idx];
    if (!data) return;
    const id = new ImageData(new Uint8ClampedArray(data), mask.width, mask.height);
    mc.putImageData(id, 0, 0);
    needsRender.current = true;
    onHistoryChange(idx > 0, idx < historyStack.current.length - 1);
  }, [onHistoryChange]);

  // ─── Event handlers ───────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const rect = eventLayerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    mousePos.current = { x: sx, y: sy };
    needsRender.current = true;

    if (!isDrawing.current) return;
    const cp = screenToCanvas(sx, sy);
    if (lastPos.current) {
      drawStrokeBetween(lastPos.current.x, lastPos.current.y, cp.x, cp.y);
    }
    lastPos.current = cp;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushSize, brushHardness, brushOpacity]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 1) return; // middle button handled separately
    if (e.button !== 0) return;
    isDrawing.current = true;
    const rect = eventLayerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const cp = screenToCanvas(sx, sy);
    lastPos.current = cp;
    stampBrush(cp.x, cp.y);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushSize, brushHardness, brushOpacity]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    lastPos.current = null;
    pushSnapshot();
  }, [pushSnapshot]);

  // Middle-mouse pan
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const handleMiddleDown = useCallback((e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    isPanning.current = true;
    panStart.current = {
      x: e.clientX, y: e.clientY,
      tx: transform.current.x, ty: transform.current.y,
    };
  }, []);

  const handleMiddleMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return;
    transform.current.x = panStart.current.tx + (e.clientX - panStart.current.x);
    transform.current.y = panStart.current.ty + (e.clientY - panStart.current.y);
    needsRender.current = true;
  }, []);

  const handleMiddleUp = useCallback((e: MouseEvent) => {
    if (e.button === 1) isPanning.current = false;
  }, []);

  // Scroll to zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    // Alt+scroll → brush size (handled in MaskEditor, see Task 7)
    // T+scroll → opacity (handled in MaskEditor)
    // Default scroll → zoom
    e.preventDefault();
    const rect = eventLayerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    const t = transform.current;
    const newScale = Math.max(0.05, Math.min(40, t.scale * delta));
    transform.current = {
      scale: newScale,
      x: sx - (sx - t.x) * (newScale / t.scale),
      y: sy - (sy - t.y) * (newScale / t.scale),
    };
    needsRender.current = true;
  }, []);

  // ─── Init & cleanup ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const orig = await loadImage(editorState.originalUrl);
      if (cancelled) return;
      const [ww, wh] = clampWorkingSize(orig.naturalWidth, orig.naturalHeight);
      workingSize.current = { w: ww, h: wh };
      originalSize.current = { w: orig.naturalWidth, h: orig.naturalHeight };
      originalImageRef.current = orig;

      if (editorState.mode === 'B' && editorState.resultUrl) {
        const res = await loadImage(editorState.resultUrl);
        if (!cancelled) resultImageRef.current = res;
      }

      // Create mask offscreen canvas
      const mc = new OffscreenCanvas(ww, wh);
      internalMaskCanvas.current = mc;
      if (maskCanvasRef && 'current' in maskCanvasRef) {
        (maskCanvasRef as React.MutableRefObject<OffscreenCanvas | null>).current = mc;
      }

      // Initial snapshot (blank)
      historyStack.current = [];
      const blankData = new Uint8ClampedArray(ww * wh * 4);
      historyStack.current.push(blankData);
      historyIndex.current = 0;

      onReady(ww, wh);
      fitView();
      needsRender.current = true;
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.imageId, editorState.outputIndex]);

  // Resize canvases to match container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      [canvas1Ref, canvas2Ref, canvas3Ref].forEach((ref) => {
        if (ref.current) {
          ref.current.width = w;
          ref.current.height = h;
        }
      });
      fitView();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitView]);

  // Keyboard: F = fit view, Shift = erase, Ctrl+Z/Y
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') fitView();
      if (e.key === 'Shift') { isErasingRef.current = true; needsRender.current = true; }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { isErasingRef.current = false; needsRender.current = true; }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [fitView]);

  // Wire canvas event listeners
  useEffect(() => {
    const el = eventLayerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('mousedown', handleMiddleDown);
    el.addEventListener('mousemove', handleMiddleMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseup', handleMiddleUp);
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('mouseenter', () => { isInsideViewport.current = true; });
    el.addEventListener('mouseleave', () => {
      isInsideViewport.current = false;
      needsRender.current = true;
    });
    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('mousedown', handleMiddleDown);
      el.removeEventListener('mousemove', handleMiddleMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseup', handleMiddleUp);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [handleMouseMove, handleMouseDown, handleMiddleDown, handleMiddleMove,
      handleMouseUp, handleMiddleUp, handleWheel]);

  // Undo/redo/clear/invert signals
  useEffect(() => {
    if (undoSignal === 0) return;
    const idx = historyIndex.current - 1;
    if (idx < 0) return;
    historyIndex.current = idx;
    restoreSnapshot(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSignal]);

  useEffect(() => {
    if (redoSignal === 0) return;
    const idx = historyIndex.current + 1;
    if (idx >= historyStack.current.length) return;
    historyIndex.current = idx;
    restoreSnapshot(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redoSignal]);

  useEffect(() => {
    if (clearSignal === 0) return;
    const mask = internalMaskCanvas.current;
    if (!mask) return;
    mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
    needsRender.current = true;
    pushSnapshot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);

  useEffect(() => {
    if (invertSignal === 0) return;
    const mask = internalMaskCanvas.current;
    if (!mask) return;
    const mc = mask.getContext('2d')!;
    const id = mc.getImageData(0, 0, mask.width, mask.height);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i + 3] = 255 - id.data[i + 3]; // invert alpha only
    }
    mc.putImageData(id, 0, 0);
    needsRender.current = true;
    pushSnapshot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertSignal]);

  // Start/stop render loop
  useEffect(() => {
    rafId.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId.current);
  }, [render]);

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas ref={canvas1Ref} style={canvasStyle} />
      <canvas ref={canvas2Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      <canvas ref={canvas3Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      <div
        ref={eventLayerRef}
        style={{
          ...canvasStyle,
          cursor: 'none',
        }}
      />
    </div>
  );
}
```

**Step 2: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add client/src/components/MaskCanvas.tsx
git commit -m "feat: add MaskCanvas with canvas layers, pan/zoom, brush rendering"
```

---

## Task 6: Wire MaskCanvas into MaskEditor + toolbar state

Connect MaskCanvas to MaskEditor, wire the toolbar buttons (SubMode, Clear, Invert), and add keyboard shortcuts (Ctrl+Z/Y, Alt+scroll, T+scroll).

**Files:**
- Modify: `client/src/components/MaskEditor.tsx`

**Step 1: Replace the MaskEditor.tsx content with the full wired version**

```typescript
// client/src/components/MaskEditor.tsx
import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { MaskCanvas, type ModeASubMode } from './MaskCanvas.js';
import type { MaskEntry } from '../hooks/useMaskStore.js';
import { maskKey } from '../config/maskConfig.js';

export function MaskEditor() {
  const editorState = useMaskStore((s) => s.editorState);
  const closeEditor = useMaskStore((s) => s.closeEditor);
  const setMask = useMaskStore((s) => s.setMask);

  const [subMode, setSubMode] = useState<ModeASubMode>('dark-overlay');
  const subModeLabels: Record<ModeASubMode, string> = {
    'dark-overlay': '暗色叠加',
    'brighten': '高亮显示',
    'red-overlay': '红色叠加',
  };
  const subModeOrder: ModeASubMode[] = ['dark-overlay', 'brighten', 'red-overlay'];

  // Brush state
  const [brushSize, setBrushSize] = useState(40);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushOpacity, setBrushOpacity] = useState(1.0);

  // Undo/redo signals (increment to trigger)
  const [undoSignal, setUndoSignal] = useState(0);
  const [redoSignal, setRedoSignal] = useState(0);
  const [clearSignal, setClearSignal] = useState(0);
  const [invertSignal, setInvertSignal] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Working size (set when canvas is ready)
  const workingSizeRef = useRef({ w: 0, h: 0 });
  const originalSizeRef = useRef({ w: 0, h: 0 });

  // Mask canvas ref (set by MaskCanvas on ready)
  const maskCanvasRef = useRef<OffscreenCanvas | null>(null);

  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState('');

  const handleClose = useCallback(() => {
    // Save mask to store
    const mask = maskCanvasRef.current;
    if (mask && editorState) {
      const mc = mask.getContext('2d')!;
      const id = mc.getImageData(0, 0, mask.width, mask.height);
      const entry: MaskEntry = {
        data: new Uint8ClampedArray(id.data),
        workingWidth: mask.width,
        workingHeight: mask.height,
        originalWidth: originalSizeRef.current.w || mask.width,
        originalHeight: originalSizeRef.current.h || mask.height,
      };
      setMask(maskKey(editorState.imageId, editorState.outputIndex), entry);
    }
    closeEditor();
  }, [closeEditor, editorState, setMask]);

  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Alt+scroll, T+scroll
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      setUndoSignal((v) => v + 1);
    }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      setRedoSignal((v) => v + 1);
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      setBrushSize((s) => Math.max(1, Math.min(500, s + delta)));
    } else if (e.getModifierState('T')) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setBrushOpacity((o) => Math.max(0, Math.min(1, parseFloat((o + delta).toFixed(1)))));
    }
  }, []);

  const cycleSubMode = useCallback(() => {
    setSubMode((current) => {
      const idx = subModeOrder.indexOf(current);
      return subModeOrder[(idx + 1) % subModeOrder.length];
    });
  }, [subModeOrder]);

  if (!editorState) return null;

  const isModeB = editorState.mode === 'B';
  const defaultExportName = editorState.resultFilename
    ? editorState.resultFilename.replace(/\.[^.]+$/, '') + '_Mixed.png'
    : 'mask_Mixed.png';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      tabIndex={-1}
    >
      <div
        style={{
          background: 'var(--card-bg, #1a1a1a)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          width: 'min(92vw, 1200px)',
          height: 'min(90vh, 820px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          gap: 8,
        }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#e5e7eb' }}>
            蒙版编辑器
            <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
              [{isModeB ? 'A|B混合模式' : '叠加模式'}]
            </span>
          </span>
          {isModeB && (
            <button
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 6, color: '#93c5fd',
                fontSize: 12, padding: '4px 10px', cursor: 'pointer',
              }}
              onClick={() => {
                setExportFilename(defaultExportName);
                setShowExportDialog(true);
              }}
            >
              导出
            </button>
          )}
          <span style={{ fontSize: 11, color: '#4b5563', userSelect: 'none' }}>
            {canUndo && (
              <button
                onClick={() => setUndoSignal((v) => v + 1)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
              >↩</button>
            )}
            {canRedo && (
              <button
                onClick={() => setRedoSignal((v) => v + 1)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
              >↪</button>
            )}
          </span>
          <button
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            onClick={handleClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          {!isModeB && (
            <button
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
              }}
              onClick={cycleSubMode}
            >
              {subModeLabels[subMode]} ▾
            </button>
          )}
          <button
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
            onClick={() => setClearSignal((v) => v + 1)}
          >清空蒙版</button>
          <button
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
            onClick={() => setInvertSignal((v) => v + 1)}
          >反转蒙版</button>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Viewport */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0d0d0d' }}>
            <MaskCanvas
              editorState={editorState}
              subMode={subMode}
              maskCanvasRef={maskCanvasRef}
              onReady={(ww, wh) => {
                workingSizeRef.current = { w: ww, h: wh };
              }}
              undoSignal={undoSignal}
              redoSignal={redoSignal}
              clearSignal={clearSignal}
              invertSignal={invertSignal}
              onHistoryChange={(u, r) => { setCanUndo(u); setCanRedo(r); }}
              brushSize={brushSize}
              brushHardness={brushHardness}
              brushOpacity={brushOpacity}
            />
          </div>

          {/* Right panel */}
          <div style={{
            width: 168, borderLeft: '1px solid rgba(255,255,255,0.08)',
            padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 20,
          }}>
            <BrushSlider
              label="大小"
              value={brushSize} min={1} max={500}
              display={`${brushSize}px`}
              onChange={setBrushSize}
            />
            <BrushSlider
              label="硬度"
              value={Math.round(brushHardness * 100)} min={0} max={100}
              display={`${Math.round(brushHardness * 100)}%`}
              onChange={(v) => setBrushHardness(v / 100)}
            />
            <BrushSlider
              label="不透明度"
              value={Math.round(brushOpacity * 100)} min={0} max={100}
              display={`${Math.round(brushOpacity * 100)}%`}
              onChange={(v) => setBrushOpacity(v / 100)}
            />
          </div>
        </div>
      </div>

      {/* Export dialog */}
      {showExportDialog && (
        <ExportDialog
          defaultFilename={exportFilename}
          maskCanvasRef={maskCanvasRef}
          editorState={editorState}
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
}

// ─── BrushSlider sub-component ────────────────────────────────────────────────

function BrushSlider({
  label, value, min, max, display, onChange,
}: {
  label: string; value: number; min: number; max: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#3b82f6' }}
      />
    </div>
  );
}

// ─── ExportDialog sub-component ───────────────────────────────────────────────

function ExportDialog({
  defaultFilename,
  maskCanvasRef,
  editorState,
  onClose,
}: {
  defaultFilename: string;
  maskCanvasRef: React.RefObject<OffscreenCanvas | null>;
  editorState: NonNullable<ReturnType<typeof useMaskStore>['editorState']> extends infer T ? T : never;
  onClose: () => void;
}) {
  // Avoid complex type, just use any-safe workaround
  const [filename, setFilename] = useState(defaultFilename);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    setSaving(true);
    setError('');

    try {
      // Build blend composite at working resolution
      const orig = new Image();
      orig.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => {
        orig.onload = () => res();
        orig.onerror = rej;
        orig.src = (editorState as { originalUrl: string }).originalUrl;
      });
      const resultUrl = (editorState as { resultUrl?: string }).resultUrl;
      const result = new Image();
      result.crossOrigin = 'anonymous';
      if (resultUrl) {
        await new Promise<void>((res, rej) => {
          result.onload = () => res();
          result.onerror = rej;
          result.src = resultUrl;
        });
      }

      const w = mask.width;
      const h = mask.height;
      const out = new OffscreenCanvas(w, h);
      const ctx = out.getContext('2d')!;
      ctx.drawImage(orig, 0, 0, w, h);
      if (resultUrl) {
        const temp = new OffscreenCanvas(w, h);
        const tc = temp.getContext('2d')!;
        tc.drawImage(result, 0, 0, w, h);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mask, 0, 0);
        ctx.drawImage(temp, 0, 0);
      }

      const blob = await out.convertToBlob({ type: 'image/png' });
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), '')
      );

      const res = await fetch('/api/workflow/export-blend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId: 1, // TODO: derive from editorState when more tabs use Mode B
          filename: filename.endsWith('.png') ? filename : filename + '.png',
          imageDataBase64: base64,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      alert(`已保存到: ${json.savedPath}`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8, padding: 20, minWidth: 340,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: '#e5e7eb', marginBottom: 14 }}>导出混合结果</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
          保存路径: <span style={{ color: '#9ca3af' }}>output/1-真人精修/</span>
        </div>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, padding: '7px 10px',
            color: '#e5e7eb', fontSize: 13, marginBottom: 12,
          }}
        />
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
          >取消</button>
          <button
            onClick={handleExport}
            disabled={saving}
            style={{ background: 'rgba(59,130,246,0.8)', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 14px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}
          >
            {saving ? '保存中…' : '确认保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note: `ExportDialog` uses `editorState` parameter typed as `MaskEditorOpenState` — fix the import at the top:
```typescript
import type { MaskEntry, MaskEditorOpenState } from '../hooks/useMaskStore.js';
```
And update ExportDialog's prop type to `editorState: MaskEditorOpenState`.

**Step 2: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Fix any type errors before continuing.

**Step 3: Commit**

```bash
git add client/src/components/MaskEditor.tsx client/src/components/MaskCanvas.tsx
git commit -m "feat: wire MaskCanvas into MaskEditor with toolbar and brush controls"
```

---

## Task 7: Load existing mask on editor open

When the editor opens, if a mask already exists in the store for this `imageId:outputIndex`, restore it onto the mask canvas.

**Files:**
- Modify: `client/src/components/MaskCanvas.tsx`

**Step 1: Accept existing mask as a prop**

In MaskCanvas props interface, add:
```typescript
existingMask?: MaskEntry;
```

Import MaskEntry:
```typescript
import type { MaskEntry, MaskEditorOpenState } from '../hooks/useMaskStore.js';
```

**Step 2: In the `init()` function inside the `useEffect`, after creating `internalMaskCanvas`, restore existing mask if provided**

After `internalMaskCanvas.current = mc;`, add:
```typescript
if (existingMask) {
  const mc2 = mc.getContext('2d')!;
  const id = new ImageData(
    new Uint8ClampedArray(existingMask.data),
    existingMask.workingWidth,
    existingMask.workingHeight
  );
  // Scale if working sizes differ
  if (existingMask.workingWidth === ww && existingMask.workingHeight === wh) {
    mc2.putImageData(id, 0, 0);
  } else {
    const tmp = new OffscreenCanvas(existingMask.workingWidth, existingMask.workingHeight);
    tmp.getContext('2d')!.putImageData(id, 0, 0);
    mc2.drawImage(tmp, 0, 0, ww, wh);
  }
  // Replace blank snapshot with loaded mask
  const loaded = mc2.getImageData(0, 0, ww, wh);
  historyStack.current[0] = new Uint8ClampedArray(loaded.data);
}
```

**Step 3: Pass existingMask from MaskEditor**

In `MaskEditor.tsx`, add store selector:
```typescript
const getMask = useMaskStore((s) => s.getMask);
```

In the `<MaskCanvas ...>` JSX, add:
```tsx
existingMask={editorState ? getMask(maskKey(editorState.imageId, editorState.outputIndex)) : undefined}
```

**Step 4: Check TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add client/src/components/MaskCanvas.tsx client/src/components/MaskEditor.tsx
git commit -m "feat: restore existing mask on editor open"
```

---

## Task 8: Server export endpoint

Add the POST `/api/workflow/export-blend` endpoint that saves a base64 PNG to the workflow's output directory.

**Files:**
- Modify: `server/src/routes/workflow.ts`

**Step 1: Add the endpoint before `export default router`**

```typescript
// POST /api/workflow/export-blend — save Mode B blended result to output dir
router.post('/export-blend', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { tabId, filename, imageDataBase64 } = req.body as {
      tabId: number;
      filename: string;
      imageDataBase64: string;
    };

    const adapter = getAdapter(tabId);
    if (!adapter) {
      res.status(400).json({ error: `Unknown workflow: ${tabId}` });
      return;
    }

    // Sanitise filename — allow only safe characters
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9_\-. \u4e00-\u9fff]/g, '_');
    const outputDir = path.resolve(__dirname, '../../../output', adapter.outputDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, safeName);
    const buffer = Buffer.from(imageDataBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    res.json({ ok: true, savedPath: filePath });
  } catch (err) {
    console.error('[export-blend]', err);
    res.status(500).json({ error: String(err) });
  }
});
```

Note: `express` is already imported as part of the app setup; the route file uses `Router`. For the JSON body limit, check that the main `app.ts`/`index.ts` has `express.json()` mounted globally or add it inline as shown.

**Step 2: Check TypeScript compiles on server**

```bash
cd server && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add server/src/routes/workflow.ts
git commit -m "feat: add export-blend endpoint to save mask composite to output dir"
```

---

## 🧑‍💻 HUMAN CHECKPOINT B

**Test the following before continuing:**

1. Tab 0 — double-click any card. Editor opens. You can **paint** on the canvas with the brush cursor visible.
2. Erase mode: hold **Shift** — brush ring turns red. Painting erases. Release Shift — back to add mode.
3. Mode A sub-modes — click "预览模式 ▾" button to cycle through dark-overlay / brighten / red-overlay. Verify all three look correct on the painted area.
4. **Undo/redo:** Paint a stroke → Ctrl+Z undoes it → Ctrl+Y redoes it. Paint 31+ strokes to confirm history cap (oldest stroke is lost).
5. **Clear mask** button wipes the canvas. Undo (Ctrl+Z) restores it.
6. **Invert mask** flips painted/unpainted areas.
7. **Pan:** Middle-mouse drag pans the view.
8. **Zoom:** Middle-mouse scroll zooms around cursor.
9. **Fit (F):** Press F to reset view.
10. **Alt+scroll** changes brush size (watch the right panel slider update).
11. **T+scroll** changes opacity.
12. Close editor with X. Reopen same card — previous mask is **restored**.
13. Tab 0 card mask icon turns **green** after painting and closing. **Gray** after deleting via dropdown.
14. Tab 1 — open a card with an output. Mode B shows the A|B blend realtime. Paint to reveal result image pixels through mask.
15. Tab 1 — click 导出 in title bar. Export dialog appears with correct default filename `{output}_Mixed.png`. Confirm saves a file to `output/1-真人精修/`. Toast shows path.

**Report results before continuing.**

---

## Task 9: Polish — cursor hiding, T-key scroll, edge cases

Minor fixes identified during testing.

**Files:**
- Modify: `client/src/components/MaskCanvas.tsx`
- Modify: `client/src/components/MaskEditor.tsx`

**Step 1: T-key scroll for opacity**

The `handleWheel` in `MaskEditor.tsx` checks `e.getModifierState('T')`. This doesn't work because `getModifierState` only works for modifier keys (Shift/Alt/Ctrl). Instead, track T key in state:

In MaskEditor, add:
```typescript
const tKeyRef = useRef(false);
```

In the `onKeyDown` handler:
```typescript
if (e.key === 't' || e.key === 'T') tKeyRef.current = true;
```
In the `onKeyUp` handler (add one if not present):
```typescript
if (e.key === 't' || e.key === 'T') tKeyRef.current = false;
```

Update `handleWheel`:
```typescript
} else if (tKeyRef.current) {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  setBrushOpacity((o) => Math.max(0, Math.min(1, parseFloat((o + delta).toFixed(1)))));
}
```

**Step 2: Ensure brush cursor is hidden when mouse leaves the editor modal**

The viewport `cursor: none` is already on the event layer div in `MaskCanvas`. Verify that outside the viewport div, the cursor returns to normal. This should already work as `cursor: none` is scoped to the event layer.

**Step 3: Commit**

```bash
git add client/src/components/MaskEditor.tsx client/src/components/MaskCanvas.tsx
git commit -m "fix: correct T-key scroll for opacity, cursor polish"
```

---

## 🧑‍💻 HUMAN CHECKPOINT C (Final)

**Full regression test:**

1. All checkpoint B items still pass.
2. T+scroll correctly steps opacity ±0.1.
3. Switching between Tab 0 and Tab 1 and opening the editor on each shows the correct mode (A vs B).
4. On Tab 1, a card with no output shows the toast "请先执行工作流…" instead of opening the editor.
5. Multiple cards can each have their own independent masks.
6. Masks survive between editor open/close sessions within the same page load.
7. Deleting a mask via dropdown changes the card icon from green to gray.
8. Export produces a valid PNG file in the correct output directory.

**If all pass: proceed to git wrap-up below.**

---

## Wrap-up

```bash
git log --oneline -10
```

Verify all commits are present and clean.

---

## Known Limitations & Future Work

- Masks are **in-memory only** — lost on page refresh (by design for this version)
- Mode A is only active on Tab 0 (dev/test) — assign to real tabs when needed
- Export path is hardcoded to Tab 1's output dir — generalise when more tabs use Mode B
- The `ExportDialog` base64 encoding path is synchronous and may be slow for very large images — replace with `createObjectURL` + fetch blob if needed
