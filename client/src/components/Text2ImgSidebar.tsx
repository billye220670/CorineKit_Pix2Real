import { useState, useEffect, useCallback } from 'react';
import { useWorkflowStore, type Text2ImgConfig } from '../hooks/useWorkflowStore.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ChevronRight, ChevronDown, Loader, BookText } from 'lucide-react';

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

const DRAFT_KEY = 't2i_draft';
function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') ?? {}; } catch { return {}; }
}

export function Text2ImgSidebar() {
  const clientId  = useWorkflowStore((s) => s.clientId);
  const sessionId = useWorkflowStore((s) => s.sessionId);
  const startTask = useWorkflowStore((s) => s.startTask);
  const addText2ImgCard = useWorkflowStore((s) => s.addText2ImgCard);
  const { sendMessage } = useWebSocket();

  // Model list
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    setModelsLoading(true);
    fetch('/api/workflow/models/checkpoints')
      .then((r) => r.json())
      .then((data: string[]) => { setModels(data); })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  // Config state — initialised from localStorage draft so tab switches don't reset values
  const [model,      setModel]      = useState(() => readDraft().model     ?? '');
  const [prompt,     setPrompt]     = useState(() => readDraft().prompt    ?? '');
  const [ratio,      setRatio]      = useState(() => readDraft().ratio     ?? '3:4');
  const [steps,      setSteps]      = useState(() => readDraft().steps     ?? 30);
  const [cfg,        setCfg]        = useState(() => readDraft().cfg       ?? 6);
  const [sampler,    setSampler]    = useState(() => readDraft().sampler   ?? 'euler_ancestral');
  const [scheduler,  setScheduler]  = useState(() => readDraft().scheduler ?? 'normal');
  const [customName, setCustomName] = useState(() => readDraft().customName ?? '');
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [batchCount, setBatchCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);

  // Persist config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ model, prompt, ratio, steps, cfg, sampler, scheduler, customName }));
  }, [model, prompt, ratio, steps, cfg, sampler, scheduler, customName]);

  // Default model once loaded (only if none was saved)
  useEffect(() => {
    if (models.length > 0 && !model) {
      setModel(models[0]);
    }
  }, [models, model]);

  const selectedPreset = RATIO_PRESETS.find((p) => p.label === ratio) ?? RATIO_PRESETS[1];

  const handleGenerate = useCallback(async () => {
    if (!clientId || isGenerating) return;

    const config: Text2ImgConfig = {
      model: model || (models[0] ?? ''),
      prompt,
      width:     selectedPreset.width,
      height:    selectedPreset.height,
      steps,
      cfg,
      sampler,
      scheduler,
    };

    // Build base name: user input or auto timestamp
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const baseName = customName.trim() || `t2i_${ts}`;
    const count = Math.min(32, Math.max(1, batchCount));

    setIsGenerating(true);
    try {
      for (let i = 0; i < count; i++) {
        const itemName = count === 1 ? baseName : `${baseName}_${i + 1}`;
        const imageId = addText2ImgCard(config, itemName);
        startTask(imageId, '');  // Show shimmer immediately before fetch returns
        try {
          const res = await fetch('/api/workflow/7/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...config, name: itemName }),
          });
          if (!res.ok) {
            console.error('[Text2Img] Execute failed:', await res.text());
            continue;
          }
          const data = await res.json() as { promptId: string };
          startTask(imageId, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 7, sessionId, tabId: 7 });
        } catch (err) {
          console.error('[Text2Img] Execute error:', err);
        }
      }
    } finally {
      setIsGenerating(false);
    }
  }, [clientId, isGenerating, model, models, prompt, selectedPreset, steps, cfg, sampler, scheduler, customName, batchCount, addText2ImgCard, startTask, sendMessage, sessionId]);

  // ── Style helpers ────────────────────────────────────────────────────────

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

        {/* Model */}
        <div>
          <div style={label}>模型</div>
          {modelsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <Loader size={12} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
              加载中…
            </div>
          ) : (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            >
              {models.length === 0 && <option value="">（无可用模型）</option>}
              {models.map((m) => (
                <option key={m} value={m}>{m.split('\\').pop()?.replace(/\.[^.]+$/, '') ?? m}</option>
              ))}
            </select>
          )}
        </div>

        {/* Prompt */}
        <div>
          <div style={label}>提示词</div>
          <div style={{ position: 'relative' }}>
            <textarea
              placeholder="输入提示词（可选）"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
              rows={4}
              style={{
                width: '100%',
                padding: '7px 8px',
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
              }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                usePromptAssistantStore.getState().openPanel({
                  initialText: prompt,
                });
              }}
              title="提示词助理"
              style={{
                position: 'absolute',
                bottom: 10,
                right: 6,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: 'var(--color-text-secondary)',
                opacity: promptFocused ? 1 : 0,
                display: 'flex',
                alignItems: 'center',
                transition: 'opacity 0.15s',
                pointerEvents: promptFocused ? 'auto' : 'none',
              }}
            >
              <BookText size={13} />
            </button>
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
            </div>
          )}
        </div>
      </div>

      {/* Generate area: name input + button row */}
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
            disabled={!clientId || isGenerating || models.length === 0}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '14px',
              fontWeight: 600,
              cursor: (!clientId || isGenerating || models.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (!clientId || isGenerating || models.length === 0) ? 0.5 : 1,
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
