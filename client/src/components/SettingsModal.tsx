import React, { useEffect, useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel, type LlmModel, type StartupBehavior, type DropdownMenuStyle, type DiceMixPreset, type DiceRefMode, type DiceRatioMode, type DiceContentPolicy, type TaskExecutionMode } from '../hooks/useSettingsStore.js';
import { useAutoLoopStore } from '../hooks/useAutoLoopStore.js';
import { SegmentedControl } from './SegmentedControl.js';
import { ensureNotificationPermission } from '../services/desktopNotify.js';
import { MyProfileSection } from './MyProfileSection.js';

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

const DICE_MIX_PRESET_OPTIONS: { value: DiceMixPreset; label: string; title: string }[] = [
  { value: 'preference',  label: '更多偏好', title: '70% 画像偏好 / 20% 画像微改 / 10% 探索' },
  { value: 'balanced',    label: '均衡',     title: '50% 画像偏好 / 30% 画像微改 / 20% 探索（默认）' },
  { value: 'exploration', label: '更多推荐', title: '20% 画像偏好 / 30% 画像微改 / 50% 探索' },
];

const DICE_REF_MODE_OPTIONS: { value: DiceRefMode; label: string; title: string }[] = [
  { value: 'auto', label: '使用（如有）', title: '若侧边栏已配置参考图，则每条随机结果都会带上该参考图' },
  { value: 'none', label: '不使用',        title: '骰子随机生成时忽略侧边栏的参考图，总是纯随机' },
];

const DICE_RATIO_MODE_OPTIONS: { value: DiceRatioMode; label: string; title: string }[] = [
  { value: 'manual', label: '手动', title: '所有随机结果都跟随侧边栏当前比例' },
  { value: 'auto',   label: '自动', title: '由 AI 为每条随机结果推荐合适画面比例' },
];

const DICE_CONTENT_POLICY_OPTIONS: { value: DiceContentPolicy; label: string; title: string }[] = [
  { value: 'sfw',   label: 'SFW',   title: '强制安全向：不涉及裸露/性暗示/挑逗，穿着得体适合全年龄展示' },
  { value: 'mixed', label: '混合',  title: '不加额外约束：由 AI 根据主题自由发挥（默认）' },
  { value: 'nsfw',  label: 'NSFW',  title: '倾向成人向：可含暴露服饰/性感姿势/成人情境等艺术表达' },
];

const TASK_EXECUTION_MODE_OPTIONS: { value: TaskExecutionMode; label: string; title: string }[] = [
  { value: 'manual',   label: '手动添加', title: '按右侧张数输入框一次性提交任务（默认）' },
  { value: 'autoLoop', label: '自动循环', title: '持续循环投递，完成一单即自动投递下一单，直到点击停止' },
];

