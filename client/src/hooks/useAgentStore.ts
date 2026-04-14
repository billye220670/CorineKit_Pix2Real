import { create } from 'zustand';

interface FavoriteEntry {
  tabId: number;
  favoritedAt: number;
}

interface AgentState {
  favorites: Record<string, FavoriteEntry>;
  setFavorites: (favorites: Record<string, FavoriteEntry>) => void;
  toggleFavorite: (sessionId: string, imageId: string, tabId: number) => void;
  isFavorited: (imageId: string) => boolean;
  loadFavorites: (sessionId: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  favorites: {},

  setFavorites: (favorites) => set({ favorites }),

  toggleFavorite: (sessionId, imageId, tabId) => {
    const current = get().favorites;
    const wasF = imageId in current;
    const next = { ...current };
    if (wasF) {
      delete next[imageId];
    } else {
      next[imageId] = { tabId, favoritedAt: Date.now() };
    }
    set({ favorites: next });
    // Fire-and-forget persist
    fetch('/api/agent/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, imageId, tabId, isFavorited: !wasF }),
    }).catch((err) => console.warn('[AgentStore] Failed to persist favorite:', err));
  },

  isFavorited: (imageId) => imageId in get().favorites,

  loadFavorites: async (sessionId) => {
    try {
      const res = await fetch(`/api/agent/favorites?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      set({ favorites: data });
    } catch (err) {
      console.warn('[AgentStore] Failed to load favorites:', err);
    }
  },
}));
