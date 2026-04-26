import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel, type StartupBehavior, type DropdownMenuStyle } from '../hooks/useSettingsStore.js';
import { SegmentedControl } from './SegmentedControl.js';

const REVERSE_PROMPT_MODELS: { value: ReversePromptModel; label: string }[] = [
  { value: 'Qwen3VL', label: 'Qwen3VL' },
  { value: 'Florence', label: 'Florence' },
  { value: 'WD-14', label: 'WD-14' },
  { value: 'Grok', label: 'Grok' },
];

const STARTUP_BEHAVIOR_OPTIONS: { value: StartupBehavior; label: string }[] = [
  { value: 'restore', label: '恢复上次' },
  { value: 'new', label: '开新会话' },
  { value: 'welcome', label: '欢迎页' },
];

const DROPDOWN_MENU_STYLE_OPTIONS: { value: DropdownMenuStyle; label: string }[] = [
  { value: 'classic', label: '经典' },
  { value: 'fast', label: '快速' },
];

const CATEGORIES = [
  { id: 'workflow', label: '工作流' },
  { id: 'session', label: '会话' },
  { id: 'prompt', label: '提示词管理' },
];

// ── 统一样式常量 ─────────────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 18,
};

const sectionGapStyle: React.CSSProperties = { height: 36 };

const settingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '15px 0',
  borderBottom: '1px solid var(--color-border)',
};

const settingLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-text)',
  marginBottom: 4,
};

const settingDescStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  lineHeight: '17px',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

export function SettingsModal() {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const reversePromptModel = useSettingsStore((s) => s.reversePromptModel);
  const setReversePromptModel = useSettingsStore((s) => s.setReversePromptModel);
  const startupBehavior = useSettingsStore((s) => s.startupBehavior);
  const setStartupBehavior = useSettingsStore((s) => s.setStartupBehavior);
  const dropdownMenuStyle = useSettingsStore((s) => s.dropdownMenuStyle);
  const setDropdownMenuStyle = useSettingsStore((s) => s.setDropdownMenuStyle);

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
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>

            {/* ── Section: 工作流 ── */}
            <div
              ref={(el) => { sectionRefs.current['workflow'] = el; }}
              data-section="workflow"
            >
              <div style={sectionTitleStyle}>工作流</div>

              {/* Row: 反推模型 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>反推模型</div>
                  <div style={settingDescStyle}>用于图像提示词反推的 AI 模型</div>
                </div>
                <SegmentedControl
                  options={REVERSE_PROMPT_MODELS}
                  value={reversePromptModel}
                  onChange={(v) => setReversePromptModel(v as ReversePromptModel)}
                />
              </div>

              {/* Row: 下拉菜单样式 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>下拉菜单样式</div>
                  <div style={settingDescStyle}>快速模式仅显示有缩略图的模型，以宫格方式排列</div>
                </div>
                <SegmentedControl
                  options={DROPDOWN_MENU_STYLE_OPTIONS}
                  value={dropdownMenuStyle}
                  onChange={(v) => setDropdownMenuStyle(v as DropdownMenuStyle)}
                />
              </div>
            </div>

            <div style={sectionGapStyle} />

            {/* ── Section: 会话 ── */}
            <div
              ref={(el) => { sectionRefs.current['session'] = el; }}
              data-section="session"
            >
              <div style={sectionTitleStyle}>会话</div>

              {/* Row: 启动时行为 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>启动时行为</div>
                  <div style={settingDescStyle}>打开应用时对上次会话的处理方式</div>
                </div>
                <SegmentedControl
                  options={STARTUP_BEHAVIOR_OPTIONS}
                  value={startupBehavior}
                  onChange={(v) => setStartupBehavior(v as StartupBehavior)}
                />
              </div>
            </div>

            <div style={sectionGapStyle} />

            {/* ── Section: 提示词管理 ── */}
            <div
              ref={(el) => { sectionRefs.current['prompt'] = el; }}
              data-section="prompt"
            >
              <div style={sectionTitleStyle}>提示词管理</div>

              {/* Row: 提示词数据库 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>提示词数据库</div>
                  <div style={settingDescStyle}>管理标签合成器使用的标签分类数据</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* 导出按钮 */}
                  <button
                    onClick={() => {
                      let data: string;
                      const stored = localStorage.getItem('tagData');
                      if (stored) {
                        data = stored;
                      } else {
                        import('../data/tagData.json').then((mod) => {
                          const blob = new Blob([JSON.stringify(mod.default, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'tagData.json';
                          a.click();
                          URL.revokeObjectURL(url);
                        });
                        return;
                      }
                      const blob = new Blob([JSON.stringify(JSON.parse(data), null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'tagData.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={actionBtnStyle}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
                  >
                    导出
                  </button>

                  {/* 导入按钮 */}
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.json';
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          try {
                            const text = ev.target?.result as string;
                            const parsed = JSON.parse(text);
                            if (!parsed.categories || !Array.isArray(parsed.categories)) {
                              alert('无效的标签数据格式：缺少 categories 数组');
                              return;
                            }
                            localStorage.setItem('tagData', JSON.stringify(parsed));
                            alert('标签数据导入成功！');
                          } catch (err) {
                            alert('导入失败：JSON 格式无效');
                          }
                        };
                        reader.readAsText(file);
                      };
                      input.click();
                    }}
                    style={actionBtnStyle}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
                  >
                    导入
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
