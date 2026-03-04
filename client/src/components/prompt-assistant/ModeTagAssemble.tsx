import { useState, useEffect, useMemo } from 'react';
import { Edit2, Download, Upload, Plus, X, GripVertical } from 'lucide-react';
import tagDataDefault from '../../data/tagData.json';

interface TagData {
  categories: Category[];
}

interface Category {
  id: string;
  label: string;
  subcategories: Subcategory[];
}

interface Subcategory {
  id: string;
  label: string;
  multiSelect?: boolean;
  tags?: string[];
  subcategories?: Subcategory[];
}

const genId = () => `id_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

function flattenSubcategories(subs: Subcategory[]): Subcategory[] {
  const result: Subcategory[] = [];
  for (const sub of subs) {
    result.push(sub);
    if (sub.subcategories) result.push(...flattenSubcategories(sub.subcategories));
  }
  return result;
}

function findSubcategoryById(tagData: TagData, id: string): Subcategory | undefined {
  for (const cat of tagData.categories) {
    const found = findSubInList(cat.subcategories, id);
    if (found) return found;
  }
  return undefined;
}

function findSubInList(subs: Subcategory[], id: string): Subcategory | undefined {
  for (const sub of subs) {
    if (sub.id === id) return sub;
    if (sub.subcategories) {
      const found = findSubInList(sub.subcategories, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function ModeTagAssemble() {
  const [tagData, setTagData] = useState<TagData>(() => {
    try {
      const stored = localStorage.getItem('tagData');
      return stored ? JSON.parse(stored) : tagDataDefault;
    } catch {
      return tagDataDefault;
    }
  });
  const [selectedCat, setSelectedCat] = useState<string>(() => {
    return localStorage.getItem('tagAssemble_selectedCat') || tagData.categories[0]?.id || '';
  });
  const [selectedTags, setSelectedTags] = useState<Record<string, string[]>>(() => {
    try {
      const stored = localStorage.getItem('tagAssemble_selectedTags');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [editMode, setEditMode] = useState(false);
  const [catDragIndex, setCatDragIndex] = useState<number | null>(null);
  const [catDragOver, setCatDragOver] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem('tagAssemble_selectedCat', selectedCat);
  }, [selectedCat]);

  useEffect(() => {
    localStorage.setItem('tagAssemble_selectedTags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  const updateTagData = (newData: TagData) => {
    setTagData(newData);
    localStorage.setItem('tagData', JSON.stringify(newData));
  };

  const computedResult = useMemo(() => {
    const parts: string[] = [];
    for (const cat of tagData.categories) {
      for (const subcat of cat.subcategories) {
        const subs = flattenSubcategories([subcat]);
        for (const sub of subs) {
          if (selectedTags[sub.id]?.length) parts.push(...selectedTags[sub.id]);
        }
      }
    }
    return parts.join(', ');
  }, [selectedTags, tagData]);

  const [result, setResult] = useState(computedResult);
  const [prevComputed, setPrevComputed] = useState(computedResult);
  if (prevComputed !== computedResult) {
    setPrevComputed(computedResult);
    setResult(computedResult);
  }

  const handleTagToggle = (subcatId: string, tag: string) => {
    const subcat = findSubcategoryById(tagData, subcatId);
    if (!subcat) return;
    setSelectedTags((prev) => {
      const current = prev[subcatId] || [];
      if (subcat.multiSelect) {
        return {
          ...prev,
          [subcatId]: current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
        };
      } else {
        return { ...prev, [subcatId]: current.includes(tag) ? [] : [tag] };
      }
    });
  };

  const handleAddCategory = () => {
    const label = prompt('新建分类名称：');
    if (!label?.trim()) return;
    const newCat: Category = { id: genId(), label: label.trim(), subcategories: [] };
    updateTagData({ ...tagData, categories: [...tagData.categories, newCat] });
    setSelectedCat(newCat.id);
  };

  const handleDeleteCategory = (catId: string) => {
    if (!confirm('确认删除该分类及其所有内容？')) return;
    const newCats = tagData.categories.filter((c) => c.id !== catId);
    updateTagData({ ...tagData, categories: newCats });
    if (selectedCat === catId) setSelectedCat(newCats[0]?.id || '');
  };

  const handleRenameCategory = (catId: string) => {
    const cat = tagData.categories.find((c) => c.id === catId);
    if (!cat) return;
    const newLabel = prompt('修改分类名称：', cat.label);
    if (!newLabel?.trim()) return;
    updateTagData({
      ...tagData,
      categories: tagData.categories.map((c) => (c.id === catId ? { ...c, label: newLabel.trim() } : c)),
    });
  };

  const handleCatDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCatDragOver(index);
  };

  const handleCatDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (catDragIndex !== null && catDragIndex !== toIndex) {
      updateTagData({ ...tagData, categories: reorderArray(tagData.categories, catDragIndex, toIndex) });
    }
    setCatDragIndex(null);
    setCatDragOver(null);
  };

  const handleSubcategoriesChange = (catId: string, newSubs: Subcategory[]) => {
    updateTagData({
      ...tagData,
      categories: tagData.categories.map((c) => (c.id === catId ? { ...c, subcategories: newSubs } : c)),
    });
  };

  const handleExportTagData = () => {
    const json = JSON.stringify(tagData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tagData.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTagData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as TagData;
        updateTagData(imported);
        setSelectedCat(imported.categories[0]?.id || '');
        alert('导入成功');
      } catch (err) {
        alert('导入失败：' + (err instanceof Error ? err.message : '未知错误'));
      }
    };
    input.click();
  };

  const currentCat = tagData.categories.find((c) => c.id === selectedCat);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12 }}>
      {/* Left - Category List */}
      <div
        style={{
          width: 140,
          borderRight: '1px solid var(--color-border)',
          overflow: 'auto',
          paddingRight: 8,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 8,
            color: 'var(--color-text-secondary)',
            letterSpacing: '0.04em',
          }}
        >
          分类
        </div>
        {tagData.categories.map((cat, index) => (
          <CategoryItem
            key={cat.id}
            cat={cat}
            selected={selectedCat === cat.id}
            editMode={editMode}
            isDragOver={catDragOver === index}
            onSelect={() => setSelectedCat(cat.id)}
            onDelete={() => handleDeleteCategory(cat.id)}
            onRename={() => handleRenameCategory(cat.id)}
            onDragStart={(e) => {
              e.stopPropagation();
              setCatDragIndex(index);
            }}
            onDragOver={(e) => handleCatDragOver(e, index)}
            onDrop={(e) => handleCatDrop(e, index)}
            onDragEnd={() => {
              setCatDragIndex(null);
              setCatDragOver(null);
            }}
          />
        ))}
        {editMode && (
          <button
            onClick={handleAddCategory}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              width: '100%',
              padding: '6px 8px',
              marginTop: 4,
              background: 'transparent',
              border: '1px dashed var(--color-border)',
              borderRadius: 4,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <Plus size={12} /> 添加
          </button>
        )}
      </div>

      {/* Middle - Subcategories */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          borderRight: '1px solid var(--color-border)',
          paddingRight: 8,
        }}
      >
        {currentCat && (
          <SubcategoryList
            subcategories={currentCat.subcategories}
            selectedTags={selectedTags}
            onTagToggle={handleTagToggle}
            editMode={editMode}
            onChange={(newSubs) => handleSubcategoriesChange(currentCat.id, newSubs)}
          />
        )}
      </div>

      {/* Right - Result & Controls */}
      <div style={{ width: 220, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 6,
            color: 'var(--color-text-secondary)',
            letterSpacing: '0.04em',
          }}
        >
          组装结果
        </label>
        <textarea
          value={result}
          onChange={(e) => setResult(e.target.value)}
          style={{
            flex: 1,
            padding: 8,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            fontSize: 12,
            resize: 'none',
            marginBottom: 8,
            outline: 'none',
          }}
          placeholder="点击标签后实时组装..."
        />
        <div style={{ display: 'flex', gap: 6, flexDirection: 'column', fontSize: 12 }}>
          <button
            onClick={() => setEditMode(!editMode)}
            style={{
              padding: '6px 12px',
              background: editMode ? '#f59e0b' : 'transparent',
              color: editMode ? '#fff' : 'var(--color-text)',
              border: '1px solid ' + (editMode ? '#f59e0b' : 'var(--color-border)'),
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Edit2 size={14} /> {editMode ? '完成' : '编辑'}
          </button>
          <button
            onClick={handleExportTagData}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Download size={14} /> 导出
          </button>
          <button
            onClick={handleImportTagData}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Upload size={14} /> 导入
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- CategoryItem ----

function CategoryItem({
  cat,
  selected,
  editMode,
  isDragOver,
  onSelect,
  onDelete,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  cat: Category;
  selected: boolean;
  editMode: boolean;
  isDragOver: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable={editMode}
      onDragStart={editMode ? onDragStart : undefined}
      onDragOver={editMode ? onDragOver : undefined}
      onDrop={editMode ? onDrop : undefined}
      onDragEnd={editMode ? onDragEnd : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
        outline: isDragOver ? '2px dashed var(--color-primary)' : 'none',
        borderRadius: 4,
      }}
    >
      {editMode && (
        <GripVertical
          size={12}
          style={{ color: 'var(--color-text-secondary)', flexShrink: 0, cursor: 'grab' }}
        />
      )}
      <button
        onClick={onSelect}
        onDoubleClick={editMode ? onRename : undefined}
        style={{
          flex: 1,
          padding: '7px 8px',
          background: selected ? 'var(--color-primary)' : 'transparent',
          border: '1px solid ' + (selected ? 'var(--color-primary)' : 'var(--color-border)'),
          borderRadius: 4,
          color: selected ? '#fff' : 'var(--color-text)',
          cursor: 'pointer',
          fontSize: 12,
          textAlign: 'left',
        }}
      >
        {cat.label}
      </button>
      {editMode && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            flexShrink: 0,
            padding: 2,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ---- SubcategoryList ----


function SubcategoryList({
  subcategories,
  selectedTags,
  onTagToggle,
  editMode,
  onChange,
  depth = 0,
}: {
  subcategories: Subcategory[];
  selectedTags: Record<string, string[]>;
  onTagToggle: (id: string, tag: string) => void;
  editMode: boolean;
  onChange: (newSubs: Subcategory[]) => void;
  depth?: number;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const handleAdd = () => {
    const label = prompt('新建子分类名称：');
    if (!label?.trim()) return;
    const newSub: Subcategory = { id: genId(), label: label.trim(), multiSelect: true, tags: [] };
    onChange([...subcategories, newSub]);
  };

  const handleDelete = (index: number) => {
    if (!confirm('确认删除该子分类及其所有内容？')) return;
    onChange(subcategories.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, updated: Subcategory) => {
    onChange(subcategories.map((s, i) => (i === index ? updated : s)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: depth === 0 ? 8 : 6 }}>
      {subcategories.map((sub, index) => (
        <div
          key={sub.id}
          draggable={editMode}
          onDragStart={
            editMode
              ? (e) => {
                  e.stopPropagation();
                  setDragIndex(index);
                }
              : undefined
          }
          onDragOver={
            editMode
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(index);
                }
              : undefined
          }
          onDrop={
            editMode
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragIndex !== null && dragIndex !== index) {
                    onChange(reorderArray(subcategories, dragIndex, index));
                  }
                  setDragIndex(null);
                  setDragOver(null);
                }
              : undefined
          }
          onDragEnd={
            editMode
              ? () => {
                  setDragIndex(null);
                  setDragOver(null);
                }
              : undefined
          }
          style={{
            outline: dragOver === index ? '2px dashed var(--color-primary)' : 'none',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            padding: '8px 10px',
          }}
        >
          <SubcategoryNode
            subcategory={sub}
            selectedTags={selectedTags}
            onTagToggle={onTagToggle}
            editMode={editMode}
            onChange={(updated) => handleUpdate(index, updated)}
            onDelete={() => handleDelete(index)}
            depth={depth}
          />
        </div>
      ))}
      {editMode && (
        <button
          onClick={handleAdd}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '6px 8px',
            background: 'transparent',
            border: '1px dashed var(--color-border)',
            borderRadius: 4,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <Plus size={12} /> 添加子分类
        </button>
      )}
    </div>
  );
}

// ---- SubcategoryNode ----

function SubcategoryNode({
  subcategory,
  selectedTags,
  onTagToggle,
  editMode,
  onChange,
  onDelete,
  depth = 0,
}: {
  subcategory: Subcategory;
  selectedTags: Record<string, string[]>;
  onTagToggle: (id: string, tag: string) => void;
  editMode: boolean;
  onChange: (updated: Subcategory) => void;
  onDelete: () => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [tagsText, setTagsText] = useState(subcategory.tags?.join(', ') || '');
  const [tagsFocused, setTagsFocused] = useState(false);

  useEffect(() => {
    if (!tagsFocused) {
      setTagsText(subcategory.tags?.join(', ') || '');
    }
  }, [subcategory.tags, tagsFocused]);

  const handleRename = () => {
    const newLabel = prompt('修改名称：', subcategory.label);
    if (!newLabel?.trim()) return;
    onChange({ ...subcategory, label: newLabel.trim() });
  };

  const hasChildren = Boolean(subcategory.subcategories && subcategory.subcategories.length > 0);

  const header = (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hasChildren ? (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {expanded ? '▼' : '▶'} {subcategory.label}
        </button>
      ) : (
        <div
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 0',
            color: 'var(--color-text-secondary)',
          }}
        >
          {subcategory.label}
        </div>
      )}
      {editMode && (
        <>
          <button
            onClick={handleRename}
            style={{
              padding: 2,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              opacity: hovered ? 1 : 0,
              display: 'flex',
              alignItems: 'center',
              transition: 'opacity 0.15s',
            }}
          >
            <Edit2 size={10} />
          </button>
          <button
            onClick={onDelete}
            style={{
              padding: 2,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
              opacity: hovered ? 1 : 0,
              display: 'flex',
              alignItems: 'center',
              transition: 'opacity 0.15s',
            }}
          >
            <X size={10} />
          </button>
        </>
      )}
    </div>
  );

  if (hasChildren) {
    return (
      <div>
        {header}
        {expanded && (
          <div style={{ marginTop: 6 }}>
            <SubcategoryList
              subcategories={subcategory.subcategories!}
              selectedTags={selectedTags}
              onTagToggle={onTagToggle}
              editMode={editMode}
              onChange={(newSubs) => onChange({ ...subcategory, subcategories: newSubs })}
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    );
  }

  // Leaf node
  return (
    <div>
      {header}
      <div style={{ marginTop: 4 }}>
        {editMode ? (
          <textarea
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            onFocus={() => setTagsFocused(true)}
            onBlur={() => {
              setTagsFocused(false);
              const tags = tagsText
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
              onChange({ ...subcategory, tags });
            }}
            placeholder="输入标签，用逗号分隔"
            style={{
              width: '100%',
              padding: 6,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              color: 'var(--color-text)',
              fontFamily: 'inherit',
              fontSize: 11,
              resize: 'vertical',
              minHeight: 60,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {subcategory.tags?.map((tag) => {
              const isSelected = selectedTags[subcategory.id]?.includes(tag) ?? false;
              return (
                <button
                  key={tag}
                  onClick={() => onTagToggle(subcategory.id, tag)}
                  style={{
                    padding: '4px 8px',
                    background: isSelected ? 'var(--color-primary)' : 'var(--color-bg)',
                    color: isSelected ? '#fff' : 'var(--color-text)',
                    border: '1px solid ' + (isSelected ? 'var(--color-primary)' : 'var(--color-border)'),
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
