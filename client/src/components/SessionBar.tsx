// client/src/components/SessionBar.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusSquare, ChevronDown, Trash2, Pencil, Check } from 'lucide-react';
import { listSessions, deleteSession, type SessionMeta } from '../services/sessionService.js';

const NAMES_KEY = 'pix2real_session_names';

function getSessionNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}'); } catch { return {}; }
}
function saveSessionName(id: string, name: string) {
  const names = getSessionNames();
  if (name.trim()) names[id] = name.trim(); else delete names[id];
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
}
function getSessionLabel(id: string): string {
  const name = getSessionNames()[id];
  return name || id.slice(0, 8) + '…';
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

interface SessionBarProps {
  sessionId: string;
  lastSavedAt: Date | null;
  onNewSession: (name?: string) => void;
}

export function SessionBar({ sessionId, lastSavedAt, onNewSession }: SessionBarProps) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  // New session naming
  const [showNameInput, setShowNameInput] = useState(false);
  const [newName, setNewName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Wrapper ref for outside click detection
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Refresh "X分钟前" every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // Focus name input when shown
  useEffect(() => {
    if (showNameInput) nameInputRef.current?.focus();
  }, [showNameInput]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await listSessions()); } catch { /* ignore */ }
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

  // ── Rename ──
  const startRename = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(getSessionNames()[id] ?? '');
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    saveSessionName(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
    // Force re-render of labels
    setSessions((prev) => [...prev]);
  }, [renamingId, renameValue]);

  // ── New session ──
  const handleNewSessionClick = useCallback(() => {
    setShowNameInput(true);
    setNewName('');
  }, []);

  const commitNewSession = useCallback(() => {
    const name = newName.trim();
    setShowNameInput(false);
    setNewName('');
    onNewSession(name || undefined);
    if (name) {
      // Name will be saved after the new sessionId is created — handled by parent via callback
      // Store the pending name so parent can save it; simpler: pass name to onNewSession
    }
  }, [newName, onNewSession]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitNewSession();
    if (e.key === 'Escape') { setShowNameInput(false); setNewName(''); }
  }, [commitNewSession]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* ── Main bordered row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        border: '1px solid var(--color-border)',
      }}>
        {/* Last saved timestamp */}
        <span style={{
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          opacity: 0.7,
          whiteSpace: 'nowrap',
          padding: '0 8px',
        }}>
          {lastSavedAt ? `已保存 ${timeAgo(lastSavedAt)}` : '未保存'}
        </span>

        {/* Divider */}
        <div style={{ width: 1, height: '60%', backgroundColor: 'var(--color-border)' }} />

        {/* New session button */}
        <button
          onClick={handleNewSessionClick}
          title="新建会话"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '0 10px',
            height: '100%',
            backgroundColor: 'transparent',
            color: 'var(--color-text-secondary)',
            border: 'none',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <PlusSquare size={13} />
          新建会话
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: '60%', backgroundColor: 'var(--color-border)' }} />

        {/* History dropdown arrow */}
        <button
          onClick={handleOpenDropdown}
          title="会话历史"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            height: '100%',
            backgroundColor: open ? 'var(--color-surface-hover)' : 'transparent',
            color: open ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {/* ── New session name input — appears below the bar ── */}
      {showNameInput && (
        <>
          <div onClick={() => { setShowNameInput(false); setNewName(''); }} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 300,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            padding: '10px',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            minWidth: 220,
          }}>
            <input
              ref={nameInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={() => { /* handled by backdrop */ }}
              placeholder="会话名称（留空使用 ID）"
              style={{
                flex: 1,
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                outline: 'none',
              }}
            />
            <button
              onClick={commitNewSession}
              style={{
                height: 28,
                padding: '0 10px',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              确认
            </button>
          </div>
        </>
      )}

      {/* ── Session history dropdown ── */}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
          <div style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 240,
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
              const isRenaming = renamingId === s.sessionId;
              return (
                <div
                  key={s.sessionId}
                  onClick={() => !isRenaming && handleSwitchSession(s.sessionId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 10px',
                    cursor: isCurrent || isRenaming ? 'default' : 'pointer',
                    backgroundColor: isCurrent ? 'var(--color-surface-hover)' : 'transparent',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent && !isRenaming) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { if (!isCurrent && !isRenaming) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') { setRenamingId(null); }
                          e.stopPropagation();
                        }}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="输入名称"
                        style={{
                          width: '100%',
                          height: 24,
                          padding: '0 6px',
                          border: '1px solid var(--color-primary)',
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-text)',
                          fontSize: '12px',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: isCurrent ? 700 : 400,
                          color: isCurrent ? 'var(--color-primary)' : 'var(--color-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {isCurrent ? `${getSessionLabel(s.sessionId)} (当前)` : getSessionLabel(s.sessionId)}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '1px' }}>
                          {updated.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Rename icon */}
                  {!isRenaming && (
                    <button
                      onClick={(e) => startRename(s.sessionId, e)}
                      title="重命名"
                      style={{ padding: '2px 3px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {isRenaming && (
                    <button
                      onClick={(e) => { e.stopPropagation(); commitRename(); }}
                      style={{ padding: '2px 3px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', flexShrink: 0 }}
                    >
                      <Check size={11} />
                    </button>
                  )}
                  {/* Delete (non-current only) */}
                  {!isCurrent && !isRenaming && (
                    <button
                      onClick={(e) => handleDelete(s.sessionId, e)}
                      title="删除此会话"
                      style={{ padding: '2px 3px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
