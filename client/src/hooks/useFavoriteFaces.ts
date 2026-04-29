import { create } from 'zustand';

export interface FavoriteFace {
  id: string;
  originalName: string;
  url: string;
  addedAt: string;
}

interface FavoriteFacesStore {
  list: FavoriteFace[];
  loaded: boolean;
  loading: boolean;
  /** imageId → SHA-256 hash（用于判断脸部参考卡片当前收藏状态 & 导入去重） */
  imageHashCache: Record<string, string>;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 添加到收藏；返回新增或已存在的条目 */
  add: (file: File) => Promise<FavoriteFace | null>;
  /** 按 hash（后端 id）取消收藏 */
  remove: (id: string) => Promise<boolean>;
  /** 惰性计算并缓存图片 hash */
  ensureImageHash: (imageId: string, file: File) => Promise<string>;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const useFavoriteFaces = create<FavoriteFacesStore>((set, get) => ({
  list: [],
  loaded: false,
  loading: false,
  imageHashCache: {},

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch('/api/favorites/faces');
      if (res.ok) {
        const list = (await res.json()) as FavoriteFace[];
        set({ list, loaded: true });
      }
    } catch (err) {
      console.error('[favorites] load failed', err);
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    try {
      const res = await fetch('/api/favorites/faces');
      if (res.ok) {
        const list = (await res.json()) as FavoriteFace[];
        set({ list, loaded: true });
      }
    } catch (err) {
      console.error('[favorites] refresh failed', err);
    }
  },

  add: async (file) => {
    const formData = new FormData();
    formData.append('image', file, file.name);
    try {
      const res = await fetch('/api/favorites/faces', { method: 'POST', body: formData });
      if (!res.ok) return null;
      const fav = (await res.json()) as FavoriteFace;
      set((state) => {
        if (state.list.some((f) => f.id === fav.id)) return state;
        return { list: [fav, ...state.list] };
      });
      return fav;
    } catch (err) {
      console.error('[favorites] add failed', err);
      return null;
    }
  },

  remove: async (id) => {
    try {
      const res = await fetch(`/api/favorites/faces/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) return false;
      set((state) => ({ list: state.list.filter((f) => f.id !== id) }));
      return true;
    } catch (err) {
      console.error('[favorites] remove failed', err);
      return false;
    }
  },

  ensureImageHash: async (imageId, file) => {
    const cached = get().imageHashCache[imageId];
    if (cached) return cached;
    const hash = await computeFileHash(file);
    set((state) => {
      if (state.imageHashCache[imageId]) return state;
      return { imageHashCache: { ...state.imageHashCache, [imageId]: hash } };
    });
    return hash;
  },
}));
