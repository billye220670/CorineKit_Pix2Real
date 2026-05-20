import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useWorkflowStore, type ZitConfig } from '../hooks/useWorkflowStore.js';
import { type LoraSlot } from '../services/sessionService.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useAutoLoopStore, waitPromptComplete } from '../hooks/useAutoLoopStore.js';
import { ChevronRight, ChevronDown, Loader, BookText, Hash, AlignLeft, Wand2, Loader2, AlertTriangle, Plus, Trash2, Square } from 'lucide-react';
import PromptContextMenu from './PromptContextMenu';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { ModelSelect, useModelFavorites } from './ModelSelect.js';
import { useModelMetadata } from '../hooks/useModelMetadata.js';
import { showToast } from '../hooks/useToast.js';
import { callPromptAssistant } from '../services/api.js';
import {
  ZIT_WARMUP_DEFAULT_SYSTEM,
  ZIT_WARMUP_DEFAULT_USER,
  ZIT_WARMUP_SYSTEM_KEY,
  ZIT_WARMUP_USER_KEY,
  ZIT_CHAT_DEFAULT_SYSTEM,
  ZIT_CHAT_DEFAULT_USER,
  ZIT_CHAT_SYSTEM_KEY,
  ZIT_CHAT_USER_KEY,
  ZIT_WARMUP_HOT_DEFAULT_SYSTEM,
  ZIT_WARMUP_HOT_DEFAULT_USER,
  ZIT_WARMUP_HOT_SYSTEM_KEY,
  ZIT_WARMUP_HOT_USER_KEY,
  ZIT_CONFIG_DEFAULT_SYSTEM,
  ZIT_CONFIG_SYSTEM_KEY,
  ZIT_SMARTQA_DEFAULT_SYSTEM,
  ZIT_SMARTQA_SYSTEM_KEY,
  ZIT_FOLLOWUP_AGENT_DEFAULT_SYSTEM,
  ZIT_FOLLOWUP_AGENT_DEFAULT_USER,
  ZIT_FOLLOWUP_AGENT_SYSTEM_KEY,
  ZIT_FOLLOWUP_AGENT_USER_KEY,
  ZIT_FOLLOWUP_CONFIG_DEFAULT_SYSTEM,
  ZIT_FOLLOWUP_CONFIG_DEFAULT_USER,
  ZIT_FOLLOWUP_CONFIG_SYSTEM_KEY,
  ZIT_FOLLOWUP_CONFIG_USER_KEY,
} from '../data/zitWarmupPrompts.js';

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

const DRAFT_KEY = 'zit_draft';
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

