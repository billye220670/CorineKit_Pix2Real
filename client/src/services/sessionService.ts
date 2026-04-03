// client/src/services/sessionService.ts
// Typed API wrappers for the session persistence backend.

export interface Text2ImgConfig {
  model: string;
  loraModel: string;
  loraEnabled: boolean;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface ZitConfig {
  unetModel: string;
  loraModel: string;
  loraEnabled: boolean;
  shiftEnabled: boolean;
  shift: number;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface SessionMeta {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedImage {
  id: string;
  originalName: string;
  ext: string;
}

export interface SerializedTask {
  promptId: string;
  status: string;
  progress: number;
  outputs: Array<{ filename: string; url: string }>;
  error?: string;
}

export interface SerializedTabData {
  images: SerializedImage[];
  prompts: Record<string, string>;
  tasks: Record<string, SerializedTask>;
  selectedOutputIndex: Record<string, number>;
  backPoseToggles: Record<string, boolean>;
  text2imgConfigs?: Record<string, Text2ImgConfig>;
  zitConfigs?: Record<string, ZitConfig>;
  faceSwapZones?: Record<string, 'face' | 'target'>;
}

export interface SessionData {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  activeTab: number;
  tabData: Record<number, SerializedTabData>;
}

// Upload an input image to the session directory.
// Returns the persistent URL for that image.
export async function uploadSessionImage(
  sessionId: string,
  tabId: number,
  imageId: string,
  file: File,
): Promise<string> {
  const fd = new FormData();
  fd.append('image', file, file.name);
  fd.append('tabId', String(tabId));
  fd.append('imageId', imageId);
  const res = await fetch(`/api/session/${sessionId}/images`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Failed to upload session image: ${res.status}`);
  const data = await res.json() as { url: string };
  return data.url;
}

// Upload a mask PNG blob to the session directory.
export async function uploadSessionMask(
  sessionId: string,
  tabId: number,
  maskKey: string,
  blob: Blob,
): Promise<void> {
  const fd = new FormData();
  fd.append('mask', blob, 'mask.png');
  fd.append('tabId', String(tabId));
  fd.append('maskKey', maskKey);
  const res = await fetch(`/api/session/${sessionId}/masks`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Failed to upload session mask: ${res.status}`);
}

// Save (overwrite) the full serializable store state for a session.
export async function putSessionState(
  sessionId: string,
  state: { activeTab: number; tabData: Record<number, SerializedTabData> },
): Promise<void> {
  const res = await fetch(`/api/session/${sessionId}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`Failed to save session state: ${res.status}`);
}

// Load an existing session by ID.  Returns null if not found.
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const res = await fetch(`/api/session/${sessionId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json() as Promise<SessionData>;
}

// List the most recent sessions (up to 5).
export async function listSessions(): Promise<SessionMeta[]> {
  const res = await fetch('/api/session');
  if (!res.ok) return [];
  return res.json() as Promise<SessionMeta[]>;
}

// Delete a session.
export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
}
