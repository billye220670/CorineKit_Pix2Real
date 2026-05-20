import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Paperclip, X, AlertCircle, RefreshCw, Loader2, ExternalLink, ChevronDown, Bot, Settings, MessageCircle, Check, Undo2, Sparkles, Trash2, FileText, XCircle } from 'lucide-react';
import { useAgentStore, type ChatMessage, type CardDropResult, type ChatMode, type ConfigSnapshot, type AgentTabId } from '../hooks/useAgentStore.js';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { readZitWarmupPrompts, readZitWarmupHotPrompts, readZitChatPrompts, readZitConfigPrompt, readZitSmartQAPrompt, readZitFollowupAgentPrompts, readZitFollowupConfigPrompts } from '../data/zitWarmupPrompts.js';
import { PromptDiff } from './PromptDiff.js';

/**
 * 把 useWorkflowStore.activeTab 的任意 tabId 归一到 agent 面板的 tab 范围（7 或 9）。
 * 仅 Tab 7（快速出图）和 Tab 9（ZIT快出）支持 AI 聊天，其它 tab 不打开此对话框，
 * 兜底为 7 防御性返回。
 */
function resolveAgentTab(activeTab: number | string | undefined): AgentTabId {
  return Number(activeTab) === 9 ? 9 : 7;
}

/**
 * 统一发起暖场/后续建议请求。
 * ZIT（tab9）走 POST，携带 ZITSidebar 顶部 debug 区里的 customSystemPrompt/customUserPrompt；
 * Tab7 维持 GET 不变。
 */