export function ZITSidebar({ width }: { width?: number }) {
  const clientId    = useWorkflowStore((s) => s.clientId);
  const sessionId   = useWorkflowStore((s) => s.sessionId);
  const startTask   = useWorkflowStore((s) => s.startTask);
  const addZitCard  = useWorkflowStore((s) => s.addZitCard);
  const setFlashingImage = useWorkflowStore((s) => s.setFlashingImage);
  const { sendMessage } = useWebSocket();

  // 任务执行模式（手动/自动循环）与循环状态
  const taskExecutionMode = useSettingsStore((s) => s.taskExecutionMode);
  const loopActive = useAutoLoopStore((s) => s.active);
  const loopTabId = useAutoLoopStore((s) => s.tabId);
  const isMyLoop = loopActive && loopTabId === 9;

  // UNet model list
  const [unetModels, setUnetModels]         = useState<string[]>([]);
  const [unetLoading, setUnetLoading]       = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setUnetLoading(true);
    fetch('/api/workflow/models/unets')
      .then((r) => r.json())
      .then((data: string[]) => setUnetModels(data))
      .catch(() => {})
      .finally(() => setUnetLoading(false));
  }, [clientId]);

  // LoRA model list
  const [loraModels, setLoraModels]         = useState<string[]>([]);
  const [loraListLoading, setLoraListLoading] = useState(false);

  // Model favorites
  const { favorites: unetFavorites, toggleFavorite: toggleUnetFavorite } = useModelFavorites('unets');
  const { favorites: loraFavorites, toggleFavorite: toggleLoraFavorite } = useModelFavorites('loras');
  const { metadata, uploadThumbnail, setNickname, setTriggerWords, getThumbnailUrl, getTriggerWords, getNickname, setCategory, deleteCategory, updateMetadataFields, getRecommendedStrength } = useModelMetadata();

  useEffect(() => {
    if (!clientId) return;
    setLoraListLoading(true);
    fetch('/api/workflow/models/loras')
      .then((r) => r.json())
      .then((data: string[]) => setLoraModels(data))
      .catch(() => {})
      .finally(() => setLoraListLoading(false));
  }, [clientId]);

  // Config state — initialised from localStorage draft
  const [unetModel,   setUnetModel]   = useState(() => readDraft().unetModel   ?? '');
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
    if (window.confirm('确定删除此 LoRA？')) {
      setLoras(prev => prev.filter((_, i) => i !== index));
    }
  };
  const [shiftEnabled,  setShiftEnabled]  = useState(() => readDraft().shiftEnabled  ?? false);
  const [shift,         setShift]         = useState(() => readDraft().shift         ?? 3);
  const [prompt,        setPrompt]        = useState(() => readDraft().prompt        ?? '');
  const [ratio,       setRatio]       = useState(() => readDraft().ratio       ?? '3:4');
  const [customWidth, setCustomWidth] = useState<number>(() => readDraft().width ?? 832);
  const [customHeight, setCustomHeight] = useState<number>(() => readDraft().height ?? 1216);
  const [steps,       setSteps]       = useState(() => readDraft().steps       ?? 9);
  const [cfg,         setCfg]         = useState(() => readDraft().cfg         ?? 1);
  const [sampler,     setSampler]     = useState(() => readDraft().sampler     ?? 'euler');
  const [scheduler,   setScheduler]   = useState(() => readDraft().scheduler   ?? 'simple');
  const [customName,  setCustomName]  = useState(() => readDraft().customName  ?? '');
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [batchCount,  setBatchCount]  = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── 暖场建议 prompt 调试（仅 ZIT cold-start 使用） ───────────────────────
  const [warmupDebugOpen, setWarmupDebugOpen] = useState(true);
  const [warmupSystem, setWarmupSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_WARMUP_SYSTEM_KEY) ?? ZIT_WARMUP_DEFAULT_SYSTEM; }
    catch { return ZIT_WARMUP_DEFAULT_SYSTEM; }
  });
  const [warmupUser, setWarmupUser] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_WARMUP_USER_KEY) ?? ZIT_WARMUP_DEFAULT_USER; }
    catch { return ZIT_WARMUP_DEFAULT_USER; }
  });
  useEffect(() => {
    try { localStorage.setItem(ZIT_WARMUP_SYSTEM_KEY, warmupSystem); } catch {}
  }, [warmupSystem]);
  useEffect(() => {
    try { localStorage.setItem(ZIT_WARMUP_USER_KEY, warmupUser); } catch {}
  }, [warmupUser]);
  const resetWarmupPrompts = () => {
    if (!window.confirm('恢复 System / User Prompt 为默认值？当前内容会被覆盖。')) return;
    setWarmupSystem(ZIT_WARMUP_DEFAULT_SYSTEM);
    setWarmupUser(ZIT_WARMUP_DEFAULT_USER);
  };

  // ── AI 对话主流程 prompt 调试（点击暖场建议 / 用户消息发送时使用） ───────────
  const [chatDebugOpen, setChatDebugOpen] = useState(false);
  const [chatSystem, setChatSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_CHAT_SYSTEM_KEY) ?? ZIT_CHAT_DEFAULT_SYSTEM; }
    catch { return ZIT_CHAT_DEFAULT_SYSTEM; }
  });
  const [chatUser, setChatUser] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_CHAT_USER_KEY) ?? ZIT_CHAT_DEFAULT_USER; }
    catch { return ZIT_CHAT_DEFAULT_USER; }
  });
  useEffect(() => {
    try { localStorage.setItem(ZIT_CHAT_SYSTEM_KEY, chatSystem); } catch {}
  }, [chatSystem]);
  useEffect(() => {
    try { localStorage.setItem(ZIT_CHAT_USER_KEY, chatUser); } catch {}
  }, [chatUser]);
  const resetChatPrompts = () => {
    if (!window.confirm('恢复 AI 对话 System / User Prompt 为默认值？当前内容会被覆盖。')) return;
    setChatSystem(ZIT_CHAT_DEFAULT_SYSTEM);
    setChatUser(ZIT_CHAT_DEFAULT_USER);
  };

  // ── 暖场建议 warm/hot 阶段 prompt 调试（画像数据足够时使用） ──────────────
  const [warmupHotDebugOpen, setWarmupHotDebugOpen] = useState(false);
  const [warmupHotSystem, setWarmupHotSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_WARMUP_HOT_SYSTEM_KEY) ?? ZIT_WARMUP_HOT_DEFAULT_SYSTEM; }
    catch { return ZIT_WARMUP_HOT_DEFAULT_SYSTEM; }
  });
  const [warmupHotUser, setWarmupHotUser] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_WARMUP_HOT_USER_KEY) ?? ZIT_WARMUP_HOT_DEFAULT_USER; }
    catch { return ZIT_WARMUP_HOT_DEFAULT_USER; }
  });
  useEffect(() => { try { localStorage.setItem(ZIT_WARMUP_HOT_SYSTEM_KEY, warmupHotSystem); } catch {} }, [warmupHotSystem]);
  useEffect(() => { try { localStorage.setItem(ZIT_WARMUP_HOT_USER_KEY, warmupHotUser); } catch {} }, [warmupHotUser]);
  const resetWarmupHotPrompts = () => {
    if (!window.confirm('恢复 warm/hot 暖场 Prompt 为默认值？')) return;
    setWarmupHotSystem(ZIT_WARMUP_HOT_DEFAULT_SYSTEM);
    setWarmupHotUser(ZIT_WARMUP_HOT_DEFAULT_USER);
  };

  // ── 配置助理 system prompt 调试 ─────────────────────────────────────────
  const [configDebugOpen, setConfigDebugOpen] = useState(false);
  const [configSystem, setConfigSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_CONFIG_SYSTEM_KEY) ?? ZIT_CONFIG_DEFAULT_SYSTEM; }
    catch { return ZIT_CONFIG_DEFAULT_SYSTEM; }
  });
  useEffect(() => { try { localStorage.setItem(ZIT_CONFIG_SYSTEM_KEY, configSystem); } catch {} }, [configSystem]);
  const resetConfigPrompt = () => {
    if (!window.confirm('恢复配置助理 System Prompt 为默认值？')) return;
    setConfigSystem(ZIT_CONFIG_DEFAULT_SYSTEM);
  };

  // ── 智能问答 system prompt 调试 ─────────────────────────────────────────
  const [smartQADebugOpen, setSmartQADebugOpen] = useState(false);
  const [smartQASystem, setSmartQASystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_SMARTQA_SYSTEM_KEY) ?? ZIT_SMARTQA_DEFAULT_SYSTEM; }
    catch { return ZIT_SMARTQA_DEFAULT_SYSTEM; }
  });
  useEffect(() => { try { localStorage.setItem(ZIT_SMARTQA_SYSTEM_KEY, smartQASystem); } catch {} }, [smartQASystem]);
  const resetSmartQAPrompt = () => {
    if (!window.confirm('恢复智能问答 System Prompt 为默认值？')) return;
    setSmartQASystem(ZIT_SMARTQA_DEFAULT_SYSTEM);
  };

  // ── 智能体跟进建议 prompt 调试 ──────────────────────────────────────────
  const [followupAgentDebugOpen, setFollowupAgentDebugOpen] = useState(false);
  const [followupAgentSystem, setFollowupAgentSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_FOLLOWUP_AGENT_SYSTEM_KEY) ?? ZIT_FOLLOWUP_AGENT_DEFAULT_SYSTEM; }
    catch { return ZIT_FOLLOWUP_AGENT_DEFAULT_SYSTEM; }
  });
  const [followupAgentUser, setFollowupAgentUser] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_FOLLOWUP_AGENT_USER_KEY) ?? ZIT_FOLLOWUP_AGENT_DEFAULT_USER; }
    catch { return ZIT_FOLLOWUP_AGENT_DEFAULT_USER; }
  });
  useEffect(() => { try { localStorage.setItem(ZIT_FOLLOWUP_AGENT_SYSTEM_KEY, followupAgentSystem); } catch {} }, [followupAgentSystem]);
  useEffect(() => { try { localStorage.setItem(ZIT_FOLLOWUP_AGENT_USER_KEY, followupAgentUser); } catch {} }, [followupAgentUser]);
  const resetFollowupAgentPrompts = () => {
    if (!window.confirm('恢复智能体跟进建议 Prompt 为默认值？')) return;
    setFollowupAgentSystem(ZIT_FOLLOWUP_AGENT_DEFAULT_SYSTEM);
    setFollowupAgentUser(ZIT_FOLLOWUP_AGENT_DEFAULT_USER);
  };

  // ── 配置助理跟进建议 prompt 调试 ────────────────────────────────────────
  const [followupConfigDebugOpen, setFollowupConfigDebugOpen] = useState(false);
  const [followupConfigSystem, setFollowupConfigSystem] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_FOLLOWUP_CONFIG_SYSTEM_KEY) ?? ZIT_FOLLOWUP_CONFIG_DEFAULT_SYSTEM; }
    catch { return ZIT_FOLLOWUP_CONFIG_DEFAULT_SYSTEM; }
  });
  const [followupConfigUser, setFollowupConfigUser] = useState<string>(() => {
    try { return localStorage.getItem(ZIT_FOLLOWUP_CONFIG_USER_KEY) ?? ZIT_FOLLOWUP_CONFIG_DEFAULT_USER; }
    catch { return ZIT_FOLLOWUP_CONFIG_DEFAULT_USER; }
  });
  useEffect(() => { try { localStorage.setItem(ZIT_FOLLOWUP_CONFIG_SYSTEM_KEY, followupConfigSystem); } catch {} }, [followupConfigSystem]);
  useEffect(() => { try { localStorage.setItem(ZIT_FOLLOWUP_CONFIG_USER_KEY, followupConfigUser); } catch {} }, [followupConfigUser]);
  const resetFollowupConfigPrompts = () => {
    if (!window.confirm('恢复配置助理跟进建议 Prompt 为默认值？')) return;
    setFollowupConfigSystem(ZIT_FOLLOWUP_CONFIG_DEFAULT_SYSTEM);
    setFollowupConfigUser(ZIT_FOLLOWUP_CONFIG_DEFAULT_USER);
  };

  const [promptFocused, setPromptFocused] = useState(false);
  const [promptBtnHovered, setPromptBtnHovered] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    // 最优先：阻止默认行为和事件冒泡
    e.preventDefault();
    e.stopPropagation();
    
    // 重置拖拽状态
    dragDepthRef.current = 0;
    setIsDragOverConfig(false);

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (!imageId) return;
    const config = useWorkflowStore.getState().tabData[9]?.zitConfigs?.[imageId];
    if (!config) {
      showToast('该卡片没有可用的生成配置');
      return;
    }
    console.log('[ZIT Drop] applying config');
    applyConfigToSidebar(config);
    showToast('已应用卡片配置');
  }, [applyConfigToSidebar]);

  // Listen for pendingApplyConfig from useWorkflowStore
  const pendingApplyConfig = useWorkflowStore((s) => s.pendingApplyConfig);
  const clearPendingApplyConfig = useWorkflowStore((s) => s.clearPendingApplyConfig);
  useEffect(() => {
    if (!pendingApplyConfig) return;
    // Only apply if it's a ZitConfig (has 'unetModel' field)
    const cfg_ = pendingApplyConfig as any;
    if (!cfg_.unetModel && cfg_.model) return; // Text2Img config, skip

    const c = pendingApplyConfig as ZitConfig;

    // 增量更新：只更新配置中存在的字段
    if (c.unetModel !== undefined) setUnetModel(c.unetModel);
    if (c.loras !== undefined) setLoras(c.loras);
    if (c.prompt !== undefined) setPrompt(c.prompt);
    if (c.shiftEnabled !== undefined) setShiftEnabled(c.shiftEnabled);
    if (c.shift !== undefined) setShift(c.shift);
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

    clearPendingApplyConfig();
  }, [pendingApplyConfig, clearPendingApplyConfig]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      unetModel, loras, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName, width: customWidth, height: customHeight,
    }));
  }, [unetModel, loras, shiftEnabled, shift, prompt, ratio, steps, cfg, sampler, scheduler, customName, customWidth, customHeight]);

  // 全局 dragend 防御：确保拖拽结束后清除覆盖层
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      dragDepthRef.current = 0;
      setIsDragOverConfig(false);
    };
    document.addEventListener('dragend', handleGlobalDragEnd);
    return () => document.removeEventListener('dragend', handleGlobalDragEnd);
  }, []);

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

  const selectedPreset = RATIO_PRESETS.find((p) => p.label === ratio);

  const handleGenerate = useCallback(async () => {
    if (!clientId || isGenerating) return;

    // 跨 Tab 拦截守卫：当前若有其它 Tab 的循环在跑，先询问用户
    const guarded = await useAutoLoopStore.getState().guardBeforeSubmit(9);
    if (!guarded) return;

    const config: ZitConfig = {
      unetModel: unetModel || (unetModels[0] ?? ''),
      loras,
      shiftEnabled,
      shift,
      prompt,
      width:     selectedPreset ? selectedPreset.width : customWidth,
      height:    selectedPreset ? selectedPreset.height : customHeight,
      steps,
      cfg,
      sampler,
      scheduler,
    };

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const baseName = customName.trim() || `zit_${ts}`;
    const isLoop = taskExecutionMode === 'autoLoop';
    const manualCount = Math.min(32, Math.max(1, batchCount));

    if (isLoop) {
      useAutoLoopStore.getState().startLoop(9, 'normal');
    }

    setIsGenerating(true);
    try {
      let i = 0;
      while (isLoop ? useAutoLoopStore.getState().active : i < manualCount) {
        const itemName = (!isLoop && manualCount === 1) ? baseName : `${baseName}_${i + 1}`;
        const imageId = addZitCard(config, itemName);
        setFlashingImage(imageId);
        startTask(imageId, '');
        let submittedPromptId: string | null = null;
        try {
          const res = await fetch('/api/workflow/9/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...config, name: itemName }),
          });
          if (!res.ok) {
            console.error('[ZIT] Execute failed:', await res.text());
            if (isLoop) break;
            i++;
            continue;
          }
          const data = await res.json() as { promptId: string };
          submittedPromptId = data.promptId;
          startTask(imageId, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 9, sessionId, tabId: 9 });
        } catch (err) {
          console.error('[ZIT] Execute error:', err);
          if (isLoop) break;
          i++;
          continue;
        }
        // 自动循环：等当前任务结束再投下一单
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
  }, [clientId, isGenerating, unetModel, unetModels, loras, loraModels, shiftEnabled, shift, prompt, selectedPreset, customWidth, customHeight, steps, cfg, sampler, scheduler, customName, batchCount, taskExecutionMode, addZitCard, startTask, sendMessage, sessionId, setFlashingImage]);

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

  // 通用 debug 卡片渲染器（折叠 + system 必填 + user 可选 + 恢复默认）
  const renderDebugCard = (opts: {
    emoji: string; title: string; subtitle: string; bg: string;
    open: boolean; onToggle: () => void;
    onReset: () => void;
    systemValue: string; onSystemChange: (v: string) => void; systemMinHeight?: number;
    userValue?: string; onUserChange?: (v: string) => void; userLabel?: string; userMinHeight?: number;
    hint?: React.ReactNode;
  }) => (
    <div style={{ ...cardStyle, paddingTop: 0, paddingBottom: 16, marginBottom: 12, border: '1px dashed var(--color-border)', borderRadius: 6, padding: 10, background: opts.bg }}>
      <div onClick={opts.onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', marginBottom: opts.open ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          {opts.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{opts.emoji} {opts.title}</span>
          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>{opts.subtitle}</span>
        </div>
        {opts.open && (
          <button type="button" onClick={(e) => { e.stopPropagation(); opts.onReset(); }} style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            恢复默认
          </button>
        )}
      </div>
      {opts.open && (
        <>
          {opts.hint && <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>{opts.hint}</div>}
          <div style={{ marginBottom: opts.userValue !== undefined ? 8 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>System Prompt</div>
            <textarea value={opts.systemValue} onChange={(e) => opts.onSystemChange(e.target.value)} spellCheck={false} style={{ width: '100%', minHeight: opts.systemMinHeight ?? 120, resize: 'vertical', fontSize: 11, fontFamily: 'Menlo, Consolas, monospace', padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', lineHeight: 1.5, boxSizing: 'border-box' }} />
          </div>
          {opts.userValue !== undefined && opts.onUserChange && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{opts.userLabel ?? 'User Template'}</div>
              <textarea value={opts.userValue} onChange={(e) => opts.onUserChange!(e.target.value)} spellCheck={false} style={{ width: '100%', minHeight: opts.userMinHeight ?? 120, resize: 'vertical', fontSize: 11, fontFamily: 'Menlo, Consolas, monospace', padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', lineHeight: 1.5, boxSizing: 'border-box' }} />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      className="sidebar-panel"
      onDragEnter={handleConfigDragEnter}
      onDragOver={handleConfigDragOver}
      onDragLeave={handleConfigDragLeave}
      onDrop={handleConfigDrop}
      onDragEnd={() => { dragDepthRef.current = 0; setIsDragOverConfig(false); }}
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

        {/* ── 🛠 暖场建议 Prompt 调试区（仅 ZIT cold-start 生效） ────────────── */}
        <div style={{
          ...cardStyle,
          paddingTop: 0,
          paddingBottom: 16,
          marginBottom: 12,
          border: '1px dashed var(--color-border)',
          borderRadius: 6,
          padding: 10,
          background: 'rgba(255, 200, 0, 0.04)',
        }}>
          <div
            onClick={() => setWarmupDebugOpen(o => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: warmupDebugOpen ? 8 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              {warmupDebugOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>🛠 暖场建议 Prompt 调试</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                ZIT cold-start
              </span>
            </div>
            {warmupDebugOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); resetWarmupPrompts(); }}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                恢复默认
              </button>
            )}
          </div>
          {warmupDebugOpen && (
            <>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>
                编辑后立即持久化到本地存储。仅当 AI Chat 处于 ZIT 模式且画像数据不足（cold）时，作为暖场建议的 LLM 提示词使用。
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>System Prompt</div>
                <textarea
                  value={warmupSystem}
                  onChange={(e) => setWarmupSystem(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 80,
                    resize: 'vertical',
                    fontSize: 11,
                    fontFamily: 'Menlo, Consolas, monospace',
                    padding: 6,
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>User Prompt</div>
                <textarea
                  value={warmupUser}
                  onChange={(e) => setWarmupUser(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 200,
                    resize: 'vertical',
                    fontSize: 11,
                    fontFamily: 'Menlo, Consolas, monospace',
                    padding: 6,
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* ── 💬 AI 对话主流程 Prompt 调试区（ZIT mode='agent' 生效） ────────── */}
        <div style={{
          ...cardStyle,
          paddingTop: 0,
          paddingBottom: 16,
          marginBottom: 12,
          border: '1px dashed var(--color-border)',
          borderRadius: 6,
          padding: 10,
          background: 'rgba(80, 160, 255, 0.05)',
        }}>
          <div
            onClick={() => setChatDebugOpen(o => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: chatDebugOpen ? 8 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              {chatDebugOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>💬 AI 对话 Prompt 调试</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                ZIT chat
              </span>
            </div>
            {chatDebugOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); resetChatPrompts(); }}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                恢复默认
              </button>
            )}
          </div>
          {chatDebugOpen && (
            <>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>
                编辑后立即持久化。点击暖场建议或在 ZIT 模式下发送消息时，此处的 prompt 会替代后端默认 buildSystemPrompt。
                <br />User 模板支持 <code style={{ background: 'var(--color-bg-secondary, rgba(0,0,0,0.06))', padding: '0 3px', borderRadius: 2 }}>{'{{message}}'}</code> 占位符（用户实际消息）和 <code style={{ background: 'var(--color-bg-secondary, rgba(0,0,0,0.06))', padding: '0 3px', borderRadius: 2 }}>{'{{profile}}'}</code> 占位符（用户画像摘要，仅 system 用）。
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>System Prompt</div>
                <textarea
                  value={chatSystem}
                  onChange={(e) => setChatSystem(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 220,
                    resize: 'vertical',
                    fontSize: 11,
                    fontFamily: 'Menlo, Consolas, monospace',
                    padding: 6,
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>User Template</div>
                <textarea
                  value={chatUser}
                  onChange={(e) => setChatUser(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 60,
                    resize: 'vertical',
                    fontSize: 11,
                    fontFamily: 'Menlo, Consolas, monospace',
                    padding: 6,
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* ── 🔥 暖场建议 warm/hot Prompt 调试 ──────────────────────────────── */}
        {renderDebugCard({
          emoji: '🔥',
          title: '暖场建议 warm/hot Prompt 调试',
          subtitle: 'ZIT warm/hot',
          bg: 'rgba(255, 120, 80, 0.05)',
          open: warmupHotDebugOpen,
          onToggle: () => setWarmupHotDebugOpen(o => !o),
          onReset: resetWarmupHotPrompts,
          systemValue: warmupHotSystem,
          onSystemChange: setWarmupHotSystem,
          systemMinHeight: 60,
          userValue: warmupHotUser,
          onUserChange: setWarmupHotUser,
          userLabel: 'User Template',
          userMinHeight: 200,
          hint: <>当 ZIT 用户画像处于 <b>warm/hot</b>（已有足够生图历史）时，作为暖场建议的 LLM 提示词。User 模板支持 <code>{'{{profile}}'}</code> 占位符。</>,
        })}

        {/* ── ⚙ 配置助理 System Prompt 调试 ────────────────────────────── */}
        {renderDebugCard({
          emoji: '⚙',
          title: '配置助理 Prompt 调试',
          subtitle: 'ZIT config_assistant',
          bg: 'rgba(120, 200, 120, 0.05)',
          open: configDebugOpen,
          onToggle: () => setConfigDebugOpen(o => !o),
          onReset: resetConfigPrompt,
          systemValue: configSystem,
          onSystemChange: setConfigSystem,
          systemMinHeight: 240,
          hint: <>ZIT 配置助理模式下使用。System 内支持 <code>{'{{profile}}'}</code> 与 <code>{'{{currentConfig}}'}</code> 占位符（在后端运行时替换为画像摘要 / 当前 sidebar 配置 JSON）。</>,
        })}

        {/* ── ❓ 智能问答 System Prompt 调试 ────────────────────────────── */}
        {renderDebugCard({
          emoji: '❓',
          title: '智能问答 Prompt 调试',
          subtitle: 'ZIT smart_qa',
          bg: 'rgba(150, 150, 220, 0.05)',
          open: smartQADebugOpen,
          onToggle: () => setSmartQADebugOpen(o => !o),
          onReset: resetSmartQAPrompt,
          systemValue: smartQASystem,
          onSystemChange: setSmartQASystem,
          systemMinHeight: 200,
          hint: <>ZIT 智能问答模式下使用，仅 system 一段，不需要 user 模板（用户消息直接作为 user message 传入）。</>,
        })}

        {/* ── 🤖 智能体跟进建议 Prompt 调试 ─────────────────────────────── */}
        {renderDebugCard({
          emoji: '🤖',
          title: '智能体跟进建议 Prompt 调试',
          subtitle: 'ZIT follow-up agent',
          bg: 'rgba(80, 180, 200, 0.05)',
          open: followupAgentDebugOpen,
          onToggle: () => setFollowupAgentDebugOpen(o => !o),
          onReset: resetFollowupAgentPrompts,
          systemValue: followupAgentSystem,
          onSystemChange: setFollowupAgentSystem,
          systemMinHeight: 60,
          userValue: followupAgentUser,
          onUserChange: setFollowupAgentUser,
          userLabel: 'User Template',
          userMinHeight: 220,
          hint: <>ZIT 智能体生图后，调用 LLM 推荐 4 条"下一步"建议时使用。User 模板支持 <code>{'{{profile}}'}</code>、<code>{'{{currentPrompt}}'}</code> 占位符。</>,
        })}

        {/* ── 🛠 配置助理跟进建议 Prompt 调试 ──────────────────────────── */}
        {renderDebugCard({
          emoji: '🛠',
          title: '配置助理跟进建议 Prompt 调试',
          subtitle: 'ZIT follow-up config',
          bg: 'rgba(200, 160, 100, 0.05)',
          open: followupConfigDebugOpen,
          onToggle: () => setFollowupConfigDebugOpen(o => !o),
          onReset: resetFollowupConfigPrompts,
          systemValue: followupConfigSystem,
          onSystemChange: setFollowupConfigSystem,
          systemMinHeight: 60,
          userValue: followupConfigUser,
          onUserChange: setFollowupConfigUser,
          userLabel: 'User Template',
          userMinHeight: 220,
          hint: <>ZIT 配置助理调整参数后，调用 LLM 推荐后续创意方向时使用。User 模板支持 <code>{'{{profile}}'}</code>、<code>{'{{currentPrompt}}'}</code> 占位符。</>,
        })}

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
            isLora={false}
            onUpdateMetadata={updateMetadataFields}
          />
        </div>

        <div style={dividerStyle} />

        {/* LoRA collapsible sections */}
        <div style={{ ...cardStyle, paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...sectionLabelStyle, marginBottom: 0 }}>LoRA</div>
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

              {/* Shift (AuraFlow) sub-section — using LoRA-style toggle */}
              <div style={{ marginTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: shiftEnabled ? 10 : 0,
                  }}
                >
                  {/* Toggle Switch */}
                  <div
                    onClick={() => setShiftEnabled((v: boolean) => !v)}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: shiftEnabled ? 'var(--color-primary, #4a9eff)' : 'rgba(128,128,128,0.3)',
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
                        left: shiftEnabled ? 18 : 2,
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
                    采样算法偏移
                  </span>
                </div>
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
          {isMyLoop ? (
            <button
              onClick={() => useAutoLoopStore.getState().stopLoop()}
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
                {taskExecutionMode === 'autoLoop' ? '开始循环' : '生成'}
              </button>
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
