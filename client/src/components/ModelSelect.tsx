import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Star, Loader, Check, ImagePlus, PencilLine } from 'lucide-react';
import type { ModelMetadata } from '../hooks/useModelMetadata.js';

interface ModelSelectProps {
  models: string[];
  value: string;
  onChange: (value: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (model: string) => void;
  loading?: boolean;
  placeholder?: string;
  metadata?: Record<string, ModelMetadata>;
  onUploadThumbnail?: (modelPath: string, file: File) => void;
  onSetNickname?: (modelPath: string, nickname: string) => void;
  getThumbnailUrl?: (modelPath: string) => string | null;
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
  metadata,
  onUploadThumbnail,
  onSetNickname,
  getThumbnailUrl,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetModel, setUploadTargetModel] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [tooltipModel, setTooltipModel] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingModel(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 关闭下拉时清理状态
  useEffect(() => {
    if (!open) {
      setEditingModel(null);
      setTooltipModel(null);
      setTooltipPos(null);
    }
  }, [open]);

  // 分离收藏项和非收藏项
  const favoriteModels = models.filter((m) => favorites.has(m));
  const otherModels = models.filter((m) => !favorites.has(m));

  const getModelDisplayName = useCallback((model: string) => {
    const nick = metadata?.[model]?.nickname;
    return nick || getDisplayName(model);
  }, [metadata]);

  const displayValue = value ? getModelDisplayName(value) : placeholder;

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadTargetModel && onUploadThumbnail) {
      onUploadThumbnail(uploadTargetModel, file);
    }
    setUploadTargetModel(null);
    // reset input so same file can be selected again
    e.target.value = '';
  }, [uploadTargetModel, onUploadThumbnail]);

  const handleNicknameConfirm = useCallback((model: string, newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && onSetNickname) {
      onSetNickname(model, trimmed);
    }
    setEditingModel(null);
  }, [onSetNickname]);

  const handleItemMouseEnter = useCallback((model: string, e: React.MouseEvent<HTMLDivElement>, index: number) => {
    setHoveredIndex(index);
    const thumbUrl = getThumbnailUrl?.(model);
    if (thumbUrl) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltipModel(model);
      setTooltipPos({ top: rect.top, left: rect.left - 210 });
    } else {
      setTooltipModel(null);
      setTooltipPos(null);
    }
  }, [getThumbnailUrl]);

  const handleItemMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltipModel(null);
    setTooltipPos(null);
  }, []);

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
    const isEditing = editingModel === model;

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
          if (!isEditing) {
            onChange(model);
            setOpen(false);
          }
        }}
        onMouseEnter={(e) => handleItemMouseEnter(model, e, index)}
        onMouseLeave={handleItemMouseLeave}
      >
        {/* Star icon */}
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

        {/* Display name or edit input */}
        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                handleNicknameConfirm(model, editValue);
              } else if (e.key === 'Escape') {
                setEditingModel(null);
              }
            }}
            onBlur={() => handleNicknameConfirm(model, editValue)}
            style={{
              flex: 1,
              fontSize: '12px',
              color: 'var(--color-text)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '2px 6px',
              outline: 'none',
              fontFamily: 'inherit',
              minWidth: 0,
            }}
          />
        ) : (
          <span
            title={model}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              fontSize: '12px',
              color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
            }}
          >
            {getModelDisplayName(model)}
          </span>
        )}

        {/* Action icons — visible on hover */}
        {onUploadThumbnail && (
          <ImagePlus
            size={14}
            onClick={(e) => {
              e.stopPropagation();
              setUploadTargetModel(model);
              fileInputRef.current?.click();
            }}
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              opacity: isHovered ? 0.7 : 0,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as SVGElement).style.opacity = isHovered ? '0.7' : '0'; }}
          />
        )}
        {onSetNickname && (
          <PencilLine
            size={14}
            onClick={(e) => {
              e.stopPropagation();
              setEditingModel(model);
              setEditValue(metadata?.[model]?.nickname || getDisplayName(model));
            }}
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              opacity: isHovered ? 0.7 : 0,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as SVGElement).style.opacity = isHovered ? '0.7' : '0'; }}
          />
        )}

        {isSelected && (
          <Check size={14} color="var(--color-primary)" style={{ flexShrink: 0 }} />
        )}
      </div>
    );
  };

  // 为每个模型分配唯一 index（用于 hover 状态管理）
  let itemIndex = 0;

  // Thumbnail tooltip
  const tooltipUrl = tooltipModel ? getThumbnailUrl?.(tooltipModel) : null;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Hidden file input for thumbnail upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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

      {/* Thumbnail tooltip */}
      {tooltipUrl && tooltipPos && (
        <div
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: 200,
            zIndex: 10000,
            pointerEvents: 'none',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <img
            src={tooltipUrl}
            alt="model thumbnail"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: 8,
            }}
          />
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
