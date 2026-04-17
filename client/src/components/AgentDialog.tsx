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
  }, [messages, isExecuting]);

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

    // 设置初始状态
    setAgentExecution({
      promptId: '',
      workflowId: intent.workflowId || 7,
      tabId: intent.workflowId || 7,
      imageId: '',
      status: 'preparing',
      progress: 0,
      outputs: [],
    });

    try {
      // 调用后端执行
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, clientId, sessionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Execution failed' }));
        throw new Error(err.error || 'Execution failed');
      }

      const data = await res.json();
      const { promptId, workflowId, tabId, resolvedConfig } = data;

      // 在目标 Tab 创建卡片（不切换 activeTab，避免竞态条件导致 session 丢失数据）
      const store = useWorkflowStore.getState();
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const itemName = `agent_${ts}`;

      // addText2ImgCard / addZitCard 已硬编码写入 tab 7 / tab 9，不依赖 activeTab
      let imageId: string;
      if (tabId === 9) {
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

      // 使用 startTaskInTab 在目标 tab 下关联 promptId（不依赖 activeTab）
      store.startTaskInTab(tabId, imageId, promptId);

      // 注册 WebSocket 进度跟踪
      wsSendMessage({ type: 'register', promptId, workflowId: tabId, sessionId, tabId });

      // 更新 agent execution 状态
      useAgentStore.getState().setAgentExecution({
        promptId,
        workflowId,
        tabId,
        imageId,
        status: 'executing',
        progress: 0,
        outputs: [],
      });

    } catch (err: any) {
      useAgentStore.getState().failAgentExecution(err.message || '执行失败');
    }
  }, [wsSendMessage]);

  const handleNavigateToResult = useCallback(() => {
    const exec = useAgentStore.getState().agentExecution;
    if (!exec) return;

    // 1. 关闭对话框
    handleClose();

    // 2. 切换到目标 Tab
    useWorkflowStore.getState().setActiveTab(exec.tabId);

    // 3. 卡片闪烁高亮
    useWorkflowStore.getState().setFlashingImage(exec.imageId);

    // 4. 滚动到卡片位置（延迟一点让 Tab 切换完成）
    setTimeout(() => {
      const card = document.querySelector(`[data-image-id="${exec.imageId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);

    // 5. 清理
    useAgentStore.getState().clearAgentExecution();
  }, [handleClose]);

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
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || 'default',
          message: content,
          images,
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
        // Store follow-up suggestions if present
        if (data.suggestions?.length > 0) {
          setFollowUpSuggestions(data.suggestions);
        } else {
          setFollowUpSuggestions([]);
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
      }}
    >
      {/* Messages area */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
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
        {messages.map((msg, index) => (
          <div key={msg.id}>
            <MessageBubble
              message={msg}
              onRetry={handleRetry}
              isTyping={!msg.isError && msg.role === 'assistant' && msg.id === typingMessageId}
              onTypingComplete={() => setTypingMessageId(null)}
              scrollRef={messagesEndRef as React.RefObject<HTMLDivElement>}
            />
            {(followUpSuggestions.length > 0 || suggestionsLoading) && !typingMessageId && index === messages.length - 1 && msg.role === 'assistant' && !msg.isError && (
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
                  <span>正在生成图片... {agentExecution.progress}%</span>
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

function MessageBubble({ message, onRetry, isTyping, onTypingComplete, scrollRef }: {
  message: ChatMessage;
  onRetry: (msg: ChatMessage) => void;
  isTyping?: boolean;
  onTypingComplete?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
}) {
  const isUser = message.role === 'user';

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
    }}>
      {/* Attached images */}
      {message.images && message.images.length > 0 && (
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
