import { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, FolderOpen, Trash2, Fan, HardDrive } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';

interface StatusBarProps {
  lastSavedAt: Date | null;
}

interface SysStats { vram: number | null; ram: number; }

function usageColor(pct: number): string {
  if (pct < 50) return '#4CAF50';
  if (pct < 75) return '#FF9800';
  if (pct < 90) return '#FF5722';
  return '#f44336';
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return '刚刚';
  if (secs < 60) return `${secs}秒前`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

const Divider = () => (
  <div style={{ width: 1, alignSelf: 'stretch', margin: '4px 0', backgroundColor: 'var(--color-border)', flexShrink: 0 }} />
);

export function StatusBar({ lastSavedAt }: StatusBarProps) {
  const clientId = useWorkflowStore((s) => s.clientId);
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const hasAnyProcessing = useWorkflowStore((s) =>
    Object.values(s.tabData).some((tab) =>
      Object.values(tab.tasks).some((t) => t.status === 'processing' || t.status === 'queued')
    )
  );

  const [releasing, setReleasing] = useState(false);
  const [displayStats, setDisplayStats] = useState<SysStats | null>(null);
  const [tick, setTick] = useState(0);
  const targetStatsRef = useRef<SysStats | null>(null);
  const currentVramRef = useRef<number | null>(null);
  const currentRamRef = useRef<number>(0);

  // Refresh "X分钟前" every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // VRAM/RAM polling — updates target ref only
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/workflow/system-stats');
        if (res.ok) {
          const data: SysStats = await res.json();
          if (targetStatsRef.current === null) {
            currentVramRef.current = data.vram;
            currentRamRef.current = data.ram;
          }
          targetStatsRef.current = data;
        }
      } catch { /* ComfyUI not ready */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);

  // Continuous rAF lerp toward polling target
  useEffect(() => {
    const LERP = 0.012;
    let rafId: number;
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      const target = targetStatsRef.current;
      if (!target) return;
      currentVramRef.current = currentVramRef.current !== null && target.vram !== null
        ? currentVramRef.current + (target.vram - currentVramRef.current) * LERP
        : target.vram;
      currentRamRef.current = currentRamRef.current + (target.ram - currentRamRef.current) * LERP;
      const roundedVram = currentVramRef.current !== null ? Math.round(currentVramRef.current) : null;
      const roundedRam = Math.round(currentRamRef.current);
      setDisplayStats((prev) => {
        if (prev?.vram === roundedVram && prev?.ram === roundedRam) return prev;
        return { vram: roundedVram, ram: roundedRam };
      });
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleReleaseMemory = useCallback(async () => {
    if (!clientId || releasing) return;
    setReleasing(true);
    try {
      const res = await fetch(`/api/workflow/release-memory?clientId=${clientId}`, { method: 'POST' });
      if (!res.ok) console.error('Release memory failed:', await res.text());
    } catch (err) {
      console.error('Release memory error:', err);
    } finally {
      setTimeout(() => setReleasing(false), 2000);
    }
  }, [clientId, releasing]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await fetch(`/api/workflow/${activeTab}/open-folder`, { method: 'POST' });
    } catch (err) {
      console.error('Open folder error:', err);
    }
  }, [activeTab]);

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 10px',
    height: '100%',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    color: 'var(--color-text-secondary)',
  };

  return (
    <div style={{
      height: 28,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      borderTop: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
      fontSize: '11px',
      color: 'var(--color-text-secondary)',
      userSelect: 'none',
    }}>
      {/* ── Left: autosave ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px', whiteSpace: 'nowrap', opacity: 0.75 }}>
        <CheckCircle2 size={11} style={{ flexShrink: 0 }} />
        {lastSavedAt ? `自动保存于 ${timeAgo(lastSavedAt)}` : '未保存'}
      </div>

      <Divider />

      {/* ── Middle: open folder ── */}
      <button
        onClick={handleOpenFolder}
        title="打开输出目录"
        style={btnStyle}
      >
        <FolderOpen size={11} />
        打开输出目录
      </button>

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Right: release memory ── */}
      <Divider />
      <button
        onClick={handleReleaseMemory}
        disabled={!clientId || releasing || hasAnyProcessing}
        title={hasAnyProcessing ? '队列执行中，无法释放' : '释放显存/内存'}
        style={{
          ...btnStyle,
          cursor: (!clientId || releasing || hasAnyProcessing) ? 'not-allowed' : 'pointer',
          opacity: (!clientId || releasing || hasAnyProcessing) ? 0.4 : 1,
        }}
      >
        <Trash2 size={11} />
        {releasing ? '释放中...' : '释放缓存'}
      </button>

      {/* ── VRAM ── */}
      {displayStats && displayStats.vram !== null && (
        <>
          <Divider />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', whiteSpace: 'nowrap' }}>
            <Fan size={11} style={{ flexShrink: 0 }} />
            <span>显存</span>
            <div style={{ width: 40, height: 3, backgroundColor: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${displayStats.vram}%`, height: '100%', backgroundColor: usageColor(displayStats.vram), borderRadius: 2 }} />
            </div>
            <span style={{ fontWeight: 700, color: usageColor(displayStats.vram) }}>{displayStats.vram}%</span>
          </div>
        </>
      )}

      {/* ── RAM ── */}
      {displayStats && (
        <>
          <Divider />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', whiteSpace: 'nowrap' }}>
            <HardDrive size={11} style={{ flexShrink: 0 }} />
            <span>内存</span>
            <div style={{ width: 40, height: 3, backgroundColor: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${displayStats.ram}%`, height: '100%', backgroundColor: usageColor(displayStats.ram), borderRadius: 2 }} />
            </div>
            <span style={{ fontWeight: 700, color: usageColor(displayStats.ram) }}>{displayStats.ram}%</span>
          </div>
        </>
      )}
    </div>
  );
}
