import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ImagePlus, HelpCircle } from 'lucide-react';
import type { ModelMetadata } from '../hooks/useModelMetadata.js';
import { loadCategoryColorMap } from './ModelSelect.js';

interface MetadataEditorModalProps {
  modelPath: string;
  metadata: ModelMetadata | undefined;
  isLora: boolean;
  models?: string[];
  allMetadata?: Record<string, ModelMetadata>;
  getThumbnailUrl?: (modelPath: string) => string | null;
  onSave: (modelPath: string, fields: Record<string, any>) => Promise<void>;
  onClose: () => void;
}

function getDisplayName(fullPath: string): string {
  return fullPath.split('\\').pop()?.replace(/\.[^.]+$/, '') ?? fullPath;
}

// 从字符串中提取中文部分
function extractChinese(str: string): string[] {
  const matches = str.match(/[\u4e00-\u9fa5]+/g);
  return matches ?? [];
}

// 从 modelPath 推断兼容模型
function inferCompatibleModels(modelPath: string): string[] {
  const lower = modelPath.toLowerCase();
  const result: string[] = [];
  if (lower.includes('光辉') || lower.includes('guanghui')) result.push('光辉系列');
  if (lower.includes('pony')) result.push('PONY系列');
  return result;
}

// ─── HSL 颜色工具 ──────────────────────────────────────────────────────────
function hslToHsla(hsl: string, alpha: number): string {
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// ─── CategoryPill 筛选条按钮 ──────────────────────────────────────────────────
function CategoryPill({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  const [hovered, setHovered] = useState(false);
  const bgColor = color
    ? active ? hslToHsla(color, 0.35) : hovered ? hslToHsla(color, 0.12) : hslToHsla(color, 0.08)
    : active ? 'var(--color-primary)' : hovered ? 'var(--color-surface-hover)' : 'transparent';
  const textColor = color
    ? active ? color : color
    : active ? '#fff' : 'var(--color-text-secondary)';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '2px 10px',
        fontSize: '11px',
        borderRadius: 12,
        border: color ? `1px solid ${hslToHsla(color, active ? 0.5 : 0.2)}` : active ? '1px solid transparent' : '1px solid var(--color-border)',
        backgroundColor: bgColor,
        color: textColor,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        lineHeight: '18px',
        transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

export function MetadataEditorModal({
  modelPath,
  metadata,
  isLora,
  models,
  allMetadata,
  getThumbnailUrl,
  onSave,
  onClose,
}: MetadataEditorModalProps) {
  // Internal model path state for switching
  const [currentModelPath, setCurrentModelPath] = useState(modelPath);

  // Local copy of allMetadata so left panel updates immediately on edits
  const [localMetadata, setLocalMetadata] = useState<Record<string, ModelMetadata>>(() => allMetadata ? { ...allMetadata } : {});

  // Sync when props.allMetadata changes externally
  useEffect(() => {
    if (allMetadata) setLocalMetadata({ ...allMetadata });
  }, [allMetadata]);

  const currentMetadata = localMetadata[currentModelPath] ?? (currentModelPath === modelPath ? metadata : undefined);

  const thumbUrl = getThumbnailUrl?.(currentModelPath) ?? null;

  // Form state
  const [nickname, setNickname] = useState(currentMetadata?.nickname ?? '');
  const [category, setCategory] = useState(currentMetadata?.category ?? '');
  const [triggerWords, setTriggerWords] = useState(currentMetadata?.triggerWords ?? '');
  const [description, setDescription] = useState('');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [compatibleModels, setCompatibleModels] = useState<string[]>([]);
  const [recommendedStrength, setRecommendedStrength] = useState(0.8);
  const [saving, setSaving] = useState(false);

  const [styleTagInput, setStyleTagInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  // Left panel state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [localThumbUrl, setLocalThumbUrl] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(80);

  // Reset localThumbUrl when model switches
  useEffect(() => {
    setLocalThumbUrl(null);
  }, [currentModelPath]);

  // Measure right-side fields container height for thumbnail sizing
  useEffect(() => {
    const el = fieldsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) setThumbSize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentModelPath]);

  // All available model paths
  const modelList = useMemo(() => models ?? [modelPath], [models, modelPath]);

  // Extract all unique categories from localMetadata
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const path of modelList) {
      const cat = localMetadata[path]?.category;
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, 'zh'));
  }, [localMetadata, modelList]);

  // Filter models by search + category
  const filteredModels = useMemo(() => {
    let items = modelList;
    // Category filter
    if (selectedCategory === '__uncategorized__') {
      items = items.filter(m => !localMetadata[m]?.category);
    } else if (selectedCategory) {
      items = items.filter(m => localMetadata[m]?.category === selectedCategory);
    }
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(m => {
        const nick = localMetadata[m]?.nickname ?? '';
        const displayName = getDisplayName(m);
        return nick.toLowerCase().includes(q) || displayName.toLowerCase().includes(q);
      });
    }
    return items;
  }, [modelList, selectedCategory, searchQuery, localMetadata]);

  // Group filtered models by category (for "all" view)
  const groupedModels = useMemo(() => {
    if (selectedCategory) return null; // no grouping when filtering by specific category
    const groups: Record<string, string[]> = {};
    const uncategorized: string[] = [];
    for (const m of filteredModels) {
      const cat = localMetadata[m]?.category;
      if (cat) {
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(m);
      } else {
        uncategorized.push(m);
      }
    }
    const sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh'));
    const result: { label: string; items: string[] }[] = sortedKeys.map(k => ({ label: k, items: groups[k] }));
    if (uncategorized.length > 0) {
      result.push({ label: '未分类', items: uncategorized });
    }
    return result;
  }, [filteredModels, selectedCategory, localMetadata]);

  const hasUncategorized = useMemo(() => {
    return modelList.some(m => !localMetadata[m]?.category);
  }, [modelList, localMetadata]);

  // Helper to update a field in localMetadata for the current model
  const updateLocalMetadataField = useCallback((path: string, field: string, value: any) => {
    setLocalMetadata(prev => ({
      ...prev,
      [path]: { ...prev[path], [field]: value } as ModelMetadata,
    }));
  }, []);

  const categoryColorMap = useMemo(() => loadCategoryColorMap(), []);

  // Thumbnail upload handler
  const handleThumbnailUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('modelPath', currentModelPath);
    try {
      const res = await fetch('/api/models/metadata/thumbnail', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.ok && data.thumbnail) {
        updateLocalMetadataField(currentModelPath, 'thumbnail', data.thumbnail);
        const newUrl = getThumbnailUrl?.(currentModelPath);
        setLocalThumbUrl(newUrl ? `${newUrl}?t=${Date.now()}` : null);
      }
    } catch (e) {
      console.error('Thumbnail upload failed', e);
    }
  }, [currentModelPath, getThumbnailUrl, updateLocalMetadataField]);

  // Load form data from metadata for a given model path
  const loadFormData = useCallback((path: string, meta: ModelMetadata | undefined) => {
    setNickname(meta?.nickname ?? '');
    setCategory(meta?.category ?? '');
    setTriggerWords(meta?.triggerWords ?? '');
    setStyleTags(meta?.styleTags ?? []);
    // keywords: auto-fill from nickname if empty
    if (meta?.keywords && meta.keywords.length > 0) {
      setKeywords(meta.keywords);
    } else {
      const nick = meta?.nickname ?? '';
      const chinese = extractChinese(nick);
      setKeywords(chinese.length > 0 ? chinese : []);
    }
    // compatibleModels: auto-fill from path if empty
    if (meta?.compatibleModels && meta.compatibleModels.length > 0) {
      setCompatibleModels(meta.compatibleModels);
    } else {
      setCompatibleModels(inferCompatibleModels(path));
    }
    setRecommendedStrength(meta?.recommendedStrength ?? 0.8);
    // description: auto-fill from nickname + category
    if (meta?.description) {
      setDescription(meta.description);
    } else {
      const nick = meta?.nickname ?? '';
      const cat = meta?.category ?? '';
      if (nick || cat) {
        setDescription(cat ? `${nick || getDisplayName(path)} (${cat})` : nick);
      } else {
        setDescription('');
      }
    }
    setStyleTagInput('');
    setKeywordInput('');
  }, []);

  // Initialize with auto-fill logic
  useEffect(() => {
    loadFormData(currentModelPath, currentMetadata);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async (targetPath?: string) => {
    setSaving(true);
    try {
      const savePath = targetPath ?? currentModelPath;
      const fields: Record<string, any> = {
        nickname: nickname.trim() || null,
        category: category.trim() || null,
        triggerWords: triggerWords.trim() || null,
        description: description.trim() || null,
        styleTags: styleTags.length > 0 ? styleTags : null,
        keywords: keywords.length > 0 ? keywords : null,
      };
      if (isLora) {
        fields.compatibleModels = compatibleModels.length > 0 ? compatibleModels : null;
        fields.recommendedStrength = recommendedStrength;
      }
      await onSave(savePath, fields);
    } finally {
      setSaving(false);
    }
  }, [currentModelPath, nickname, category, triggerWords, description, styleTags, keywords, compatibleModels, recommendedStrength, isLora, onSave]);

  // Handle model switch from the left panel
  const handleModelSwitch = useCallback(async (newModelPath: string) => {
    if (newModelPath === currentModelPath) return;
    // Auto-save current edits silently
    await handleSave(currentModelPath);
    // Switch to new model
    setCurrentModelPath(newModelPath);
    const newMeta = localMetadata[newModelPath];
    loadFormData(newModelPath, newMeta);
  }, [currentModelPath, handleSave, localMetadata, loadFormData]);

  const handleAddStyleTag = useCallback(() => {
    const val = styleTagInput.trim();
    if (val && !styleTags.includes(val)) {
      const newTags = [...styleTags, val];
      setStyleTags(newTags);
      updateLocalMetadataField(currentModelPath, 'styleTags', newTags);
    }
    setStyleTagInput('');
  }, [styleTagInput, styleTags, currentModelPath, updateLocalMetadataField]);

  const handleAddKeyword = useCallback(() => {
    const val = keywordInput.trim();
    if (val && !keywords.includes(val)) {
      const newKw = [...keywords, val];
      setKeywords(newKw);
      updateLocalMetadataField(currentModelPath, 'keywords', newKw);
    }
    setKeywordInput('');
  }, [keywordInput, keywords, currentModelPath, updateLocalMetadataField]);

  const toggleCompatible = (model: string) => {
    const newList = compatibleModels.includes(model) ? compatibleModels.filter(m => m !== model) : [...compatibleModels, model];
    setCompatibleModels(newList);
    updateLocalMetadataField(currentModelPath, 'compatibleModels', newList.length > 0 ? newList : undefined);
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginTop: 24,
    marginBottom: 12,
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'var(--color-text)',
    width: '100%',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    userSelect: 'text',
  };

  const tagStyle: React.CSSProperties = {
    backgroundColor: 'rgba(33,150,243,0.15)',
    color: 'var(--color-primary)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 13,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };

  const renderTagInput = (
    tags: string[],
    setTags: React.Dispatch<React.SetStateAction<string[]>>,
    inputValue: string,
    setInputValue: React.Dispatch<React.SetStateAction<string>>,
    onAdd: () => void,
    placeholder: string,
    metaField?: string,
  ) => (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: tags.length > 0 ? 4 : 0 }}>
        {tags.map((tag) => (
          <span key={tag} style={tagStyle}>
            {tag}
            <X
              size={12}
              style={{ cursor: 'pointer', opacity: 0.7 }}
              onClick={() => {
                const newTags = tags.filter(t => t !== tag);
                setTags(newTags);
                if (metaField) updateLocalMetadataField(currentModelPath, metaField, newTags.length > 0 ? newTags : undefined);
              }}
            />
          </span>
        ))}
      </div>
      <input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd();
          }
        }}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );

  // Determine if we show left panel (multi-model mode)
  const showLeftPanel = modelList.length > 1;

  // Render a single list item
  const renderListItem = (m: string) => {
    const nick = localMetadata[m]?.nickname;
    const label = nick || getDisplayName(m);
    const isActive = m === currentModelPath;
    const cat = localMetadata[m]?.category;
    const itemColor = cat ? categoryColorMap[cat] : undefined;
    return (
      <ListItem
        key={m}
        label={label}
        active={isActive}
        onClick={() => handleModelSwitch(m)}
        color={itemColor}
      />
    );
  };

  const content = (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10010,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 12,
          padding: 0,
          width: showLeftPanel ? 'min(92vw, 860px)' : 480,
          height: showLeftPanel ? 'min(85vh, 720px)' : undefined,
          maxHeight: showLeftPanel ? undefined : '80vh',
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* ─── Left Panel: Model List ─── */}
        {showLeftPanel && (
          <div style={{
            width: 280,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}>
            {/* Search + Filter area (fixed) */}
            <div style={{ padding: 16, paddingBottom: 0, flexShrink: 0 }}>
              {/* Search box */}
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索..."
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    padding: '6px 10px 6px 30px',
                    fontSize: 13,
                    width: '100%',
                    color: 'var(--color-text)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    userSelect: 'text',
                  }}
                />
              </div>
              {/* Category filter pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                <CategoryPill label="全部" active={selectedCategory === null} onClick={() => setSelectedCategory(null)} />
                {allCategories.map(cat => (
                  <CategoryPill key={cat} label={cat} active={selectedCategory === cat} onClick={() => setSelectedCategory(cat)} color={categoryColorMap[cat]} />
                ))}
                {hasUncategorized && (
                  <CategoryPill label="未分类" active={selectedCategory === '__uncategorized__'} onClick={() => setSelectedCategory('__uncategorized__')} />
                )}
              </div>
            </div>

            {/* Scrollable list area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
              {groupedModels ? (
                // "全部" view: grouped by category
                groupedModels.map(group => {
                  const groupColor = group.label === '未分类' ? undefined : categoryColorMap[group.label];
                  return (
                    <div key={group.label} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', padding: '6px 0 2px', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {groupColor && <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: groupColor, flexShrink: 0 }} />}
                        {group.label}
                      </div>
                      {group.items.map(m => renderListItem(m))}
                    </div>
                  );
                })
              ) : (
                // Specific category view: flat list
                filteredModels.map(m => renderListItem(m))
              )}
              {filteredModels.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '16px 0', textAlign: 'center' }}>无匹配项</div>
              )}
            </div>

            {/* Item count footer */}
            <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--color-text-secondary)', flexShrink: 0, borderTop: '1px solid var(--color-border)' }}>
              {filteredModels.length === modelList.length
                ? `共 ${modelList.length} 项`
                : `${filteredModels.length} / ${modelList.length} 项`
              }
            </div>
          </div>
        )}

        {/* ─── Right Panel: Edit Form ─── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          position: 'relative',
        }}>
          {/* Close button - absolute top right */}
          <X
            size={18}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 1, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
            onClick={onClose}
          />
          {/* Hidden file input for thumbnail upload */}
          <input
            ref={thumbnailInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleThumbnailUpload(file);
              e.target.value = '';
            }}
          />

          {/* Scrollable form area */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: showLeftPanel ? '16px 24px 0' : '24px 24px 0',
          }}>
            {/* 基础信息 */}
            <div style={{ ...sectionTitle, marginTop: 0 }}>基础信息</div>
            {/* 缩略图 + Nickname/Category 水平并排 */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* 缩略图 */}
              <div style={{ width: thumbSize, height: thumbSize, minWidth: thumbSize, minHeight: thumbSize, flexShrink: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
                {(localThumbUrl || thumbUrl) ? (
                  <img
                    src={localThumbUrl || thumbUrl!}
                    alt="thumbnail"
                    onClick={() => thumbnailInputRef.current?.click()}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                  />
                ) : (
                  <div
                    onClick={() => thumbnailInputRef.current?.click()}
                    style={{
                      width: thumbSize,
                      height: thumbSize,
                      borderRadius: 8,
                      border: '2px dashed var(--color-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      boxSizing: 'border-box',
                    }}
                  >
                    <ImagePlus size={20} />
                    <span style={{ fontSize: 11 }}>上传</span>
                  </div>
                )}
              </div>
              {/* Nickname + Category */}
              <div ref={fieldsRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Nickname</div>
                  <input value={nickname} onChange={(e) => { setNickname(e.target.value); updateLocalMetadataField(currentModelPath, 'nickname', e.target.value || undefined); }} placeholder="输入昵称" style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Category</div>
                  <select
                    value={category}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      setCategory(newCat);
                      updateLocalMetadataField(currentModelPath, 'category', newCat || undefined);
                    }}
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: 'var(--color-text)',
                      fontSize: 14,
                      width: '100%',
                      outline: 'none',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box' as const,
                      userSelect: 'text' as const,
                    }}
                  >
                    <option value="">无分类</option>
                    {allCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {/* Trigger Words 全宽另起一行 */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Trigger Words</div>
              <textarea
                value={triggerWords}
                onChange={(e) => { setTriggerWords(e.target.value); updateLocalMetadataField(currentModelPath, 'triggerWords', e.target.value || undefined); }}
                placeholder="输入触发词"
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', userSelect: 'text' }}
              />
            </div>

            {/* AI Agent 增强 */}
            <div style={sectionTitle}>AI Agent 增强</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Description</span>
                  <span style={{ color: '#ef4444' }}>*</span>
                  <span title="一句话描述该模型/LoRA的特点和风格，用于AI Agent理解和推荐"><HelpCircle size={14} style={{ color: 'var(--color-text-secondary)', cursor: 'help' }} /></span>
                </div>
                <input value={description} onChange={(e) => { setDescription(e.target.value); updateLocalMetadataField(currentModelPath, 'description', e.target.value || undefined); }} placeholder="一句话描述（如：甜美日系风，色彩鲜艳）" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Style Tags</span>
                  <span style={{ color: '#ef4444' }}>*</span>
                  <span title="该模型/LoRA擅长的风格标签，如：甜美、暗黑、赛博朋克。用于风格匹配推荐"><HelpCircle size={14} style={{ color: 'var(--color-text-secondary)', cursor: 'help' }} /></span>
                </div>
                {renderTagInput(styleTags, setStyleTags, styleTagInput, setStyleTagInput, handleAddStyleTag, '输入风格标签后按 Enter 添加', 'styleTags')}
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Keywords</span>
                  <span title="用于自然语言匹配的关键词，如角色名、别名。用户说出这些词时能匹配到此项"><HelpCircle size={14} style={{ color: 'var(--color-text-secondary)', cursor: 'help' }} /></span>
                </div>
                {renderTagInput(keywords, setKeywords, keywordInput, setKeywordInput, handleAddKeyword, '输入关键词后按 Enter 添加', 'keywords')}
              </div>
              {isLora && (
                <>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>Compatible Models</span>
                      <span title="该LoRA兼容的基础模型系列，用于避免不兼容的组合推荐"><HelpCircle size={14} style={{ color: 'var(--color-text-secondary)', cursor: 'help' }} /></span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 16 }}>
                      {['光辉系列', 'PONY系列'].map((model) => (
                        <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={compatibleModels.includes(model)}
                            onChange={() => toggleCompatible(model)}
                            style={{ accentColor: 'var(--color-primary)' }}
                          />
                          {model}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>Recommended Strength</span>
                      <span title="推荐的LoRA强度值，AI Agent会参考此值设置默认强度"><HelpCircle size={14} style={{ color: 'var(--color-text-secondary)', cursor: 'help' }} /></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range"
                        min={0} max={2} step={0.05}
                        value={recommendedStrength}
                        onChange={(e) => { const v = parseFloat(e.target.value); setRecommendedStrength(v); updateLocalMetadataField(currentModelPath, 'recommendedStrength', v); }}
                        style={{ flex: 1, accentColor: 'var(--color-primary)' }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--color-text)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {recommendedStrength.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Spacer so content doesn't stick to bottom buttons */}
            <div style={{ height: 16 }} />
          </div>

          {/* Bottom buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: showLeftPanel ? '12px 24px' : '16px 24px 24px', flexShrink: 0, borderTop: '1px solid var(--color-border)' }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-secondary)',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              关闭
            </button>
            <button
              onClick={() => handleSave()}
              disabled={saving}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
                fontFamily: 'inherit',
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ─── ListItem 列表项组件 ──────────────────────────────────────────────────
function ListItem({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 32,
        padding: '4px 10px',
        fontSize: 13,
        color: color || 'var(--color-text)',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        backgroundColor: active
          ? 'var(--color-surface-hover)'
          : hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        transition: 'background-color 0.1s',
        userSelect: 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}
