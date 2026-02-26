// client/src/hooks/useSession.ts
// Central session management: init, restore, auto-save via store subscriptions.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from './useWorkflowStore.js';
import { useMaskStore, type MaskEntry } from './useMaskStore.js';
import {
  uploadSessionImage,
  uploadSessionMask,
  putSessionState,
  getSession,
  type SerializedTabData,
} from '../services/sessionService.js';
import type { ImageItem } from '../types/index.js';

const SESSION_ID_KEY = 'pix2real_session_id';

function generateSessionId(): string {
  return crypto.randomUUID();
}

function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = generateSessionId();
    localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

// Convert a MaskEntry's RGBA pixel data to a grayscale PNG Blob (alpha>0 → white).
function maskEntryToBlob(entry: MaskEntry): Promise<Blob> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = entry.workingWidth;
    canvas.height = entry.workingHeight;
    const ctx = canvas.getContext('2d')!;
    const id = ctx.createImageData(entry.workingWidth, entry.workingHeight);
    for (let i = 0; i < entry.data.length; i += 4) {
      const v = entry.data[i + 3] > 0 ? 255 : 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}

// Fetch a session image URL and reconstruct a File object from it.
async function fetchAsFile(url: string, originalName: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch session image: ${url}`);
  const blob = await res.blob();
  return new File([blob], originalName, { type: blob.type });
}

// Decode a mask PNG from a URL back to a MaskEntry (RGBA pixel data).
async function fetchMaskEntry(url: string): Promise<MaskEntry> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mask: ${url}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  // Restore RGBA: white pixel → fully opaque (alpha=255), black → transparent (alpha=0)
  const rgba = new Uint8ClampedArray(imgData.data.length);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const isWhite = imgData.data[i] > 127;
    rgba[i] = isWhite ? 255 : 0;
    rgba[i + 1] = isWhite ? 255 : 0;
    rgba[i + 2] = isWhite ? 255 : 0;
    rgba[i + 3] = isWhite ? 255 : 0;
  }
  return {
    data: rgba,
    workingWidth: bitmap.width,
    workingHeight: bitmap.height,
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
  };
}

const NAMES_KEY = 'pix2real_session_names';

export interface UseSessionReturn {
  sessionId: string;
  lastSavedAt: Date | null;
  newSession: (name?: string) => void;
}

export function useSession(): UseSessionReturn {
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateSessionId());
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which (tab:imageId) have already been uploaded to avoid re-uploading
  const uploadedImages = useRef<Set<string>>(new Set());
  // Track which maskKeys have already been saved
  const savedMasks = useRef<Set<string>>(new Set());
  // Flag to avoid saving during restore
  const isRestoring = useRef(true);

  // ── Serialize store state (strips File objects) ──────────────────────────
  const serializeState = useCallback((): { activeTab: number; tabData: Record<number, SerializedTabData> } => {
    const state = useWorkflowStore.getState();
    const serializedTabData: Record<number, SerializedTabData> = {};
    for (let tab = 0; tab <= 5; tab++) {
      const td = state.tabData[tab];
      if (!td) continue;
      serializedTabData[tab] = {
        images: td.images.map((img) => ({
          id: img.id,
          originalName: img.originalName,
          ext: img.originalName.includes('.')
            ? ('.' + img.originalName.split('.').pop()!.toLowerCase())
            : '.png',
        })),
        prompts: td.prompts,
        tasks: td.tasks,
        selectedOutputIndex: td.selectedOutputIndex,
        backPoseToggles: td.backPoseToggles,
      };
    }
    return { activeTab: state.activeTab, tabData: serializedTabData };
  }, []);

  const doSaveState = useCallback(async () => {
    if (isRestoring.current) return;
    try {
      await putSessionState(sessionIdRef.current, serializeState());
      setLastSavedAt(new Date());
    } catch (err) {
      console.warn('[Session] Failed to save state:', err);
    }
  }, [serializeState]);

  const scheduleSaveState = useCallback(() => {
    if (isRestoring.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { void doSaveState(); }, 500);
  }, [doSaveState]);

  // ── Subscribe to workflow store changes ──────────────────────────────────
  useEffect(() => {
    const unsub = useWorkflowStore.subscribe((state, prevState) => {
      if (isRestoring.current) return;

      // Detect new images and upload them
      for (let tab = 0; tab <= 5; tab++) {
        const prevImages = prevState.tabData[tab]?.images ?? [];
        const currImages = state.tabData[tab]?.images ?? [];
        const prevIds = new Set(prevImages.map((i) => i.id));
        for (const img of currImages) {
          const key = `${tab}:${img.id}`;
          if (!prevIds.has(img.id) && !uploadedImages.current.has(key)) {
            uploadedImages.current.add(key);
            // Upload image async, then update sessionUrl in store if successful
            void (async () => {
              try {
                const url = await uploadSessionImage(sessionIdRef.current, tab, img.id, img.file);
                // Patch sessionUrl onto the image in the store
                useWorkflowStore.setState((s) => {
                  const td = s.tabData[tab];
                  if (!td) return s;
                  return {
                    tabData: {
                      ...s.tabData,
                      [tab]: {
                        ...td,
                        images: td.images.map((i) =>
                          i.id === img.id ? { ...i, sessionUrl: url } : i
                        ),
                      },
                    },
                  };
                });
                // After upload, save state so session.json references updated sessionUrl
                scheduleSaveState();
              } catch (err) {
                console.warn(`[Session] Failed to upload image ${img.id}:`, err);
              }
            })();
          }
        }
      }

      // Detect meaningful state changes and schedule a save
      if (state.tabData !== prevState.tabData) {
        scheduleSaveState();
      }
    });
    return unsub;
  }, [scheduleSaveState]);

  // ── Subscribe to mask store changes ─────────────────────────────────────
  useEffect(() => {
    const unsub = useMaskStore.subscribe((state, prevState) => {
      if (isRestoring.current) return;
      for (const [key, entry] of Object.entries(state.masks)) {
        if (prevState.masks[key] !== entry) {
          savedMasks.current.add(key);
          // Derive tabId from maskKey: key = "img_<timestamp>_<counter>:<outputIndex>"
          // We need to find which tab this image belongs to
          const imageId = key.split(':')[0];
          const storeState = useWorkflowStore.getState();
          let tabId = 0;
          for (let tab = 0; tab <= 5; tab++) {
            if (storeState.tabData[tab]?.images.some((i) => i.id === imageId)) {
              tabId = tab;
              break;
            }
          }
          void (async () => {
            try {
              const blob = await maskEntryToBlob(entry);
              await uploadSessionMask(sessionIdRef.current, tabId, key, blob);
            } catch (err) {
              console.warn(`[Session] Failed to save mask ${key}:`, err);
            }
          })();
        }
      }
    });
    return unsub;
  }, []);

  // ── Load & restore on mount ──────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const session = await getSession(sessionId);
        if (!session) {
          isRestoring.current = false;
          return;
        }

        const restoredImages: Record<number, ImageItem[]> = {};
        const restoredMasks: Record<string, MaskEntry> = {};

        for (let tab = 0; tab <= 5; tab++) {
          const td = session.tabData[tab];
          if (!td) continue;

          const images: ImageItem[] = [];
          for (const imgMeta of td.images) {
            const sessionUrl = `/api/session-files/${sessionId}/tab-${tab}/input/${imgMeta.id}${imgMeta.ext}`;
            try {
              const file = await fetchAsFile(sessionUrl, imgMeta.originalName);
              const blobUrl = URL.createObjectURL(file);
              images.push({
                id: imgMeta.id,
                file,
                previewUrl: blobUrl,
                originalName: imgMeta.originalName,
                sessionUrl,
              });
              // Mark as already uploaded so we don't re-upload on subscription trigger
              uploadedImages.current.add(`${tab}:${imgMeta.id}`);
            } catch {
              console.warn(`[Session] Could not restore image ${imgMeta.id} for tab ${tab}`);
            }
          }
          restoredImages[tab] = images;

          // Restore masks by probing known paths
          for (const img of td.images) {
            for (const suffix of ['-1', '0', '1', '2', '3', '4']) {
              const maskKey = `${img.id}:${suffix}`;
              const safeName = maskKey.replace(/:/g, '_');
              const maskUrl = `/api/session-files/${sessionId}/tab-${tab}/masks/${safeName}.png`;
              try {
                const headRes = await fetch(maskUrl, { method: 'HEAD' });
                if (!headRes.ok) continue;
                const entry = await fetchMaskEntry(maskUrl);
                restoredMasks[maskKey] = entry;
                savedMasks.current.add(maskKey);
              } catch { /* mask doesn't exist, skip */ }
            }
          }
        }

        useWorkflowStore.getState().restoreSession(session.activeTab, session.tabData, restoredImages);
        useMaskStore.getState().restoreAllMasks(restoredMasks);
        setLastSavedAt(new Date(session.updatedAt));
      } catch (err) {
        console.warn('[Session] Failed to restore session:', err);
      } finally {
        isRestoring.current = false;
      }
    })();
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── beforeunload flush ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      const state = serializeState();
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      navigator.sendBeacon(`/api/session/${sessionIdRef.current}/state`, blob);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [serializeState]);

  // ── New session ──────────────────────────────────────────────────────────
  const newSession = useCallback((name?: string) => {
    const id = generateSessionId();
    localStorage.setItem(SESSION_ID_KEY, id);
    if (name?.trim()) {
      const names = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
      names[id] = name.trim();
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    }
    setSessionId(id);
    sessionIdRef.current = id;
    uploadedImages.current.clear();
    savedMasks.current.clear();
    setLastSavedAt(null);
    // Reset store to empty state
    useWorkflowStore.getState().restoreSession(0, {}, {});
    useMaskStore.getState().restoreAllMasks({});
  }, []);

  return { sessionId, lastSavedAt, newSession };
}
