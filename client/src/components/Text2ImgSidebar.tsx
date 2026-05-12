import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useWorkflowStore, type Text2ImgConfig } from '../hooks/useWorkflowStore.js';
import { type LoraSlot } from '../services/sessionService.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ChevronRight, ChevronDown, ChevronUp, Loader, BookText, Hash, AlignLeft, Wand2, Loader2, AlertTriangle, Plus, Trash2, Upload, RefreshCw, X, Sparkles, Dices, Square, Snowflake, Thermometer, Flame } from 'lucide-react';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { ModelSelect, useModelFavorites } from './ModelSelect.js';
import { useModelMetadata } from '../hooks/useModelMetadata.js';
import PromptContextMenu from './PromptContextMenu.js';
import { showToast } from '../hooks/useToast.js';
import { callPromptAssistant, callSmartLora, callSmartTriggerInsert } from '../services/api.js';
import { useSettingsStore, type DiceMixPreset } from '../hooks/useSettingsStore.js';
import { useAutoLoopStore, waitPromptComplete } from '../hooks/useAutoLoopStore.js';

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
  { label: 'dpmpp_2m', value: 'dpmpp_2m' }
];

const SCHEDULERS = [
  { label: 'simple', value: 'simple' },
  { label: '指数',    value: 'exponential' },
  { label: 'ddim',   value: 'ddim_uniform' },
  { label: 'beta',   value: 'beta' },
  { label: 'normal', value: 'normal' },
];

const SAMPLER_VALUES = SAMPLERS.map(s => s.value);
const SCHEDULER_VALUES = SCHEDULERS.map(s => s.value);

// ── 随机骰子按钮的档位 → 比例映射 ────────────────────────────────────────
const DICE_MIX_RATIOS: Record<DiceMixPreset, [number, number, number]> = {
  preference:  [0.7, 0.2, 0.1],
  balanced:    [0.5, 0.3, 0.2],
  exploration: [0.2, 0.3, 0.5],
};

const DICE_MIX_LABEL: Record<DiceMixPreset, string> = {
  preference:  '更多偏好',
  balanced:    '均衡',
  exploration: '更多推荐',
};

// 意向面板专用简短叫法（与设置面板长文案 DICE_MIX_LABEL 数据驱动同一字段）
const DICE_MIX_SHORT_LABEL: Record<DiceMixPreset, string> = {
  preference:  '偏好向',
  balanced:    '均衡向',
  exploration: '探索向',
};

const DICE_MIX_PRESET_TITLE: Record<DiceMixPreset, string> = {
  preference:  '70% 画像偏好 / 20% 画像微改 / 10% 探索',
  balanced:    '50% 画像偏好 / 30% 画像微改 / 20% 探索（默认）',
  exploration: '20% 画像偏好 / 30% 画像微改 / 50% 探索',
};

/**
 * 根据档位与总数计算三档数量。
 * - N == 1：按权重加权随机单抽
 * - N == 2：按比例向下取整 + 余数给权重最高档
 * - N == 3：强制三档各 1
 * - N >= 4：四舍五入，若 exploration 档 exploreCount 被舍入成 0，借 1 张
 */
function computeMix(n: number, preset: DiceMixPreset): { preferenceCount: number; tweakCount: number; exploreCount: number } {
  const [pr, tr, er] = DICE_MIX_RATIOS[preset];
  if (n <= 0) return { preferenceCount: 0, tweakCount: 0, exploreCount: 0 };

  if (n === 1) {
    const r = Math.random();
    if (r < pr) return { preferenceCount: 1, tweakCount: 0, exploreCount: 0 };
    if (r < pr + tr) return { preferenceCount: 0, tweakCount: 1, exploreCount: 0 };
    return { preferenceCount: 0, tweakCount: 0, exploreCount: 1 };
  }

  if (n === 2) {
    // 按权重挑出前 2 档各 1 张
    const arr = [
      { key: 'p' as const, w: pr },
      { key: 't' as const, w: tr },
      { key: 'e' as const, w: er },
    ].sort((a, b) => b.w - a.w);
    const counts = { p: 0, t: 0, e: 0 };
    counts[arr[0].key] += 1;
    counts[arr[1].key] += 1;
    return { preferenceCount: counts.p, tweakCount: counts.t, exploreCount: counts.e };
  }

  if (n === 3) {
    return { preferenceCount: 1, tweakCount: 1, exploreCount: 1 };
  }

  let pc = Math.round(n * pr);
  let tc = Math.round(n * tr);
  let ec = n - pc - tc;
  if (ec < 0) {
    // 舍入使 ec 变负：从最大档借回
    if (pc >= tc) pc += ec; else tc += ec;
    ec = 0;
  }
  if (ec === 0 && preset === 'exploration' && pc > 0) {
    pc -= 1;
    ec = 1;
  }
  return { preferenceCount: pc, tweakCount: tc, exploreCount: ec };
}

const DRAFT_KEY = 't2i_draft';
const DEFAULT_LORAS: LoraSlot[] = [];
function readDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') ?? {};
    // Backward compat: migrate old loraModel/loraEnabled to loras array
    if (!raw.loras && (raw.loraModel || raw.loraEnabled !== undefined)) {
      raw.loras = [
        { model: raw.loraModel ?? '', enabled: raw.loraEnabled ?? false, strength: 0 }
      ];
      delete raw.loraModel;
      delete raw.loraEnabled;
    }
    // Validate persisted sampler/scheduler against current option lists
    if (raw.sampler && !SAMPLER_VALUES.includes(raw.sampler)) {
      delete raw.sampler;
    }
    if (raw.scheduler && !SCHEDULER_VALUES.includes(raw.scheduler)) {
      delete raw.scheduler;
    }
    return raw;
  } catch { return {}; }
}

/**
 * 生成一个 48 位的唯一随机种子（KSampler.seed）。
 * 使用 crypto.getRandomValues 而非 Math.random，避免批量场景下连续调用产生相似/重复值，
 * 从而导致"prompt 不同但生成结果视觉上一模一样"。
 */
function genUniqueSeed(): number {
  const buf = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0x100000000);
    buf[1] = Math.floor(Math.random() * 0x100000000);
  }
  // 拼出 48 位整数（2^48 ≈ 2.8e14，远小于 Comfy KSampler 上限 2^53）
  const high = buf[0] & 0xFFFF;
  const low  = buf[1];
  return high * 0x100000000 + low;
}

