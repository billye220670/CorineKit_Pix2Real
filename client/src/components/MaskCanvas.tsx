// client/src/components/MaskCanvas.tsx
import { useRef, useEffect, useCallback } from 'react';
import type { MaskEntry, MaskEditorOpenState } from '../hooks/useMaskStore.js';

export type ModeASubMode = 'dark-overlay' | 'brighten' | 'red-overlay';

const MAX_WORKING_SIZE = 2048;
const MAX_HISTORY = 30;

function clampWorkingSize(w: number, h: number): [number, number] {
  const longest = Math.max(w, h);
  if (longest <= MAX_WORKING_SIZE) return [w, h];
  const scale = MAX_WORKING_SIZE / longest;
  return [Math.round(w * scale), Math.round(h * scale)];
}

export interface MaskCanvasHandle {
  getMaskEntry: () => MaskEntry | null;
  applyMaskFromUrl: (url: string) => Promise<void>;
}

interface MaskCanvasProps {
  editorState: MaskEditorOpenState;
  subMode: ModeASubMode;
  existingMask?: MaskEntry;
  onReady: (workingWidth: number, workingHeight: number, originalWidth: number, originalHeight: number) => void;
  undoSignal: number;
  redoSignal: number;
  clearSignal: number;
  invertSignal: number;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
  showMaskOverlay?: boolean;
  canvasHandleRef: React.MutableRefObject<MaskCanvasHandle | null>;
}

