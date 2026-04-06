import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkflowStore, type ZitConfig } from '../hooks/useWorkflowStore.js';
import { type LoraSlot } from '../services/sessionService.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ChevronRight, ChevronDown, Loader, BookText, Hash, AlignLeft, Wand2, Loader2, AlertTriangle } from 'lucide-react';
import PromptContextMenu from './PromptContextMenu';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { ModelSelect, useModelFavorites } from './ModelSelect.js';
import { useModelMetadata } from '../hooks/useModelMetadata.js';

const RATIO_PRESETS = [
  { label: '1:1',  width: 1024, height: 1024 },
  { label: '3:4',  width: 832,  height: 1216 },
  { label: '9:16', width: 768,  height: 1344 },
  { label: '4:3',  width: 1216, height: 832  },
  { label: '16:9', width: 1344, height: 768  },
];

const SAMPLERS = [
  { label: 'euler',   value: 'euler' },
  { label: 'euler_a', value: 'euler_ancestral' },
  { label: 'res_ms',  value: 'res_multistep_ancestral' },
  { label: 'dpm2m',   value: 'dpm_2m' },
];

const SCHEDULERS = [
  { label: 'simple', value: 'simple' },
  { label: '指数',    value: 'exponential' },
  { label: 'ddim',   value: 'ddim_uniform' },
  { label: 'beta',   value: 'beta' },
  { label: 'normal', value: 'normal' },
];

const DRAFT_KEY = 'zit_draft';
const DEFAULT_LORAS: LoraSlot[] = [
  { model: '', enabled: false, strength: 1 },
  { model: '', enabled: false, strength: 1 },
  { model: '', enabled: false, strength: 1 },
];
function readDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') ?? {};
    // Backward compat: migrate old loraModel/loraEnabled to loras array
    if (!raw.loras && (raw.loraModel || raw.loraEnabled !== undefined)) {
      raw.loras = [
        { model: raw.loraModel ?? '', enabled: raw.loraEnabled ?? false, strength: 1 },
        { model: '', enabled: false, strength: 1 },
        { model: '', enabled: false, strength: 1 },
      ];
      delete raw.loraModel;
      delete raw.loraEnabled;
    }
    return raw;
  } catch { return {}; }
}

