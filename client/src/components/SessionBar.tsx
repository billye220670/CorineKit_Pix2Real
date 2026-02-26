// client/src/components/SessionBar.tsx
import { useCallback, useEffect, useState } from 'react';
import { PlusSquare, ChevronDown, Trash2 } from 'lucide-react';
import { listSessions, deleteSession, type SessionMeta } from '../services/sessionService.js';

interface SessionBarProps {
  sessionId: string;
  lastSavedAt: Date | null;
  onNewSession: () => void;
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return '刚刚';
  if (secs < 60) return `${secs}秒前`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

export function SessionBar({ sessionId, lastSavedAt, onNewSession }: SessionBarProps) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  // Refresh "X 分钟前" display every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick; // suppress unused warning

  const loadSessions = useCallback(async () => {
    try {
      const list = await listSessions();
      setSessions(list);
    } catch { /* ignore */ }
  }, []);

  const handleOpenDropdown = useCallback(async () => {
    if (!open) await loadSessions();
    setOpen((v) => !v);
  }, [open, loadSessions]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.sessionId !== id));
  }, []);

  const handleSwitchSession = useCallback((id: string) => {
    if (id === sessionId) { setOpen(false); return; }
    localStorage.setItem('pix2real_session_id', id);
    window.location.reload();
  }, [sessionId]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
      {/* Last saved timestamp */}
      <span style={{
        fontSize: '11px',
        color: 'var(--color-text-secondary)',
        opacity: 0.7,
        whiteSpace: 'nowrap',
      }}>
        {lastSavedAt ? `已保存 ${timeAgo(lastSavedAt)}` : '未保存'}
      </span>

      {/* New session button */}
      <button
        onClick={onNewSession}
        title="新建会话"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
          backgroundColor: 'transparent',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 0,
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <PlusSquare size={13} />
        新建会话
      </button>

      {/* Session history dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={handleOpenDropdown}
          title="会话历史"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            padding: '4px 6px',
            backgroundColor: open ? 'var(--color-surface-hover)' : 'transparent',
            color: open ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            border: '1px solid',
            borderColor: open ? 'var(--color-primary)' : 'var(--color-border)',
            borderRadius: 0,
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>

        {open && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            />
            <div style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 4px)',
              minWidth: '220px',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              zIndex: 200,
            }}>
              <div style={{
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-text-secondary)',
                borderBottom: '1px solid var(--color-border)',
                letterSpacing: '0.05em',
              }}>
                最近会话
              </div>
              {sessions.length === 0 && (
                <div style={{ padding: '10px', fontSize: '12px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                  暂无历史
                </div>
              )}
              {sessions.map((s) => {
                const isCurrent = s.sessionId === sessionId;
                const updated = new Date(s.updatedAt);
                return (
                  <div
                    key={s.sessionId}
                    onClick={() => handleSwitchSession(s.sessionId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      cursor: isCurrent ? 'default' : 'pointer',
                      backgroundColor: isCurrent ? 'var(--color-surface-hover)' : 'transparent',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                    onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--color-surface-hover)'; }}
                    onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: isCurrent ? 700 : 400,
                        color: isCurrent ? 'var(--color-primary)' : 'var(--color-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {isCurrent ? '当前会话' : s.sessionId.slice(0, 8) + '…'}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '1px' }}>
                        {updated.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={(e) => handleDelete(s.sessionId, e)}
                        title="删除此会话"
                        style={{
                          padding: '2px 4px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--color-text-secondary)',
                          flexShrink: 0,
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
