import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { LoraSlot } from '../services/sessionService';
import tagDataDefault from '../data/tagData.json';

interface PromptContextMenuProps {
  x: number;
  y: number;
  loras: LoraSlot[];
  getNickname: (model: string) => string | null;
  getTriggerWords: (model: string) => string | null;
  onInsert: (text: string) => void;
  onClose: () => void;
}

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

// ── helpers ──

function extractModelName(modelPath: string): string {
  const name = modelPath.split(/[/\\]/).pop() || modelPath;
  return name.replace(/\.[^.]+$/, '');
}

function loadTagData(): TagData {
  try {
    const raw = localStorage.getItem('tagData');
    if (raw) return JSON.parse(raw) as TagData;
  } catch { /* fall through */ }
  return tagDataDefault as TagData;
}

// ── styles ──

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  zIndex: 10000,
  padding: '4px 0',
  minWidth: 140,
  maxHeight: '70vh',
  overflowY: 'auto',
};

const itemBase: React.CSSProperties = {
  padding: '6px 12px 6px 12px',
  fontSize: 12,
  color: 'var(--color-text)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  position: 'relative',
  userSelect: 'none',
};

const disabledStyle: React.CSSProperties = {
  ...itemBase,
  color: 'var(--color-text-secondary)',
  opacity: 0.6,
  cursor: 'default',
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--color-border)',
  margin: '4px 0',
};

const arrowStyle: React.CSSProperties = {
  position: 'absolute',
  left: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  pointerEvents: 'none',
};

// ── SubMenu (recursive) ──

interface SubMenuProps {
  items: SubMenuItem[];
  parentRect: DOMRect;
}

type SubMenuItem =
  | { type: 'action'; label: string; onClick: () => void }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; children: SubMenuItem[] };

function SubMenu({ items, parentRect }: SubMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = parentRect.left - rect.width;
    let top = parentRect.top;
    if (left < 0) {
      left = parentRect.right;
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, window.innerHeight - rect.height);
    }
    setPos({ left, top });
  }, [parentRect]);

  return (
    <div
      ref={ref}
      style={{
        ...menuStyle,
        left: pos.left,
        top: pos.top,
      }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={`sep-${i}`} style={separatorStyle} />;
        }
        if (item.type === 'submenu') {
          const isOpen = openIdx === i;
          return (
            <div
              key={i}
              ref={(el) => { if (el) itemRefs.current.set(i, el); }}
              style={{ ...itemBase, padding: '6px 12px 6px 20px', background: isOpen ? 'rgba(128, 128, 128, 0.08)' : undefined }}
              onMouseEnter={() => setOpenIdx(i)}
              onMouseLeave={() => setOpenIdx(null)}
            >
              {item.label}
              <span style={arrowStyle}><ChevronLeft size={12} /></span>
              {isOpen && itemRefs.current.get(i) && (
                <SubMenu
                  items={item.children}
                  parentRect={itemRefs.current.get(i)!.getBoundingClientRect()}
                />
              )}
            </div>
          );
        }
        // action
        return (
          <MenuItem key={i} label={item.label} onClick={item.onClick} />
        );
      })}
    </div>
  );
}

// ── MenuItem ──

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ ...itemBase, background: hover ? 'rgba(128, 128, 128, 0.08)' : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
    </div>
  );
}

// ── Main Component ──