export function ZITSidebar({ width }: { width?: number }) {
  const clientId    = useWorkflowStore((s) => s.clientId);
  const sessionId   = useWorkflowStore((s) => s.sessionId);
  const startTask   = useWorkflowStore((s) => s.startTask);
  const addZitCard  = useWorkflowStore((s) => s.addZitCard);
  const setFlashingImage = useWorkflowStore((s) => s.setFlashingImage);
  const { sendMessage } = useWebSocket();

  // UNet model list
  const [unetModels, setUnetModels]         = useState<string[]>([]);
  const [unetLoading, setUnetLoading]       = useState(false);

  useEffect(() => {
    setUnetLoading(true);
    fetch('/api/workflow/models/unets')
      .then((r) => r.json())
      .then((data: string[]) => setUnetModels(data))
      .catch(() => {})
      .finally(() => setUnetLoading(false));
  }, []);

  // LoRA model list
  const [loraModels, setLoraModels]         = useState<string[]>([]);
  const [loraListLoading, setLoraListLoading] = useState(false);

  // Model favorites
  const { favorites: unetFavorites, toggleFavorite: toggleUnetFavorite } = useModelFavorites('unets');
  const { favorites: loraFavorites, toggleFavorite: toggleLoraFavorite } = useModelFavorites('loras');
  const { metadata, uploadThumbnail, setNickname, setTriggerWords, getThumbnailUrl, getTriggerWords, getNickname, setCategory, deleteCategory } = useModelMetadata();

  useEffect(() => {
    setLoraListLoading(true);
    fetch('/api/workflow/models/loras')
      .then((r) => r.json())
      .then((data: string[]) => setLoraModels(data))
      .catch(() => {})
      .finally(() => setLoraListLoading(false));
  }, []);

  // Config state — initialised from localStorage draft
  const [unetModel,   setUnetModel]   = useState(() => readDraft().unetModel   ?? '');
  const [loras, setLoras] = useState<LoraSlot[]>(() => readDraft().loras ?? DEFAULT_LORAS);
  const updateLora = (index: number, patch: Partial<LoraSlot>) => {
    setLoras(prev => prev.map((l, i) => i === index ? { ...l, ...patch } : l));
  };
  const [shiftEnabled,  setShiftEnabled]  = useState(() => readDraft().shiftEnabled  ?? false);
  const [shift,         setShift]         = useState(() => readDraft().shift         ?? 3);
  const [prompt,        setPrompt]        = useState(() => readDraft().prompt        ?? '');
  const [ratio,       setRatio]       = useState(() => readDraft().ratio       ?? '3:4');
  const [steps,       setSteps]       = useState(() => readDraft().steps       ?? 9);
  const [cfg,         setCfg]         = useState(() => readDraft().cfg         ?? 1);
  const [sampler,     setSampler]     = useState(() => readDraft().sampler     ?? 'euler');
  const [scheduler,   setScheduler]   = useState(() => readDraft().scheduler   ?? 'simple');
  const [customName,  setCustomName]  = useState(() => readDraft().customName  ?? '');
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [batchCount,  setBatchCount]  = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);
  const [promptBtnHovered, setPromptBtnHovered] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const cursorPosRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      unetModel, loras, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName,
    }));
  }, [unetModel, loras, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName]);

  // Default model once loaded (or fallback if saved model not in list)
  useEffect(() => {
    if (unetModels.length > 0) {
      if (!unetModel || !unetModels.includes(unetModel)) {
        setUnetModel(unetModels[0]);
      }
    }
  }, [unetModels, unetModel]);

  useEffect(() => {
    if (loraModels.length > 0) {
      setLoras(prev => prev.map(l =>
        (!l.model || !loraModels.includes(l.model)) ? { ...l, model: loraModels[0] } : l
      ));
    }
  }, [loraModels]);

  const selectedPreset = RATIO_PRESETS.find((p) => p.label === ratio) ?? RATIO_PRESETS[1];

  const handleGenerate = useCallback(async () => {
    if (!clientId || isGenerating) return;

    const config: ZitConfig = {
      unetModel: unetModel || (unetModels[0] ?? ''),
      loras,
      shiftEnabled,
      shift,
      prompt,
      width:     selectedPreset.width,
      height:    selectedPreset.height,
      steps,
      cfg,
      sampler,
      scheduler,
    };

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const baseName = customName.trim() || `zit_${ts}`;
    const count = Math.min(32, Math.max(1, batchCount));

    setIsGenerating(true);
    try {
      for (let i = 0; i < count; i++) {
        const itemName = count === 1 ? baseName : `${baseName}_${i + 1}`;
        const imageId = addZitCard(config, itemName);
        setFlashingImage(imageId);
        startTask(imageId, '');
        try {
          const res = await fetch('/api/workflow/9/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...config, name: itemName }),
          });
          if (!res.ok) {
            console.error('[ZIT] Execute failed:', await res.text());
            continue;
          }
          const data = await res.json() as { promptId: string };
          startTask(imageId, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 9, sessionId, tabId: 9 });
        } catch (err) {
          console.error('[ZIT] Execute error:', err);
        }
      }
    } finally {
      setIsGenerating(false);
    }
  }, [clientId, isGenerating, unetModel, unetModels, loras, loraModels, shiftEnabled, shift, prompt, selectedPreset, steps, cfg, sampler, scheduler, customName, batchCount, addZitCard, startTask, sendMessage, sessionId]);

  const handleQuickAction = useCallback(async (mode: 'naturalToTags' | 'tagsToNatural' | 'detailer') => {
    if (!prompt.trim()) return;
    setQuickActionLoading(mode);
    try {
      const sysPrompt =
        mode === 'naturalToTags' ? SYSTEM_PROMPTS.naturalToTags :
        mode === 'tagsToNatural' ? SYSTEM_PROMPTS.tagsToNatural :
        SYSTEM_PROMPTS.detailer;
      const res = await fetch('/api/workflow/prompt-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: sysPrompt, userPrompt: prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { text: result } = await res.json();
      setPrompt(result);
    } catch {
      // silent fail
    } finally {
      setQuickActionLoading(null);
    }
  }, [prompt]);

  // ── Style helpers ─────────────────────────────────────────────────────────

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 8px',
    fontSize: '12px',
    border: 'none',
    borderRadius: 6,
    backgroundColor: active ? 'rgba(33,150,243,0.12)' : 'var(--color-surface-hover)',
    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  });

  const cardStyle: React.CSSProperties = {
    padding: '0',
  };

  const dividerStyle: React.CSSProperties = {
    height: 1,
    backgroundColor: 'var(--color-border)',
    margin: '0',
    opacity: 0.5,
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: 8,
    letterSpacing: '0.02em',
  };

  const sliderRow = (name: string, value: number, min: number, max: number, step: number, setter: (v: number) => void) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{name}</span>
        <span style={{ fontSize: '12px', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setter(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
      />
    </div>
  );

  return (
    <div style={{
      width: width ?? 260,
      flexShrink: 0,
      borderLeft: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* UNet Model */}
        <div style={{ ...cardStyle, paddingTop: 0, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>UNet 模型</div>
          <ModelSelect
            models={unetModels}
            value={unetModel}
            onChange={setUnetModel}
            favorites={unetFavorites}
            onToggleFavorite={toggleUnetFavorite}
            loading={unetLoading}
            placeholder="（无可用模型）"
            metadata={metadata}
            onUploadThumbnail={uploadThumbnail}
            onSetNickname={setNickname}
            onSetCategory={setCategory}
            onDeleteCategory={deleteCategory}
            getThumbnailUrl={getThumbnailUrl}
          />
        </div>

        <div style={dividerStyle} />

        {/* LoRA collapsible sections */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>LoRA</div>
        {loras.map((lora, i) => (
          <div key={i} style={{ marginBottom: i < loras.length - 1 ? 12 : 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: lora.enabled ? 10 : 0,
              }}
            >
              {/* Toggle Switch */}
              <div
                onClick={() => updateLora(i, { enabled: !lora.enabled })}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: lora.enabled ? 'var(--color-primary, #4a9eff)' : 'rgba(128,128,128,0.3)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    position: 'absolute',
                    top: 2,
                    left: lora.enabled ? 18 : 2,
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  letterSpacing: '0.04em',
                  cursor: 'default',
                  userSelect: 'none',
                }}
              >
                启用 LoRA {i + 1}
              </span>
              {lora.enabled && lora.model && (() => {
                const tw = getTriggerWords(lora.model);
                if (!tw) return null;
                const words = tw.split(',').map(s => s.trim()).filter(Boolean);
                if (words.length === 0) return null;
                const promptLower = prompt.toLowerCase();
                const anyUsed = words.some(w => promptLower.includes(w.toLowerCase()));
                if (anyUsed) return null;
                return (
                  <span title="未使用触发词，请在提示词区域右键加入" style={{ display: 'inline-flex', marginLeft: 4 }}>
                    <AlertTriangle size={12} color="#e6a817" />
                  </span>
                );
              })()}
            </div>

            {lora.enabled && (
              <div>
                <ModelSelect
                  models={loraModels}
                  value={lora.model}
                  onChange={(v) => updateLora(i, { model: v })}
                  favorites={loraFavorites}
                  onToggleFavorite={toggleLoraFavorite}
                  loading={loraListLoading}
                  placeholder="（无可用 LoRA）"
                  metadata={metadata}
                  onUploadThumbnail={uploadThumbnail}
                  onSetNickname={setNickname}
                  onSetTriggerWords={setTriggerWords}
                  onSetCategory={setCategory}
                  onDeleteCategory={deleteCategory}
                  getThumbnailUrl={getThumbnailUrl}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>权重</span>
                  <input
                    type="range"
                    min={0} max={2} step={0.05}
                    value={lora.strength}
                    onChange={(e) => updateLora(i, { strength: parseFloat(e.target.value) })}
                    style={{ flex: 1, accentColor: 'var(--color-primary)' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 28, textAlign: 'right' }}>
                    {lora.strength.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
        </div>

        <div style={dividerStyle} />

        {/* Prompt */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>提示词</div>
          <div
            style={{ position: 'relative' }}
            className={quickActionLoading ? 'textarea-ai-active' : undefined}
          >
            <textarea
              ref={textareaRef}
              placeholder="输入提示词（可选）"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
              onContextMenu={(e) => {
                e.preventDefault();
                cursorPosRef.current = e.currentTarget.selectionStart;
                setContextMenu({ x: e.clientX, y: e.clientY });
              }}
              readOnly={quickActionLoading !== null}
              rows={4}
              style={{
                width: '100%',
                padding: '7px 36px 7px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: 80,
                boxSizing: 'border-box',
                opacity: quickActionLoading !== null ? 0.45 : 1,
                transition: 'opacity 0.2s',
              }}
            />
            {/* Prompt assistant button group */}
            <div
              onMouseEnter={() => setPromptBtnHovered(true)}
              onMouseLeave={() => setPromptBtnHovered(false)}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 6,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                opacity: promptFocused || promptBtnHovered ? 1 : 0,
                pointerEvents: promptFocused || promptBtnHovered ? 'auto' : 'none',
                background: promptBtnHovered ? 'var(--color-surface)' : 'transparent',
                border: `1px solid ${promptBtnHovered ? 'var(--color-border)' : 'transparent'}`,
                borderRadius: 6,
                padding: '2px 4px',
                transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
              }}
            >
              {/* Quick action buttons — slide in on hover */}
              <div style={{
                display: 'flex',
                gap: 4,
                overflow: 'hidden',
                maxWidth: promptBtnHovered ? 72 : 0,
                marginRight: promptBtnHovered ? 4 : 0,
                opacity: promptBtnHovered ? 1 : 0,
                transition: 'max-width 0.2s ease, margin-right 0.2s ease, opacity 0.15s',
              }}>
                {/* 按需扩写 */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickAction('detailer')}
                  disabled={quickActionLoading !== null}
                  title="按需扩写（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: quickActionLoading === 'detailer' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: quickActionLoading && quickActionLoading !== 'detailer' ? 0.35 : 1,
                  }}
                >
                  {quickActionLoading === 'detailer'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <Wand2 size={13} />}
                </button>
                {/* tag → 自然语言 */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickAction('tagsToNatural')}
                  disabled={quickActionLoading !== null}
                  title="标签 → 自然语言（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: quickActionLoading === 'tagsToNatural' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: quickActionLoading && quickActionLoading !== 'tagsToNatural' ? 0.35 : 1,
                  }}
                >
                  {quickActionLoading === 'tagsToNatural'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <AlignLeft size={13} />}
                </button>
                {/* 自然语言 → tag */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickAction('naturalToTags')}
                  disabled={quickActionLoading !== null}
                  title="自然语言 → 标签（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: quickActionLoading === 'naturalToTags' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: quickActionLoading && quickActionLoading !== 'naturalToTags' ? 0.35 : 1,
                  }}
                >
                  {quickActionLoading === 'naturalToTags'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <Hash size={13} />}
                </button>
              </div>
              {/* Panel entry button */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  usePromptAssistantStore.getState().openPanel({ initialText: prompt });
                }}
                title="提示词助理"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <BookText size={13} />
              </button>
            </div>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Aspect ratio */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>比例</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {RATIO_PRESETS.map((p) => (
              <button key={p.label} style={pillBtn(ratio === p.label)} onClick={() => setRatio(p.label)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Collapsible sampler settings */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 0 }}>
          <button
            onClick={() => setSamplerOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.02em',
              marginBottom: samplerOpen ? 10 : 0,
            }}
          >
            {samplerOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            采样设置
          </button>

          {samplerOpen && (
            <div>
              {sliderRow('步数', steps, 4, 50, 1, setSteps)}
              {sliderRow('CFG', cfg, 1, 12, 0.5, setCfg)}

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 4 }}>采样器</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {SAMPLERS.map((s) => (
                    <button key={s.value} style={pillBtn(sampler === s.value)} onClick={() => setSampler(s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 4 }}>调度器</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {SCHEDULERS.map((s) => (
                    <button key={s.value} style={pillBtn(scheduler === s.value)} onClick={() => setScheduler(s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shift (AuraFlow) sub-section */}
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => setShiftEnabled((v: boolean) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    fontSize: '12px',
                    marginBottom: shiftEnabled ? 8 : 0,
                  }}
                >
                  {shiftEnabled ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <input
                    type="checkbox"
                    checked={shiftEnabled}
                    onChange={() => {}}
                    onClick={(e) => e.stopPropagation()}
                    style={{ margin: '0 2px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                  />
                  采样算法偏移
                </button>
                {shiftEnabled && sliderRow('偏移量', shift, 1, 5, 1, setShift)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: name + generate + batch */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          placeholder="图片名（留空自动命名）"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            fontSize: '12px',
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleGenerate}
            disabled={!clientId || isGenerating || unetModels.length === 0}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '14px',
              fontWeight: 600,
              cursor: (!clientId || isGenerating || unetModels.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (!clientId || isGenerating || unetModels.length === 0) ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'opacity 0.15s',
            }}
          >
            {isGenerating && <Loader size={14} style={{ animation: 'pulse 1s ease-in-out infinite' }} />}
            生成
          </button>
          <input
            type="number"
            className="no-spin"
            min={1}
            max={32}
            step={1}
            value={batchCount}
            onChange={(e) => setBatchCount(Math.min(32, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            style={{
              width: 52,
              padding: '0 6px',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: '14px',
              fontWeight: 600,
              textAlign: 'center',
              outline: 'none',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      {contextMenu && (
        <PromptContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          loras={loras}
          getNickname={(model) => getNickname(model)}
          getTriggerWords={(model) => getTriggerWords(model)}
          onInsert={(text) => {
            const pos = cursorPosRef.current;
            const before = prompt.slice(0, pos);
            const after = prompt.slice(pos);
            const needComma = before.length > 0 && !before.trimEnd().endsWith(',') && before.trim().length > 0;
            const inserted = (needComma ? ', ' : '') + text;
            const newPrompt = before + inserted + after;
            setPrompt(newPrompt);
            const newPos = pos + inserted.length;
            cursorPosRef.current = newPos;
            setTimeout(() => {
              if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.selectionStart = newPos;
                textareaRef.current.selectionEnd = newPos;
              }
            }, 0);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
