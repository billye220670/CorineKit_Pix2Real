import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, X, Trash2 } from 'lucide-react';
import { useFavoriteFaces, type FavoriteFace } from '../hooks/useFavoriteFaces.js';

interface FavoriteFacesMenuProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
  onImport: (fav: FavoriteFace) => void;
}

export function FavoriteFacesMenu({ anchorRect, onClose, onImport }: FavoriteFacesMenuProps) {
  const list = useFavoriteFaces((s) => s.list);
  const loading = useFavoriteFaces((s) => s.loading);
  const loaded = useFavoriteFaces((s) => s.loaded);
  const load = useFavoriteFaces((s) => s.load);
  const remove = useFavoriteFaces((s) => s.remove);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  // 点击外部关闭（延迟一帧绑定，避免打开瞬间立即关闭）
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!anchorRect) return null;

  const menuWidth = 340;
  const menuMaxHeight = 460;
  const margin = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = anchorRect.right - menuWidth;
  if (left < margin) left = margin;
  if (left + menuWidth > viewportW - margin) left = Math.max(margin, viewportW - menuWidth - margin);

  let top = anchorRect.bottom + 6;
  if (top + menuMaxHeight > viewportH - margin) {
    // 若底部放不下则向上弹出
    top = Math.max(margin, anchorRect.top - menuMaxHeight - 6);
  }

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top,
        left,
        width: menuWidth,
        maxHeight: menuMaxHeight,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        boxShadow: '0 10px 32px rgba(0,0,0,0.28)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Star size={14} color="#f5a623" fill="#f5a623" strokeWidth={2} />
          收藏的面容 · {list.length}
        </span>
        <button
          onClick={onClose}
          title="关闭"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, minHeight: 0 }}>
        {loading && !loaded ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 12, padding: 24 }}>
            加载中...
          </div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 12, padding: 24, lineHeight: 1.6 }}>
            还没有收藏的面容
            <br />
            点击脸部卡片下方的 ⭐ 即可收藏
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {list.map((fav) => (
              <FavoriteItem
                key={fav.id}
                fav={fav}
                onImport={() => onImport(fav)}
                onRemove={() => remove(fav.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface FavoriteItemProps {
  fav: FavoriteFace;
  onImport: () => void;
  onRemove: () => void;
}

function FavoriteItem({ fav, onImport, onRemove }: FavoriteItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onImport}
      title={`${fav.originalName}\n点击导入到脸部参考`}
      style={{
        position: 'relative',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        border: '1px solid var(--color-border)',
        aspectRatio: '1 / 1',
        backgroundColor: 'var(--color-bg)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        transform: hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 4px 12px rgba(0,0,0,0.18)' : 'none',
      }}
    >
      <img
        src={fav.url}
        alt={fav.originalName}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {hover && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="取消收藏"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.65)',
            border: 'none',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
