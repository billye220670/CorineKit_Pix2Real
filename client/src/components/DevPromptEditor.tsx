import React, { useEffect, useState, useCallback } from 'react';

interface PromptMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  variables: string[];
}

interface PromptFull extends PromptMeta {
  systemPrompt: string;
  userPrompt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  agent: '智能体',
  config: '配置助理',
  qa: '智能问答',
  warmup: '暖场建议',
  followup: '后续建议',
  'prompt-assistant': '提示词助手',
  other: '其他',
};

export function DevPromptEditor() {
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptFull | null>(null);
  const [editSystem, setEditSystem] = useState('');
  const [editUser, setEditUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Fetch prompt list
  useEffect(() => {
    fetch('/api/prompts')
      .then(r => r.json())
      .then(data => {
        if (data.prompts) setPrompts(data.prompts);
      })
      .catch(err => console.error('[DevPromptEditor] Failed to fetch prompts:', err));
  }, []);

  // Load selected prompt detail
  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PromptFull = await res.json();
      setDetail(data);
      setEditSystem(data.systemPrompt);
      setEditUser(data.userPrompt);
      setDirty(false);
    } catch (err) {
      console.error('[DevPromptEditor] Load detail failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Save handler
  const handleSave = async () => {
    if (!selectedId || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: editSystem, userPrompt: editUser }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDirty(false);
    } catch (err) {
      alert('保存失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Group prompts by category
  const grouped = prompts.reduce<Record<string, PromptMeta[]>>((acc, p) => {
    const cat = p.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 480, gap: 0 }}>
      {/* Left: Prompt list */}
      <div style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        overflowY: 'auto',
        padding: '8px 0',
      }}>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '4px 12px',
              opacity: 0.7,
            }}>
              {CATEGORY_LABELS[cat] || cat}
            </div>
            {items.map(p => {
              const active = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 12px',
                    border: 'none',
                    background: active ? 'var(--color-surface-hover, rgba(255,255,255,0.08))' : 'transparent',
                    color: active ? 'var(--color-primary)' : 'var(--color-text)',
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    borderRadius: 0,
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={p.description}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Right: Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', overflow: 'hidden' }}>
        {!selectedId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            ← 选择左侧的提示词项目进行编辑
          </div>
        ) : loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            加载中...
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{detail.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{detail.description}</div>
              </div>
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                style={{
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                  border: dirty ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: dirty ? 'var(--color-primary)' : 'var(--color-bg)',
                  color: dirty ? '#fff' : 'var(--color-text-secondary)',
                  cursor: dirty ? 'pointer' : 'default',
                  opacity: dirty ? 1 : 0.5,
                  transition: 'all 0.15s',
                }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>

            {/* Variables hint */}
            {detail.variables.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 8, padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                模板变量：{detail.variables.map(v => `{{${v}}}`).join('、')}
              </div>
            )}

            {/* System Prompt textarea */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: detail.userPrompt || editUser ? 8 : 0 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>System Prompt</label>
              <textarea
                value={editSystem}
                onChange={(e) => { setEditSystem(e.target.value); setDirty(true); }}
                style={{
                  flex: 1,
                  minHeight: 120,
                  resize: 'vertical',
                  padding: '8px 10px',
                  fontSize: 12,
                  lineHeight: '18px',
                  fontFamily: 'Consolas, "Courier New", monospace',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  color: 'var(--color-text)',
                  outline: 'none',
                }}
                spellCheck={false}
              />
            </div>

            {/* User Prompt textarea (only show if non-empty or originally had content) */}
            {(detail.userPrompt || editUser) && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>User Prompt</label>
                <textarea
                  value={editUser}
                  onChange={(e) => { setEditUser(e.target.value); setDirty(true); }}
                  style={{
                    flex: 1,
                    minHeight: 100,
                    resize: 'vertical',
                    padding: '8px 10px',
                    fontSize: 12,
                    lineHeight: '18px',
                    fontFamily: 'Consolas, "Courier New", monospace',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    color: 'var(--color-text)',
                    outline: 'none',
                  }}
                  spellCheck={false}
                />
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
