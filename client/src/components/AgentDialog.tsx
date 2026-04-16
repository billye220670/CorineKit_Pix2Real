import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import { useAgentStore, type ChatMessage } from '../hooks/useAgentStore.js';

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

  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closeDialog();
    }, 180);
  }, [closeDialog]);

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

  const handleSend = useCallback(() => {
    const content = text.trim();
    if (!content && uploadedImages.length === 0) return;

    const images = uploadedImages.map((i) => i.dataUrl);
    addMessage({
      role: 'user',
      content,
      ...(images.length > 0 ? { images } : {}),
    });
    setText('');
    clearUploadedImages();

    // Placeholder: simulate AI response
    setIsExecuting(true);
    setExecutionStatus('正在处理中...');
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content: '收到你的请求，功能开发中...',
      });
      setIsExecuting(false);
      setExecutionStatus('');
    }, 2000);
  }, [text, uploadedImages, addMessage, clearUploadedImages, setIsExecuting, setExecutionStatus]);

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
        {messages.length === 0 && !isExecuting && (
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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
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

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
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
        {message.content}
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
    </div>
  );
}
