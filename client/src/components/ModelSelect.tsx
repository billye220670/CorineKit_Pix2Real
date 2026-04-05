import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Star, Loader, Check, ImagePlus, PencilLine, Tag, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ModelMetadata } from '../hooks/useModelMetadata.js';

// ─── 分类颜色系统 ──────────────────────────────────────────────────────────────

// HSL 色相均分：12 个分类，每隔 30° 一个色相，饱和度 55%，亮度 65%
const CATEGORY_COLORS = Array.from({ length: 12 }, (_, i) =>
  `hsl(${i * 30}, 55%, 65%)`
);

const CATEGORY_COLORS_KEY = 'model_category_colors';

function loadCategoryColorMap(): Record<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(CATEGORY_COLORS_KEY) ?? '{}');
    // Invalidate old hex-based cache — HSL scheme uses "hsl(" prefix
    const values = Object.values(stored) as string[];
    if (values.length > 0 && !values[0].startsWith('hsl(')) {
      localStorage.removeItem(CATEGORY_COLORS_KEY);
      return {};
    }
    return stored;
  } catch {
    return {};
  }
}

function saveCategoryColorMap(map: Record<string, string>) {
  localStorage.setItem(CATEGORY_COLORS_KEY, JSON.stringify(map));
}

function useCategoryColors(categories: string[]) {
  const [colorMap, setColorMap] = useState<Record<string, string>>(loadCategoryColorMap);

  const getCategoryColor = useCallback((category: string): string => {
    // Already assigned
    if (colorMap[category]) return colorMap[category];

    // Assign next color by index (sequential, cyclic)
    const usedCount = Object.keys(colorMap).length;
    const color = CATEGORY_COLORS[usedCount % CATEGORY_COLORS.length];

    const newMap = { ...colorMap, [category]: color };
    setColorMap(newMap);
    saveCategoryColorMap(newMap);
    return color;
  }, [colorMap]);

  // Ensure all current categories have colors assigned (lazy)
  useEffect(() => {
    let changed = false;
    const map = { ...colorMap };
    let idx = Object.keys(map).length;
    for (const cat of categories) {
      if (!map[cat]) {
        map[cat] = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
        idx++;
        changed = true;
      }
    }
    if (changed) {
      setColorMap(map);
      saveCategoryColorMap(map);
    }
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  return { getCategoryColor, colorMap };
}

// ─── ModelSelect ────────────────────────────────────────────────────────────────

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
  onSetTriggerWords?: (modelPath: string, triggerWords: string) => void;
  getThumbnailUrl?: (modelPath: string) => string | null;
  onSetCategory?: (modelPath: string, category: string) => void;
  onDeleteCategory?: (modelPath: string) => void;
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
  onSetTriggerWords,
  getThumbnailUrl,
  onSetCategory,
  onDeleteCategory,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const [uploadTargetModel, setUploadTargetModel] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingTriggerModel, setEditingTriggerModel] = useState<string | null>(null);
  const [triggerEditValue, setTriggerEditValue] = useState('');
  const [tooltipModel, setTooltipModel] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    modelPath: string;
    showSubmenu: boolean;
    isCreatingNew: boolean;
    newCategoryName: string;
  } | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const newCategoryInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingModel(null);
        setEditingTriggerModel(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 关闭下拉时清理状态
  useEffect(() => {
    if (!open) {
      setEditingModel(null);
      setEditingTriggerModel(null);
      setTooltipModel(null);
      setTooltipPos(null);
      setContextMenu(null);
    }
  }, [open]);

  // 打开下拉时自动滚动到选中项
  useEffect(() => {
    if (open && selectedItemRef.current) {
      requestAnimationFrame(() => {
        selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [open]);

  // 关闭右键菜单：点击外部 / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      setContextMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Focus new category input when entering create mode
  useEffect(() => {
    if (contextMenu?.isCreatingNew) {
      setTimeout(() => newCategoryInputRef.current?.focus(), 0);
    }
  }, [contextMenu?.isCreatingNew]);

  // 从 metadata 推导所有分类
  const allCategories = useMemo(() => {
    if (!metadata) return [];
    const cats = new Set<string>();
    for (const m of models) {
      const cat = metadata[m]?.category;
      if (cat) cats.add(cat);
    }
    return [...cats].sort();
  }, [metadata, models]);

  // 分类颜色
  const { getCategoryColor, colorMap: categoryColorMap } = useCategoryColors(allCategories);

  // 是否存在未分类模型
  const hasUncategorized = useMemo(() => {
    if (!metadata || allCategories.length === 0) return false;
    return models.some((m) => !metadata[m]?.category);
  }, [metadata, models, allCategories]);

  // 显示筛选条的条件：至少有一个已分类模型
  const showCategoryBar = allCategories.length > 0;

  // 按选中分类过滤模型
  const filteredModels = useMemo(() => {
    if (selectedCategory === null) return models;
    if (selectedCategory === '__uncategorized__') {
      return models.filter((m) => !metadata?.[m]?.category);
    }
    return models.filter((m) => metadata?.[m]?.category === selectedCategory);
  }, [models, metadata, selectedCategory]);

  // 分离收藏项和非收藏项
  const favoriteModels = filteredModels.filter((m) => favorites.has(m));
  const otherModels = filteredModels.filter((m) => !favorites.has(m));

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

  const handleTriggerWordsConfirm = useCallback((model: string, words: string) => {
    if (onSetTriggerWords) {
      onSetTriggerWords(model, words.trim());
    }
    setEditingTriggerModel(null);
  }, [onSetTriggerWords]);

  const handleItemMouseEnter = useCallback((model: string, e: React.MouseEvent<HTMLDivElement>, index: number) => {
    setHoveredIndex(index);
    const thumbUrl = getThumbnailUrl?.(model);
    if (thumbUrl) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltipModel(model);
      setTooltipPos({ top: rect.top, left: rect.left - 280 - 8 });
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
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
  };

  const renderModelItem = (model: string, index: number, isFavorite: boolean) => {
    const isSelected = model === value;
    const isHovered = hoveredIndex === index;
    const isEditing = editingModel === model;
    const isEditingTrigger = editingTriggerModel === model;
    const triggerWords = metadata?.[model]?.triggerWords;
    const modelCategory = metadata?.[model]?.category;
    const modelColor = modelCategory ? getCategoryColor(modelCategory) : undefined;

    return (
      <div
        key={model}
        ref={isSelected ? selectedItemRef : undefined}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          padding: '6px 10px',
          cursor: 'pointer',
          gap: 8,
          backgroundColor: isSelected
            ? (isHovered ? 'rgba(128, 128, 128, 0.2)' : 'rgba(128, 128, 128, 0.12)')
            : (isHovered ? 'var(--color-surface-hover)' : 'transparent'),
          transition: 'background-color 0.1s',
        }}
        onClick={() => {
          if (!isEditing && !isEditingTrigger) {
            onChange(model);
            setOpen(false);
          }
        }}
        onContextMenu={(e) => {
          if (!onSetCategory) return;
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            modelPath: model,
            showSubmenu: false,
            isCreatingNew: false,
            newCategoryName: '',
          });
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

        {/* Display name / edit inputs */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                width: '100%',
                fontSize: '12px',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <span
              title={model}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '12px',
                color: modelColor || 'var(--color-text)',
              }}
            >
              {getModelDisplayName(model)}
            </span>
          )}
          {isEditingTrigger ? (
            <input
              autoFocus
              placeholder="输入触发词…"
              value={triggerEditValue}
              onChange={(e) => setTriggerEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  handleTriggerWordsConfirm(model, triggerEditValue);
                } else if (e.key === 'Escape') {
                  setEditingTriggerModel(null);
                }
              }}
              onBlur={() => handleTriggerWordsConfirm(model, triggerEditValue)}
              style={{
                width: '100%',
                fontSize: '11px',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            />
          ) : null}
        </div>

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
              setEditingTriggerModel(null);
              setEditingModel(model);
              setEditValue(metadata?.[model]?.nickname || getDisplayName(model));
            }}
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              opacity: isHovered ? 0.7 : 0,
              transition: 'opacity 0.15s',
              marginTop: 2,
            }}
            onMouseEnter={(e) => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as SVGElement).style.opacity = isHovered ? '0.7' : '0'; }}
          />
        )}
        {onSetTriggerWords && (
          <Tag
            size={14}
            onClick={(e) => {
              e.stopPropagation();
              setEditingModel(null);
              setEditingTriggerModel(model);
              setTriggerEditValue(metadata?.[model]?.triggerWords || '');
            }}
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              color: triggerWords ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              opacity: isHovered ? 0.7 : 0,
              transition: 'opacity 0.15s',
              marginTop: 2,
            }}
            onMouseEnter={(e) => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as SVGElement).style.opacity = isHovered ? '0.7' : '0'; }}
          />
        )}

        {isSelected && (
          <Check size={14} color="var(--color-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
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
          {/* 分类筛选条 */}
          {showCategoryBar && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '6px 10px',
              flexShrink: 0,
              borderBottom: '1px solid var(--color-border)',
            }}>
              {/* 全部 pill */}
              <CategoryPill
                label="全部"
                active={selectedCategory === null}
                onClick={() => setSelectedCategory(null)}
              />
              {allCategories.map((cat) => (
                <CategoryPill
                  key={cat}
                  label={cat}
                  active={selectedCategory === cat}
                  onClick={() => setSelectedCategory(cat)}
                  color={getCategoryColor(cat)}
                />
              ))}
              {hasUncategorized && (
                <CategoryPill
                  label="未分类"
                  active={selectedCategory === '__uncategorized__'}
                  onClick={() => setSelectedCategory('__uncategorized__')}
                />
              )}
            </div>
          )}
          {/* 模型列表（可滚动） */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
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
        </div>
      )}

      {/* Thumbnail tooltip */}
      {tooltipUrl && tooltipPos && (
        <div
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: 280,
            zIndex: 10000,
            pointerEvents: 'none',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            userSelect: 'none',
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

      {/* 右键上下文菜单 (Portal) */}
      {contextMenu && onSetCategory && createPortal(
        <ContextMenuPortal
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          allCategories={allCategories}
          metadata={metadata}
          onSetCategory={onSetCategory}
          onDeleteCategory={onDeleteCategory}
          submenuRef={submenuRef}
          newCategoryInputRef={newCategoryInputRef}
          getCategoryColor={getCategoryColor}
        />,
        document.body,
      )}
    </div>
  );
}

