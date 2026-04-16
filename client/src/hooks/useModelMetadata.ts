import { useState, useEffect, useCallback } from 'react';

export interface ModelMetadata {
  thumbnail?: string;
  nickname?: string;
  triggerWords?: string;
  category?: string;
  // AI Agent 增强字段
  description?: string;
  styleTags?: string[];
  keywords?: string[];
  compatibleModels?: string[];       // 仅 LoRA：兼容的基础模型类型
  recommendedStrength?: number;       // 仅 LoRA：推荐强度
}

export function useModelMetadata() {
  const [metadata, setMetadata] = useState<Record<string, ModelMetadata>>({});

  const loadMetadata = useCallback(async () => {
    try {
      const res = await fetch('/api/models/metadata');
      if (!res.ok) return;
      const data: Record<string, ModelMetadata> = await res.json();
      setMetadata(data);
    } catch {
      // silent
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const uploadThumbnail = useCallback(async (modelPath: string, file: File) => {
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('modelPath', modelPath);
      const res = await fetch('/api/models/metadata/thumbnail', { method: 'POST', body: form });
      if (!res.ok) return;
      const data = await res.json();
      setMetadata((prev) => ({
        ...prev,
        [modelPath]: { ...prev[modelPath], thumbnail: data.thumbnail },
      }));
    } catch {
      // silent
    }
  }, []);

  const setNickname = useCallback(async (modelPath: string, nickname: string) => {
    try {
      const res = await fetch('/api/models/metadata/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath, nickname }),
      });
      if (!res.ok) return;
      setMetadata((prev) => ({
        ...prev,
        [modelPath]: { ...prev[modelPath], nickname },
      }));
    } catch {
      // silent
    }
  }, []);

  const removeThumbnail = useCallback(async (modelPath: string) => {
    try {
      const res = await fetch('/api/models/metadata/thumbnail', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath }),
      });
      if (!res.ok) return;
      setMetadata((prev) => {
        const next = { ...prev };
        if (next[modelPath]) {
          next[modelPath] = { ...next[modelPath] };
          delete next[modelPath].thumbnail;
        }
        return next;
      });
    } catch {
      // silent
    }
  }, []);

  const removeNickname = useCallback(async (modelPath: string) => {
    try {
      const res = await fetch('/api/models/metadata/nickname', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath }),
      });
      if (!res.ok) return;
      setMetadata((prev) => {
        const next = { ...prev };
        if (next[modelPath]) {
          next[modelPath] = { ...next[modelPath] };
          delete next[modelPath].nickname;
        }
        return next;
      });
    } catch {
      // silent
    }
  }, []);

  const getThumbnailUrl = useCallback((modelPath: string): string | null => {
    const thumb = metadata[modelPath]?.thumbnail;
    return thumb ? `/model_meta/thumbnails/${thumb}` : null;
  }, [metadata]);

  const getNickname = useCallback((modelPath: string): string | null => {
    return metadata[modelPath]?.nickname ?? null;
  }, [metadata]);

  const setTriggerWords = useCallback(async (modelPath: string, triggerWords: string) => {
    try {
      const res = await fetch('/api/models/metadata/trigger-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath, triggerWords }),
      });
      if (!res.ok) return;
      setMetadata((prev) => ({
        ...prev,
        [modelPath]: { ...prev[modelPath], triggerWords },
      }));
    } catch {
      // silent
    }
  }, []);

  const deleteTriggerWords = useCallback(async (modelPath: string) => {
    try {
      const res = await fetch('/api/models/metadata/trigger-words', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath }),
      });
      if (!res.ok) return;
      setMetadata((prev) => {
        const next = { ...prev };
        if (next[modelPath]) {
          next[modelPath] = { ...next[modelPath] };
          delete next[modelPath].triggerWords;
        }
        return next;
      });
    } catch {
      // silent
    }
  }, []);

  const getTriggerWords = useCallback((modelPath: string): string | null => {
    return metadata[modelPath]?.triggerWords ?? null;
  }, [metadata]);

  const setCategory = useCallback(async (modelPath: string, category: string) => {
    try {
      const res = await fetch('/api/models/metadata/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath, category }),
      });
      if (!res.ok) return;
      setMetadata((prev) => ({
        ...prev,
        [modelPath]: { ...prev[modelPath], category },
      }));
    } catch {
      // silent
    }
  }, []);

  const deleteCategory = useCallback(async (modelPath: string) => {
    try {
      const res = await fetch('/api/models/metadata/category', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath }),
      });
      if (!res.ok) return;
      setMetadata((prev) => {
        const next = { ...prev };
        if (next[modelPath]) {
          next[modelPath] = { ...next[modelPath] };
          delete next[modelPath].category;
        }
        return next;
      });
    } catch {
      // silent
    }
  }, []);

  const getCategory = useCallback((modelPath: string): string | null => {
    return metadata[modelPath]?.category ?? null;
  }, [metadata]);

  const updateMetadataFields = useCallback(async (modelPath: string, fields: Record<string, any>) => {
    try {
      const res = await fetch('/api/models/metadata/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath, fields }),
      });
      if (res.ok) {
        setMetadata(prev => {
          const updated = { ...prev };
          if (!updated[modelPath]) updated[modelPath] = {};
          for (const [key, value] of Object.entries(fields)) {
            if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
              delete (updated[modelPath] as any)[key];
            } else {
              (updated[modelPath] as any)[key] = value;
            }
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('[ModelMeta] Failed to update metadata:', err);
    }
  }, []);

  return {
    metadata,
    loadMetadata,
    uploadThumbnail,
    setNickname,
    removeThumbnail,
    removeNickname,
    getThumbnailUrl,
    getNickname,
    setTriggerWords,
    deleteTriggerWords,
    getTriggerWords,
    setCategory,
    deleteCategory,
    getCategory,
    updateMetadataFields,
  };
}
