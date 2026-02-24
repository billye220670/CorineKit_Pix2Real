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
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const mousePos = useRef({ x: -999, y: -999 });
  const insideViewport = useRef(false);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const rafId = useRef(0);
  const dirty = useRef(true);

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

  const stampBrush = useCallback((cx: number, cy: number) => {
    const mc = maskCanvas.current;
    if (!mc) return;
    const mctx = mc.getContext('2d')!;
    const r = brushSize;
    const stamp = new OffscreenCanvas(r * 2 + 2, r * 2 + 2);
    const sc = stamp.getContext('2d')!;
    const cx2 = r + 1, cy2 = r + 1;
    const grad = sc.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
    const hardEdge = 0.01 + brushHardness * 0.99;
    grad.addColorStop(0, 'rgba(255,255,255,' + brushOpacity + ')');
    grad.addColorStop(hardEdge, 'rgba(255,255,255,' + brushOpacity + ')');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, stamp.width, stamp.height);
    mctx.save();
    mctx.globalCompositeOperation = isErasing.current ? 'destination-out' : 'source-over';
    mctx.drawImage(stamp, cx - r - 1, cy - r - 1);
    mctx.restore();
    dirty.current = true;
  }, [brushSize, brushHardness, brushOpacity]);

  const strokeBetween = useCallback((ax: number, ay: number, bx: number, by: number) => {
    const dist = Math.hypot(bx - ax, by - ay);
    const step = Math.max(1, brushSize * 0.25);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampBrush(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }, [brushSize, stampBrush]);

  const renderModeAOverlay = (
    ctx: CanvasRenderingContext2D,
    mc: OffscreenCanvas,
    w: number, h: number
  ) => {
    const tmp = new OffscreenCanvas(w, h);
    const tc = tmp.getContext('2d')!;
    if (subMode === 'dark-overlay') {
      tc.fillStyle = 'rgba(20,20,20,0.72)';
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(mc, 0, 0);
    } else if (subMode === 'brighten') {
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
    ctx.drawImage(tmp, 0, 0);
  };

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
      renderModeAOverlay(ctx2, mc, w, h);
      ctx2.restore();
    } else {
      const result = resultImageRef.current;
      if (result) {
        renderModeBBlend(ctx1, orig, result, mc, w, h);
      } else {
        ctx1.drawImage(orig, 0, 0, w, h);
      }
      ctx1.restore();
    }

    // Brush cursor on canvas3
    if (insideViewport.current) {
      const { x: mx, y: my } = mousePos.current;
      const radiusScreen = brushSize * scale;
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
  }, [editorState.mode, subMode, brushSize]);

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
    }
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.imageId, editorState.outputIndex]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = el;
      [canvas1Ref, canvas2Ref, canvas3Ref].forEach(ref => {
        if (ref.current) { ref.current.width = w; ref.current.height = h; }
      });
      fitView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { isErasing.current = true; dirty.current = true; }
      if (e.key === 'f' || e.key === 'F') fitView();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { isErasing.current = false; dirty.current = true; }
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
      if (e.button === 1) {
        e.preventDefault();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, tx: transform.current.x, ty: transform.current.y };
        return;
      }
      if (e.button !== 0) return;
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
      pushSnapshot();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

  useEffect(() => {
    dirty.current = true;
  }, [subMode, brushSize]);

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
      <div ref={eventLayerRef} style={{ ...canvasStyle, cursor: 'none' }} />
    </div>
  );
}