// ─── CategoryPill 筛选条按钮 ──────────────────────────────────────────────────

function CategoryPill({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '2px 10px',
        fontSize: '11px',
        borderRadius: 12,
        border: color
          ? `1px solid ${color}`
          : active ? '1px solid transparent' : '1px solid var(--color-border)',
        backgroundColor: active
          ? (color || 'var(--color-primary)')
          : hovered ? (color ? `${color}18` : 'var(--color-surface-hover)') : 'transparent',
        color: active ? '#fff' : (color || 'var(--color-text-secondary)'),
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        lineHeight: '18px',
        transition: 'background-color 0.15s, color 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ─── 右键上下文菜单 Portal 组件 ──────────────────────────────────────────────────

interface ContextMenuPortalProps {
  contextMenu: {
    x: number;
    y: number;
    modelPath: string;
    showSubmenu: boolean;
    isCreatingNew: boolean;
    newCategoryName: string;
  };
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuPortalProps['contextMenu'] | null>>;
  allCategories: string[];
  metadata?: Record<string, ModelMetadata>;
  onSetCategory: (modelPath: string, category: string) => void;
  onDeleteCategory?: (modelPath: string) => void;
  submenuRef: React.RefObject<HTMLDivElement | null>;
  newCategoryInputRef: React.RefObject<HTMLInputElement | null>;
  getCategoryColor: (category: string) => string;
}

function ContextMenuPortal({
  contextMenu,
  setContextMenu,
  allCategories,
  metadata,
  onSetCategory,
  onDeleteCategory,
  submenuRef,
  newCategoryInputRef,
  getCategoryColor,
}: ContextMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuSide, setSubmenuSide] = useState<'right' | 'left'>('right');
  const currentCategory = metadata?.[contextMenu.modelPath]?.category;

  // Determine submenu side based on available space
  useEffect(() => {
    if (contextMenu.showSubmenu && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right;
      setSubmenuSide(spaceRight < 180 ? 'left' : 'right');
    }
  }, [contextMenu.showSubmenu]);

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    height: 32,
    fontSize: '12px',
    color: 'var(--color-text)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.1s',
  };

  return (
    <div
      ref={menuRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: contextMenu.y,
        left: contextMenu.x,
        zIndex: 10001,
        minWidth: 160,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: '4px 0',
        userSelect: 'none',
      }}
    >
      {/* 移入分类 */}
      <div
        style={{ ...menuItemStyle, justifyContent: 'space-between', position: 'relative' }}
        onMouseEnter={() => setContextMenu((prev) => prev ? { ...prev, showSubmenu: true } : prev)}
        onClick={() => setContextMenu((prev) => prev ? { ...prev, showSubmenu: !prev.showSubmenu } : prev)}
      >
        <span>移入分类</span>
        <ChevronRight size={14} color="var(--color-text-secondary)" />

        {/* 子菜单 */}
        {contextMenu.showSubmenu && (
          <div
            ref={submenuRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: -4,
              ...(submenuSide === 'right' ? { left: '100%', marginLeft: 2 } : { right: '100%', marginRight: 2 }),
              minWidth: 140,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              padding: '4px 0',
              zIndex: 10002,
            }}
          >
            {allCategories.map((cat) => (
              <ContextMenuItem
                key={cat}
                label={cat}
                checked={currentCategory === cat}
                colorDot={getCategoryColor(cat)}
                onClick={() => {
                  onSetCategory(contextMenu.modelPath, cat);
                  setContextMenu(null);
                }}
              />
            ))}
            {allCategories.length > 0 && (
              <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '4px 0' }} />
            )}
            {contextMenu.isCreatingNew ? (
              <div style={{ padding: '4px 12px' }}>
                <input
                  ref={newCategoryInputRef}
                  value={contextMenu.newCategoryName}
                  onChange={(e) => setContextMenu((prev) => prev ? { ...prev, newCategoryName: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const name = contextMenu.newCategoryName.trim();
                      if (name) {
                        onSetCategory(contextMenu.modelPath, name);
                        setContextMenu(null);
                      }
                    } else if (e.key === 'Escape') {
                      setContextMenu((prev) => prev ? { ...prev, isCreatingNew: false, newCategoryName: '' } : prev);
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="分类名称…"
                  style={{
                    width: '100%',
                    fontSize: '12px',
                    padding: '4px 8px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ) : (
              <ContextMenuItem
                label="+ 新建分类..."
                icon={<Plus size={12} />}
                onClick={() => setContextMenu((prev) => prev ? { ...prev, isCreatingNew: true, newCategoryName: '' } : prev)}
              />
            )}
          </div>
        )}
      </div>

      {/* 移除分类 */}
      {currentCategory && onDeleteCategory && (
        <ContextMenuItem
          label="移除分类"
          icon={<Trash2 size={12} />}
          onClick={() => {
            onDeleteCategory(contextMenu.modelPath);
            setContextMenu(null);
          }}
          style={menuItemStyle}
        />
      )}
    </div>
  );
}

// ─── 右键菜单项 ──────────────────────────────────────────────────────────────

function ContextMenuItem({ label, checked, icon, onClick, style: customStyle, colorDot }: {
  label: string;
  checked?: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
  colorDot?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 32,
        fontSize: '12px',
        color: 'var(--color-text)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background-color 0.1s',
        backgroundColor: hovered ? 'var(--color-surface-hover)' : 'transparent',
        ...customStyle,
      }}
    >
      {checked && <Check size={12} color="var(--color-primary)" />}
      {!checked && colorDot && (
        <span style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: colorDot,
          flexShrink: 0,
        }} />
      )}
      {!checked && !colorDot && icon}
      <span style={{ flex: 1 }}>{label}</span>
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
