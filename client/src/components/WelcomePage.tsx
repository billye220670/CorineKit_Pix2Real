import { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, X, Pencil } from 'lucide-react';
import {
  listSessions,
  getSession,
  deleteSession,
  type SessionMeta,
} from '../services/sessionService.js';

const SESSION_ID_KEY = 'pix2real_session_id';
const NAMES_KEY = 'pix2real_session_names';

interface SessionCard {
  meta: SessionMeta;
  name: string;
  previewUrl: string | null;
}

interface WelcomePageProps {
  onNewSession: () => void;
  onEnterApp: () => void;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

async function resolvePreviewUrl(sessionId: string): Promise<string | null> {
  try {
    const session = await getSession(sessionId);
    if (!session) return null;
    // Prefer output images
    for (let tab = 0; tab <= 9; tab++) {
      const td = session.tabData[tab];
      if (!td) continue;
      for (const task of Object.values(td.tasks)) {
        if (task.outputs.length > 0) return task.outputs[0].url;
      }
    }
    // Fall back to input images
    for (let tab = 0; tab <= 9; tab++) {
      const td = session.tabData[tab];
      if (!td || td.images.length === 0) continue;
      const img = td.images[0];
      return `/api/session-files/${sessionId}/tab-${tab}/input/${img.id}${img.ext}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function WelcomePage({ onNewSession, onEnterApp }: WelcomePageProps) {
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const metas = await listSessions();
        const names = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, string>;
        const loaded: SessionCard[] = await Promise.all(
          metas.map(async (meta) => ({
            meta,
            name: names[meta.sessionId] ?? formatRelativeTime(meta.updatedAt),
            previewUrl: await resolvePreviewUrl(meta.sessionId),
          }))
        );
        setCards(loaded);
      } catch (err) {
        console.warn('[WelcomePage] Failed to load sessions:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const enterSession = useCallback((sessionId: string) => {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem('pix2real_switch_intent', '1');
    window.location.reload();
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, sessionId: string, sessionName: string) => {
    e.stopPropagation();
    if (!window.confirm(`确定要删除「${sessionName}」吗？本地文件将一并删除，无法恢复。`)) return;
    void deleteSession(sessionId);
    setCards((prev) => prev.filter((c) => c.meta.sessionId !== sessionId));
    const names = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, string>;
    delete names[sessionId];
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  }, []);

  const commitRename = useCallback((sessionId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      const names = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, string>;
      names[sessionId] = trimmed;
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
      setCards((prev) =>
        prev.map((c) => (c.meta.sessionId === sessionId ? { ...c, name: trimmed } : c))
      );
    }
    setRenamingId(null);
  }, [renameValue]);

  const startRename = useCallback((e: React.MouseEvent, sessionId: string, currentName: string) => {
    e.stopPropagation();
    setRenamingId(sessionId);
    setRenameValue(currentName);
  }, []);

  const currentSessionId = localStorage.getItem(SESSION_ID_KEY);
  const hasCurrentSession = cards.some((c) => c.meta.sessionId === currentSessionId);

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--color-bg)',
      overflowY: 'auto',
    }}>
      {/* Page header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '32px 48px 24px',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
            最近会话
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            点击卡片进入会话，悬停后点击编辑图标可重命名
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasCurrentSession && (
            <button
              onClick={onEnterApp}
              style={{
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              继续当前会话
            </button>
          )}
          <button
            onClick={onNewSession}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-bg)',
              backgroundColor: 'var(--color-primary)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <Plus size={15} />
            新建会话
          </button>
        </div>
      </div>

      {/* Cards area */}
      <div style={{ flex: 1, padding: '0 48px 48px' }}>
        {loading ? (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{
                width: 180,
                height: 220,
                backgroundColor: 'var(--color-surface)',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                opacity: 0.5,
              }} />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 200,
            color: 'var(--color-text-secondary)',
            fontSize: 14,
            gap: 12,
          }}>
            <div style={{ fontSize: 40, opacity: 0.3 }}>🗂</div>
            <div>暂无保存的会话</div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            {cards.map((card) => {
              const isHovered = hoveredId === card.meta.sessionId;
              const isRenaming = renamingId === card.meta.sessionId;
              return (
                <div
                  key={card.meta.sessionId}
                  onClick={() => !isRenaming && enterSession(card.meta.sessionId)}
                  onMouseEnter={() => setHoveredId(card.meta.sessionId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    position: 'relative',
                    width: 180,
                    height: 220,
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: 'var(--color-surface)',
                    border: `1px solid ${isHovered ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: isRenaming ? 'default' : 'pointer',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    boxShadow: isHovered ? '0 4px 16px rgba(0,0,0,0.18)' : 'none',
                    flexShrink: 0,
                  }}
                >
                  {/* Image area */}
                  <div style={{
                    width: '100%',
                    height: 140,
                    flexShrink: 0,
                    overflow: 'hidden',
                    backgroundColor: 'var(--color-surface-hover)',
                  }}>
                    {card.previewUrl ? (
                      <img
                        src={card.previewUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, var(--color-surface-hover) 0%, var(--color-border) 100%)',
                        opacity: 0.6,
                      }} />
                    )}
                  </div>

                  {/* Info area */}
                  <div style={{
                    flex: 1,
                    padding: '8px 10px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 3,
                    minHeight: 0,
                  }}>
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(card.meta.sessionId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(card.meta.sessionId);
                          if (e.key === 'Escape') setRenamingId(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '100%',
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--color-text)',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-primary)',
                          borderRadius: 3,
                          padding: '2px 4px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--color-text)',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            userSelect: 'none',
                          }}
                          title={card.name}
                        >
                          {card.name}
                        </div>
                        <button
                          onClick={(e) => startRename(e, card.meta.sessionId, card.name)}
                          title="重命名"
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 18,
                            height: 18,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-secondary)',
                            padding: 0,
                            opacity: isHovered ? 1 : 0,
                            transition: 'opacity 0.15s',
                            pointerEvents: isHovered ? 'auto' : 'none',
                          }}
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                    <div style={{
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {formatRelativeTime(card.meta.updatedAt)}
                    </div>
                  </div>

                  {/* Delete button (hover reveal) */}
                  <button
                    onClick={(e) => handleDelete(e, card.meta.sessionId, card.name)}
                    title="删除会话"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: '#fff',
                      opacity: isHovered ? 1 : 0,
                      transition: 'opacity 0.15s',
                      pointerEvents: isHovered ? 'auto' : 'none',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
