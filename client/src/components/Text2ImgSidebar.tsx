import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useWorkflowStore, type Text2ImgConfig } from '../hooks/useWorkflowStore.js';
import { type LoraSlot } from '../services/sessionService.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ChevronRight, ChevronDown, Loader, BookText, Hash, AlignLeft, Wand2, Loader2, AlertTriangle, Plus, Trash2, Upload, RefreshCw, X, Sparkles } from 'lucide-react';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { ModelSelect, useModelFavorites } from './ModelSelect.js';
import { useModelMetadata } from '../hooks/useModelMetadata.js';
import PromptContextMenu from './PromptContextMenu.js';
import { showToast } from '../hooks/useToast.js';
import { callPromptAssistant, callSmartLora, callSmartTriggerInsert } from '../services/api.js';

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
    if (loras.length < 5) {
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
    const count = Math.min(32, Math.max(1, batchCount));

    setIsGenerating(true);
    try {
      for (let i = 0; i < count; i++) {
        const itemName = count === 1 ? baseName : `${baseName}_${i + 1}`;
        const imageId = addText2ImgCard(config, itemName);
        setFlashingImage(imageId);
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
  }, [clientId, isGenerating, model, models, loras, loraModels, prompt, negativePrompt, selectedPreset, customWidth, customHeight, steps, cfg, sampler, scheduler, customName, batchCount, addText2ImgCard, startTask, sendMessage, sessionId, referenceImage, poseStrength, depthStrength]);

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
              {loras.length < 5 && (
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
