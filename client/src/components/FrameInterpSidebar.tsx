import { useState, useEffect } from 'react';

export interface FrameInterpConfig {
  multiplier: number;
}

const MULTIPLIER_OPTIONS = [
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
  { label: '6x', value: 6 },
];

const STORAGE_KEY = 'frameinterp_config';

function readSavedConfig(): Partial<FrameInterpConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function FrameInterpSidebar({ width }: { width?: number }) {
  const saved = readSavedConfig();
  const [multiplier, setMultiplier] = useState(saved.multiplier ?? 2);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ multiplier }));
  }, [multiplier]);

  // Expose config via a global accessor for execute to read
  useEffect(() => {
    (window as any).__frameInterpConfig = { multiplier };
    return () => { delete (window as any).__frameInterpConfig; };
  }, [multiplier]);

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
        视频补帧参数
      </div>

      {/* Multiplier */}
      <SegmentedControl
        label="补帧倍率"
        options={MULTIPLIER_OPTIONS}
        value={multiplier}
        onChange={setMultiplier}
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
