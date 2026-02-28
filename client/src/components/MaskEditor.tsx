// client/src/components/MaskEditor.tsx
import { useCallback, useRef, useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { maskKey } from '../config/maskConfig.js';
import { MaskCanvas, type ModeASubMode, type MaskCanvasHandle } from './MaskCanvas.js';
import type { MaskEditorOpenState } from '../hooks/useMaskStore.js';

// ── BrushSlider ────────────────────────────────────────────────────────────────────────────────
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

// ── ExportDialog ────────────────────────────────────────────────────────────────────────────────
function ExportDialog({
  editorState,
  canvasHandle,
  sessionId,
  tabId,
  onClose,
}: {
  editorState: MaskEditorOpenState;
  canvasHandle: MaskCanvasHandle | null;
  sessionId: string | null;
  tabId: number;
  onClose: () => void;
}) {
  const defaultName = editorState.resultFilename
    ? editorState.resultFilename.replace(/.[^.]+$/, '') + '_Mixed.png'
    : 'mask_Mixed.png';
  const [filename, setFilename] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    if (!canvasHandle) return;
    const entry = canvasHandle.getMaskEntry();
    if (!entry) return;
    setSaving(true);
    setError('');
    try {
      const loadImg = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });
      const orig = await loadImg(editorState.originalUrl);
      const w = entry.workingWidth;
      const h = entry.workingHeight;
      const out = new OffscreenCanvas(w, h);
      const ctx = out.getContext('2d')!;
      ctx.drawImage(orig, 0, 0, w, h);
      if (editorState.resultUrl) {
        const result = await loadImg(editorState.resultUrl);
        const tmp = new OffscreenCanvas(w, h);
        const tc = tmp.getContext('2d')!;
        tc.drawImage(result, 0, 0, w, h);
        const maskOC = new OffscreenCanvas(w, h);
        maskOC.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(entry.data), w, h), 0, 0);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(maskOC, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      }
      const blob = await out.convertToBlob({ type: 'image/png' });
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const safeFilename = filename.endsWith('.png') ? filename : filename + '.png';
      const res = await fetch('/api/workflow/export-blend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, tabId, filename: safeFilename, imageDataBase64: base64 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { savedPath: string };
      alert('已保存到: ' + json.savedPath);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 20, minWidth: 340 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: '#e5e7eb', marginBottom: 14 }}>导出混合结果</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
          保存路径: <span style={{ color: '#9ca3af' }}>output/1-真人精修/</span>
        </div>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', color: '#e5e7eb', fontSize: 13, marginBottom: 12 }}
        />
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>取消</button>
          <button onClick={handleExport} disabled={saving} style={{ background: 'rgba(59,130,246,0.8)', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 14px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            {saving ? '保存中…' : '确认保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MaskEditor ────────────────────────────────────────────────────────────────────────────────

export function MaskEditor() {
  const editorState = useMaskStore((s) => s.editorState);
  const closeEditor = useMaskStore((s) => s.closeEditor);
  const setMask = useMaskStore((s) => s.setMask);
  const getMask = useMaskStore((s) => s.getMask);
  const sessionId = useWorkflowStore((s) => s.sessionId);
  const activeTab = useWorkflowStore((s) => s.activeTab);

  const [subMode, setSubMode] = useState<ModeASubMode>('dark-overlay');
  const subModeLabels: Record<ModeASubMode, string> = {
    'dark-overlay': '暗色叠加',
    'brighten': '高亮显示',
    'red-overlay': '红色叠加',
  };
  const subModeOrder: ModeASubMode[] = ['dark-overlay', 'brighten', 'red-overlay'];

  const [brushSize, setBrushSize] = useState(40);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushOpacity, setBrushOpacity] = useState(1.0);
  const [undoSignal, setUndoSignal] = useState(0);
  const [redoSignal, setRedoSignal] = useState(0);
  const [clearSignal, setClearSignal] = useState(0);
  const [invertSignal, setInvertSignal] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showMaskOverlay, setShowMaskOverlay] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const tKeyDown = useRef(false);
  const canvasHandleRef = useRef<MaskCanvasHandle | null>(null);

  // Stable callback — does not change reference between renders, which keeps
  // pushSnapshot/restoreSnapshot in MaskCanvas stable and prevents undo/invert
  // effects from double-firing when React re-renders the editor.
  const handleHistoryChange = useCallback((canUndo: boolean, canRedo: boolean) => {
    setCanUndo(canUndo);
    setCanRedo(canRedo);
  }, []);

  const handleClose = useCallback(() => {
    if (editorState && canvasHandleRef.current) {
      const entry = canvasHandleRef.current.getMaskEntry();
      if (entry) {
        setMask(maskKey(editorState.imageId, editorState.outputIndex), entry);
      }
    }
    closeEditor();
  }, [editorState, closeEditor, setMask]);

  const cycleSubMode = useCallback(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setSubMode((cur) => subModeOrder[(subModeOrder.indexOf(cur) + 1) % subModeOrder.length]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoFill = useCallback(async () => {
    if (!editorState || !canvasHandleRef.current) return;

    // Check if canvas already has painted content
    const entry = canvasHandleRef.current.getMaskEntry();
    if (entry) {
      let hasContent = false;
      for (let i = 3; i < entry.data.length; i += 4) {
        if (entry.data[i] > 0) { hasContent = true; break; }
      }
      if (hasContent && !confirm('当前画布已有蒙版内容，确认要替换吗？')) return;
    }

    setAutoFilling(true);
    try {
      const imgRes = await fetch(editorState.originalUrl);
      if (!imgRes.ok) throw new Error('无法获取原图');
      const blob = await imgRes.blob();
      const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg';
      const formData = new FormData();
      formData.append('image', blob, 'original' + ext);

      const res = await fetch('/api/workflow/mask/auto-recognize', { method: 'POST', body: formData });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const maskBlob = await res.blob();
      const maskUrl = URL.createObjectURL(maskBlob);
      try {
        await canvasHandleRef.current.applyMaskFromUrl(maskUrl);
      } finally {
        URL.revokeObjectURL(maskUrl);
      }
    } catch (e) {
      alert('识别失败: ' + String(e));
    } finally {
      setAutoFilling(false);
    }
  }, [editorState]);

  // Keyboard: Ctrl+Z/Y handled here so they work anywhere in the modal
  useEffect(() => {
    if (!editorState) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') tKeyDown.current = true;
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); setUndoSignal((v) => v + 1); }
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); setRedoSignal((v) => v + 1); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') tKeyDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [editorState]);

  // Alt+scroll = brush size, T+scroll = opacity (on the modal overlay div)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      e.preventDefault();
      setBrushSize((s) => Math.max(1, Math.min(500, s + (e.deltaY < 0 ? 5 : -5))));
    } else if (tKeyDown.current) {
      e.preventDefault();
      setBrushOpacity((o) => Math.max(0, Math.min(1, parseFloat((o + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(1)))));
    }
  }, []);

  if (!editorState) return null;

  const isModeB = editorState.mode === 'B';
  const existingMask = getMask(maskKey(editorState.imageId, editorState.outputIndex));

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
      onWheel={handleWheel}
    >
      <div
        style={{ background: 'var(--card-bg, #1a1a1a)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 'min(92vw, 1200px)', height: 'min(90vh, 820px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', gap: 8 }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#e5e7eb' }}>
            蒙版编辑器
            <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
              [{isModeB ? 'A|B混合模式' : '叠加模式'}]
            </span>
          </span>
          {canUndo && (
            <button onClick={() => setUndoSignal((v) => v + 1)} title="撤销 (Ctrl+Z)" style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>↩</button>
          )}
          {canRedo && (
            <button onClick={() => setRedoSignal((v) => v + 1)} title="重做 (Ctrl+Y)" style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>↪</button>
          )}
          {isModeB && (
            <button
              onClick={() => setShowExport(true)}
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6, color: '#93c5fd', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
            >
              导出
            </button>
          )}
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {!isModeB && (
            <button onClick={cycleSubMode} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
              {subModeLabels[subMode]} ▾
            </button>
          )}
          {isModeB && (
            <button
              onClick={() => setShowMaskOverlay((v) => !v)}
              title={showMaskOverlay ? '隐藏蒙版叠加' : '显示蒙版叠加'}
              style={{ background: showMaskOverlay ? 'rgba(220,40,40,0.25)' : 'rgba(255,255,255,0.07)', border: `1px solid ${showMaskOverlay ? 'rgba(220,40,40,0.6)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, color: showMaskOverlay ? '#fca5a5' : '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {showMaskOverlay ? <EyeOff size={13} /> : <Eye size={13} />}
              蒙版可见
            </button>
          )}
          <button onClick={() => setClearSignal((v) => v + 1)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>清空蒙版</button>
          <button onClick={() => setInvertSignal((v) => v + 1)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#d1d5db', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>反转蒙版</button>
        </div>

        {/* Main area: viewport + right panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Viewport */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0d0d0d' }}>
            <MaskCanvas
              editorState={editorState}
              subMode={subMode}
              existingMask={existingMask}
              onReady={() => {}}
              undoSignal={undoSignal}
              redoSignal={redoSignal}
              clearSignal={clearSignal}
              invertSignal={invertSignal}
              onHistoryChange={handleHistoryChange}
              brushSize={brushSize}
              brushHardness={brushHardness}
              brushOpacity={brushOpacity}
              canvasHandleRef={canvasHandleRef}
              showMaskOverlay={showMaskOverlay}
            />
          </div>

          {/* Right panel */}
          <div style={{ width: 168, borderLeft: '1px solid rgba(255,255,255,0.08)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <button
              onClick={handleAutoFill}
              disabled={autoFilling}
              style={{ background: autoFilling ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,0.9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 0', cursor: autoFilling ? 'not-allowed' : 'pointer', width: '100%' }}
            >
              {autoFilling ? '识别中…' : '识别并填充'}
            </button>
            <BrushSlider label="大小" value={brushSize} min={1} max={500} display={brushSize + 'px'} onChange={setBrushSize} />
            <BrushSlider label="硬度" value={Math.round(brushHardness * 100)} min={0} max={100} display={Math.round(brushHardness * 100) + '%'} onChange={(v) => setBrushHardness(v / 100)} />
            <BrushSlider label="不透明度" value={Math.round(brushOpacity * 100)} min={0} max={100} display={Math.round(brushOpacity * 100) + '%'} onChange={(v) => setBrushOpacity(v / 100)} />
          </div>
        </div>
      </div>

      {showExport && (
        <ExportDialog
          editorState={editorState}
          canvasHandle={canvasHandleRef.current}
          sessionId={sessionId}
          tabId={activeTab}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