const CATEGORIES = [
  { id: 'workflow', label: '工作流' },
  { id: 'random', label: '随机生成' },
  { id: 'session', label: '会话' },
  { id: 'notification', label: '通知' },
  { id: 'prompt', label: '提示词管理' },
  { id: 'profile', label: '我的偏好' },
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
  const diceMixPreset = useSettingsStore((s) => s.diceMixPreset);
  const setDiceMixPreset = useSettingsStore((s) => s.setDiceMixPreset);
  const diceRefMode = useSettingsStore((s) => s.diceRefMode);
  const setDiceRefMode = useSettingsStore((s) => s.setDiceRefMode);
  const diceRatioMode = useSettingsStore((s) => s.diceRatioMode);
  const setDiceRatioMode = useSettingsStore((s) => s.setDiceRatioMode);
  const diceContentPolicy = useSettingsStore((s) => s.diceContentPolicy);
  const setDiceContentPolicy = useSettingsStore((s) => s.setDiceContentPolicy);
  const taskExecutionMode = useSettingsStore((s) => s.taskExecutionMode);
  const setTaskExecutionMode = useSettingsStore((s) => s.setTaskExecutionMode);
  const sessionsBase = useSettingsStore((s) => s.sessionsBase);
  const defaultSessionsBase = useSettingsStore((s) => s.defaultSessionsBase);
  const sessionsPathLoaded = useSettingsStore((s) => s.sessionsPathLoaded);
  const loadSessionsPath = useSettingsStore((s) => s.loadSessionsPath);
  const updateSessionsPath = useSettingsStore((s) => s.updateSessionsPath);

  const [sessionsPathSaving, setSessionsPathSaving] = useState(false);

  const [activeSection, setActiveSection] = useState('workflow');

  // 切换"自动循环"前的二次确认弹窗
  const [autoLoopConfirmOpen, setAutoLoopConfirmOpen] = useState(false);

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

  if (!settingsOpen) return null;

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
                  onClick={() => setActiveSection(cat.id)}
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
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>

            {/* ── Section: 工作流 ── */}
            {activeSection === 'workflow' && (
            <div>
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

              {/* Row: 任务执行模式 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>任务执行模式</div>
                  <div style={settingDescStyle}>
                    手动：按右侧张数输入框一次性提交；<br />
                    自动循环：生成/随机按钮变为"开始循环"，持续投递任务直到手动停止
                  </div>
                </div>
                <SegmentedControl
                  options={TASK_EXECUTION_MODE_OPTIONS}
                  value={taskExecutionMode}
                  onChange={(v) => {
                    const next = v as TaskExecutionMode;
                    if (next === taskExecutionMode) return;
                    if (next === 'autoLoop') {
                      // 切到自动循环：弹风险确认
                      setAutoLoopConfirmOpen(true);
                    } else {
                      // 切回手动：若当前有循环正在跑，先停止
                      const loopState = useAutoLoopStore.getState();
                      if (loopState.active) loopState.stopLoop();
                      setTaskExecutionMode('manual');
                    }
                  }}
                />
              </div>
            </div>
            )}

            {/* ── Section: 随机生成 ── */}
            {activeSection === 'random' && (
            <div>
              <div style={sectionTitleStyle}>随机生成</div>

              {/* Row: 随机生成偏好 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>随机生成偏好</div>
                  <div style={settingDescStyle}>
                    控制「快速出图」生成按钮旁骰子按钮按数量分配画像偏好 / 画像微改 / 探索三档的比例。
                  </div>
                </div>
                <SegmentedControl
                  options={DICE_MIX_PRESET_OPTIONS}
                  value={diceMixPreset}
                  onChange={(v) => setDiceMixPreset(v as DiceMixPreset)}
                />
              </div>

              {/* Row: 参考图 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>参考图</div>
                  <div style={settingDescStyle}>
                    骰子批量生成时是否复用侧边栏已设置的参考图；若侧边栏未配置参考图，两种模式结果相同。
                  </div>
                </div>
                <SegmentedControl
                  options={DICE_REF_MODE_OPTIONS}
                  value={diceRefMode}
                  onChange={(v) => setDiceRefMode(v as DiceRefMode)}
                />
              </div>

              {/* Row: 比例 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>比例</div>
                  <div style={settingDescStyle}>
                    手动：所有随机结果跟随侧边栏当前比例；自动：由 AI 为每条结果推荐合适的画面比例。
                  </div>
                </div>
                <SegmentedControl
                  options={DICE_RATIO_MODE_OPTIONS}
                  value={diceRatioMode}
                  onChange={(v) => setDiceRatioMode(v as DiceRatioMode)}
                />
              </div>

              {/* Row: 内容限制 */}
              <div style={settingRowStyle}>
                <div style={{ marginRight: 24 }}>
                  <div style={settingLabelStyle}>内容限制</div>
                  <div style={settingDescStyle}>
                    SFW：强制安全向输出；混合：不加约束由 AI 自由发挥；NSFW：倾向成人向艺术表达。<br />
                    该选项会作为骰子模式专属指令下发给 AI，约束生成提示词的侧重方向。
                  </div>
                </div>
                <SegmentedControl
                  options={DICE_CONTENT_POLICY_OPTIONS}
                  value={diceContentPolicy}
                  onChange={(v) => setDiceContentPolicy(v as DiceContentPolicy)}
                />
              </div>
            </div>
            )}

            {/* ── Section: 会话 ── */}
            {activeSection === 'session' && (
            <div>
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
            )}

            {/* ── Section: 通知 ── */}
            {activeSection === 'notification' && (
            <div>
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
            )}

            {/* ── Section: 提示词管理 ── */}
            {activeSection === 'prompt' && (
            <div>
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
            )}

            {/* ── 我的偏好分类 ── */}
            {activeSection === 'profile' && (
              <MyProfileSection />
            )}

          </div>
        </div>
      </div>

      {/* 自动循环风险确认弹窗 */}
      {autoLoopConfirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              width: 'min(90vw, 480px)',
              backgroundColor: 'var(--card-bg, #1a1a1a)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '20px 22px',
              color: 'var(--color-text)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              开启自动循环模式？
            </div>
            <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--color-text-secondary)', marginBottom: 16 }}>
              在此模式下，生成按钮和随机按钮会持续向队列投递任务，直到您手动点击停止。请注意：
              <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
                <li>若使用的是在线模型或依赖 API 计费的资源（如 Grok/外部 LLM），长时间运行会持续产生 API 费用；</li>
                <li>持续满载运行将显著增加 GPU 负载与发热，建议确认散热环境良好；</li>
                <li>仅在您确认需要批量探索时开启，不使用时请切换回"手动添加"。</li>
              </ul>
              点击"开启自动循环"后设置立即生效。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setAutoLoopConfirmOpen(false)}
                style={{
                  ...actionBtnStyle,
                  padding: '7px 18px',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
              >
                取消
              </button>
              <button
                onClick={() => {
                  setTaskExecutionMode('autoLoop');
                  setAutoLoopConfirmOpen(false);
                }}
                style={{
                  ...actionBtnStyle,
                  padding: '7px 18px',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  border: '1px solid var(--color-primary)',
                }}
              >
                开启自动循环
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
