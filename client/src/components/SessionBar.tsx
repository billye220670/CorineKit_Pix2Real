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

interface SessionBarProps {
  sessionId: string;
  onNewSession: (name?: string) => void;
}

export function SessionBar({ sessionId, onNewSession }: SessionBarProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  // New session naming
  const [showNameInput, setShowNameInput] = useState(false);
  const [isNameInputClosing, setIsNameInputClosing] = useState(false);
  const [newName, setNewName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  // History dropdown
  const [isHistoryClosing, setIsHistoryClosing] = useState(false);
  // Wrapper ref for outside click detection
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const names = getSessionNames();
    const label = names[id] ? `「${names[id]}」` : '此会话';
    if (!window.confirm(`确定要删除${label}吗？本地文件将一并删除，无法恢复。`)) return;
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.sessionId !== id));
  }, []);

  const handleSwitchSession = useCallback((id: string) => {
    if (id === sessionId) { setOpen(false); return; }
    localStorage.setItem('pix2real_session_id', id);
    sessionStorage.setItem('pix2real_switch_intent', '1');
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
  const closeNameInput = useCallback(() => {
    setIsNameInputClosing(true);
    setTimeout(() => {
      setShowNameInput(false);
      setIsNameInputClosing(false);
      setNewName('');
    }, 150);
  }, []);

  const closeHistory = useCallback(() => {
    setIsHistoryClosing(true);
    setTimeout(() => {
      setOpen(false);
      setIsHistoryClosing(false);
    }, 150);
  }, []);

  const handleNewSessionClick = useCallback(() => {
    setIsNameInputClosing(false);
    setShowNameInput(true);
    setNewName('');
  }, []);

  const commitNewSession = useCallback(() => {
    const name = newName.trim();
    onNewSession(name || undefined);
    closeNameInput();
  }, [newName, onNewSession, closeNameInput]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitNewSession();
    if (e.key === 'Escape') closeNameInput();
  }, [commitNewSession, closeNameInput]);

  const handleOpenDropdown = useCallback(async () => {
    if (open) { closeHistory(); return; }
    await loadSessions();
    setIsHistoryClosing(false);
    setOpen(true);
  }, [open, loadSessions, closeHistory]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* ── Main bordered row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
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
            backgroundColor: 'var(--color-primary)',
            color: '#ffffff',
            border: 'none',
            fontSize: '13px',
            fontWeight: 300,
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
            backgroundColor: 'var(--color-primary)',
            color: open ? '#ffffff' : '#ffffff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {/* ── New session name input — appears below the bar ── */}
      {(showNameInput || isNameInputClosing) && (
        <>
          <div onClick={closeNameInput} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
          <div className={isNameInputClosing ? 'panel-exit' : 'panel-enter'} style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 300,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: '10px',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            width: 260,
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
                minWidth: 0,
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                outline: 'none',
              }}
            />
            <button
              onClick={commitNewSession}
              style={{
                flexShrink: 0,
                height: 28,
                padding: '0 12px',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              确认
            </button>
          </div>
        </>
      )}

      {/* ── Session history dropdown ── */}
      {(open || isHistoryClosing) && (
        <>
          <div onClick={closeHistory} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
          <div className={isHistoryClosing ? 'panel-exit' : 'panel-enter'} style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 240,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            zIndex: 200,
            overflow: 'hidden',
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
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
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
          </div>
        </>
      )}
    </div>
  );
}
