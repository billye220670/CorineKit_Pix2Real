import { useState, useEffect, useCallback } from 'react';
import { useWorkflowStore, type ZitConfig } from '../hooks/useWorkflowStore.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ChevronRight, ChevronDown, Loader, BookText, Hash, AlignLeft, Wand2, Loader2 } from 'lucide-react';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { ModelSelect, useModelFavorites } from './ModelSelect.js';

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
function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') ?? {}; } catch { return {}; }
}

export function ZITSidebar() {
  const clientId    = useWorkflowStore((s) => s.clientId);
  const sessionId   = useWorkflowStore((s) => s.sessionId);
  const startTask   = useWorkflowStore((s) => s.startTask);
  const addZitCard  = useWorkflowStore((s) => s.addZitCard);
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
  const [loraModel,   setLoraModel]   = useState(() => readDraft().loraModel   ?? '');
  const [loraEnabled,   setLoraEnabled]   = useState(() => readDraft().loraEnabled   ?? false);
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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      unetModel, loraModel, loraEnabled, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName,
    }));
  }, [unetModel, loraModel, loraEnabled, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName]);

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
      if (!loraModel || !loraModels.includes(loraModel)) {
        setLoraModel(loraModels[0]);
      }
    }
  }, [loraModels, loraModel]);

  const selectedPreset = RATIO_PRESETS.find((p) => p.label === ratio) ?? RATIO_PRESETS[1];

  const handleGenerate = useCallback(async () => {
    if (!clientId || isGenerating) return;

    const config: ZitConfig = {
      unetModel: unetModel || (unetModels[0] ?? ''),
      loraModel: loraModel || (loraModels[0] ?? ''),
      loraEnabled,
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
  }, [clientId, isGenerating, unetModel, unetModels, loraModel, loraModels, loraEnabled, shiftEnabled, shift, prompt, selectedPreset, steps, cfg, sampler, scheduler, customName, batchCount, addZitCard, startTask, sendMessage, sessionId]);

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
    border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    borderRadius: 6,
    backgroundColor: active ? 'rgba(33,150,243,0.12)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  });

  const label: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    letterSpacing: '0.04em',
    marginBottom: 6,
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
      width: 260,
      flexShrink: 0,
      borderLeft: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* UNet Model */}
        <div>
          <div style={label}>UNet 模型</div>
          <ModelSelect
            models={unetModels}
            value={unetModel}
            onChange={setUnetModel}
            favorites={unetFavorites}
            onToggleFavorite={toggleUnetFavorite}
            loading={unetLoading}
            placeholder="（无可用模型）"
          />
        </div>

        {/* LoRA collapsible section */}
        <div>
          <button
            onClick={() => setLoraEnabled((v: boolean) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              marginBottom: loraEnabled ? 10 : 0,
            }}
          >
            {loraEnabled ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <input
              type="checkbox"
              checked={loraEnabled}
              onChange={() => {}}
              onClick={(e) => e.stopPropagation()}
              style={{ margin: '0 2px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
            />
            启用 LoRA
          </button>

          {loraEnabled && (
            <div>
              <ModelSelect
                models={loraModels}
                value={loraModel}
                onChange={setLoraModel}
                favorites={loraFavorites}
                onToggleFavorite={toggleLoraFavorite}
                loading={loraListLoading}
                placeholder="（无可用 LoRA）"
              />
            </div>
          )}
        </div>

        {/* Prompt */}
        <div>
          <div style={label}>提示词</div>
          <div
            style={{ position: 'relative' }}
            className={quickActionLoading ? 'textarea-ai-active' : undefined}
          >
            <textarea
              placeholder="输入提示词（可选）"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
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

        {/* Aspect ratio */}
        <div>
          <div style={label}>比例</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {RATIO_PRESETS.map((p) => (
              <button key={p.label} style={pillBtn(ratio === p.label)} onClick={() => setRatio(p.label)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible sampler settings */}
        <div>
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
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
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
    </div>
  );
}