export function Text2ImgSidebar({ width }: { width?: number }) {
  const clientId  = useWorkflowStore((s) => s.clientId);
  const sessionId = useWorkflowStore((s) => s.sessionId);
  const startTask = useWorkflowStore((s) => s.startTask);
  const addText2ImgCard = useWorkflowStore((s) => s.addText2ImgCard);
  const setFlashingImage = useWorkflowStore((s) => s.setFlashingImage);
  const { sendMessage } = useWebSocket();

  // Model list
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Model favorites
  const { favorites: checkpointFavorites, toggleFavorite: toggleCheckpointFavorite } = useModelFavorites('checkpoints');
  const { favorites: loraFavorites, toggleFavorite: toggleLoraFavorite } = useModelFavorites('loras');
  const { metadata, uploadThumbnail, setNickname, setTriggerWords, getThumbnailUrl, getTriggerWords, getNickname, setCategory, deleteCategory, updateMetadataFields, getRecommendedStrength } = useModelMetadata();
  // LoRA model list
  const [loraModels, setLoraModels] = useState<string[]>([]);
  const [loraListLoading, setLoraListLoading] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setLoraListLoading(true);
    fetch('/api/workflow/models/loras')
      .then((r) => r.json())
      .then((data: string[]) => setLoraModels(data))
      .catch(() => {})
      .finally(() => setLoraListLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    setModelsLoading(true);
    fetch('/api/workflow/models/checkpoints')
      .then((r) => r.json())
      .then((data: string[]) => { setModels(data); })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, [clientId]);

  // Config state — initialised from localStorage draft so tab switches don't reset values
  const [model,      setModel]      = useState(() => readDraft().model     ?? '');
  const [loras, setLoras] = useState<LoraSlot[]>(() => readDraft().loras ?? DEFAULT_LORAS);
  const updateLora = (index: number, patch: Partial<LoraSlot>) => {
    setLoras(prev => prev.map((l, i) => {
      if (i !== index) return l;
      const next = { ...l, ...patch };
      // 用户手动切换 LoRA 模型时，自动应用推荐默认权重（元数据中维护），无则回退为 0.5
      if (patch.model !== undefined && patch.model !== l.model && patch.strength === undefined) {
        next.strength = patch.model ? (getRecommendedStrength(patch.model) ?? 0.5) : 0.5;
      }
      return next;
    }));
  };
  const addLora = () => {
    if (loras.length < 7) {
      setLoras(prev => [...prev, { model: '', enabled: true, strength: 0.5 }]);
    }
  };
  const removeLora = (index: number) => {
    if (!window.confirm('确定删除此 LoRA？')) return;
    const lora = loras[index];
    if (lora.enabled) {
      const words = getLoraWordsArray(lora.model);
      if (words.length) {
        setPrompt((prev: string) => removeTriggerWords(prev, words));
      }
    }
    setLoras(prev => prev.filter((_, i) => i !== index));
  };

  // 数据驱动：获取LoRA触发词数组（数据源：metadata）
  const getLoraWordsArray = (model: string): string[] => {
    const tw = getTriggerWords(model);
    return tw ? tw.split(',').map(s => s.trim()).filter(Boolean) : [];
  };

  // 数据驱动：从提示词中移除指定触发词（按逗号段精确匹配）
  const removeTriggerWords = (currentPrompt: string, words: string[]): string => {
    if (!words.length || !currentPrompt.trim()) return currentPrompt;
    const removeSet = new Set(words.map(w => w.trim().toLowerCase()));
    return currentPrompt
      .split(',')
      .map(s => s.trim())
      .filter(s => s && !removeSet.has(s.toLowerCase()))
      .join(', ');
  };

  // 数据驱动：向提示词追加缺失的触发词
  const appendMissingTriggerWords = (currentPrompt: string, words: string[]): string => {
    if (!words.length) return currentPrompt;
    const promptLower = currentPrompt.toLowerCase();
    const missing = words.filter(w => !promptLower.includes(w.trim().toLowerCase()));
    if (!missing.length) return currentPrompt;
    const base = currentPrompt.trim();
    return base ? `${base}, ${missing.join(', ')}` : missing.join(', ');
  };
  const handleSmartLora = async () => {
    if (!prompt.trim()) {
      showToast('请先输入提示词');
      return;
    }
    setSmartLoraLoading(true);
    try {
      const result = await callSmartLora(prompt);
      if (!result.loras || result.loras.length === 0) {
        showToast('未找到匹配的 LoRA 推荐');
        return;
      }
      // 直接应用推荐的 LoRA
      const newLoras = result.loras.map(l => ({
        model: l.model,
        enabled: true,
        strength: l.strength,
      }));
      setLoras(newLoras);
      if (result.modifiedPrompt) {
        setPrompt(result.modifiedPrompt);
      }
      showToast(`已推荐 ${result.loras.length} 个 LoRA`);
    } catch (err) {
      console.error('Smart LoRA error:', err);
      showToast('智能推荐失败，请稍后重试');
    } finally {
      setSmartLoraLoading(false);
    }
  };

  const handleSmartTriggerInsert = async (lora: LoraSlot, index: number) => {
    const tw = getTriggerWords(lora.model);
    if (!tw) return;
    if (!prompt.trim()) {
      showToast('请先输入提示词');
      return;
    }
    setTriggerInsertLoadingIndex(index);
    try {
      const nickname = getNickname(lora.model) || lora.model;
      const result = await callSmartTriggerInsert(prompt, tw, nickname);
      setPrompt(result.modifiedPrompt);
      showToast('已智能插入触发词');
    } catch (err) {
      console.error('Smart trigger insert error:', err);
      showToast('触发词插入失败');
    } finally {
      setTriggerInsertLoadingIndex(null);
    }
  };
  const [prompt,     setPrompt]     = useState(() => readDraft().prompt    ?? '');
  const [negativePrompt, setNegativePrompt] = useState(() => readDraft().negativePrompt ?? '');
  const [ratio,      setRatio]      = useState(() => readDraft().ratio     ?? '3:4');
  const [customWidth, setCustomWidth] = useState<number>(() => readDraft().width ?? 832);
  const [customHeight, setCustomHeight] = useState<number>(() => readDraft().height ?? 1216);
  const [steps,      setSteps]      = useState(() => readDraft().steps     ?? 30);
  const [cfg,        setCfg]        = useState(() => readDraft().cfg       ?? 6);
  const [sampler,    setSampler]    = useState(() => readDraft().sampler   ?? 'euler_ancestral');
  const [scheduler,  setScheduler]  = useState(() => readDraft().scheduler ?? 'normal');
  const [customName, setCustomName] = useState(() => readDraft().customName ?? '');
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(() => readDraft().referenceImage ?? null);
  const [refImageSize, setRefImageSize] = useState<{ width: number; height: number } | null>(() => readDraft().refImageSize ?? null);
  const [poseStrength, setPoseStrength] = useState(() => readDraft().poseStrength ?? 0.5);
  const [depthStrength, setDepthStrength] = useState(() => readDraft().depthStrength ?? 0.3);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const [batchCount, setBatchCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  // 随机生成 · 意向面板：用户点击骰子右侧 ChevronUp 弹出的浮动输入面板
  const [intentPanelOpen, setIntentPanelOpen] = useState(false);
  const [intentText, setIntentText] = useState('');
  const intentPanelRef = useRef<HTMLDivElement | null>(null);
  const intentToggleRef = useRef<HTMLButtonElement | null>(null);
  const intentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 意向面板内的「偏好档位」上拉菜单（与设置面板"随机生成偏好"数据驱动同一字段）
  const [mixMenuOpen, setMixMenuOpen] = useState(false);
  const mixMenuRef = useRef<HTMLDivElement | null>(null);
  const diceMixPreset = useSettingsStore((s) => s.diceMixPreset);
  const setDiceMixPreset = useSettingsStore((s) => s.setDiceMixPreset);
  const diceRefMode = useSettingsStore((s) => s.diceRefMode);
  const diceRatioMode = useSettingsStore((s) => s.diceRatioMode);
  const diceContentPolicy = useSettingsStore((s) => s.diceContentPolicy);
  const diceTemperature = useSettingsStore((s) => s.diceTemperature);
  const setDiceTemperature = useSettingsStore((s) => s.setDiceTemperature);
  const taskExecutionMode = useSettingsStore((s) => s.taskExecutionMode);
  const loopActive = useAutoLoopStore((s) => s.active);
  const loopTabId = useAutoLoopStore((s) => s.tabId);
  const isMyLoop = loopActive && loopTabId === 7;
  const [smartLoraLoading, setSmartLoraLoading] = useState(false);
  const [triggerInsertLoadingIndex, setTriggerInsertLoadingIndex] = useState<number | null>(null);
  const [promptFocused, setPromptFocused] = useState(false);
  const [promptBtnHovered, setPromptBtnHovered] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [negPromptFocused, setNegPromptFocused] = useState(false);
  const [negPromptBtnHovered, setNegPromptBtnHovered] = useState(false);
  const [negQuickActionLoading, setNegQuickActionLoading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const negTextareaRef = useRef<HTMLTextAreaElement>(null);
  // 负面提示词输入框的最小高度（根据首次渲染的默认高度动态测量）
  const [negMinHeight, setNegMinHeight] = useState<number>(0);

  // AI Agent 修改提示词后的一次性闪烁反馈
  // 使用 ref 记录挂载时的 tick 基线，避免 Tab 切换 remount 时因 tick 已 >0 而误闪
  const agentPromptEditTick = useWorkflowStore((s) => s.agentPromptEditTick);
  const promptTickBaselineRef = useRef<number | null>(null);
  const [promptFlashing, setPromptFlashing] = useState(false);
  useEffect(() => {
    if (promptTickBaselineRef.current === null) {
      promptTickBaselineRef.current = agentPromptEditTick;
      return;
    }
    if (agentPromptEditTick <= promptTickBaselineRef.current) return;
    promptTickBaselineRef.current = agentPromptEditTick;
    setPromptFlashing(true);
    const t = window.setTimeout(() => setPromptFlashing(false), 1500);
    return () => window.clearTimeout(t);
  }, [agentPromptEditTick]);

  // 提示词输入框：根据内容动态调整高度，最小高度保持默认 4 行（80px）
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(80, el.scrollHeight) + 'px';
  }, [prompt]);

  // 首次渲染后测量负面提示词输入框的默认高度，作为最小高度
  useLayoutEffect(() => {
    if (negTextareaRef.current && negMinHeight === 0) {
      setNegMinHeight(negTextareaRef.current.offsetHeight);
    }
  }, [negMinHeight]);

  // 负面提示词输入框：根据内容动态调整高度
  useLayoutEffect(() => {
    const el = negTextareaRef.current;
    if (!el || negMinHeight === 0) return;
    el.style.height = 'auto';
    el.style.height = Math.max(negMinHeight, el.scrollHeight) + 'px';
  }, [negativePrompt, negMinHeight]);

  const getSelectedText = () => {
    const { start, end } = selectionRef.current;
    return start !== end ? prompt.slice(start, end) : '';
  };

  const handleCtxCut = useCallback(() => {
    const { start, end } = selectionRef.current;
    if (start === end) return;
    const text = prompt.slice(start, end);
    navigator.clipboard.writeText(text);
    const newPrompt = prompt.slice(0, start) + prompt.slice(end);
    setPrompt(newPrompt);
    selectionRef.current = { start, end: start };
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = start;
        textareaRef.current.selectionEnd = start;
      }
    }, 0);
  }, [prompt, setPrompt]);

  const handleCtxCopy = useCallback(() => {
    const { start, end } = selectionRef.current;
    if (start === end) return;
    navigator.clipboard.writeText(prompt.slice(start, end));
  }, [prompt]);

  const handleCtxPaste = useCallback(() => {
    navigator.clipboard.readText().then(clipText => {
      if (!clipText) return;
      const { start, end } = selectionRef.current;
      const before = prompt.slice(0, start);
      const after = prompt.slice(end);
      const newPrompt = before + clipText + after;
      setPrompt(newPrompt);
      const newPos = start + clipText.length;
      selectionRef.current = { start: newPos, end: newPos };
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
        }
      }, 0);
    });
  }, [prompt, setPrompt]);

  // Drag-and-drop: apply card config by dropping card onto this sidebar
  const [isDragOverConfig, setIsDragOverConfig] = useState(false);
  const dragDepthRef = useRef(0);
  const applyConfigToSidebar = useWorkflowStore((s) => s.applyConfigToSidebar);
  const handleConfigDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-workflow-image')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setIsDragOverConfig(true);
  }, []);
  const handleConfigDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-workflow-image')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleConfigDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-workflow-image')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOverConfig(false);
  }, []);
  const handleConfigDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOverConfig(false);

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (!imageId) return;

    const config = useWorkflowStore.getState().tabData[7]?.text2imgConfigs?.[imageId];
    if (!config) {
      showToast('该卡片没有可用的生成配置');
      return;
    }
    applyConfigToSidebar(config);
    showToast('已应用卡片配置');
  }, [applyConfigToSidebar]);

  // Listen for pendingApplyConfig from useWorkflowStore
  const pendingApplyConfig = useWorkflowStore((s) => s.pendingApplyConfig);
  const clearPendingApplyConfig = useWorkflowStore((s) => s.clearPendingApplyConfig);
  useEffect(() => {
    if (!pendingApplyConfig) return;
    // Only apply if it's a Text2ImgConfig (has 'model' field, no 'unetModel')
    const cfg_ = pendingApplyConfig as any;
    if (cfg_.unetModel && !cfg_.model) return; // ZIT config, skip

    const c = pendingApplyConfig as Text2ImgConfig;

    // 增量更新：只更新配置中存在的字段
    if (c.model !== undefined) setModel(c.model);
    if (c.loras !== undefined) setLoras(c.loras);
    if (c.prompt !== undefined) setPrompt(c.prompt);
    if (c.negativePrompt !== undefined) setNegativePrompt(c.negativePrompt);
    if (c.steps !== undefined) setSteps(c.steps);
    if (c.cfg !== undefined) setCfg(c.cfg);
    if (c.sampler !== undefined) setSampler(c.sampler);
    if (c.scheduler !== undefined) setScheduler(c.scheduler);
    if (c.width !== undefined) setCustomWidth(c.width);
    if (c.height !== undefined) setCustomHeight(c.height);

    // 如果宽高都有，尝试匹配预设比例
    if (c.width !== undefined && c.height !== undefined) {
      const matchedPreset = RATIO_PRESETS.find(p => p.width === c.width && p.height === c.height);
      if (matchedPreset) {
        setRatio(matchedPreset.label);
      } else {
        setRatio('custom');
      }
    }

    // 参考图处理
    if (c.referenceImage !== undefined) {
      if (c.referenceImage) {
        setReferenceImage(c.referenceImage);
        if (c.poseStrength !== undefined) setPoseStrength(c.poseStrength);
        if (c.depthStrength !== undefined) setDepthStrength(c.depthStrength);
        setRefOpen(true);
        if (c.refImageWidth && c.refImageHeight) {
          setRefImageSize({ width: c.refImageWidth, height: c.refImageHeight });
          setRatio('original');
          setCustomWidth(c.refImageWidth);
          setCustomHeight(c.refImageHeight);
        } else {
          const img = new Image();
          img.onload = () => {
            setRefImageSize({ width: img.naturalWidth, height: img.naturalHeight });
            setRatio('original');
            setCustomWidth(img.naturalWidth);
            setCustomHeight(img.naturalHeight);
          };
          img.src = `/api/workflow/7/ref-image/${c.referenceImage}`;
        }
      } else {
        setReferenceImage(null);
        setRefImageSize(null);
        setPoseStrength(0.5);
        setDepthStrength(0.3);
        setRatio((prev: string) => prev === 'original' ? '3:4' : prev);
      }
    }

    clearPendingApplyConfig();
  }, [pendingApplyConfig, clearPendingApplyConfig]);

  // Persist config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ model, loras, prompt, negativePrompt, ratio, steps, cfg, sampler, scheduler, customName, width: customWidth, height: customHeight, referenceImage, refImageSize, poseStrength, depthStrength }));
  }, [model, loras, prompt, negativePrompt, ratio, steps, cfg, sampler, scheduler, customName, customWidth, customHeight, referenceImage, refImageSize, poseStrength, depthStrength]);

  // Default model once loaded (only if none was saved or saved model not in list)
  useEffect(() => {
    if (models.length > 0) {
      if (!model || !models.includes(model)) {
        setModel(models[0]);
      }
    }
  }, [models, model]);

  useEffect(() => {
    if (loraModels.length > 0) {
      setLoras(prev => prev.map(l =>
        (l.model && !loraModels.includes(l.model)) ? { ...l, model: loraModels[0] } : l
      ));
    }
  }, [loraModels]);

  // 意向面板：打开时自动聚焦 textarea；点击面板与触发按钮之外区域关闭；Esc 关闭
  useEffect(() => {
    if (!intentPanelOpen) return;
    // 延迟一帧 focus，避免与 onClick 冲突
    const focusTimer = window.setTimeout(() => {
      intentTextareaRef.current?.focus();
    }, 0);
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (intentPanelRef.current?.contains(target)) return;
      if (intentToggleRef.current?.contains(target)) return;
      setIntentPanelOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIntentPanelOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [intentPanelOpen]);

  // 意向 textarea：随内容自动撑高（初始 1 行，换行后向上长；max-height 160px）
  useLayoutEffect(() => {
    if (!intentPanelOpen) return;
    const ta = intentTextareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [intentPanelOpen, intentText]);

  // 偏好档位上拉菜单：点击菜单容器之外关闭（面板整体关闭时菜单也随之卸载）
  useEffect(() => {
    if (!mixMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (mixMenuRef.current?.contains(t)) return;
      setMixMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mixMenuOpen]);

  // 意向面板关闭时同步收起子菜单
  useEffect(() => {
    if (!intentPanelOpen) setMixMenuOpen(false);
  }, [intentPanelOpen]);

  const selectedPreset = ratio === 'original' ? undefined : RATIO_PRESETS.find((p) => p.label === ratio);

  // ── Reference image handlers ───────────────────────────────────────────────
  const handleRefImageUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch('/api/workflow/7/ref-image', { method: 'POST', body: formData });
      if (!res.ok) { showToast('上传参考图失败'); return; }
      const data = await res.json();
      setReferenceImage(data.filename);
      if (data.width && data.height) {
        setRefImageSize({ width: data.width, height: data.height });
        setRatio('original');
        setCustomWidth(data.width);
        setCustomHeight(data.height);
      }
    } catch {
      showToast('上传参考图失败');
    }
  }, [referenceImage]);

  const handleRefImageDelete = useCallback(() => {
    setReferenceImage(null);
    setRefImageSize(null);
    setRatio((prev: string) => prev === 'original' ? '3:4' : prev);
    if (ratio === 'original') { setCustomWidth(832); setCustomHeight(1216); }
  }, [ratio]);

  const handleRefFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleRefImageUpload(file);
    e.target.value = '';
  }, [handleRefImageUpload]);

  const handleRefDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) handleRefImageUpload(file);
  }, [handleRefImageUpload]);

  const handleGenerate = useCallback(async () => {
    if (!clientId || isGenerating) return;

    // 跨 tab 守卫：若其它 tab 正在自动循环，弹模态框询问用户是否停止
    const guarded = await useAutoLoopStore.getState().guardBeforeSubmit(7);
    if (!guarded) return;

    const config: Text2ImgConfig = {
      model: model || (models[0] ?? ''),
      loras,
      prompt,
      negativePrompt,
      width:     selectedPreset ? selectedPreset.width : customWidth,
      height:    selectedPreset ? selectedPreset.height : customHeight,
      steps,
      cfg,
      sampler,
      scheduler,
      ...(referenceImage ? { referenceImage, poseStrength, depthStrength, useOriginalRatio: ratio === 'original', ...(refImageSize ? { refImageWidth: refImageSize.width, refImageHeight: refImageSize.height } : {}) } : {}),
    };

    // Build base name: user input or auto timestamp
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const baseName = customName.trim() || `t2i_${ts}`;
    const isLoop = taskExecutionMode === 'autoLoop';
    const manualCount = Math.min(32, Math.max(1, batchCount));

    if (isLoop) {
      useAutoLoopStore.getState().startLoop(7, 'normal');
    }

    setIsGenerating(true);
    try {
      let i = 0;
      while (isLoop ? useAutoLoopStore.getState().active : i < manualCount) {
        const itemName = (!isLoop && manualCount === 1) ? baseName : `${baseName}_${i + 1}`;
        // 每张卡片独立生成 seed，避免 Node.js Math.random 在连续快速调用下碰撞
        const cfgWithSeed: Text2ImgConfig = { ...config, seed: genUniqueSeed() };
        const imageId = addText2ImgCard(cfgWithSeed, itemName);
        setFlashingImage(imageId);
        startTask(imageId, '');  // Show shimmer immediately before fetch returns
        let submittedPromptId: string | null = null;
        try {
          const res = await fetch('/api/workflow/7/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...cfgWithSeed, name: itemName }),
          });
          if (!res.ok) {
            console.error('[Text2Img] Execute failed:', await res.text());
            if (isLoop) break;
            i++;
            continue;
          }
          const data = await res.json() as { promptId: string };
          submittedPromptId = data.promptId;
          startTask(imageId, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 7, sessionId, tabId: 7 });
        } catch (err) {
          console.error('[Text2Img] Execute error:', err);
          if (isLoop) break;
        }
        if (isLoop && submittedPromptId) {
          await waitPromptComplete(submittedPromptId);
        }
        i++;
      }
    } finally {
      setIsGenerating(false);
      if (isLoop && useAutoLoopStore.getState().active) {
        useAutoLoopStore.getState().stopLoop();
      }
    }
  }, [clientId, isGenerating, model, models, loras, loraModels, prompt, negativePrompt, selectedPreset, customWidth, customHeight, steps, cfg, sampler, scheduler, customName, batchCount, taskExecutionMode, addText2ImgCard, startTask, sendMessage, sessionId, referenceImage, poseStrength, depthStrength, ratio, refImageSize]);

  /**
   * 随机骰子：按用户在设置面板选择的档位（更多偏好 / 均衡 / 更多推荐）拆分 batchCount，
   * 调后端 /api/agent/random-batch 拉取 N 条 prompt，覆盖当前 sidebar 其他配置后入照片墙。
   */
  const handleRandomGenerate = useCallback(async (userIntent?: string) => {
    if (!clientId || isGenerating || isRandomizing) return;
    if (models.length === 0) return;

    // 用户意向（来自骰子右侧 ChevronUp 浮动面板）：裁剪并校验长度
    const trimmedIntent = typeof userIntent === 'string' ? userIntent.trim().slice(0, 500) : '';

    // 跨 tab 守卫：若其它 tab 正在自动循环，弹模态框询问用户是否停止
    const guarded = await useAutoLoopStore.getState().guardBeforeSubmit(7);
    if (!guarded) return;

    const isLoop = taskExecutionMode === 'autoLoop';
    if (isLoop) {
      useAutoLoopStore.getState().startLoop(7, 'random');
    }

    setIsRandomizing(true);
    try {
      type RandomItem = {
        category: 'preference' | 'tweak' | 'explore';
        prompt: string;
        recommendedLoras?: Array<{ model: string; strength: number }>;
        recommendedModel?: string;
        ratio?: string;
        width?: number;
        height?: number;
        cardName?: string;
      };

      // 每轮：manual 跑 1 轮，autoLoop 持续到 stopLoop
      let outerIter = 0;
      while (isLoop ? useAutoLoopStore.getState().active : outerIter === 0) {
        const total = isLoop ? 1 : Math.min(32, Math.max(1, batchCount));
        const { preferenceCount, tweakCount, exploreCount } = computeMix(total, diceMixPreset);

        let items: RandomItem[];
        try {
          const resp = await fetch('/api/agent/random-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferenceCount, tweakCount, exploreCount, mixPreset: diceMixPreset, ratioMode: diceRatioMode, contentPolicy: diceContentPolicy, userIntent: trimmedIntent || undefined, temperature: diceTemperature }),
          });
          if (!resp.ok) {
            const errText = await resp.text();
            showToast(`随机生成失败：${errText || `HTTP ${resp.status}`}`);
            if (isLoop) break;
            return;
          }
          const data = await resp.json() as { items: RandomItem[] };
          items = Array.isArray(data.items) ? data.items : [];
        } catch (err) {
          showToast(`随机生成请求失败：${err instanceof Error ? err.message : String(err)}`);
          if (isLoop) break;
          return;
        }

        if (items.length < total) {
          showToast(`随机生成返回条数不足（${items.length}/${total}），已${isLoop ? '终止循环' : '中止'}`);
          if (isLoop) break;
          return;
        }

        // 基础配置：复用 sidebar 当前其他字段；model / loras 会被每条 item 的推荐覆盖
        // 参考图：仅当 diceRefMode === 'auto' 且 sidebar 已配置参考图时注入
        const useSidebarRef = diceRefMode === 'auto' && !!referenceImage;
        const baseConfig: Omit<Text2ImgConfig, 'prompt' | 'model' | 'loras'> = {
          negativePrompt,
          width:     selectedPreset ? selectedPreset.width : customWidth,
          height:    selectedPreset ? selectedPreset.height : customHeight,
          steps,
          cfg,
          sampler,
          scheduler,
          ...(useSidebarRef ? { referenceImage, poseStrength, depthStrength, useOriginalRatio: ratio === 'original', ...(refImageSize ? { refImageWidth: refImageSize.width, refImageHeight: refImageSize.height } : {}) } : {}),
        };

        const CATEGORY_LABEL: Record<'preference' | 'tweak' | 'explore', string> = {
          preference: '偏好',
          tweak:      '微改',
          explore:    '探索',
        };
        // 按档位累计计数（仅用于 fallback 名字与分母展示）
        const categoryTotals = { preference: preferenceCount, tweak: tweakCount, explore: exploreCount };
        const categoryCursor = { preference: 0, tweak: 0, explore: 0 };
        // 同批次已使用的卡片名集合，用于在 LLM 偶发撞名时追加 _2/_3... 防重
        const usedNames = new Set<string>();

        let firstImageId: string | null = null;
        let lastPromptId: string | null = null;
        for (let i = 0; i < items.length; i++) {
          if (isLoop && !useAutoLoopStore.getState().active) break;
          const item = items[i];

          // 每条 item 用推荐的 LoRA 和模型覆盖；无推荐则回退到 sidebar 当前值
          const recLoras = Array.isArray(item.recommendedLoras) && item.recommendedLoras.length > 0
            ? item.recommendedLoras.map(l => ({ model: l.model, enabled: true, strength: l.strength }))
            : loras;
          const recModel = item.recommendedModel && models.includes(item.recommendedModel)
            ? item.recommendedModel
            : (model || (models[0] ?? ''));

          const cfg: Text2ImgConfig = {
            ...baseConfig,
            model: recModel,
            loras: recLoras,
            prompt: item.prompt,
            seed: genUniqueSeed(),
            // 若比例模式为 auto 且 LLM 返回了有效 width/height，覆盖 baseConfig 的比例
            ...(diceRatioMode === 'auto' && item.width && item.height ? { width: item.width, height: item.height } : {}),
          };
          categoryCursor[item.category] += 1;
          // 注意：displayName 作为 ComfyUI SaveImage.filename_prefix，不能含 "/" 或 "\"，
          // 否则 ComfyUI 会把 "/" 前的部分当成 subfolder，导致本地文件互相覆盖。
          // 命名策略：直接使用 LLM 的 cardName；若 LLM 没返回，回退到「随机·偏好 1-5」；
          // 仅在同批撞名时才追加 _2/_3... 作为防重保底。
          const seq = categoryCursor[item.category];
          const fallbackName = `随机·${CATEGORY_LABEL[item.category]} ${seq}-${categoryTotals[item.category]}`;
          const baseName = (item.cardName && item.cardName.trim().length > 0 ? item.cardName.trim() : fallbackName)
            .replace(/[/\\]/g, '-');
          let displayName = baseName;
          if (usedNames.has(displayName)) {
            let n = 2;
            while (usedNames.has(`${baseName}_${n}`)) n++;
            displayName = `${baseName}_${n}`;
          }
          usedNames.add(displayName);

          const imageId = addText2ImgCard(cfg, displayName);
          if (firstImageId === null) {
            firstImageId = imageId;
            setFlashingImage(imageId);
          }
          startTask(imageId, '');
          try {
            const res = await fetch('/api/workflow/7/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId, ...cfg, name: displayName }),
            });
            if (!res.ok) {
              console.error('[Text2Img] Random execute failed:', await res.text());
              continue;
            }
            const data = await res.json() as { promptId: string };
            lastPromptId = data.promptId;
            startTask(imageId, data.promptId);
            sendMessage({ type: 'register', promptId: data.promptId, workflowId: 7, sessionId, tabId: 7 });
          } catch (err) {
            console.error('[Text2Img] Random execute error:', err);
          }
        }

        // autoLoop：等待这一轮最后一个提交完成后再继续下一轮
        if (isLoop && lastPromptId) {
          await waitPromptComplete(lastPromptId);
        }
        outerIter++;
      }
    } finally {
      setIsRandomizing(false);
      if (isLoop && useAutoLoopStore.getState().active) {
        useAutoLoopStore.getState().stopLoop();
      }
    }
  }, [clientId, isGenerating, isRandomizing, batchCount, diceMixPreset, diceRefMode, diceRatioMode, diceContentPolicy, diceTemperature, taskExecutionMode, model, models, loraModels, loras, negativePrompt, selectedPreset, customWidth, customHeight, steps, cfg, sampler, scheduler, referenceImage, poseStrength, depthStrength, ratio, refImageSize, addText2ImgCard, startTask, setFlashingImage, sendMessage, sessionId]);

  const handleQuickAction = useCallback(async (mode: 'naturalToTags' | 'tagsToNatural' | 'detailer') => {
    if (!prompt.trim()) return;
    setQuickActionLoading(mode);
    try {
      const sysPrompt =
        mode === 'naturalToTags' ? SYSTEM_PROMPTS.naturalToTags :
        mode === 'tagsToNatural' ? SYSTEM_PROMPTS.tagsToNatural :
        SYSTEM_PROMPTS.detailer;
      const { text: result } = await callPromptAssistant({ systemPrompt: sysPrompt, userPrompt: prompt });
      setPrompt(result);
    } catch {
      // silent fail — user can retry
    } finally {
      setQuickActionLoading(null);
    }
  }, [prompt]);

  const handleNegQuickAction = useCallback(async (mode: 'naturalToTags' | 'tagsToNatural' | 'detailer') => {
    if (!negativePrompt.trim()) return;
    setNegQuickActionLoading(mode);
    try {
      const sysPrompt =
        mode === 'naturalToTags' ? SYSTEM_PROMPTS.naturalToTags :
        mode === 'tagsToNatural' ? SYSTEM_PROMPTS.tagsToNatural :
        SYSTEM_PROMPTS.detailer;
      const { text: result } = await callPromptAssistant({ systemPrompt: sysPrompt, userPrompt: negativePrompt });
      setNegativePrompt(result);
    } catch {
      // silent fail
    } finally {
      setNegQuickActionLoading(null);
    }
  }, [negativePrompt]);

  // ── Style helpers ────────────────────────────────────────────────────────

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
    <div
      className="sidebar-panel"
      onDragEnter={handleConfigDragEnter}
      onDragOver={handleConfigDragOver}
      onDragLeave={handleConfigDragLeave}
      onDrop={handleConfigDrop}
      style={{
        width: width ?? 260,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        outline: isDragOverConfig ? '2px dashed var(--color-primary)' : 'none',
        outlineOffset: '-2px',
        transition: 'outline-color 0.12s',
      }}
    >
      {isDragOverConfig && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          padding: '6px 10px',
          fontSize: 12,
          color: 'var(--color-primary)',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid var(--color-primary)',
          borderRadius: 6,
          textAlign: 'center',
          zIndex: 20,
          pointerEvents: 'none',
        }}>
          释放以应用该卡片的生成配置
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Model */}
        <div style={{ ...cardStyle, paddingTop: 0, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>模型</div>
          <ModelSelect
            models={models}
            value={model}
            onChange={setModel}
            favorites={checkpointFavorites}
            onToggleFavorite={toggleCheckpointFavorite}
            loading={modelsLoading}
            placeholder="（无可用模型）"
            metadata={metadata}
            onUploadThumbnail={uploadThumbnail}
            onSetNickname={setNickname}
            onSetCategory={setCategory}
            onDeleteCategory={deleteCategory}
            getThumbnailUrl={getThumbnailUrl}
            isLora={false}
            onUpdateMetadata={updateMetadataFields}
          />
        </div>

        <div style={dividerStyle} />

        {/* LoRA collapsible sections */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...sectionLabelStyle, marginBottom: 0 }}>LoRA</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* 智能LoRA推荐按钮 */}
              <button
                onClick={handleSmartLora}
                disabled={smartLoraLoading || !prompt.trim()}
                title="AI 智能推荐 LoRA"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: smartLoraLoading || !prompt.trim() ? 'not-allowed' : 'pointer',
                  color: smartLoraLoading ? 'var(--accent-color, #7c5cbf)' : 'var(--text-secondary, #888)',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  opacity: smartLoraLoading || !prompt.trim() ? 0.5 : 1,
                  transition: 'color 0.2s, opacity 0.2s',
                }}
                onMouseEnter={e => {
                  if (!smartLoraLoading && prompt.trim()) {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-color, #7c5cbf)';
                  }
                }}
                onMouseLeave={e => {
                  if (!smartLoraLoading) {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary, #888)';
                  }
                }}
              >
                <Sparkles
                  size={14}
                  style={smartLoraLoading ? {
                    animation: 'pulse 1s ease-in-out infinite',
                  } : undefined}
                />
              </button>
              {/* 原有的添加 LoRA 按钮 */}
              {loras.length < 7 && (
                <button
                  onClick={addLora}
                  title="添加 LoRA"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
          </div>
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
                onClick={() => {
                  const newEnabled = !lora.enabled;
                  const words = getLoraWordsArray(lora.model);
                  if (words.length) {
                    setPrompt((prev: string) => newEnabled
                      ? appendMissingTriggerWords(prev, words)
                      : removeTriggerWords(prev, words)
                    );
                  }
                  updateLora(i, { enabled: newEnabled });
                }}
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
                  <button
                    onClick={() => handleSmartTriggerInsert(lora, i)}
                    disabled={triggerInsertLoadingIndex === i}
                    title="点击智能插入触发词"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: triggerInsertLoadingIndex === i ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginLeft: 4,
                      padding: 0,
                    }}
                  >
                    <AlertTriangle
                      size={12}
                      color="#e6a817"
                      style={triggerInsertLoadingIndex === i ? {
                        animation: 'pulse 1s ease-in-out infinite',
                      } : undefined}
                    />
                  </button>
                );
              })()}
              <button
                onClick={() => removeLora(i)}
                title="删除此 LoRA"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-text-secondary)',
                  marginLeft: 'auto',
                }}
              >
                <Trash2 size={12} />
              </button>
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
                  isLora={true}
                  onUpdateMetadata={updateMetadataFields}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>权重</span>
                  <input
                    type="range"
                    min={-2} max={2} step={0.1}
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
            style={{ position: 'relative', borderRadius: 6 }}
            className={[
              quickActionLoading ? 'textarea-ai-active' : '',
              promptFlashing ? 'card-flash-anim' : '',
            ].filter(Boolean).join(' ') || undefined}
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
                selectionRef.current = {
                  start: e.currentTarget.selectionStart,
                  end: e.currentTarget.selectionEnd,
                };
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
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: 80,
                overflow: 'hidden',
                boxSizing: 'border-box',
                opacity: quickActionLoading !== null ? 0.45 : 1,
                transition: 'opacity 0.2s',
              }}
            />
            {/* Prompt assistant button group — expands on hover */}
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
                  usePromptAssistantStore.getState().openPanel({
                    initialText: prompt,
                  });
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
          <div style={{ marginTop: 10, position: 'relative' }} className={negQuickActionLoading ? 'textarea-ai-active' : undefined}>
            <textarea
              ref={negTextareaRef}
              placeholder="额外负面提示词（可选）"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              onFocus={() => setNegPromptFocused(true)}
              onBlur={() => setNegPromptFocused(false)}
              readOnly={negQuickActionLoading !== null}
              rows={1}
              style={{
                width: '100%',
                padding: '7px 36px 7px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: negMinHeight || undefined,
                overflow: 'hidden',
                boxSizing: 'border-box' as const,
                opacity: negQuickActionLoading !== null ? 0.45 : 1,
                transition: 'opacity 0.2s',
              }}
            />
            {/* 快速操作按钮 - 与正面提示词完全相同的结构 */}
            <div
              onMouseEnter={() => setNegPromptBtnHovered(true)}
              onMouseLeave={() => setNegPromptBtnHovered(false)}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 6,
                display: 'flex',
                flexDirection: 'row' as const,
                alignItems: 'center',
                opacity: negPromptFocused || negPromptBtnHovered ? 1 : 0,
                pointerEvents: negPromptFocused || negPromptBtnHovered ? 'auto' as const : 'none' as const,
                background: negPromptBtnHovered ? 'var(--color-surface)' : 'transparent',
                border: `1px solid ${negPromptBtnHovered ? 'var(--color-border)' : 'transparent'}`,
                borderRadius: 6,
                padding: '2px 4px',
                transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
              }}
            >
              {/* 三个快速操作按钮的滑出容器 */}
              <div style={{
                display: 'flex',
                gap: 4,
                overflow: 'hidden',
                maxWidth: negPromptBtnHovered ? 72 : 0,
                marginRight: negPromptBtnHovered ? 4 : 0,
                opacity: negPromptBtnHovered ? 1 : 0,
                transition: 'max-width 0.2s ease, margin-right 0.2s ease, opacity 0.15s',
              }}>
                {/* 按需扩写 */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleNegQuickAction('detailer')}
                  disabled={negQuickActionLoading !== null}
                  title="按需扩写（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: negQuickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: negQuickActionLoading === 'detailer' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: negQuickActionLoading && negQuickActionLoading !== 'detailer' ? 0.35 : 1,
                  }}
                >
                  {negQuickActionLoading === 'detailer'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <Wand2 size={13} />}
                </button>
                {/* 标签 → 自然语言 */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleNegQuickAction('tagsToNatural')}
                  disabled={negQuickActionLoading !== null}
                  title="标签 → 自然语言（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: negQuickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: negQuickActionLoading === 'tagsToNatural' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: negQuickActionLoading && negQuickActionLoading !== 'tagsToNatural' ? 0.35 : 1,
                  }}
                >
                  {negQuickActionLoading === 'tagsToNatural'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <AlignLeft size={13} />}
                </button>
                {/* 自然语言 → 标签 */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleNegQuickAction('naturalToTags')}
                  disabled={negQuickActionLoading !== null}
                  title="自然语言 → 标签（直接替换）"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: negQuickActionLoading ? 'not-allowed' : 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: negQuickActionLoading === 'naturalToTags' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    opacity: negQuickActionLoading && negQuickActionLoading !== 'naturalToTags' ? 0.35 : 1,
                  }}
                >
                  {negQuickActionLoading === 'naturalToTags'
                    ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                    : <Hash size={13} />}
                </button>
              </div>
              {/* 提示词助理按钮 */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  usePromptAssistantStore.getState().openPanel({
                    initialText: negativePrompt,
                  });
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

        {/* 图像参考 */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <button
            onClick={() => setRefOpen((v) => !v)}
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
              marginBottom: refOpen ? 10 : 0,
            }}
          >
            {refOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            图像参考
          </button>

          {refOpen && (
            <div>
              <input
                ref={refFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleRefFilePick}
              />
              {!referenceImage ? (
                <div
                  onClick={() => refFileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleRefDrop}
                  style={{
                    border: '2px dashed rgba(255,255,255,0.3)',
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer',
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Upload size={24} color="var(--color-text-secondary)" />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>点击上传或拖拽图片</span>
                </div>
              ) : (
                <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                  <img
                    src={`/api/workflow/7/ref-image/${referenceImage}`}
                    alt="参考图"
                    style={{ width: '100%', borderRadius: 8, display: 'block' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    display: 'flex',
                    gap: 4,
                  }}>
                    <button
                      onClick={() => refFileInputRef.current?.click()}
                      title="替换图片"
                      style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: 'rgba(0,0,0,0.55)',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      onClick={handleRefImageDelete}
                      title="删除图片"
                      style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: 'rgba(0,0,0,0.55)',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* 姿势参考 */}
              <div style={{ marginTop: 12, opacity: referenceImage ? 1 : 0.4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>姿势参考</span>
                  <span style={{ fontSize: '12px', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{poseStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={poseStrength}
                  disabled={!referenceImage}
                  onChange={(e) => setPoseStrength(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                />
              </div>

              {/* 深度参考 */}
              <div style={{ marginTop: 10, opacity: referenceImage ? 1 : 0.4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>深度参考</span>
                  <span style={{ fontSize: '12px', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{depthStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={depthStrength}
                  disabled={!referenceImage}
                  onChange={(e) => setDepthStrength(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={dividerStyle} />

        {/* Aspect ratio */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={sectionLabelStyle}>比例</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {referenceImage && refImageSize && (
              <button
                key="original"
                style={{
                  ...pillBtn(ratio === 'original'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 52,
                  height: 52,
                  padding: '4px 6px',
                }}
                onClick={() => { setRatio('original'); setCustomWidth(refImageSize.width); setCustomHeight(refImageSize.height); }}
              >
                <span style={{ fontSize: 12 }}>auto</span>
              </button>
            )}
            {RATIO_PRESETS.map((p) => {
              const active = ratio === p.label;
              const maxSize = p.width === p.height ? 19 : 24;
              const w = p.width >= p.height ? maxSize : Math.round(maxSize * p.width / p.height);
              const h = p.height >= p.width ? maxSize : Math.round(maxSize * p.height / p.width);
              return (
                <button
                  key={p.label}
                  style={{
                    ...pillBtn(active),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 52,
                    height: 52,
                    padding: '4px 6px 7px',
                  }}
                  onClick={() => { setRatio(p.label); setCustomWidth(p.width); setCustomHeight(p.height); }}
                >
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{
                      width: w,
                      height: h,
                      border: `1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-text-secondary)'}`,
                      borderRadius: 2,
                      flexShrink: 0,
                      transition: 'border-color 0.12s',
                    }} />
                  </div>
                  <span style={{ fontSize: '10px', lineHeight: 1 }}>{p.label}</span>
                </button>
              );
            })}
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

              <div style={{ marginTop: 10, marginBottom: 20 }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 4 }}>采样器</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {SAMPLERS.map((s) => (
                    <button key={s.value} style={pillBtn(sampler === s.value)} onClick={() => setSampler(s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
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
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          {isMyLoop ? (
            <button
              onClick={() => useAutoLoopStore.getState().stopLoop()}
              title="停止自动循环（当前正在执行的那一单会正常完成）"
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#E53935',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'opacity 0.15s',
              }}
            >
              <Square size={14} fill="#fff" />
              停止循环
            </button>
          ) : (
            <>
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
                {taskExecutionMode === 'autoLoop' ? '开始循环' : '生成'}
              </button>
              {/* 随机生成组合控件：骰子 + 分隔线 + ChevronUp 意向面板触发，共用一个 border */}
              {(() => {
                const diceDisabled = !clientId || isGenerating || isRandomizing || models.length === 0;
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      backgroundColor: 'var(--color-bg)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      opacity: diceDisabled ? 0.5 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <button
                      onClick={() => handleRandomGenerate()}
                      disabled={diceDisabled}
                      title={`随机生成（档位：${DICE_MIX_LABEL[diceMixPreset]} / 参考图：${diceRefMode === 'auto' ? '使用（如有）' : '不使用'} / 比例：${diceRatioMode === 'auto' ? '自动' : '手动'}，可在设置-随机生成中调整）${taskExecutionMode === 'autoLoop' ? ' · 自动循环模式' : ''}`}
                      style={{
                        padding: '10px',
                        width: 40,
                        backgroundColor: 'transparent',
                        color: 'var(--color-text)',
                        border: 'none',
                        borderRadius: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: diceDisabled ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, rgba(255,255,255,0.06))';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {isRandomizing
                        ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Dices size={16} />}
                    </button>
                    {/* 竖向分隔细线：上下撑满容器 */}
                    <div style={{ width: 1, backgroundColor: 'var(--color-border)', alignSelf: 'stretch', flexShrink: 0 }} />
                    {/* 意向面板触发按钮（ChevronUp）：点击展开浮动输入面板 */}
                    <button
                      ref={intentToggleRef}
                      onClick={() => setIntentPanelOpen((v) => !v)}
                      disabled={diceDisabled}
                      title={intentText.trim() ? `当前意向：${intentText.trim()}（点击编辑）` : '写下你的生成意向（可选，作为最高优先级影响随机生成）'}
                      style={{
                        padding: 0,
                        width: 24,
                        backgroundColor: intentPanelOpen ? 'var(--color-surface-hover, rgba(255,255,255,0.08))' : 'transparent',
                        color: intentText.trim() ? 'var(--color-primary)' : 'var(--color-text)',
                        border: 'none',
                        borderRadius: 0,
                        cursor: diceDisabled ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s, transform 0.15s',
                        position: 'relative',
                      }}
                      onMouseEnter={(e) => {
                        if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, rgba(255,255,255,0.06))';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = intentPanelOpen ? 'var(--color-surface-hover, rgba(255,255,255,0.08))' : 'transparent';
                      }}
                    >
                      <ChevronUp size={14} style={{ transform: intentPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
                      {/* 已填入意向时的小圆点指示器 */}
                      {intentText.trim() && !intentPanelOpen && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 3,
                            right: 3,
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: 'var(--color-primary)',
                          }}
                        />
                      )}
                    </button>
                  </div>
                );
              })()}
              {taskExecutionMode === 'manual' && (
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
              )}
              {/* 意向浮动面板：向上弹出，包含 textarea（1 行起步，随内容向上撑高） + toolbar（温度图标 + 发送按钮） */}
              {intentPanelOpen && (
                <div
                  ref={intentPanelRef}
                  style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    right: 0,
                    width: 300,
                    padding: 10,
                    backgroundColor: 'var(--color-surface, var(--color-bg))',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    zIndex: 20,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <textarea
                    ref={intentTextareaRef}
                    value={intentText}
                    onChange={(e) => setIntentText(e.target.value.slice(0, 500))}
                    onKeyDown={(e) => {
                      // Ctrl/Cmd + Enter 或纯 Enter 发送；Shift+Enter 换行
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        const txt = intentText.trim();
                        setIntentPanelOpen(false);
                        handleRandomGenerate(txt || undefined);
                      }
                    }}
                    placeholder="请输入生成的主题 / 意向"
                    rows={1}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      outline: 'none',
                      resize: 'none',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      overflowY: 'auto',
                      // 单行起步，随内容撑高；关闭仍可用 Esc 或点击面板外
                      minHeight: 36,
                      display: 'block',
                      verticalAlign: 'top',
                    }}
                  />
                  {/* toolbar：文本框下方右侧 · 温度图标（无底色） + 发送按钮（蓝底白字） */}
                  {(() => {
                    const isLoop = taskExecutionMode === 'autoLoop';
                    const sendDisabled = !clientId || isGenerating || isRandomizing || isMyLoop || models.length === 0;
                    const hasIntent = intentText.trim().length > 0;
                    const sendLabel = isLoop ? '开始' : '生成';
                    const sendTitle = isMyLoop
                      ? '当前正在自动循环中，无法发起新任务'
                      : isLoop
                        ? (hasIntent
                            ? '围绕该意向开始自动循环随机生成（持续到手动停止）'
                            : '未填写意向，将按画像开始自动循环随机生成')
                        : (hasIntent
                            ? '围绕该意向发起随机生成（按当前批量数一次性生成）'
                            : '未填写意向，将按画像随机生成（按当前批量数一次性生成）');
                    // 温度循环按钮：low → medium → high → low
                    // 语义层（系统提示词里的"意向发散温度"）+ API 层（LLM temperature：0.6/0.9/1.15）双重影响
                    const tempNext = diceTemperature === 'low' ? 'medium' : diceTemperature === 'medium' ? 'high' : 'low';
                    const tempIcon = diceTemperature === 'low'
                      ? <Snowflake size={16} />
                      : diceTemperature === 'high'
                        ? <Flame size={16} />
                        : <Thermometer size={16} />;
                    const tempColor = diceTemperature === 'low'
                      ? '#4ea8ff'
                      : diceTemperature === 'high'
                        ? '#ff6b4a'
                        : '#f0a500';
                    const tempLabel = diceTemperature === 'low' ? '低' : diceTemperature === 'high' ? '高' : '中';
                    const tempDesc = diceTemperature === 'low'
                      ? '严格紧贴意向字面，尽量少变奏'
                      : diceTemperature === 'high'
                        ? '在保持意向主体前提下大胆发散'
                        : '在保持意向主体前提下自然变奏';
                    const tempTitle = `发散温度：${tempLabel}（${tempDesc}）。点击切换至「${tempNext === 'low' ? '低' : tempNext === 'high' ? '高' : '中'}」。`;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        {/* 左下：偏好档位上拉菜单 + 温度图标（数据驱动 · 与设置-随机生成-随机生成偏好同一字段） */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div ref={mixMenuRef} style={{ position: 'relative' }}>
                          <button
                            onClick={() => setMixMenuOpen((v) => !v)}
                            title={`当前档位：${DICE_MIX_SHORT_LABEL[diceMixPreset]}（${DICE_MIX_PRESET_TITLE[diceMixPreset]}）。点击切换；与设置面板"随机生成偏好"同步。`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              height: 26,
                              padding: '0 8px',
                              backgroundColor: 'transparent',
                              color: 'var(--color-text-secondary)',
                              border: '1px solid var(--color-border)',
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: 'pointer',
                              lineHeight: 1,
                              flexShrink: 0,
                            }}
                          >
                            {DICE_MIX_SHORT_LABEL[diceMixPreset]}
                            <ChevronUp size={12} style={{ transform: mixMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
                          </button>
                          {mixMenuOpen && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 4px)',
                                left: 0,
                                minWidth: 120,
                                padding: 4,
                                backgroundColor: 'var(--color-surface, var(--color-bg))',
                                border: '1px solid var(--color-border)',
                                borderRadius: 8,
                                boxShadow: '0 6px 18px rgba(0,0,0,0.24)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                zIndex: 30,
                              }}
                            >
                              {(['preference', 'balanced', 'exploration'] as DiceMixPreset[]).map((v) => {
                                const active = v === diceMixPreset;
                                return (
                                  <button
                                    key={v}
                                    onClick={() => { setDiceMixPreset(v); setMixMenuOpen(false); }}
                                    title={DICE_MIX_PRESET_TITLE[v]}
                                    style={{
                                      padding: '6px 10px',
                                      textAlign: 'left',
                                      fontSize: 12,
                                      backgroundColor: active ? 'var(--color-primary)' : 'transparent',
                                      color: active ? '#fff' : 'var(--color-text)',
                                      border: 'none',
                                      borderRadius: 4,
                                      cursor: 'pointer',
                                      fontWeight: active ? 600 : 400,
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!active) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, rgba(255,255,255,0.08))';
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!active) e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                  >
                                    {DICE_MIX_SHORT_LABEL[v]}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                          {/* 温度图标（无底色）：紧贴偏好档位菜单右侧 */}
                          <button
                            onClick={() => setDiceTemperature(tempNext)}
                            title={tempTitle}
                            style={{
                              width: 26,
                              height: 26,
                              padding: 0,
                              backgroundColor: 'transparent',
                              color: tempColor,
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {tempIcon}
                          </button>
                        </div>
                        {/* 右下：发送按钮（蓝底白字） */}
                        <button
                          onClick={() => {
                            const txt = intentText.trim();
                            setIntentPanelOpen(false);
                            handleRandomGenerate(txt || undefined);
                          }}
                          disabled={sendDisabled}
                          title={sendTitle}
                          style={{
                            height: 26,
                            padding: '0 12px',
                            backgroundColor: 'var(--color-primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: sendDisabled ? 'not-allowed' : 'pointer',
                            opacity: sendDisabled ? 0.5 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {sendLabel}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {contextMenu && (
        <PromptContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          loras={loras}
          getNickname={(model) => getNickname(model)}
          getTriggerWords={(model) => getTriggerWords(model)}
          selectedText={getSelectedText()}
          selectionStart={selectionRef.current.start}
          selectionEnd={selectionRef.current.end}
          onCut={handleCtxCut}
          onCopy={handleCtxCopy}
          onPaste={handleCtxPaste}
          onInsert={(text) => {
            const { start, end } = selectionRef.current;
            const before = prompt.slice(0, start);
            const after = prompt.slice(end);

            const trimmedBefore = before.trimEnd();
            const needCommaBefore = trimmedBefore.length > 0 && !trimmedBefore.endsWith(',');
            const trimmedAfter = after.trimStart();
            const needCommaAfter = trimmedAfter.length > 0 && !trimmedAfter.startsWith(',');

            const prefix = needCommaBefore ? ', ' : '';
            const suffix = needCommaAfter ? ', ' : '';
            const inserted = prefix + text + suffix;

            const newPrompt = before + inserted + after;
            setPrompt(newPrompt);

            const newPos = before.length + prefix.length + text.length;
            selectionRef.current = { start: newPos, end: newPos };

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