async function fetchAgentSuggestions(params: {
  sessionId: string;
  mode: string;
  tabId: AgentTabId;
}): Promise<string[]> {
  const { sessionId, mode, tabId } = params;
  try {
    if (tabId === 9) {
      const { system, user } = readZitWarmupPrompts();
      const { system: hotSystem, userTemplate: hotUserTemplate } = readZitWarmupHotPrompts();
      const reqBody = {
        sessionId: sessionId || 'default',
        mode,
        tabId,
        customSystemPrompt: system,
        customUserPrompt: user,
        customHotSystemPrompt: hotSystem,
        customHotUserPrompt: hotUserTemplate,
      };
      console.log('[Agent] suggestions POST →', {
        ...reqBody,
        customSystemPrompt: `<${system.length} chars>`,
        customUserPrompt: `<${user.length} chars>`,
        customHotSystemPrompt: `<${hotSystem.length} chars>`,
        customHotUserPrompt: `<${hotUserTemplate.length} chars>`,
      });
      const res = await fetch('/api/agent/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const data = await res.json();
      if (data._debug) console.log('[Agent] suggestions ← _debug:', data._debug);
      return data.suggestions || [];
    }
    const res = await fetch(
      `/api/agent/suggestions?sessionId=${sessionId || 'default'}&mode=${mode}&tabId=${tabId}`
    );
    const data = await res.json();
    if (data._debug) console.log('[Agent] suggestions ← _debug:', data._debug);
    return data.suggestions || [];
  } catch (err) {
    console.warn('[Agent] suggestions fetch failed:', err);
    return [];
  }
}

function getCurrentSidebarConfig(): { tabId: number; config: any } {
  const store = useWorkflowStore.getState();
  const activeTab = store.activeTab;
  
  if (activeTab === 9) {
    // ZIT 配置从 localStorage 读取
    try {
      const raw = JSON.parse(localStorage.getItem('zit_draft') ?? '{}');
      return { tabId: 9, config: raw };
    } catch { return { tabId: 9, config: {} }; }
  } else {
    // Text2Img 配置从 localStorage 读取
    try {
      const raw = JSON.parse(localStorage.getItem('t2i_draft') ?? '{}');
      return { tabId: 7, config: raw };
    } catch { return { tabId: 7, config: {} }; }
  }
}

const CHAT_MODES: Array<{ id: ChatMode; label: string; icon: any; description: string; placeholder: string }> = [
  { id: 'agent', label: '智能体', icon: Bot, description: '理解需求并自动生成图片', placeholder: '输入你的需求...' },
  { id: 'config_assistant', label: '配置助理', icon: Settings, description: '调整右侧面板的生成参数', placeholder: '描述你想调整的配置...' },
  { id: 'smart_qa', label: '智能问答', icon: MessageCircle, description: '回答 AI 绘图相关问题', placeholder: '问我任何问题...' },
];

export function AgentDialog({ rightOffset = 0 }: { rightOffset?: number }) {
  const isOpen = useAgentStore((s) => s.isDialogOpen);
  const closeDialog = useAgentStore((s) => s.closeDialog);
  const messages = useAgentStore((s) => s.messages);
  const addMessage = useAgentStore((s) => s.addMessage);
  const updateMessage = useAgentStore((s) => s.updateMessage);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const executionStatus = useAgentStore((s) => s.executionStatus);
  const setIsExecuting = useAgentStore((s) => s.setIsExecuting);
  const setExecutionStatus = useAgentStore((s) => s.setExecutionStatus);
  const uploadedImages = useAgentStore((s) => s.uploadedImages);
  const addUploadedImage = useAgentStore((s) => s.addUploadedImage);
  const removeUploadedImage = useAgentStore((s) => s.removeUploadedImage);
  const clearUploadedImages = useAgentStore((s) => s.clearUploadedImages);
  const agentExecution = useAgentStore((s) => s.agentExecution);
  const chatMode = useAgentStore((s) => s.chatMode);
  const setChatMode = useAgentStore((s) => s.setChatMode);
  const allowLoraModification = useAgentStore((s) => s.allowLoraModification);
  const setAllowLoraModification = useAgentStore((s) => s.setAllowLoraModification);
  const saveConfigSnapshot = useAgentStore((s) => s.saveConfigSnapshot);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  // ── 当前 agent 面板归属的 tab（7=SD 快速出图，9=ZImage ZIT快出，画像严格隔离） ──
  const workflowActiveTab = useWorkflowStore((s) => s.activeTab);
  const activeAgentTab = useAgentStore((s) => s.activeAgentTab);
  const setActiveAgentTab = useAgentStore((s) => s.setActiveAgentTab);

  // 跟随 sidebar 的 activeTab 同步 agent 面板的 tab，触发 messages/uploadedImages/chatMode 切桶
  useEffect(() => {
    setActiveAgentTab(resolveAgentTab(workflowActiveTab));
  }, [workflowActiveTab, setActiveAgentTab]);

  const { sendMessage: wsSendMessage } = useWebSocket();

  const [text, setText] = useState('');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const [closing, setClosing] = useState(false);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [warmUpSuggestions, setWarmUpSuggestions] = useState<string[]>([]);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const pendingFollowUpRef = useRef<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stop typing immediately and show full text
  const stopTyping = useCallback(() => {
    setTypingMessageId(null);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isExecuting, agentExecution?.batchOutputs?.length]);

  // 批量模式：监听 batchOutputs 变化，逐张追加结果图到同一条消息
  const batchMsgHandledCountRef = useRef<number>(0);
  useEffect(() => {
    const exec = agentExecution;
    if (!exec || !exec.batchTotal || exec.batchTotal <= 1) return;

    const outputs = exec.batchOutputs || [];
    if (outputs.length === 0 || outputs.length <= batchMsgHandledCountRef.current) return;
    batchMsgHandledCountRef.current = outputs.length;

    const batchId = exec.promptId;
    const existingMsg = messages.find(m => m.batchResultId === batchId);

    // 保存输出图片供后续工作流链式引用（逐张更新）
    useAgentStore.getState().setLastOutputImages(outputs);

    if (existingMsg) {
      // 更新现有消息的 images
      updateMessage(existingMsg.id, {
        images: outputs,
        imageIds: exec.allImageIds,
        content: `✅ 生成中... ${outputs.length}/${exec.batchTotal} 张变体`,
      });
    } else {
      // 创建新的批量图片消息
      addMessage({
        role: 'assistant',
        content: `✅ 生成中... ${outputs.length}/${exec.batchTotal} 张变体`,
        images: outputs,
        imageIds: exec.allImageIds,
        batchResultId: batchId,
        tabId: exec.tabId,
        imageId: exec.imageId,
      });
    }

    // DOM 更新后延迟触发滚动
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [agentExecution?.batchOutputs?.length]);

  // 生成完成后追加上下文消息到对话历史，并显示后续建议
  const completionHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      agentExecution?.status === 'complete' &&
      agentExecution.generationContext &&
      agentExecution.promptId &&
      completionHandledRef.current !== agentExecution.promptId
    ) {
      completionHandledRef.current = agentExecution.promptId;
      const ctx = agentExecution.generationContext;
      // 精简LoRA名称：去掉路径和.safetensors后缀，只保留名称
      const loras = ctx.loras || [];
      const loraNames = loras.length > 0
        ? loras.map(l => {
            const name = l.model.replace(/\\/g, '/').split('/').pop() || l.model;
            return name.replace(/\.safetensors$/i, '');
          }).join(', ')
        : '无';
      const shortPrompt = ctx.prompt.length > 200 ? ctx.prompt.substring(0, 200) + '...' : ctx.prompt;

      const execution = agentExecution;
      const isBatchMode = (execution.batchTotal ?? 1) > 1;

      // 隐藏的上下文消息（仅作为 LLM 上下文，UI 不显示）
      const loraInfo = loraNames !== '无' ? ` | LoRA: ${loraNames}` : '';
      const contextContent = isBatchMode
        ? `[生成完成] 共生成 ${execution.batchTotal} 张变体 | 提示词: ${shortPrompt}${loraInfo} | 有输出图片可供后续处理`
        : `[生成完成] 工作流: ${ctx.workflowName} | 提示词: ${shortPrompt} | LoRA: ${loraNames} | 有输出图片可供后续处理`;

      addMessage({
        role: 'assistant',
        content: contextContent,
        hidden: true,
      });

      if (isBatchMode) {
        // 批量模式：更新已有的批量消息为最终状态
        const outputUrls = execution.batchOutputs ?? [];
        const existingMsg = messages.find(m => m.batchResultId === execution.promptId);
        if (existingMsg && outputUrls.length > 0) {
          updateMessage(existingMsg.id, {
            images: outputUrls,
            imageIds: execution.allImageIds,
            content: `✅ 生成完成！共生成 ${outputUrls.length} 张变体`,
          });
          useAgentStore.getState().setLastOutputImages(outputUrls);
        } else if (outputUrls.length > 0) {
          // 兜底：如果没有找到已有消息（不应发生），创建新消息
          useAgentStore.getState().setLastOutputImages(outputUrls);
          addMessage({
            role: 'assistant',
            content: `✅ 生成完成！共生成 ${outputUrls.length} 张变体`,
            images: outputUrls,
            imageIds: execution.allImageIds,
            batchResultId: execution.promptId,
            tabId: execution.tabId,
            imageId: execution.imageId,
          });
        }
      } else {
        // 单次模式：原有逻辑
        const outputUrls = execution.outputs.map(o => o.url);

        if (outputUrls.length > 0) {
          useAgentStore.getState().setLastOutputImages(outputUrls);

          addMessage({
            role: 'assistant',
            content: `✅ 生成完成！共 ${outputUrls.length} 张图片`,
            images: outputUrls,
            tabId: execution.tabId,
            imageId: execution.imageId,
          });
        }
      }

      // 清除执行状态卡片（图片已在消息气泡中展示，无需重复）
      useAgentStore.getState().clearAgentExecution();
      // 重置批量消息计数
      batchMsgHandledCountRef.current = 0;

      // 生成完成后才显示后续建议
      if (pendingFollowUpRef.current.length > 0) {
        setFollowUpSuggestions(pendingFollowUpRef.current);
        pendingFollowUpRef.current = [];
      }
    }
  }, [agentExecution?.status, agentExecution?.promptId, addMessage, updateMessage]);



  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Reusable warm-up suggestions fetch
  const fetchWarmUpSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const sessionId = useWorkflowStore.getState().sessionId;
      const tabId = useAgentStore.getState().activeAgentTab;
      const suggestions = await fetchAgentSuggestions({
        sessionId: sessionId || 'default',
        mode: useAgentStore.getState().chatMode,
        tabId,
      });
      setWarmUpSuggestions(suggestions);
    } catch {
      setWarmUpSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Fetch warm-up suggestions when dialog opens with no messages (only once, reuse cache)
  useEffect(() => {
    if (isOpen && messages.length === 0 && warmUpSuggestions.length === 0 && !suggestionsLoading) {
      fetchWarmUpSuggestions();
    }
  }, [isOpen]);

  // 切换 agent tab 时：清空暖场缓存（不同 tab 画像不同，建议必须重拉）
  useEffect(() => {
    setWarmUpSuggestions([]);
    setFollowUpSuggestions([]);
    pendingFollowUpRef.current = [];
    if (isOpen && useAgentStore.getState().messages.length === 0) {
      fetchWarmUpSuggestions();
    }
  }, [activeAgentTab]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closeDialog();
    }, 180);
  }, [closeDialog]);

  const handleModeChange = useCallback((mode: ChatMode) => {
    if (mode === chatMode) {
      setModeMenuOpen(false);
      return;
    }
    setChatMode(mode);
    clearMessages();
    setWarmUpSuggestions([]);
    setFollowUpSuggestions([]);
    setModeMenuOpen(false);
    // 重新获取该模式的暖场建议
    (async () => {
      setSuggestionsLoading(true);
      try {
        const sessionId = useWorkflowStore.getState().sessionId;
        const tabId = useAgentStore.getState().activeAgentTab;
        const suggestions = await fetchAgentSuggestions({
          sessionId: sessionId || 'default',
          mode,
          tabId,
        });
        setWarmUpSuggestions(suggestions);
      } catch {
        setWarmUpSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    })();
  }, [chatMode, setChatMode, clearMessages]);

  const executeAgentIntent = useCallback(async (intent: any) => {
    const { clientId, sessionId } = useWorkflowStore.getState();
    const { setAgentExecution } = useAgentStore.getState();

    // 判断是否为图片处理工作流 (Tab 0/2/6)
    const isImageWorkflow = [0, 2, 6].includes(intent.workflowId);

    // 设置初始状态
    setAgentExecution({
      promptId: '',
      workflowId: intent.workflowId ?? 7,
      tabId: intent.workflowId ?? 7,
      imageId: '',
      status: 'preparing',
      progress: 0,
      outputs: [],
    });

    try {
      // 图片处理工作流：按优先级获取图片
      // 优先级1：用户在最新消息中上传了新图片
      // 优先级2：上一步工作流的输出图片（lastOutputImages）
      // 优先级3：历史消息中最后一条带图的 user 消息
      let imageData: string | undefined;
      let imageFilename: string | undefined;

      if (isImageWorkflow) {
        let imageDataUrl: string | null = null;

        // 优先级1：检查最新用户消息是否上传了新图片
        const agentMessages = useAgentStore.getState().messages;
        const lastUserMsg = agentMessages[agentMessages.length - 1];
        if (lastUserMsg?.role === 'user' && lastUserMsg.images?.length) {
          imageDataUrl = lastUserMsg.images[0];
        }

        // 优先级2：使用上一步的输出图片
        if (!imageDataUrl) {
          const lastOutputs = useAgentStore.getState().lastOutputImages;
          if (lastOutputs?.length) {
            // lastOutputs 是 URL 路径（如 /api/output/...），需要 fetch 转为 data URL
            try {
              const response = await fetch(lastOutputs[0]);
              const blob = await response.blob();
              imageDataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            } catch (e) {
              console.error('Failed to fetch last output image:', e);
            }
          }
        }

        // 优先级3：历史消息中最后一条带图的 user 消息（兼容旧逻辑）
        if (!imageDataUrl) {
          const lastUserMsgWithImage = [...agentMessages].reverse().find(
            m => m.role === 'user' && m.images?.length
          );
          if (lastUserMsgWithImage?.images?.[0]) {
            imageDataUrl = lastUserMsgWithImage.images[0];
          }
        }

        // 都没有 → 报错
        if (!imageDataUrl) {
          useAgentStore.getState().addMessage({
            role: 'assistant',
            content: '请先上传一张图片，或先进行一次图片生成。',
          });
          useAgentStore.getState().clearAgentExecution();
          return;
        }

        // 从 data URL 提取 base64
        const commaIdx = imageDataUrl.indexOf(',');
        if (commaIdx >= 0) {
          imageData = imageDataUrl.substring(commaIdx + 1);
        }
        imageFilename = `agent_upload_${Date.now()}.png`;
      }

      // 构建 execute 请求体
      const executeBody: Record<string, unknown> = { intent, clientId, sessionId };
      if (imageData) {
        executeBody.imageData = imageData;
        executeBody.imageFilename = imageFilename;
      }

      // 调用后端执行
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(executeBody),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Execution failed' }));
        throw new Error(err.error || 'Execution failed');
      }

      const data = await res.json();
      const { promptId, workflowId, tabId, resolvedConfig, allPromptIds, batchTotal } = data;

      // 在目标 Tab 创建卡片（先创建卡片，再切换 Tab，避免竞态）
      const store = useWorkflowStore.getState();
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const itemName = `agent_${ts}`;

      // 判断是否为批量模式（多个 promptId）
      const isBatchMode = allPromptIds && allPromptIds.length > 1;
      const idsToRegister = allPromptIds || [promptId];

      let imageId: string;
      let batchImageIds: string[] | undefined;

      if (isBatchMode && !isImageWorkflow) {
        // ── 批量模式：为每个变体创建独立卡片 ──
        const imageIds: string[] = [];
        const allConfigs = data.allResolvedConfigs || [];

        for (let i = 0; i < allPromptIds.length; i++) {
          const variantConfig = allConfigs[i] || resolvedConfig;
          const variantName = `${itemName}_v${i}`;

          let vid: string;
          if (tabId === 9) {
            vid = store.addZitCard({
              unetModel: variantConfig.unetModel,
              loras: variantConfig.loras,
              prompt: variantConfig.prompt,
              width: variantConfig.width,
              height: variantConfig.height,
              steps: variantConfig.steps,
              cfg: variantConfig.cfg,
              sampler: variantConfig.sampler,
              scheduler: variantConfig.scheduler,
              shiftEnabled: variantConfig.shiftEnabled,
              shift: variantConfig.shift,
            }, variantName);
          } else {
            vid = store.addText2ImgCard({
              model: variantConfig.model,
              loras: variantConfig.loras,
              prompt: variantConfig.prompt,
              negativePrompt: variantConfig.negativePrompt,
              width: variantConfig.width,
              height: variantConfig.height,
              steps: variantConfig.steps,
              cfg: variantConfig.cfg,
              sampler: variantConfig.sampler,
              scheduler: variantConfig.scheduler,
            }, variantName);
          }

          imageIds.push(vid);
          // 每个变体独立绑定 promptId
          store.startTaskInTab(tabId, vid, allPromptIds[i]);
        }

        // 第一张卡片用于跳转定位
        imageId = imageIds[0];
        batchImageIds = imageIds;
      } else {
        // ── 单次模式（或图片处理工作流）：现有逻辑 ──
        if (isImageWorkflow) {
          // 图片处理工作流：用之前确定的图片创建卡片
          let file: File;
          let previewUrl: string;

          if (imageData) {
            const bytes = Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'image/png' });
            file = new File([blob], `${itemName}.png`, { type: 'image/png' });
            previewUrl = URL.createObjectURL(blob);
          } else {
            const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'image/png' });
            file = new File([blob], `${itemName}.png`, { type: 'image/png' });
            previewUrl = URL.createObjectURL(blob);
          }

          imageId = `img_${Date.now()}_agent`;
          const prev = store.tabData[tabId] || { images: [], prompts: {}, tasks: {}, imagePromptMap: {}, selectedOutputIndex: {}, backPoseToggles: {}, text2imgConfigs: {}, zitConfigs: {}, faceSwapZones: {} };
          useWorkflowStore.setState((state) => ({
            tabData: {
              ...state.tabData,
              [tabId]: {
                ...prev,
                images: [...prev.images, { id: imageId, file, previewUrl, originalName: `${itemName}.png` }],
              },
            },
          }));

          if (resolvedConfig?.prompt || intent.prompt) {
            useWorkflowStore.setState((state) => {
              const tabPrev = state.tabData[tabId];
              if (!tabPrev) return state;
              return {
                tabData: {
                  ...state.tabData,
                  [tabId]: {
                    ...tabPrev,
                    prompts: { ...tabPrev.prompts, [imageId]: resolvedConfig?.prompt || intent.prompt || '' },
                  },
                },
              };
            });
          }
        } else if (tabId === 9) {
          imageId = store.addZitCard({
            unetModel: resolvedConfig.unetModel,
            loras: resolvedConfig.loras,
            prompt: resolvedConfig.prompt,
            width: resolvedConfig.width,
            height: resolvedConfig.height,
            steps: resolvedConfig.steps,
            cfg: resolvedConfig.cfg,
            sampler: resolvedConfig.sampler,
            scheduler: resolvedConfig.scheduler,
            shiftEnabled: resolvedConfig.shiftEnabled,
            shift: resolvedConfig.shift,
          }, itemName);
        } else {
          imageId = store.addText2ImgCard({
            model: resolvedConfig.model,
            loras: resolvedConfig.loras,
            prompt: resolvedConfig.prompt,
            negativePrompt: resolvedConfig.negativePrompt,
            width: resolvedConfig.width,
            height: resolvedConfig.height,
            steps: resolvedConfig.steps,
            cfg: resolvedConfig.cfg,
            sampler: resolvedConfig.sampler,
            scheduler: resolvedConfig.scheduler,
          }, itemName);
        }

        // 单次模式：绑定唯一的 promptId
        store.startTaskInTab(tabId, imageId, promptId);
      }

      // 先更新 agent execution 状态（含真实 promptId），再注册 WebSocket，
      // 避免 WS 事件到达时 promptId 仍为空导致进度匹配失败的竞态条件
      // 批量模式下收集所有卡片 ID（从上面 batch loop 中已构建的 imageIds 数组）
      const allImageIds = batchImageIds;

      useAgentStore.getState().setAgentExecution({
        promptId,
        workflowId,
        tabId,
        imageId,
        status: 'executing',
        progress: 0,
        outputs: [],
        // 批量字段
        batchTotal: batchTotal || 1,
        batchCompleted: 0,
        allPromptIds: idsToRegister,
        batchOutputs: [],
        allImageIds,
        generationContext: isImageWorkflow
          ? {
              prompt: resolvedConfig?.prompt || intent.prompt || '',
              model: '',
              loras: [],
              workflowName: intent.workflowName || resolvedConfig?.workflowName || '图片处理',
              imageName: resolvedConfig?.imageName,
            }
          : {
              prompt: resolvedConfig.prompt || intent.prompt || '',
              negativePrompt: resolvedConfig.negativePrompt,
              model: resolvedConfig.model || resolvedConfig.unetModel || '默认模型',
              loras: resolvedConfig.loras || intent.recommendedLoras || [],
              workflowName: intent.workflowName || (tabId === 9 ? 'ZIT快出' : '快速出图'),
              width: resolvedConfig.width,
              height: resolvedConfig.height,
            },
      });

      // 注册 WebSocket 进度跟踪（为每个 promptId 注册）
      for (const pid of idsToRegister) {
        wsSendMessage({ type: 'register', promptId: pid, workflowId: tabId, sessionId, tabId });
      }

    } catch (err: any) {
      useAgentStore.getState().failAgentExecution(err.message || '执行失败');
    }
  }, [wsSendMessage]);

  // 通用跳转函数：接受 tabId 和 imageId 参数，不依赖当前 agentExecution 状态
  const navigateToCard = useCallback((tabId: number, imageId: string) => {
    // 1. 关闭对话框
    handleClose();

    // 2. 切换到目标 Tab
    useWorkflowStore.getState().setActiveTab(tabId);

    // 3. 卡片闪烁高亮
    useWorkflowStore.getState().setFlashingImage(imageId);

    // 4. 滚动到卡片位置（延迟一点让 Tab 切换完成）
    setTimeout(() => {
      const card = document.querySelector(`[data-image-id="${imageId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  }, [handleClose]);

  const handleNavigateToResult = useCallback(() => {
    const exec = useAgentStore.getState().agentExecution;
    if (!exec) return;

    navigateToCard(exec.tabId, exec.imageId);

    // 清理
    useAgentStore.getState().clearAgentExecution();
  }, [navigateToCard]);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      addUploadedImage({
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        file,
      });
    };
    reader.readAsDataURL(file);
  }, [addUploadedImage]);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content && uploadedImages.length === 0) return;

    // Stop any in-progress typing effect
    stopTyping();

    // Clear all suggestions when user sends a message
    setWarmUpSuggestions([]);
    setFollowUpSuggestions([]);

    const images = uploadedImages.map((i) => i.dataUrl);
    addMessage({
      role: 'user',
      content,
      ...(images.length > 0 ? { images } : {}),
    });
    setText('');
    clearUploadedImages();
    await sendMessage(content, images.length > 0 ? images : undefined);
  }, [text, uploadedImages, addMessage, clearUploadedImages, setIsExecuting, setExecutionStatus]);

  const sendMessage = useCallback(async (content: string, images?: string[]) => {
    // 调用真实 chat API
    setIsExecuting(true);
    setExecutionStatus('正在分析您的需求...');

    try {
      const sessionId = useWorkflowStore.getState().sessionId;
      // 获取当前对话历史（不包含本次用户消息，因为后端会自动 push 当前 message）
      const currentMessages = useAgentStore.getState().messages;
      const historyMessages = currentMessages.slice(0, -1)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || 'default',
          message: content,
          messages: historyMessages,
          images,
          hasImage: !!images?.length,
          mode: useAgentStore.getState().chatMode,
          // 当前 agent 面板归属的 tab，决定后端用哪个画像（7=SD，9=ZImage 严格隔离）
          tabId: useAgentStore.getState().activeAgentTab,
          // ZIT (tab9) agent 模式：透传 ZITSidebar 调试区的自定义 system/user template + follow-up
          ...(useAgentStore.getState().activeAgentTab === 9 && useAgentStore.getState().chatMode === 'agent' ? (() => {
            const { system, userTemplate } = readZitChatPrompts();
            const { system: fuSystem, userTemplate: fuUserTemplate } = readZitFollowupAgentPrompts();
            console.log('[Agent] chat POST →', {
              tabId: 9,
              mode: 'agent',
              customChatSystemPrompt: `<${system.length} chars>`,
              customChatUserTemplate: `<${userTemplate.length} chars>`,
              customFollowupAgentSystemPrompt: `<${fuSystem.length} chars>`,
              customFollowupAgentUserPrompt: `<${fuUserTemplate.length} chars>`,
            });
            return {
              customChatSystemPrompt: system,
              customChatUserTemplate: userTemplate,
              customFollowupAgentSystemPrompt: fuSystem,
              customFollowupAgentUserPrompt: fuUserTemplate,
            };
          })() : {}),
          // ZIT (tab9) smart_qa 模式：透传自定义 system prompt
          ...(useAgentStore.getState().activeAgentTab === 9 && useAgentStore.getState().chatMode === 'smart_qa' ? (() => {
            const sys = readZitSmartQAPrompt();
            console.log('[Agent] chat POST →', {
              tabId: 9,
              mode: 'smart_qa',
              customSmartQASystemPrompt: `<${sys.length} chars>`,
            });
            return { customSmartQASystemPrompt: sys };
          })() : {}),
          // ZIT (tab9) config_assistant 模式：透传配置助理 system prompt + follow-up 模板
          ...(useAgentStore.getState().activeAgentTab === 9 && useAgentStore.getState().chatMode === 'config_assistant' ? (() => {
            const cfgSys = readZitConfigPrompt();
            const { system: fuSys, userTemplate: fuUser } = readZitFollowupConfigPrompts();
            console.log('[Agent] chat POST →', {
              tabId: 9,
              mode: 'config_assistant',
              customConfigSystemPrompt: `<${cfgSys.length} chars>`,
              customFollowupConfigSystemPrompt: `<${fuSys.length} chars>`,
              customFollowupConfigUserPrompt: `<${fuUser.length} chars>`,
            });
            return {
              customConfigSystemPrompt: cfgSys,
              customFollowupConfigSystemPrompt: fuSys,
              customFollowupConfigUserPrompt: fuUser,
            };
          })() : {}),
          ...(useAgentStore.getState().chatMode === 'config_assistant' ? {
            currentConfig: getCurrentSidebarConfig().config,
            // ZIT (tab9) 配置助理一律不改 LoRA，强制 false 进入锁定模式；其他 tab 跟随用户开关
            allowLoraModification: useAgentStore.getState().activeAgentTab === 9
              ? false
              : useAgentStore.getState().allowLoraModification,
          } : {}),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.type === 'config_change') {
        // 配置助理模式：自动应用配置变更
        const snapshotId = crypto.randomUUID();
        const { tabId, config: currentConfig } = getCurrentSidebarConfig();
        
        // 保存当前配置快照（用于还原）
        saveConfigSnapshot(snapshotId, {
          id: snapshotId,
          tabId,
          config: currentConfig,
          appliedAt: Date.now(),
        });
        
        // 合并变更到当前配置并应用
        const mergedConfig = { ...currentConfig, ...data.changes };
        useWorkflowStore.getState().applyConfigToSidebar(mergedConfig);
        // 若涉及 prompt 改动，触发侧边栏提示词输入框闪烁提示
        if (typeof data.changes?.prompt === 'string' && data.changes.prompt !== currentConfig?.prompt) {
          useWorkflowStore.getState().bumpAgentPromptEdit();
        }
        
        // 添加带 configAction 的消息
        addMessage({
          role: 'assistant',
          content: data.summary || '已应用配置变更',
          configAction: {
            changes: data.changes,
            snapshotId,
            status: 'applied',
          },
        });
        
        // 启动打字机效果
        const msgs = useAgentStore.getState().messages;
        const newMsg = msgs[msgs.length - 1];
        if (newMsg) setTypingMessageId(newMsg.id);
        
        // 显示后续建议
        if (data.suggestions?.length > 0) {
          setFollowUpSuggestions(data.suggestions);
        }
      } else if (data.type === 'lora_conflict') {
        // 配置助理模式：检测到 LoRA 冲突，展示 4 个选择按钮
        addMessage({
          role: 'assistant',
          content: data.message || '检测到当前已启用的 LoRA 与你的意图存在冲突。',
          conflictAction: {
            status: 'pending',
            conflicts: data.conflicts || [],
            userIntent: data.userIntent || '',
            proposedPrompt: data.proposedPrompt || '',
            proposedLoras: data.proposedLoras || [],
            lorasAfterRemoval: data.lorasAfterRemoval || [],
          },
        });
        const msgsC = useAgentStore.getState().messages;
        const newMsgC = msgsC[msgsC.length - 1];
        if (newMsgC) setTypingMessageId(newMsgC.id);
      } else if (data.type === 'tool_call') {
        setExecutionStatus(`正在准备 ${data.intent?.workflowName ?? '工作流'}...`);
        addMessage({
          role: 'assistant',
          content: data.message || `已解析您的需求，将使用 ${data.intent?.workflowName} 生成图片。`,
        });
        // Start typewriter for tool_call message
        const msgs1 = useAgentStore.getState().messages;
        const newMsg1 = msgs1[msgs1.length - 1];
        if (newMsg1) setTypingMessageId(newMsg1.id);
        // 存储 intent 供 Task 9 使用
        useAgentStore.getState().setLastIntent(data.intent);
        // 触发工作流执行
        executeAgentIntent(data.intent);
        // Store follow-up suggestions to show after generation completes
        if (data.suggestions?.length > 0) {
          pendingFollowUpRef.current = data.suggestions;
        } else {
          pendingFollowUpRef.current = [];
        }
      } else {
        // 纯文本回复
        addMessage({ role: 'assistant', content: data.message });
        // Start typewriter for text reply
        const msgs2 = useAgentStore.getState().messages;
        const newMsg2 = msgs2[msgs2.length - 1];
        if (newMsg2) setTypingMessageId(newMsg2.id);
      }
    } catch (err: any) {
      addMessage({
        role: 'assistant',
        content: '抱歉，当前无法处理您的请求，请检查网络连接后重试。',
        isError: true,
      });
    } finally {
      setIsExecuting(false);
      setExecutionStatus('');
    }
  }, [addMessage, setIsExecuting, setExecutionStatus]);

  const handleSuggestionClick = useCallback((text: string) => {
    setWarmUpSuggestions([]);
    setFollowUpSuggestions([]);
    // Add user message to chat
    addMessage({ role: 'user', content: text });
    sendMessage(text);
  }, [sendMessage, addMessage]);

  const handleRetry = useCallback((errorMsg: ChatMessage) => {
    const messages = useAgentStore.getState().messages;
    const errorIndex = messages.findIndex((m) => m.id === errorMsg.id);
    let lastUserMsg: ChatMessage | null = null;
    for (let i = errorIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMsg = messages[i];
        break;
      }
    }
    if (!lastUserMsg) return;

    // 移除错误消息
    useAgentStore.getState().removeMessage(errorMsg.id);

    // 重新发送
    sendMessage(lastUserMsg.content, lastUserMsg.images);
  }, [sendMessage]);

  const handleConfirmConfig = useCallback((messageId: string) => {
    updateMessage(messageId, {
      configAction: {
        ...useAgentStore.getState().messages.find(m => m.id === messageId)?.configAction!,
        status: 'reverted',
      },
    });
  }, [updateMessage]);

  const handleRevertConfig = useCallback((snapshotId: string) => {
    const snapshot = useAgentStore.getState().getConfigSnapshot(snapshotId);
    if (!snapshot) return;
    
    // 恢复配置
    useWorkflowStore.getState().applyConfigToSidebar(snapshot.config);
    
    // 更新消息状态
    const messages = useAgentStore.getState().messages;
    const msg = messages.find(m => m.configAction?.snapshotId === snapshotId);
    if (msg) {
      updateMessage(msg.id, {
        configAction: {
          ...msg.configAction!,
          status: 'reverted',
        },
      });
    }
  }, [updateMessage]);

  // 处理 LoRA 冲突的 4 种选择
  const handleResolveConflict = useCallback((
    messageId: string,
    resolution: 'modify_lora' | 'remove_conflict' | 'apply_prompt_only' | 'ignore',
  ) => {
    const msg = useAgentStore.getState().messages.find(m => m.id === messageId);
    if (!msg?.conflictAction || msg.conflictAction.status !== 'pending') return;
    const action = msg.conflictAction;

    // 忽略：仅更新状态，不改配置
    if (resolution === 'ignore') {
      updateMessage(messageId, {
        conflictAction: { ...action, status: 'ignored', resolution },
      });
      return;
    }

    // 保存当前配置快照（用于还原）
    const { tabId, config: currentConfig } = getCurrentSidebarConfig();
    const snapshotId = crypto.randomUUID();
    saveConfigSnapshot(snapshotId, {
      id: snapshotId,
      tabId,
      config: currentConfig,
      appliedAt: Date.now(),
    });

    // 根据方案构造变更
    let mergedConfig: any;
    if (resolution === 'modify_lora') {
      mergedConfig = { ...currentConfig, prompt: action.proposedPrompt, loras: action.proposedLoras };
    } else if (resolution === 'remove_conflict') {
      mergedConfig = { ...currentConfig, prompt: action.proposedPrompt, loras: action.lorasAfterRemoval };
    } else {
      // apply_prompt_only
      mergedConfig = { ...currentConfig, prompt: action.proposedPrompt };
    }

    useWorkflowStore.getState().applyConfigToSidebar(mergedConfig);
    // 若涉及 prompt 改动，触发侧边栏提示词输入框闪烁提示
    if (typeof mergedConfig.prompt === 'string' && mergedConfig.prompt !== currentConfig?.prompt) {
      useWorkflowStore.getState().bumpAgentPromptEdit();
    }

    updateMessage(messageId, {
      conflictAction: { ...action, status: 'resolved', resolution, snapshotId },
    });
  }, [updateMessage, saveConfigSnapshot]);

  const refreshFollowUpSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const sessionId = useWorkflowStore.getState().sessionId;
      const tabId = useAgentStore.getState().activeAgentTab;
      const suggestions = await fetchAgentSuggestions({
        sessionId: sessionId || 'default',
        mode: useAgentStore.getState().chatMode,
        tabId,
      });
      setFollowUpSuggestions(suggestions);
    } catch {
      setFollowUpSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const handleCardDrop = useCallback((result: CardDropResult) => {
    // 无论 text2img 还是 img2img，都把图片放到上传预览区
    if (result.imageUrl) {
      (async () => {
        try {
          const response = await fetch(result.imageUrl!);
          const blob = await response.blob();
          const file = new File([blob], `eyedropper_${Date.now()}.png`, { type: blob.type || 'image/png' });
          const reader = new FileReader();
          reader.onload = () => {
            addUploadedImage({
              id: crypto.randomUUID(),
              dataUrl: reader.result as string,
              file,
            });
          };
          reader.readAsDataURL(blob);
        } catch {
          useAgentStore.getState().setLastOutputImages([result.imageUrl!]);
        }
      })();

      useAgentStore.getState().setLastOutputImages([result.imageUrl]);
    }

    // text2img：额外添加隐藏的配置上下文消息给 LLM
    if (result.type === 'text2img' && result.config) {
      const loraInfo = result.config.loras?.map((l: any) => `${l.model}(${l.strength})`).join(', ') || '无';
      addMessage({
        role: 'assistant',
        content: `[吸取配置] 模型: ${result.config.model || '默认'} | 提示词: ${result.config.prompt} | LoRA: ${loraInfo}`,
        hidden: true,
      });
    }
  }, [addMessage, addUploadedImage]);

  const handleCardDropFromPhotoWall = useCallback((imageId: string) => {
    const store = useWorkflowStore.getState();
    const TEXT2IMG_TABS = [7, 9];

    // 找到 imageId 所属的 tabId
    let foundTabId: number | null = null;
    for (const [tabIdStr, tabInfo] of Object.entries(store.tabData)) {
      const tabId = parseInt(tabIdStr);
      if (tabInfo.images?.some((img: any) => img.id === imageId)) {
        foundTabId = tabId;
        break;
      }
    }

    // 如果找不到，使用 activeTab
    if (foundTabId === null) {
      foundTabId = store.activeTab;
    }

    const tabId = foundTabId;
    const tabInfo = store.tabData[tabId];
    if (!tabInfo) return;

    if (TEXT2IMG_TABS.includes(tabId)) {
      // 文生图：提取配置
      const configs = tabId === 9 ? tabInfo.zitConfigs : tabInfo.text2imgConfigs;
      const cardConfig = configs?.[imageId];
      const prompt = (cardConfig as any)?.prompt || tabInfo.prompts?.[imageId] || '';

      // 获取图片 URL
      const task = tabInfo.tasks?.[imageId];
      const selectedIdx = tabInfo.selectedOutputIndex?.[imageId] ?? 0;
      const outputUrl = task?.outputs?.[selectedIdx]?.url || task?.outputs?.[0]?.url;
      const img = tabInfo.images?.find((i: any) => i.id === imageId);
      const imageUrl = outputUrl || img?.previewUrl || '';

      handleCardDrop({
        type: 'text2img',
        tabId,
        imageId,
        config: {
          prompt,
          model: (cardConfig as any)?.model || (cardConfig as any)?.unetModel || '',
          loras: ((cardConfig as any)?.loras ?? []).filter((l: any) => l.enabled !== false).map((l: any) => ({ model: l.model, strength: l.strength })),
          width: (cardConfig as any)?.width,
          height: (cardConfig as any)?.height,
        },
        imageUrl,
      });
    } else {
      // 图生图：提取输出图片
      const task = tabInfo.tasks?.[imageId];
      const selectedIdx = tabInfo.selectedOutputIndex?.[imageId] ?? 0;
      const outputUrl = task?.outputs?.[selectedIdx]?.url || task?.outputs?.[0]?.url;
      const img = tabInfo.images?.find((i: any) => i.id === imageId);
      const imageUrl = outputUrl || img?.previewUrl || '';

      handleCardDrop({
        type: 'img2img',
        tabId,
        imageId,
        imageUrl,
      });
    }
  }, [handleCardDrop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) handleImageFile(file);
      }
    }
  }, [handleImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // 优先检查是否为应用内卡片拖拽
    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (imageId) {
      handleCardDropFromPhotoWall(imageId);
      return;
    }

    // 否则走文件拖入逻辑
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleImageFile);
  }, [handleImageFile, handleCardDropFromPhotoWall]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  if (!isOpen && !closing) return null;

  const animClass = closing ? 'agent-dialog-exit' : 'agent-dialog-enter';

  return (
    <div
      ref={dialogRef}
      className={animClass}
      style={{
        position: 'absolute',
        bottom: 72,
        right: 16 + rightOffset,
        width: 360,
        maxHeight: '70vh',
        minHeight: 360,
        zIndex: 100,
        borderRadius: 12,
        backgroundColor: 'var(--color-bg)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        border: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Messages area */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {messages.length === 0 && !isExecuting && warmUpSuggestions.length === 0 && !suggestionsLoading && (
          <div style={{
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            padding: '32px 16px',
            opacity: 0.6,
          }}>
            有什么可以帮你的？
          </div>
        )}
        {messages.length === 0 && (warmUpSuggestions.length > 0 || suggestionsLoading) && (
          <SuggestionsPanel
            suggestions={warmUpSuggestions}
            loading={suggestionsLoading}
            onClickSuggestion={handleSuggestionClick}
            onRefresh={fetchWarmUpSuggestions}
            title="试试这些："
          />
        )}
        {messages.filter(m => !m.hidden).map((msg, index, visibleMessages) => (
          <div key={msg.id}>
            <MessageBubble
              message={msg}
              onRetry={handleRetry}
              isTyping={!msg.isError && msg.role === 'assistant' && msg.id === typingMessageId}
              onTypingComplete={() => setTypingMessageId(null)}
              scrollRef={messagesEndRef as React.RefObject<HTMLDivElement>}
              onNavigateToCard={navigateToCard}
              onRevertConfig={handleRevertConfig}
              onConfirmConfig={handleConfirmConfig}
              onResolveConflict={handleResolveConflict}
            />
            {(followUpSuggestions.length > 0 || suggestionsLoading) && !typingMessageId && index === visibleMessages.length - 1 && msg.role === 'assistant' && !msg.isError && (
              <SuggestionsPanel
                suggestions={followUpSuggestions}
                loading={suggestionsLoading}
                onClickSuggestion={handleSuggestionClick}
                onRefresh={refreshFollowUpSuggestions}
                title="试试这些："
              />
            )}
          </div>
        ))}
        {isExecuting && (
          <div style={{
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            padding: '8px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}>
            <span>{executionStatus}</span>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-text-secondary)',
                    animation: `dot-wave 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </span>
          </div>
        )}
        {/* Agent execution progress */}
        {agentExecution && (
          <div style={{
            margin: '8px 48px 8px 8px',
            padding: '12px 16px',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: 10,
            fontSize: 13,
          }}>
            {agentExecution.status === 'preparing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd' }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>正在准备工作流...</span>
              </div>
            )}
            {agentExecution.status === 'executing' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd', marginBottom: 8 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>
                    {(agentExecution.batchTotal ?? 1) > 1
                      ? `正在生成 ${(agentExecution.batchCompleted ?? 0) + 1}/${agentExecution.batchTotal}...`
                      : `正在生成图片... ${agentExecution.progress}%`
                    }
                  </span>
                </div>
                <div style={{
                  height: 4,
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${agentExecution.progress}%`,
                    backgroundColor: '#3b82f6',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}
            {agentExecution.status === 'complete' && (
              <div>
                <div style={{ color: '#86efac', marginBottom: 8 }}>
                  已完成！生成了 {agentExecution.outputs.length} 张图片
                </div>
                <button
                  onClick={handleNavigateToResult}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                >
                  <ExternalLink size={14} />
                  前往查看
                </button>
              </div>
            )}
            {agentExecution.status === 'error' && (
              <div style={{ color: '#fca5a5' }}>
                生成失败：{agentExecution.error || '未知错误'}
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Uploaded images preview */}
      {uploadedImages.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '6px 12px',
          flexWrap: 'wrap',
          borderTop: '1px solid var(--color-border)',
        }}>
          {uploadedImages.map((img) => (
            <div key={img.id} className="image-preview-item" style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
              <img
                src={img.dataUrl}
                alt=""
                style={{
                  width: 48,
                  height: 48,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                }}
              />
              <button
                className="delete-btn"
                onClick={() => removeUploadedImage(img.id)}
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-error)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div
        style={{
          padding: '8px 12px',
          border: isDragOver ? '2px dashed #3b82f6' : undefined,
          borderTop: isDragOver ? '2px dashed #3b82f6' : '1px solid var(--color-border)',
          backgroundColor: isDragOver ? 'rgba(59, 130, 246, 0.06)' : undefined,
          transition: 'border-color 0.15s, background-color 0.15s',
        }}
        onDragLeave={handleDragLeave}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder={CHAT_MODES.find(m => m.id === chatMode)?.placeholder || '输入你的需求...'}
          rows={2}
          style={{
            width: '100%',
            resize: 'none',
            border: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            color: 'var(--color-text)',
            fontSize: 13,
            lineHeight: 1.5,
            userSelect: 'text',
          }}
        />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Mode selector dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setModeMenuOpen(!modeMenuOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  backgroundColor: modeMenuOpen ? 'var(--color-hover, rgba(255,255,255,0.08))' : 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!modeMenuOpen) e.currentTarget.style.backgroundColor = 'var(--color-hover, rgba(255,255,255,0.05))';
                }}
                onMouseLeave={(e) => {
                  if (!modeMenuOpen) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {(() => {
                  const mode = CHAT_MODES.find(m => m.id === chatMode);
                  const Icon = mode?.icon || Bot;
                  return <Icon size={14} />;
                })()}
                <span>{CHAT_MODES.find(m => m.id === chatMode)?.label}</span>
                <ChevronDown size={12} style={{ 
                  transition: 'transform 0.15s',
                  transform: modeMenuOpen ? 'rotate(180deg)' : 'none',
                }} />
              </button>
              {modeMenuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                    onClick={() => setModeMenuOpen(false)}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 4,
                    minWidth: 200,
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    zIndex: 1000,
                    overflow: 'hidden',
                  }}>
                    {CHAT_MODES.map((mode) => {
                      const Icon = mode.icon;
                      const isActive = chatMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => handleModeChange(mode.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            width: '100%',
                            padding: '10px 12px',
                            border: 'none',
                            backgroundColor: isActive ? 'var(--color-hover, rgba(255,255,255,0.08))' : 'transparent',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background-color 0.1s',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-hover, rgba(255,255,255,0.05))';
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <Icon size={16} style={{ marginTop: 2, flexShrink: 0, color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400 }}>{mode.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{mode.description}</div>
                          </div>
                          {isActive && <Check size={14} style={{ color: 'var(--color-primary)', marginTop: 2, flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {/* LoRA 修改开关 - 仅配置助理模式显示 */}
            {chatMode === 'config_assistant' && activeAgentTab !== 9 && (
              <button
                onClick={() => setAllowLoraModification(!allowLoraModification)}
                title={allowLoraModification
                  ? '已允许助理修改 LoRA 列表。点击关闭则仅修改提示词，保留当前 LoRA 配置'
                  : '当前仅修改提示词：助理不会增删 LoRA，也不会删除已启用 LoRA 的触发词'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  marginLeft: 4,
                  fontSize: 12,
                  color: allowLoraModification ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  backgroundColor: allowLoraModification
                    ? 'rgba(59, 130, 246, 0.12)'
                    : 'transparent',
                  border: `1px solid ${allowLoraModification ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <Sparkles size={12} />
                <span>修改 LoRA</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    width: 22,
                    height: 12,
                    padding: 1,
                    borderRadius: 999,
                    backgroundColor: allowLoraModification
                      ? 'var(--color-primary)'
                      : 'var(--color-border)',
                    transition: 'background-color 0.15s',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: '#fff',
                      transform: allowLoraModification ? 'translateX(10px)' : 'translateX(0)',
                      transition: 'transform 0.15s',
                    }}
                  />
                </span>
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              title="上传图片"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 8,
                color: 'var(--color-text-secondary)',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              <Paperclip size={17} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              files.forEach(handleImageFile);
              e.target.value = '';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() && uploadedImages.length === 0}
            title="发送"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 14px',
              backgroundColor: (!text.trim() && uploadedImages.length === 0)
                ? 'var(--color-border)'
                : 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: (!text.trim() && uploadedImages.length === 0) ? 'default' : 'pointer',
              transition: 'background-color 0.2s',
            }}
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TypewriterText({ text, speed = 20, onComplete, scrollRef }: {
  text: string;
  speed?: number;
  onComplete?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
}) {
  const [displayed, setDisplayed] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayed('');
    setIsTyping(true);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      // Auto-scroll every few characters
      if (i % 5 === 0 || i >= text.length) {
        scrollRef?.current?.scrollIntoView({ behavior: 'smooth' });
      }
      if (i >= text.length) {
        clearInterval(timer);
        setIsTyping(false);
        onComplete?.();
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <>
      {displayed}
      {isTyping && (
        <span style={{
          display: 'inline-block',
          width: 2,
          height: '1em',
          backgroundColor: 'currentColor',
          marginLeft: 1,
          opacity: 0.7,
          verticalAlign: 'text-bottom',
          animation: 'blink-cursor 0.8s step-end infinite',
        }} />
      )}
    </>
  );
}

function MessageBubble({ message, onRetry, isTyping, onTypingComplete, scrollRef, onNavigateToCard, onRevertConfig, onConfirmConfig, onResolveConflict }: {
  message: ChatMessage;
  onRetry: (msg: ChatMessage) => void;
  isTyping?: boolean;
  onTypingComplete?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onNavigateToCard?: (tabId: number, imageId: string) => void;
  onRevertConfig?: (snapshotId: string) => void;
  onConfirmConfig?: (messageId: string) => void;
  onResolveConflict?: (messageId: string, resolution: 'modify_lora' | 'remove_conflict' | 'apply_prompt_only' | 'ignore') => void;
}) {
  const isUser = message.role === 'user';
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // 批量模式：多张图片且有 batchResultId
  const isBatchResult = !isUser && !!message.batchResultId && (message.images?.length ?? 0) > 0;

  const bubble = (
    <div style={{
      maxWidth: '80%',
      padding: '8px 12px',
      borderRadius: 12,
      ...(isUser
        ? { borderBottomRightRadius: 4, backgroundColor: 'var(--color-primary)', color: '#fff' }
        : { borderBottomLeftRadius: 4, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }
      ),
      fontSize: 13,
      lineHeight: 1.5,
      wordBreak: 'break-word' as const,
      userSelect: 'text',
      WebkitUserSelect: 'text',
    }}>
      {/* Attached images (user uploads only) */}
      {isUser && message.images && message.images.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          {message.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              style={{
                width: 64,
                height: 64,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>
      )}
      {isTyping ? (
        <TypewriterText text={message.content} speed={20} onComplete={onTypingComplete} scrollRef={scrollRef} />
      ) : (
        message.content
      )}
      {/* 生成结果图片（assistant 消息且带 tabId/imageId） */}
      {!isUser && message.images && message.images.length > 0 && message.tabId != null && message.imageId && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {message.images.map((url, idx) => (
            <img
              key={idx}
              src={url}
              alt={`生成结果 ${idx + 1}`}
              style={{
                maxWidth: 200,
                maxHeight: 200,
                borderRadius: 8,
                cursor: 'pointer',
                objectFit: 'cover',
                border: isBatchResult && selectedImageIndex === idx
                  ? '2px solid #3b82f6'
                  : '2px solid transparent',
                transition: 'border-color 0.15s',
              }}
              onClick={() => {
                // 设为编辑目标
                useAgentStore.getState().setLastOutputImages([url]);
                setSelectedImageIndex(idx);

                if (isBatchResult) {
                  // 批量模式：用 imageIds 跳转到对应卡片
                  const targetImageId = message.imageIds?.[idx];
                  if (targetImageId && message.tabId != null) {
                    onNavigateToCard?.(message.tabId, targetImageId);
                  }
                } else {
                  // 单张模式：跳转定位
                  onNavigateToCard?.(message.tabId!, message.imageId!);
                }
              }}
              title="点击跳转到对应卡片"
            />
          ))}
        </div>
      )}
      {/* Config assistant action buttons */}
      {!isUser && message.configAction && (
        <div style={{ 
          marginTop: 8, 
          paddingTop: 8, 
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.1))' 
        }}>
          {/* 提示词标签级变化 diff */}
          <PromptDiffForMessage
            snapshotId={message.configAction.snapshotId}
            newPrompt={typeof message.configAction.changes?.prompt === 'string' ? message.configAction.changes.prompt : undefined}
          />
          <div style={{ 
            fontSize: 12, 
            color: 'var(--color-text-secondary)',
            marginBottom: 8 
          }}>
            {message.configAction.status === 'reverted' 
              ? '已还原到之前的配置' 
              : '要保留这些修改吗？'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onConfirmConfig?.(message.id)}
              disabled={message.configAction.status !== 'applied'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
                borderRadius: 6,
                cursor: message.configAction.status === 'applied' ? 'pointer' : 'default',
                backgroundColor: message.configAction.status === 'applied' 
                  ? 'var(--color-primary)' 
                  : 'var(--color-border)',
                color: '#fff',
                opacity: message.configAction.status === 'applied' ? 1 : 0.5,
                transition: 'all 0.15s',
              }}
            >
              <Check size={12} />
              {message.configAction.status === 'applied' ? '确认' : '已确认'}
            </button>
            <button
              onClick={() => onRevertConfig?.(message.configAction!.snapshotId)}
              disabled={message.configAction.status === 'reverted'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                cursor: message.configAction.status !== 'reverted' ? 'pointer' : 'default',
                backgroundColor: 'transparent',
                color: message.configAction.status !== 'reverted' 
                  ? 'var(--color-text)' 
                  : 'var(--color-text-secondary)',
                opacity: message.configAction.status !== 'reverted' ? 1 : 0.5,
                transition: 'all 0.15s',
              }}
            >
              <Undo2 size={12} />
              {message.configAction.status !== 'reverted' ? '还原' : '已还原'}
            </button>
          </div>
        </div>
      )}
      {/* LoRA 冲突决议按钮（竖排 4 个） */}
      {!isUser && message.conflictAction && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        }}>
          {/* 冲突 LoRA 清单 */}
          {message.conflictAction.conflicts.length > 0 && (
            <div style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              marginBottom: 8,
              padding: '6px 8px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              {message.conflictAction.conflicts.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 4 }}>
                  <span style={{ color: '#ef4444', flexShrink: 0 }}>⚠</span>
                  <span><strong>{c.name}</strong>：{c.reason}</span>
                </div>
              ))}
            </div>
          )}

          {message.conflictAction.status === 'pending' ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                请选择如何处理：
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { key: 'modify_lora' as const, icon: Sparkles, label: '同时修改 LoRA', desc: '移除冲突 LoRA 并启用匹配意图的 LoRA', recommended: true },
                  { key: 'remove_conflict' as const, icon: Trash2, label: '仅删除冲突的 LoRA', desc: '从 LoRA 列表中移除冲突项，应用新提示词' },
                  { key: 'apply_prompt_only' as const, icon: FileText, label: '直接应用提示词', desc: '保留所有 LoRA，仅更新提示词（可能存在画面冲突）' },
                  { key: 'ignore' as const, icon: XCircle, label: '忽略本次操作', desc: '不做任何修改' },
                ].map(({ key, icon: Icon, label, desc, recommended }) => (
                  <button
                    key={key}
                    onClick={() => onResolveConflict?.(message.id, key)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      textAlign: 'left',
                      border: recommended ? 'none' : '1px solid var(--color-border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      backgroundColor: recommended ? 'var(--color-primary)' : 'transparent',
                      color: recommended ? '#fff' : 'var(--color-text)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!recommended) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, rgba(255,255,255,0.05))';
                    }}
                    onMouseLeave={(e) => {
                      if (!recommended) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span>
                        {label}
                        {recommended && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.9 }}>（推荐）</span>}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 400 }}>{desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* 已解决：若有快照则展示提示词标签级 diff */}
              {message.conflictAction.status === 'resolved' && message.conflictAction.snapshotId && (
                <PromptDiffForMessage
                  snapshotId={message.conflictAction.snapshotId}
                  newPrompt={message.conflictAction.proposedPrompt}
                />
              )}
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {message.conflictAction.status === 'ignored'
                  ? '已忽略本次操作。'
                  : message.conflictAction.resolution === 'modify_lora'
                    ? '已同时修改 LoRA 与提示词。'
                    : message.conflictAction.resolution === 'remove_conflict'
                      ? '已删除冲突的 LoRA 并更新提示词。'
                      : '已直接应用提示词（LoRA 保持不变）。'}
                {message.conflictAction.snapshotId && (
                  <button
                    onClick={() => onRevertConfig?.(message.conflictAction!.snapshotId!)}
                    style={{
                      marginLeft: 8,
                      padding: '2px 8px',
                      fontSize: 11,
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      backgroundColor: 'transparent',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <Undo2 size={10} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                    还原
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {/* Action button */}
      {message.actionButton && (
        <div style={{ marginTop: 6 }}>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: isUser ? 'rgba(255,255,255,0.9)' : 'var(--color-primary)',
              fontSize: 12,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            {message.actionButton.label}
          </button>
        </div>
      )}
    </div>
  );

  if (message.isError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <AlertCircle size={16} style={{ color: '#ef4444', marginTop: 4, flexShrink: 0 }} />
          <div>
            {bubble}
            <button
              onClick={() => onRetry(message)}
              style={{
                marginTop: 4,
                padding: '4px 12px',
                fontSize: 12,
                color: 'var(--color-primary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-primary)',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-primary)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--color-primary)';
              }}
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      {bubble}
    </div>
  );
}

