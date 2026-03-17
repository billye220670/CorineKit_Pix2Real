import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel, type StartupBehavior } from '../hooks/useSettingsStore.js';
import { SegmentedControl } from './SegmentedControl.js';

const REVERSE_PROMPT_MODELS: { value: ReversePromptModel; label: string }[] = [
  { value: 'Qwen3VL', label: 'Qwen3VL' },
  { value: 'Florence', label: 'Florence' },
  { value: 'WD-14', label: 'WD-14' },
];

const STARTUP_BEHAVIOR_OPTIONS: { value: StartupBehavior; label: string }[] = [
  { value: 'restore', label: '恢复上次' },
  { value: 'new', label: '开新会话' },
  { value: 'welcome', label: '欢迎页' },
];

const CATEGORIES = [
  { id: 'workflow', label: '工作流' },
  { id: 'session', label: '会话' },
];

export function SettingsModal() {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const reversePromptModel = useSettingsStore((s) => s.reversePromptModel);
  const setReversePromptModel = useSettingsStore((s) => s.setReversePromptModel);
  const startupBehavior = useSettingsStore((s) => s.startupBehavior);
  const setStartupBehavior = useSettingsStore((s) => s.setStartupBehavior);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeSection, setActiveSection] = useState('workflow');

  // Escape key
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, closeSettings]);

  // IntersectionObserver — highlight nav item whose section heading enters the top of the scroll area
  useEffect(() => {
    if (!settingsOpen) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-section');
            if (id) setActiveSection(id);
          }
        }
      },
      {
        root,
        threshold: 0,
        rootMargin: '-10% 0px -80% 0px',
      }
    );
    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const scrollTo = (sectionId: string) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={closeSettings}
    >
      <div
        style={{
          width: 'min(92vw, 1200px)',
          height: 'min(90vh, 820px)',
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>设置</span>
          <button
            onClick={closeSettings}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 4, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-secondary)', borderRadius: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: left nav + right scrolling content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

          {/* Left nav */}
          <nav style={{
            width: 120,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border)',
            padding: '16px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            {CATEGORIES.map((cat) => {
              const active = activeSection === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => scrollTo(cat.id)}
                  style={{
                    textAlign: 'left',
                    padding: '7px 16px',
                    border: 'none',
                    background: active ? 'var(--color-surface-hover, rgba(255,255,255,0.06))' : 'transparent',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    borderRadius: 0,
                    transition: 'background-color 0.15s, color 0.15s',
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </nav>

          {/* Right scrolling content */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

            {/* ── Section: 工作流 ── */}
            <div
              ref={(el) => { sectionRefs.current['workflow'] = el; }}
              data-section="workflow"
            >
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
              }}>
                工作流
              </div>

              {/* Row: 反推模型 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: '1px solid var(--color-border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
                    反推模型
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    用于图像提示词反推的 AI 模型
                  </div>
                </div>
                <SegmentedControl
                  options={REVERSE_PROMPT_MODELS}
                  value={reversePromptModel}
                  onChange={(v) => setReversePromptModel(v as ReversePromptModel)}
                />
              </div>
            </div>

            <div style={{ height: 40 }} />

            {/* ── Section: 会话 ── */}
            <div
              ref={(el) => { sectionRefs.current['session'] = el; }}
              data-section="session"
            >
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
              }}>
                会话
              </div>

              {/* Row: 启动时行为 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: '1px solid var(--color-border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
                    启动时行为
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    打开应用时对上次会话的处理方式
                  </div>
                </div>
                <SegmentedControl
                  options={STARTUP_BEHAVIOR_OPTIONS}
                  value={startupBehavior}
                  onChange={(v) => setStartupBehavior(v as StartupBehavior)}
                />
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
