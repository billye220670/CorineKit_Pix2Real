/**
 * PromptDiff
 * 展示 AI Agent 对提示词的标签级修改 diff：
 * - 新提示词按原顺序渲染；新增标签高亮绿色
 * - 被移除的标签以红色删除线单独列出
 * 对比粒度为"逗号分隔标签"，忽略大小写与前后空格。
 */

function splitTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function diffTags(oldPrompt: string, newPrompt: string) {
  const oldTags = splitTags(oldPrompt);
  const newTags = splitTags(newPrompt);
  const oldKey = new Set(oldTags.map((t) => t.toLowerCase()));
  const newKey = new Set(newTags.map((t) => t.toLowerCase()));
  const inNew = newTags.map((tag) => ({ tag, added: !oldKey.has(tag.toLowerCase()) }));
  const removed = oldTags.filter((t) => !newKey.has(t.toLowerCase()));
  return { inNew, removed };
}

interface Props {
  oldPrompt: string;
  newPrompt: string;
  label?: string;
}

export function PromptDiff({ oldPrompt, newPrompt, label = '提示词变化' }: Props) {
  const trimmedOld = (oldPrompt ?? '').trim();
  const trimmedNew = (newPrompt ?? '').trim();
  if (trimmedOld === trimmedNew) return null;

  const { inNew, removed } = diffTags(trimmedOld, trimmedNew);
  const hasAnyChange = inNew.some((t) => t.added) || removed.length > 0;
  // 完全无标签级差异（只是重排或空格改动）则不展示
  if (!hasAnyChange) return null;

  return (
    <div
      style={{
        fontSize: 11,
        marginBottom: 8,
        padding: '6px 8px',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          color: 'var(--color-text-secondary)',
          marginBottom: 4,
          fontSize: 10,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {inNew.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {inNew.map((t, i) => (
            <span
              key={`new-${i}`}
              style={{
                padding: '1px 6px',
                borderRadius: 3,
                backgroundColor: t.added ? 'rgba(34,197,94,0.18)' : 'transparent',
                color: t.added ? '#16a34a' : 'var(--color-text)',
                border: t.added
                  ? '1px solid rgba(34,197,94,0.4)'
                  : '1px solid transparent',
                fontWeight: t.added ? 500 : 400,
              }}
            >
              {t.added ? '+ ' : ''}
              {t.tag}
            </span>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'var(--color-text-secondary)',
              marginRight: 2,
            }}
          >
            已移除：
          </span>
          {removed.map((t, i) => (
            <span
              key={`rm-${i}`}
              style={{
                padding: '1px 6px',
                borderRadius: 3,
                backgroundColor: 'rgba(239,68,68,0.15)',
                color: '#dc2626',
                border: '1px solid rgba(239,68,68,0.35)',
                textDecoration: 'line-through',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