function SuggestionsPanel({
  suggestions,
  loading,
  onClickSuggestion,
  onRefresh,
  title,
}: {
  suggestions: string[];
  loading: boolean;
  onClickSuggestion: (text: string) => void;
  onRefresh: () => void;
  title?: string;
}) {
  return (
    <div style={{
      margin: '8px 0',
      padding: '12px',
      backgroundColor: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
      borderRadius: 10,
    }}>
      {title && (
        <div style={{
          fontSize: 12,
          color: 'var(--color-text-secondary, #888)',
          marginBottom: 8,
        }}>
          {title}
        </div>
      )}

      {loading ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 0',
          gap: 8,
          color: 'var(--color-text-secondary, #888)',
          fontSize: 13,
        }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span>正在生成建议...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {suggestions.map((s, i) => (
            <SuggestionButton key={i} text={s} onClick={() => onClickSuggestion(s)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            color: 'var(--color-text-secondary, #888)',
            opacity: loading ? 0.4 : 0.6,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.backgroundColor = 'var(--color-hover, rgba(255,255,255,0.05))';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = loading ? '0.4' : '0.6';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          title="刷新建议"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}

function SuggestionButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--color-text)',
        backgroundColor: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left' as const,
        transition: 'all 0.15s',
        lineHeight: 1.4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-hover, rgba(255,255,255,0.05))';
        e.currentTarget.style.borderColor = 'var(--color-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      {text}
    </button>
  );
}

/**
 * 从 configSnapshots 中读取旧 prompt，与新 prompt 做标签级 diff 并渲染
 */
function PromptDiffForMessage({ snapshotId, newPrompt }: { snapshotId: string; newPrompt?: string }) {
  const snapshot = useAgentStore((s) => s.configSnapshots[snapshotId]);
  if (typeof newPrompt !== 'string') return null;
  const oldPrompt = typeof snapshot?.config?.prompt === 'string' ? snapshot.config.prompt : '';
  return <PromptDiff oldPrompt={oldPrompt} newPrompt={newPrompt} />;
}
