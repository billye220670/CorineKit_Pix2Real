import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Star, Loader, Check } from 'lucide-react';

interface ModelSelectProps {
  models: string[];              // 模型列表（完整路径字符串）
  value: string;                 // 当前选中值
  onChange: (value: string) => void;
  favorites: Set<string>;        // 收藏的模型集合
  onToggleFavorite: (model: string) => void;
  loading?: boolean;             // 加载中状态
  placeholder?: string;
}

// 从完整路径提取显示名称（去路径去后缀）
function getDisplayName(fullPath: string): string {
  return fullPath.split('\\').pop()?.replace(/\.[^.]+$/, '') ?? fullPath;
}

export function ModelSelect({
  models,
  value,
  onChange,
  favorites,
  onToggleFavorite,
  loading = false,
  placeholder = '（无可用模型）',
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 分离收藏项和非收藏项
  const favoriteModels = models.filter((m) => favorites.has(m));
  const otherModels = models.filter((m) => !favorites.has(m));

  const displayValue = value ? getDisplayName(value) : placeholder;

  // Loading 状态
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text-secondary)',
        fontSize: '12px',
      }}>
        <Loader size={12} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
        加载中…
      </div>
    );
  }

  const triggerStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '12px',
    outline: 'none',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: models.length === 0 ? 'not-allowed' : 'pointer',
    opacity: models.length === 0 ? 0.6 : 1,
  };

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    width: '100%',
    marginTop: 4,
    zIndex: 1000,
    maxHeight: 300,
    overflowY: 'auto',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  };

  const renderModelItem = (model: string, index: number, isFavorite: boolean) => {
    const isSelected = model === value;
    const isHovered = hoveredIndex === index;

    return (
      <div
        key={model}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          cursor: 'pointer',
          gap: 8,
          backgroundColor: isHovered ? 'var(--color-surface-hover)' : 'transparent',
          transition: 'background-color 0.1s',
        }}
        onClick={() => {
          onChange(model);
          setOpen(false);
        }}
        onMouseEnter={() => setHoveredIndex(index)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <Star
          size={14}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(model);
          }}
          style={{ cursor: 'pointer', flexShrink: 0 }}
          fill={isFavorite ? 'var(--color-primary)' : 'none'}
          color={isFavorite ? 'var(--color-primary)' : 'var(--color-text-secondary)'}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            fontSize: '12px',
            color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
          }}
        >
          {getDisplayName(model)}
        </span>
        {isSelected && (
          <Check size={14} color="var(--color-primary)" style={{ flexShrink: 0 }} />
        )}
      </div>
    );
  };

  // 为每个模型分配唯一 index（用于 hover 状态管理）
  let itemIndex = 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* 触发器按钮 */}
      <div
        style={triggerStyle}
        onClick={() => {
          if (models.length > 0) setOpen((v) => !v);
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {models.length === 0 ? placeholder : displayValue}
        </span>
        <ChevronDown
          size={14}
          color="var(--color-text-secondary)"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </div>

      {/* 下拉面板 */}
      {open && models.length > 0 && (
        <div style={dropdownStyle}>
          {/* 收藏区 */}
          {favoriteModels.length > 0 && (
            <>
              {favoriteModels.map((m) => {
                const idx = itemIndex++;
                return renderModelItem(m, idx, true);
              })}
              {/* 分割线 */}
              {otherModels.length > 0 && (
                <div
                  style={{
                    height: 1,
                    backgroundColor: 'var(--color-border)',
                    margin: '4px 0',
                  }}
                />
              )}
            </>
          )}
          {/* 全部剩余区 */}
          {otherModels.map((m) => {
            const idx = itemIndex++;
            return renderModelItem(m, idx, false);
          })}
        </div>
      )}
    </div>
  );
}

// ─── 收藏持久化逻辑 Hook ───────────────────────────────────────────────────────

type FavoriteCategory = 'checkpoints' | 'unets' | 'loras';

interface ModelFavorites {
  checkpoints: string[];
  unets: string[];
  loras: string[];
}

const FAVORITES_KEY = 'model_favorites';

function readAllFavorites(): ModelFavorites {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '{}');
  } catch {
    return { checkpoints: [], unets: [], loras: [] };
  }
}

export function useModelFavorites(category: FavoriteCategory) {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const all = readAllFavorites();
    return new Set(all[category] ?? []);
  });

  const toggleFavorite = (model: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      // 同步到 localStorage
      const all = readAllFavorites();
      all[category] = [...next];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(all));
      return next;
    });
  };

  return { favorites, toggleFavorite };
}
