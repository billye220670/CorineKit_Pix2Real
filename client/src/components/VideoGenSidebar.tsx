import { useState, useEffect } from 'react';

export interface VideoGenConfig {
  megapixels: number;
  seconds: number;
  fps: number;
}

const QUALITY_OPTIONS = [
  { label: '草稿', value: 0.5 },
  { label: '中等', value: 0.8 },
  { label: '原图', value: 1.0 },
];

const DURATION_OPTIONS = [
  { label: '4s', value: 4 },
  { label: '6s', value: 6 },
  { label: '8s', value: 8 },
];

const FPS_OPTIONS = [
  { label: '草稿', value: 12 },
  { label: '流畅', value: 16 },
  { label: '精细', value: 24 },
];

const STORAGE_KEY = 'videogen_config';

function readSavedConfig(): Partial<VideoGenConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function VideoGenSidebar({ width }: { width?: number }) {
  const saved = readSavedConfig();
  const [megapixels, setMegapixels] = useState(saved.megapixels ?? 1.0);
  const [seconds, setSeconds] = useState(saved.seconds ?? 4);
  const [fps, setFps] = useState(saved.fps ?? 16);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ megapixels, seconds, fps }));
  }, [megapixels, seconds, fps]);

  // Expose config via a global accessor for execute to read
  useEffect(() => {
    (window as any).__videoGenConfig = { megapixels, seconds, fps };
    return () => { delete (window as any).__videoGenConfig; };
  }, [megapixels, seconds, fps]);

  return (
    <div
      style={{
        width: width ?? 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        padding: 16,
        gap: 20,
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
        视频生成参数
      </div>

      {/* Quality / Megapixels */}
      <SegmentedControl
        label="质量"
        options={QUALITY_OPTIONS}
        value={megapixels}
        onChange={setMegapixels}
      />

      {/* Duration */}
      <SegmentedControl
        label="时长"
        options={DURATION_OPTIONS}
        value={seconds}
        onChange={setSeconds}
      />

      {/* FPS */}
      <SegmentedControl
        label="帧率"
        options={FPS_OPTIONS}
        value={fps}
        onChange={setFps}
      />
    </div>
  );
}

// ─── SegmentedControl ─────────────────────────────────────────────────

function SegmentedControl<T extends number>({ label, options, value, onChange }: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState(-1);

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{
        display: 'flex',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}>
        {options.map((opt, idx) => {
          const isActive = opt.value === value;
          const isHover = hoverIdx === idx && !isActive;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(-1)}
              style={{
                flex: 1,
                padding: '7px 0',
                border: 'none',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                backgroundColor: isActive
                  ? 'var(--color-primary)'
                  : isHover
                    ? 'var(--color-surface-hover)'
                    : 'var(--color-bg)',
                color: isActive ? '#fff' : 'var(--color-text-secondary)',
                transition: 'background-color 0.15s, color 0.15s',
                borderRight: idx < options.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
