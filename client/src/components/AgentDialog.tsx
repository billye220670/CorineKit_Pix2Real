import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Paperclip, X, AlertCircle, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { useAgentStore, type ChatMessage } from '../hooks/useAgentStore.js';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

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

  const { sendMessage: wsSendMessage } = useWebSocket();

  const [text, setText] = useState('');
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

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking the FAB button
      if (target.closest('button[style*="border-radius: 50%"]')) return;
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        handleClose();
      }
    };
    // Use setTimeout to avoid the current click event
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Reusable warm-up suggestions fetch
  const fetchWarmUpSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const sessionId = useWorkflowStore.getState().sessionId;
      const res = await fetch(`/api/agent/suggestions?sessionId=${sessionId || 'default'}`);
      const data = await res.json();
      setWarmUpSuggestions(data.suggestions || []);
    } catch {
      setWarmUpSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Fetch warm-up suggestions when dialog opens with no messages
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      fetchWarmUpSuggestions();
    }
  }, [isOpen, messages.length]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closeDialog();
    }, 180);
  }, [closeDialog]);

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
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.type === 'tool_call') {
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

  const refreshFollowUpSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const sessionId = useWorkflowStore.getState().sessionId;
      const res = await fetch(`/api/agent/suggestions?sessionId=${sessionId || 'default'}`);
      const data = await res.json();
      setFollowUpSuggestions(data.suggestions || []);
    } catch {
      setFollowUpSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

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
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleImageFile);
  }, [handleImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
            <div key={img.id} style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
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
      <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 12px' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder="输入你的需求..."
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
          <button
            onClick={() => fileInputRef.current?.click()}
            title="上传图片"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
              color: 'var(--color-text-secondary)',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <Paperclip size={16} />
          </button>
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
              padding: '4px 10px',
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
            <Send size={14} />
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

function MessageBubble({ message, onRetry, isTyping, onTypingComplete, scrollRef, onNavigateToCard }: {
  message: ChatMessage;
  onRetry: (msg: ChatMessage) => void;
  isTyping?: boolean;
  onTypingComplete?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onNavigateToCard?: (tabId: number, imageId: string) => void;
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