export function MaskCanvas({
  editorState,
  subMode,
  existingMask,
  onReady,
  undoSignal,
  redoSignal,
  clearSignal,
  invertSignal,
  onHistoryChange,
  brushSize,
  brushHardness,
  brushOpacity,
  showMaskOverlay,
  canvasHandleRef,
}: MaskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const canvas3Ref = useRef<HTMLCanvasElement>(null);
  const eventLayerRef = useRef<HTMLDivElement>(null);

  const transform = useRef({ x: 0, y: 0, scale: 1 });
  const workingSize = useRef({ w: 0, h: 0 });
  const originalSize = useRef({ w: 0, h: 0 });

  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const resultImageRef = useRef<HTMLImageElement | null>(null);
  const maskCanvas = useRef<OffscreenCanvas | null>(null);

  const historyStack = useRef<Uint8ClampedArray[]>([]);
  const historyIndex = useRef<number>(-1);

  const isDrawing = useRef(false);
  const isErasing = useRef(false);
  const tKeyDown = useRef(false); // tracks T key for opacity scroll modifier
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const mousePos = useRef({ x: -999, y: -999 });
  const insideViewport = useRef(false);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const rafId = useRef(0);
  const dirty = useRef(true);

  // Stroke layer refs for non-accumulating soft brush.
  // On each mouseDown (paint mode), strokeBaseCanvas = snapshot of maskCanvas,
  // strokeLayerCanvas = blank canvas for this stroke's contribution.
  // Each stamp applies pixel-wise max alpha to strokeLayerCanvas, then
  // maskCanvas is recomposed as strokeBase + strokeLayer.
  // This prevents soft brush edges from hardening when stamps overlap.
  const strokeBaseCanvas = useRef<OffscreenCanvas | null>(null);
  const strokeLayerCanvas = useRef<OffscreenCanvas | null>(null);

  // Always-current refs for brush props and subMode.
  // These allow stampBrush, strokeBetween, and render to be stable useCallbacks
  // that never change reference, preventing unnecessary effect re-fires.
  const brushSizeRef = useRef(brushSize);
  const brushHardnessRef = useRef(brushHardness);
  const brushOpacityRef = useRef(brushOpacity);
  const subModeRef = useRef(subMode);
  const showMaskOverlayRef = useRef(showMaskOverlay ?? false);

  brushSizeRef.current = brushSize;
  brushHardnessRef.current = brushHardness;
  brushOpacityRef.current = brushOpacity;
  subModeRef.current = subMode;
  showMaskOverlayRef.current = showMaskOverlay ?? false;

  // Expose handle for parent to read mask data
  canvasHandleRef.current = {
    getMaskEntry: () => {
      const mc = maskCanvas.current;
      if (!mc || workingSize.current.w === 0) return null;
      const ctx = mc.getContext('2d')!;
      const id = ctx.getImageData(0, 0, mc.width, mc.height);
      return {
        data: new Uint8ClampedArray(id.data),
        workingWidth: mc.width,
        workingHeight: mc.height,
        originalWidth: originalSize.current.w || mc.width,
        originalHeight: originalSize.current.h || mc.height,
      };
    },
    applyMaskFromUrl: async (url: string) => {
      const mc = maskCanvas.current;
      if (!mc || workingSize.current.w === 0) return;
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const tmp = new OffscreenCanvas(mc.width, mc.height);
      const tc = tmp.getContext('2d')!;
      tc.drawImage(img, 0, 0, mc.width, mc.height);
      const id = tc.getImageData(0, 0, mc.width, mc.height);
      // ComfyUI MaskToImage outputs grayscale RGB: convert luminance → alpha channel
      for (let i = 0; i < id.data.length; i += 4) {
        const lum = Math.round(id.data[i] * 0.299 + id.data[i + 1] * 0.587 + id.data[i + 2] * 0.114);
        id.data[i]     = 255;
        id.data[i + 1] = 255;
        id.data[i + 2] = 255;
        id.data[i + 3] = lum;
      }
      mc.getContext('2d')!.putImageData(id, 0, 0);
      dirty.current = true;
      pushSnapshot();
    },
  };

  const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });

  const screenToCanvas = (sx: number, sy: number) => {
    const t = transform.current;
    return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
  };

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || workingSize.current.w === 0) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const { w, h } = workingSize.current;
    const scale = Math.min(cw / w, ch / h) * 0.92;
    transform.current = {
      x: (cw - w * scale) / 2,
      y: (ch - h * scale) / 2,
      scale,
    };
    dirty.current = true;
  }, []);

  const pushSnapshot = useCallback(() => {
    const mc = maskCanvas.current;
    if (!mc) return;
    const id = mc.getContext('2d')!.getImageData(0, 0, mc.width, mc.height);
    const copy = new Uint8ClampedArray(id.data);
    historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
    historyStack.current.push(copy);
    if (historyStack.current.length > MAX_HISTORY) historyStack.current.shift();
    historyIndex.current = historyStack.current.length - 1;
    onHistoryChange(historyIndex.current > 0, false);
  }, [onHistoryChange]);

  const restoreSnapshot = useCallback((idx: number) => {
    const mc = maskCanvas.current;
    if (!mc) return;
    const data = historyStack.current[idx];
    if (!data) return;
    const id = new ImageData(new Uint8ClampedArray(data), mc.width, mc.height);
    mc.getContext('2d')!.putImageData(id, 0, 0);
    dirty.current = true;
    onHistoryChange(idx > 0, idx < historyStack.current.length - 1);
  }, [onHistoryChange]);

  // Applies a brush stamp to the stroke layer using pixel-wise max alpha.
  // This is the core of the non-accumulating soft brush: for any pixel,
  // the opacity in the current stroke equals the MAX opacity any single stamp
  // reached at that pixel — identical to Photoshop's non-build-up brush mode.
  const applyStampMaxAlpha = useCallback((stamp: OffscreenCanvas, destX: number, destY: number) => {
    const sl = strokeLayerCanvas.current;
    if (!sl) return;
    const x0 = Math.max(0, destX);
    const y0 = Math.max(0, destY);
    const x1 = Math.min(sl.width, destX + stamp.width);
    const y1 = Math.min(sl.height, destY + stamp.height);
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;
    const stampData = stamp.getContext('2d')!.getImageData(x0 - destX, y0 - destY, rw, rh);
    const slctx = sl.getContext('2d')!;
    const slData = slctx.getImageData(x0, y0, rw, rh);
    for (let i = 0; i < slData.data.length; i += 4) {
      const srcAlpha = stampData.data[i + 3];
      if (srcAlpha > slData.data[i + 3]) {
        slData.data[i]     = 255; // R
        slData.data[i + 1] = 255; // G
        slData.data[i + 2] = 255; // B
        slData.data[i + 3] = srcAlpha;
      }
    }
    slctx.putImageData(slData, x0, y0);
  }, []); // stable: reads refs only

  // stampBrush reads brush props from refs so it is stable (empty deps).
  // This prevents the event-handler useEffect from re-firing on every brush change.
  const stampBrush = useCallback((cx: number, cy: number) => {
    const mc = maskCanvas.current;
    if (!mc) return;
    const mctx = mc.getContext('2d')!;
    const r = brushSizeRef.current;
    const stamp = new OffscreenCanvas(r * 2 + 2, r * 2 + 2);
    const sc = stamp.getContext('2d')!;
    const cx2 = r + 1, cy2 = r + 1;
    const grad = sc.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
    const hardEdge = 0.01 + brushHardnessRef.current * 0.99;
    grad.addColorStop(0, 'rgba(255,255,255,' + brushOpacityRef.current + ')');
    grad.addColorStop(hardEdge, 'rgba(255,255,255,' + brushOpacityRef.current + ')');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, stamp.width, stamp.height);
    const destX = Math.floor(cx - r - 1);
    const destY = Math.floor(cy - r - 1);
    if (isErasing.current) {
      // Erase directly on maskCanvas — no accumulation problem when removing alpha
      mctx.save();
      mctx.globalCompositeOperation = 'destination-out';
      mctx.drawImage(stamp, destX, destY);
      mctx.restore();
    } else {
      const sl = strokeLayerCanvas.current;
      const sb = strokeBaseCanvas.current;
      if (sl && sb) {
        // Max-alpha composite: prevents soft edges from hardening on overlap
        applyStampMaxAlpha(stamp, destX, destY);
        // Recompose maskCanvas = strokeBase (unchanged) + strokeLayer (max-blended)
        mctx.clearRect(0, 0, mc.width, mc.height);
        mctx.drawImage(sb, 0, 0);
        mctx.drawImage(sl, 0, 0);
      } else {
        // Fallback if stroke layer was not initialized (e.g. mode just switched)
        mctx.save();
        mctx.globalCompositeOperation = 'source-over';
        mctx.drawImage(stamp, destX, destY);
        mctx.restore();
      }
    }
    dirty.current = true;
  }, [applyStampMaxAlpha]); // stable: applyStampMaxAlpha is stable

  const strokeBetween = useCallback((ax: number, ay: number, bx: number, by: number) => {
    const dist = Math.hypot(bx - ax, by - ay);
    const step = Math.max(1, brushSizeRef.current * 0.25);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampBrush(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }, [stampBrush]); // stable since stampBrush is stable

  const renderModeBBlend = (
    ctx: CanvasRenderingContext2D,
    orig: HTMLImageElement,
    result: HTMLImageElement,
    mc: OffscreenCanvas,
    w: number, h: number
  ) => {
    ctx.drawImage(orig, 0, 0, w, h);
    const tmp = new OffscreenCanvas(w, h);
    const tc = tmp.getContext('2d')!;
    tc.drawImage(result, 0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mc, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  };

  // render reads subMode and brushSize from refs so it only needs editorState.mode in deps.
  // Keeping render stable avoids cancelling/rescheduling the RAF on every brush change.
  const render = useCallback(() => {
    rafId.current = requestAnimationFrame(render);
    if (!dirty.current) return;
    dirty.current = false;

    const c1 = canvas1Ref.current;
    const c2 = canvas2Ref.current;
    const c3 = canvas3Ref.current;
    const mc = maskCanvas.current;
    if (!c1 || !c2 || !c3 || !mc) return;

    const ctx1 = c1.getContext('2d')!;
    const ctx2 = c2.getContext('2d')!;
    const ctx3 = c3.getContext('2d')!;
    const { x, y, scale } = transform.current;
    const { w, h } = workingSize.current;

    ctx1.clearRect(0, 0, c1.width, c1.height);
    ctx2.clearRect(0, 0, c2.width, c2.height);
    ctx3.clearRect(0, 0, c3.width, c3.height);

    const orig = originalImageRef.current;
    if (!orig || w === 0) return;

    ctx1.save();
    ctx1.translate(x, y);
    ctx1.scale(scale, scale);

    if (editorState.mode === 'A') {
      ctx1.drawImage(orig, 0, 0, w, h);
      ctx1.restore();
      ctx2.save();
      ctx2.translate(x, y);
      ctx2.scale(scale, scale);
      // Inline overlay using subModeRef.current so this callback is stable
      const sm = subModeRef.current;
      const tmp = new OffscreenCanvas(w, h);
      const tc = tmp.getContext('2d')!;
      if (sm === 'dark-overlay') {
        tc.fillStyle = 'rgba(20,20,20,0.72)';
        tc.fillRect(0, 0, w, h);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mc, 0, 0);
      } else if (sm === 'brighten') {
        tc.fillStyle = 'rgba(0,0,0,0.55)';
        tc.fillRect(0, 0, w, h);
        tc.globalCompositeOperation = 'destination-out';
        tc.drawImage(mc, 0, 0);
      } else {
        tc.fillStyle = 'rgba(220,40,40,0.60)';
        tc.fillRect(0, 0, w, h);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mc, 0, 0);
      }
      ctx2.drawImage(tmp, 0, 0);
      ctx2.restore();
    } else {
      const result = resultImageRef.current;
      if (result) {
        renderModeBBlend(ctx1, orig, result, mc, w, h);
      } else {
        ctx1.drawImage(orig, 0, 0, w, h);
      }
      ctx1.restore();
      // Optional red mask overlay in Mode B so the user can see painted areas
      if (showMaskOverlayRef.current) {
        ctx2.save();
        ctx2.translate(x, y);
        ctx2.scale(scale, scale);
        const tmp = new OffscreenCanvas(w, h);
        const tc = tmp.getContext('2d')!;
        tc.fillStyle = 'rgba(220,40,40,0.55)';
        tc.fillRect(0, 0, w, h);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mc, 0, 0);
        ctx2.drawImage(tmp, 0, 0);
        ctx2.restore();
      }
    }

    // Brush cursor on canvas3
    if (insideViewport.current) {
      const { x: mx, y: my } = mousePos.current;
      const radiusScreen = brushSizeRef.current * scale;
      ctx3.beginPath();
      ctx3.arc(mx, my, Math.max(1, radiusScreen), 0, Math.PI * 2);
      ctx3.strokeStyle = isErasing.current ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.9)';
      ctx3.lineWidth = 1.5;
      ctx3.stroke();
      ctx3.beginPath();
      ctx3.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx3.fillStyle = 'rgba(255,255,255,0.9)';
      ctx3.fill();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.mode]); // subMode and brushSize read from refs above

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

      const mc = new OffscreenCanvas(ww, wh);
      maskCanvas.current = mc;

      // Restore existing mask if any
      if (existingMask) {
        const mctx = mc.getContext('2d')!;
        if (existingMask.workingWidth === ww && existingMask.workingHeight === wh) {
          mctx.putImageData(
            new ImageData(new Uint8ClampedArray(existingMask.data), ww, wh),
            0, 0
          );
        } else {
          const tmp = new OffscreenCanvas(existingMask.workingWidth, existingMask.workingHeight);
          tmp.getContext('2d')!.putImageData(
            new ImageData(new Uint8ClampedArray(existingMask.data), existingMask.workingWidth, existingMask.workingHeight),
            0, 0
          );
          mctx.drawImage(tmp, 0, 0, ww, wh);
        }
      }

      // Initial history snapshot
      const blankOrLoaded = mc.getContext('2d')!.getImageData(0, 0, ww, wh);
      historyStack.current = [new Uint8ClampedArray(blankOrLoaded.data)];
      historyIndex.current = 0;

      onReady(ww, wh, orig.naturalWidth, orig.naturalHeight);
      fitView();
      dirty.current = true;
      // Focus the event layer so keyboard shortcuts (Shift, F, T) work immediately
      // without requiring the user to click the canvas first.
      eventLayerRef.current?.focus();
    }
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.imageId, editorState.outputIndex]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { clientWidth: cw, clientHeight: ch } = el;
      [canvas1Ref, canvas2Ref, canvas3Ref].forEach(ref => {
        if (ref.current) {
          // Only reset dimensions when they actually change; setting width/height
          // unconditionally clears the canvas even when size hasn't changed.
          if (ref.current.width !== cw || ref.current.height !== ch) {
            ref.current.width = cw;
            ref.current.height = ch;
          }
        }
      });
      fitView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isErasing.current = true;
        dirty.current = true;
        // If switching to erase mid-stroke, maskCanvas is already the correct composite
        // (recomposed on each stamp). Null the stroke layers so subsequent erase stamps
        // go directly to maskCanvas via the fallback path.
        if (isDrawing.current) {
          strokeBaseCanvas.current = null;
          strokeLayerCanvas.current = null;
        }
      }
      if (e.key === 'f' || e.key === 'F') fitView();
      if (e.key === 't' || e.key === 'T') tKeyDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isErasing.current = false;
        dirty.current = true;
        // If switching back to paint mid-stroke, reinitialize stroke layers from
        // the current maskCanvas state (which includes any erasing just done).
        if (isDrawing.current) {
          const mc = maskCanvas.current;
          if (mc) {
            const sb = new OffscreenCanvas(mc.width, mc.height);
            sb.getContext('2d')!.drawImage(mc, 0, 0);
            strokeBaseCanvas.current = sb;
            strokeLayerCanvas.current = new OffscreenCanvas(mc.width, mc.height);
          }
        }
      }
      if (e.key === 't' || e.key === 'T') tKeyDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [fitView]);

  useEffect(() => {
    const el = eventLayerRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      mousePos.current = { x: sx, y: sy };
      dirty.current = true;

      if (isPanning.current) {
        transform.current.x = panStart.current.tx + (e.clientX - panStart.current.x);
        transform.current.y = panStart.current.ty + (e.clientY - panStart.current.y);
        dirty.current = true;
      }

      if (isDrawing.current) {
        const cp = screenToCanvas(sx, sy);
        if (lastPos.current) strokeBetween(lastPos.current.x, lastPos.current.y, cp.x, cp.y);
        lastPos.current = cp;
      }
    };

    const onDown = (e: MouseEvent) => {
      e.preventDefault(); // prevent text selection on shift+click
      if (e.button === 1) {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, tx: transform.current.x, ty: transform.current.y };
        return;
      }
      if (e.button !== 0) return;
      // Initialize stroke layers for non-accumulating soft brush (paint mode only)
      if (!isErasing.current) {
        const mc = maskCanvas.current;
        if (mc) {
          const sb = new OffscreenCanvas(mc.width, mc.height);
          sb.getContext('2d')!.drawImage(mc, 0, 0);
          strokeBaseCanvas.current = sb;
          strokeLayerCanvas.current = new OffscreenCanvas(mc.width, mc.height);
        }
      }
      isDrawing.current = true;
      const rect = el.getBoundingClientRect();
      const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
      lastPos.current = cp;
      stampBrush(cp.x, cp.y);
    };

    const onUp = (e: MouseEvent) => {
      if (e.button === 1) { isPanning.current = false; return; }
      if (!isDrawing.current) return;
      isDrawing.current = false;
      lastPos.current = null;
      // Clean up stroke layers
      strokeBaseCanvas.current = null;
      strokeLayerCanvas.current = null;
      pushSnapshot();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // When Alt or T is held, MaskEditor's outer handleWheel manages brush size/opacity.
      // Returning here prevents the canvas from also zooming at the same time.
      if (e.altKey || tKeyDown.current) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      const t = transform.current;
      const ns = Math.max(0.05, Math.min(40, t.scale * delta));
      transform.current = { scale: ns, x: sx - (sx - t.x) * (ns / t.scale), y: sy - (sy - t.y) * (ns / t.scale) };
      dirty.current = true;
    };

    const onEnter = () => { insideViewport.current = true; };
    const onLeave = () => { insideViewport.current = false; dirty.current = true; };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mousedown', onDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  // stampBrush, strokeBetween, and pushSnapshot are all stable after mount,
  // so this effect runs exactly once and never needs to re-register listeners.
  }, [stampBrush, strokeBetween, pushSnapshot]);

  useEffect(() => {
    if (undoSignal === 0) return;
    const idx = historyIndex.current - 1;
    if (idx < 0) return;
    historyIndex.current = idx;
    restoreSnapshot(idx);
  }, [undoSignal, restoreSnapshot]);

  useEffect(() => {
    if (redoSignal === 0) return;
    const idx = historyIndex.current + 1;
    if (idx >= historyStack.current.length) return;
    historyIndex.current = idx;
    restoreSnapshot(idx);
  }, [redoSignal, restoreSnapshot]);

  useEffect(() => {
    if (clearSignal === 0) return;
    const mc = maskCanvas.current;
    if (!mc) return;
    mc.getContext('2d')!.clearRect(0, 0, mc.width, mc.height);
    dirty.current = true;
    pushSnapshot();
  }, [clearSignal, pushSnapshot]);

  useEffect(() => {
    if (invertSignal === 0) return;
    const mc = maskCanvas.current;
    if (!mc) return;
    const mctx = mc.getContext('2d')!;
    const id = mctx.getImageData(0, 0, mc.width, mc.height);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i + 3] = 255 - id.data[i + 3];
    }
    mctx.putImageData(id, 0, 0);
    dirty.current = true;
    pushSnapshot();
  }, [invertSignal, pushSnapshot]);

  // Trigger a re-render when subMode, brushSize, or showMaskOverlay changes so the display updates.
  useEffect(() => {
    dirty.current = true;
  }, [subMode, brushSize, showMaskOverlay]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId.current);
  }, [render]);

  const canvasStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas ref={canvas1Ref} style={canvasStyle} />
      <canvas ref={canvas2Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      <canvas ref={canvas3Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      <div ref={eventLayerRef} tabIndex={0} style={{ ...canvasStyle, cursor: 'none', outline: 'none' }} />
    </div>
  );
}
