import { useState, useMemo } from 'react';
import { Edit2, Download, Upload } from 'lucide-react';
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

function flattenSubcategories(subs: Subcategory[]): Subcategory[] {
  const result: Subcategory[] = [];
  for (const sub of subs) {
    result.push(sub);
    if (sub.subcategories) {
      result.push(...flattenSubcategories(sub.subcategories));
    }
  }
  return result;
}

export function ModeTagAssemble() {
  const [tagData, setTagData] = useState<TagData>(tagDataDefault);
  const [selectedCat, setSelectedCat] = useState<string>(tagDataDefault.categories[0]?.id || '');
  const [selectedTags, setSelectedTags] = useState<Record<string, string[]>>({});
  const [editMode, setEditMode] = useState(false);

  // Compute result synchronously — accumulates tags from ALL categories
  const computedResult = useMemo(() => {
    const parts: string[] = [];
    for (const cat of tagData.categories) {
      for (const subcat of cat.subcategories) {
        const subs = flattenSubcategories([subcat]);
        for (const sub of subs) {
          if (selectedTags[sub.id]?.length) {
            parts.push(...selectedTags[sub.id]);
          }
        }
      }
    }
    return parts.join(', ');
  }, [selectedTags, tagData]);

  // result = computed value; user can override via typing, but tag changes reset it synchronously
  const [result, setResult] = useState(computedResult);
  const [prevComputed, setPrevComputed] = useState(computedResult);
  if (prevComputed !== computedResult) {
    setPrevComputed(computedResult);
    setResult(computedResult);
  }

  const handleSelectCategory = (catId: string) => {
    setSelectedCat(catId);
  };

  const handleTagToggle = (subcatId: string, tag: string) => {
    const subcat = findSubcategoryById(tagData, subcatId);
    if (!subcat) return;

    setSelectedTags((prev) => {
      const current = prev[subcatId] || [];
      if (subcat.multiSelect) {
        if (current.includes(tag)) {
          return { ...prev, [subcatId]: current.filter((t) => t !== tag) };
        } else {
          return { ...prev, [subcatId]: [...current, tag] };
        }
      } else {
        if (current.includes(tag)) {
          return { ...prev, [subcatId]: [] };
        } else {
          return { ...prev, [subcatId]: [tag] };
        }
      }
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
        setTagData(imported);
        localStorage.setItem('tagData', JSON.stringify(imported));
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
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
          分类
        </div>
        {tagData.categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleSelectCategory(cat.id)}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 8px',
              marginBottom: 4,
              background: selectedCat === cat.id ? 'var(--color-primary)' : 'transparent',
              border: '1px solid ' + (selectedCat === cat.id ? 'var(--color-primary)' : 'var(--color-border)'),
              borderRadius: 4,
              color: selectedCat === cat.id ? '#fff' : 'var(--color-text)',
              cursor: 'pointer',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Middle - Subcategories & Tags */}
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
            onTagDataChange={setTagData}
            tagData={tagData}
          />
        )}
      </div>

      {/* Right - Result & Controls */}
      <div style={{ width: 220, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <label style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
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

function SubcategoryList({
  subcategories,
  selectedTags,
  onTagToggle,
  editMode,
  onTagDataChange,
  tagData,
}: {
  subcategories: Subcategory[];
  selectedTags: Record<string, string[]>;
  onTagToggle: (id: string, tag: string) => void;
  editMode: boolean;
  onTagDataChange: (data: TagData) => void;
  tagData: TagData;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {subcategories.map((sub) => (
        <SubcategoryNode
          key={sub.id}
          subcategory={sub}
          selectedTags={selectedTags}
          onTagToggle={onTagToggle}
          editMode={editMode}
          onTagDataChange={onTagDataChange}
          tagData={tagData}
        />
      ))}
    </div>
  );
}

function SubcategoryNode({
  subcategory,
  selectedTags,
  onTagToggle,
  editMode,
  onTagDataChange,
  tagData,
}: {
  subcategory: Subcategory;
  selectedTags: Record<string, string[]>;
  onTagToggle: (id: string, tag: string) => void;
  editMode: boolean;
  onTagDataChange: (data: TagData) => void;
  tagData: TagData;
}) {
  const [expanded, setExpanded] = useState(true);

  if (subcategory.subcategories && subcategory.subcategories.length > 0) {
    return (
      <div style={{ marginBottom: 4 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
          }}
        >
          {expanded ? '▼' : '▶'} {subcategory.label}
        </button>
        {expanded && (
          <div style={{ marginTop: 6, marginLeft: 12 }}>
            <SubcategoryList
              subcategories={subcategory.subcategories}
              selectedTags={selectedTags}
              onTagToggle={onTagToggle}
              editMode={editMode}
              onTagDataChange={onTagDataChange}
              tagData={tagData}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
        {subcategory.label}
      </div>
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
    </div>
  );
}