function PromptContextMenu({ x, y, loras, getNickname, getTriggerWords, onInsert, onClose }: PromptContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // adjust position if overflow
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) {
      left = Math.max(0, window.innerWidth - rect.width);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, y - rect.height);
    }
    setAdjustedPos({ left, top });
  }, [x, y]);

  const handleInsert = useCallback((text: string) => {
    onInsert(text);
    onClose();
  }, [onInsert, onClose]);

  // ── build lora items ──
  const enabledLoras = useMemo(
    () => loras.filter(l => l.enabled && l.model),
    [loras]
  );

  const loraMenuItems = useMemo(() => {
    return enabledLoras.map(lora => {
      const nickname = getNickname(lora.model);
      const label = nickname || extractModelName(lora.model);
      const raw = getTriggerWords(lora.model);
      const words = raw ? raw.split(',').map(w => w.trim()).filter(Boolean) : [];
      return { label, words, model: lora.model };
    });
  }, [enabledLoras, getNickname, getTriggerWords]);

  const hasAnyTrigger = loraMenuItems.some(l => l.words.length > 0);
  const showLoraSection = enabledLoras.length > 0 && hasAnyTrigger;

  // ── build tag items ──
  const tagData = useMemo(() => loadTagData(), []);

  function buildSubcategoryItems(sub: Subcategory): SubMenuItem {
    if (sub.subcategories && sub.subcategories.length > 0) {
      return {
        type: 'submenu',
        label: sub.label,
        children: sub.subcategories.map(s => buildSubcategoryItems(s)),
      };
    }
    if (sub.tags && sub.tags.length > 0) {
      return {
        type: 'submenu',
        label: sub.label,
        children: sub.tags.map(tag => ({
          type: 'action' as const,
          label: tag,
          onClick: () => handleInsert(tag),
        })),
      };
    }
    return { type: 'action', label: sub.label, onClick: () => {} };
  }

  // all menu entries: lora section + separator + tag section
  type MenuEntry =
    | { kind: 'disabled'; label: string }
    | { kind: 'lora'; label: string; words: string[] }
    | { kind: 'separator' }
    | { kind: 'category'; label: string; children: SubMenuItem[] };

  const entries = useMemo<MenuEntry[]>(() => {
    const result: MenuEntry[] = [];

    if (!showLoraSection) {
      result.push({ kind: 'disabled', label: '无可用触发词' });
    } else {
      for (const item of loraMenuItems) {
        if (item.words.length > 0) {
          result.push({ kind: 'lora', label: item.label, words: item.words });
        }
      }
      result.push({ kind: 'separator' });
    }

    if (showLoraSection) {
      // separator already added
    } else {
      // no separator needed per spec
    }

    for (const cat of tagData.categories) {
      result.push({
        kind: 'category',
        label: cat.label,
        children: cat.subcategories.map(s => buildSubcategoryItems(s)),
      });
    }

    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLoraSection, loraMenuItems, tagData, handleInsert]);

  return (
    <div
      ref={menuRef}
      style={{ ...menuStyle, left: adjustedPos.left, top: adjustedPos.top }}
    >
      {entries.map((entry, i) => {
        const key = `entry-${i}`;

        if (entry.kind === 'separator') {
          return <div key={key} style={separatorStyle} />;
        }

        if (entry.kind === 'disabled') {
          return (
            <div key={key} style={disabledStyle}>
              {entry.label}
            </div>
          );
        }

        if (entry.kind === 'lora') {
          const isOpen = openIdx === i;
          const children: SubMenuItem[] = [
            {
              type: 'action',
              label: '使用全部',
              onClick: () => handleInsert(entry.words.join(', ')),
            },
            { type: 'separator' },
            ...entry.words.map(w => ({
              type: 'action' as const,
              label: w,
              onClick: () => handleInsert(w),
            })),
          ];
          return (
            <div
              key={key}
              ref={(el) => { if (el) itemRefs.current.set(key, el); }}
              style={{ ...itemBase, padding: '6px 12px 6px 20px', background: isOpen ? 'rgba(128, 128, 128, 0.08)' : undefined }}
              onMouseEnter={() => setOpenIdx(i)}
              onMouseLeave={() => setOpenIdx(null)}
            >
              {entry.label}
              <span style={arrowStyle}><ChevronLeft size={12} /></span>
              {isOpen && itemRefs.current.get(key) && (
                <SubMenu
                  items={children}
                  parentRect={itemRefs.current.get(key)!.getBoundingClientRect()}
                />
              )}
            </div>
          );
        }

        // category
        if (entry.kind === 'category') {
          const isOpen = openIdx === i;
          return (
            <div
              key={key}
              ref={(el) => { if (el) itemRefs.current.set(key, el); }}
              style={{ ...itemBase, padding: '6px 12px 6px 20px', background: isOpen ? 'rgba(128, 128, 128, 0.08)' : undefined }}
              onMouseEnter={() => setOpenIdx(i)}
              onMouseLeave={() => setOpenIdx(null)}
            >
              {entry.label}
              <span style={arrowStyle}><ChevronLeft size={12} /></span>
              {isOpen && itemRefs.current.get(key) && (
                <SubMenu
                  items={entry.children}
                  parentRect={itemRefs.current.get(key)!.getBoundingClientRect()}
                />
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export default React.memo(PromptContextMenu);
