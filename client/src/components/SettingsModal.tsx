import React, { useEffect, useRef, useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel, type LlmModel, type StartupBehavior, type DropdownMenuStyle } from '../hooks/useSettingsStore.js';
import { SegmentedControl } from './SegmentedControl.js';
import { ensureNotificationPermission } from '../services/desktopNotify.js';

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

const LLM_MODELS: { value: LlmModel; label: string }[] = [
  { value: 'local', label: '本地(Qwen3)' },
  { value: 'grok', label: '在线(Grok4)' },
];

const DROPDOWN_MENU_STYLE_OPTIONS: { value: DropdownMenuStyle; label: string }[] = [
  { value: 'classic', label: '经典' },
  { value: 'fast', label: '快速' },
];

const CATEGORIES = [
  { id: 'workflow', label: '工作流' },
  { id: 'session', label: '会话' },
  { id: 'notification', label: '通知' },
  { id: 'prompt', label: '提示词管理' },
];

const TOGGLE_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' },
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
  const llmModel = useSettingsStore((s) => s.llmModel);
  const setLlmModel = useSettingsStore((s) => s.setLlmModel);
  const dropdownMenuStyle = useSettingsStore((s) => s.dropdownMenuStyle);
  const setDropdownMenuStyle = useSettingsStore((s) => s.setDropdownMenuStyle);
  const desktopNotifyOnComplete = useSettingsStore((s) => s.desktopNotifyOnComplete);
  const setDesktopNotifyOnComplete = useSettingsStore((s) => s.setDesktopNotifyOnComplete);
  const sessionsBase = useSettingsStore((s) => s.sessionsBase);
  const defaultSessionsBase = useSettingsStore((s) => s.defaultSessionsBase);
  const sessionsPathLoaded = useSettingsStore((s) => s.sessionsPathLoaded);
  const loadSessionsPath = useSettingsStore((s) => s.loadSessionsPath);
  const updateSessionsPath = useSettingsStore((s) => s.updateSessionsPath);

  const [sessionsPathSaving, setSessionsPathSaving] = useState(false);

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

  // 打开面板时加载会话路径
  useEffect(() => {
    if (settingsOpen && !sessionsPathLoaded) {
      void loadSessionsPath();
    }
  }, [settingsOpen, sessionsPathLoaded, loadSessionsPath]);

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

  // 切换 sessions 路径后：清掉本地 session 标记，重载到欢迎页并刷新列表
  const applyAndReloadWelcome = () => {
    try {
      localStorage.removeItem('pix2real_session_id');
      sessionStorage.removeItem('pix2real_switch_intent');
    } catch { /* ignore */ }
    window.location.reload();
  };

  const handleBrowseSessionsFolder = async () => {
    if (sessionsPathSaving) return;
    let selected: string;
    try {
      const resp = await fetch('/api/settings/browse-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: sessionsBase ?? '' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        alert(`打开目录选择器失败：${data?.error ?? `HTTP ${resp.status}`}`);
        return;
      }
      if (data?.cancelled || !data?.path) return;
      selected = String(data.path);
    } catch (err) {
      alert(`调用目录选择器失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (sessionsBase && selected === sessionsBase) {
      alert('所选路径与当前路径相同');
      return;
    }
    if (!window.confirm(
      `将 sessions 存储路径切换为:\n${selected}\n\n老路径下的会话文件不会被迁移。\n切换后将立即返回欢迎页并刷新列表，确认继续？`
    )) return;
    setSessionsPathSaving(true);
    const result = await updateSessionsPath(selected);
    setSessionsPathSaving(false);
    if (!result.ok) {
      alert(`保存失败：${result.error}`);
      return;
    }
    applyAndReloadWelcome();
  };

  const handleResetSessionsPath = async () => {
    if (!defaultSessionsBase) return;
    if (sessionsBase === defaultSessionsBase) {
      alert('当前已是默认路径');
      return;
    }
    if (!window.confirm(
      `将 sessions 路径恢复为默认:\n${defaultSessionsBase}\n\n切换后将立即返回欢迎页并刷新列表，确认继续？`
    )) return;
    setSessionsPathSaving(true);
    const result = await updateSessionsPath(null);
    setSessionsPathSaving(false);
    if (!result.ok) {
      alert(`恢复失败：${result.error}`);
      return;
    }
    applyAndReloadWelcome();
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

              {/* Row: LLM 模型 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>LLM 模型</div>
                  <div style={settingDescStyle}>提示词助手使用的语言模型</div>
                </div>
                <SegmentedControl
                  options={LLM_MODELS}
                  value={llmModel}
                  onChange={(v) => setLlmModel(v as LlmModel)}
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

              {/* Row: Session 存储路径 */}
              <div style={{ ...settingRowStyle, alignItems: 'flex-start', borderBottom: 'none' }}>
                <div style={{ marginRight: 24, flex: 1, minWidth: 0 }}>
                  <div style={settingLabelStyle}>Session 存储路径</div>
                  <div style={settingDescStyle}>
                    所有会话数据（输入 / 输出 / 蒙版 / 封面等）的根目录，切换后立即返回欢迎页并刷新列表。<br />
                    {defaultSessionsBase && (
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        默认路径：<code style={{ fontSize: 11 }}>{defaultSessionsBase}</code>
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 280,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        border: '1px solid var(--color-border)',
                        borderRadius: 6,
                        background: 'var(--color-bg)',
                        color: sessionsBase ? 'var(--color-text)' : 'var(--color-text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={sessionsBase ?? ''}
                    >
                      {sessionsPathLoaded
                        ? (sessionsBase ?? '（加载失败）')
                        : '加载中…'}
                    </div>
                    <button
                      onClick={handleBrowseSessionsFolder}
                      disabled={!sessionsPathLoaded || sessionsPathSaving}
                      title="浏览选择目录"
                      style={{
                        ...actionBtnStyle,
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: sessionsPathSaving ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
                    >
                      <FolderOpen size={16} />
                    </button>
                    <button
                      onClick={handleResetSessionsPath}
                      disabled={
                        !sessionsPathLoaded
                        || sessionsPathSaving
                        || sessionsBase === defaultSessionsBase
                      }
                      style={{
                        ...actionBtnStyle,
                        opacity: sessionsBase === defaultSessionsBase ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div style={sectionGapStyle} />

            {/* ── Section: 通知 ── */}
            <div
              ref={(el) => { sectionRefs.current['notification'] = el; }}
              data-section="notification"
            >
              <div style={sectionTitleStyle}>通知</div>

              {/* Row: 任务完成桌面通知 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>任务完成桌面通知</div>
                  <div style={settingDescStyle}>
                    页面切到后台时，在 Windows 右下角弹出系统通知（需浏览器通知权限）
                  </div>
                </div>
                <SegmentedControl
                  options={TOGGLE_OPTIONS}
                  value={desktopNotifyOnComplete ? 'on' : 'off'}
                  onChange={(v) => {
                    const enabled = v === 'on';
                    setDesktopNotifyOnComplete(enabled);
                    if (enabled) {
                      // 开启时主动申请权限
                      ensureNotificationPermission().then((perm) => {
                        if (perm !== 'granted') {
                          alert('浏览器通知权限未授予，桌面通知将不会弹出。请在浏览器地址栏左侧的权限设置中允许通知。');
                        }
                      });
                    }
                  }}
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
