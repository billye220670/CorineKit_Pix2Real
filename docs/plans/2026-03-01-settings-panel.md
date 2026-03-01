# Settings Panel Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the settings modal with left-nav + right-scrolling layout, and add a "启动时行为" setting that controls whether the app restores the last session, starts a new one, or asks the user on each launch.

**Architecture:** Add `startupBehavior` to `useSettingsStore`; branch restore logic in `useSession` into three paths (restore / new / ask); render a blocking `StartupDialog` in `App` when the "ask" path is taken and a previous session exists. The settings modal gets a left sidebar (120 px) with `IntersectionObserver`-driven active highlighting and `scrollIntoView` navigation.

**Tech Stack:** React 18, TypeScript, Zustand, localStorage, IntersectionObserver API

---

### Task 1: Extend `useSettingsStore` with `startupBehavior`

**Files:**
- Modify: `client/src/hooks/useSettingsStore.ts`

**Step 1: Read the current file**

Read `client/src/hooks/useSettingsStore.ts` to understand the current shape.

**Step 2: Replace the file content**

```typescript
import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14';
export type StartupBehavior = 'restore' | 'new' | 'ask';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  startupBehavior: StartupBehavior;
  settingsOpen: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  startupBehavior: (localStorage.getItem('settings_startupBehavior') as StartupBehavior | null) ?? 'restore',
  settingsOpen: false,
  setReversePromptModel: (model) => {
    localStorage.setItem('settings_reversePromptModel', model);
    set({ reversePromptModel: model });
  },
  setStartupBehavior: (behavior) => {
    localStorage.setItem('settings_startupBehavior', behavior);
    set({ startupBehavior: behavior });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
```

**Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors on this file.

**Step 4: Commit**

```bash
git add client/src/hooks/useSettingsStore.ts
git commit -m "feat: add startupBehavior setting to useSettingsStore"
```

---

### Task 2: Refactor `useSession` to handle startup behavior branches

**Files:**
- Modify: `client/src/hooks/useSession.ts`

**Step 1: Read the current file**

Read `client/src/hooks/useSession.ts` in full.

**Step 2: Plan the changes**

Three changes needed:
1. Import `useSettingsStore`.
2. Add `startupDialog` state with type `StartupDialogState | null`.
3. Move the `newSession` useCallback definition ABOVE the "Load & restore on mount" useEffect (it has zero dependencies so this is safe).
4. In the mount effect, after fetching the session, branch on `startupBehavior`.
5. Extract inline restore logic into a local `doRestore` async function inside the effect.
6. Guard the `beforeunload` sendBeacon with `if (isRestoring.current) return`.
7. Add `startupDialog` to the return value.

**Step 3: Add the export type near the top of the file (after imports)**

Add these types after the existing imports:

```typescript
import { useSettingsStore } from './useSettingsStore.js';

// ... (existing code) ...

export interface StartupDialogState {
  onRestore: () => void;
  onStartNew: () => void;
}

export interface UseSessionReturn {
  sessionId: string;
  lastSavedAt: Date | null;
  newSession: (name?: string) => void;
  startupDialog: StartupDialogState | null;
}
```

**Step 4: Add `startupDialog` state inside the hook**

After the existing `useState` declarations, add:

```typescript
const [startupDialog, setStartupDialog] = useState<StartupDialogState | null>(null);
```

**Step 5: Move `newSession` before the mount effect**

Cut the entire `newSession` useCallback from its current position (near the bottom of the hook) and paste it directly BEFORE the `// ── Load & restore on mount ──` comment block. No code changes needed — just relocation.

**Step 6: Replace the mount `useEffect` body**

Replace the entire `// ── Load & restore on mount ──` useEffect with:

```typescript
// ── Load & restore on mount ──────────────────────────────────────────────
useEffect(() => {
  void (async () => {
    try {
      const session = await getSession(sessionId);
      const behavior = useSettingsStore.getState().startupBehavior;

      if (!session) {
        isRestoring.current = false;
        return;
      }

      // ── Restore logic (shared by all paths that restore) ────────────────
      const doRestore = async () => {
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
              uploadedImages.current.add(`${tab}:${imgMeta.id}`);
            } catch {
              console.warn(`[Session] Could not restore image ${imgMeta.id} for tab ${tab}`);
            }
          }
          restoredImages[tab] = images;

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
              } catch { /* mask doesn't exist */ }
            }
          }
        }

        useWorkflowStore.getState().restoreSession(session.activeTab, session.tabData, restoredImages);
        useMaskStore.getState().restoreAllMasks(restoredMasks);
        setLastSavedAt(new Date(session.updatedAt));
        isRestoring.current = false;
      };

      // ── Branch on startup behavior ──────────────────────────────────────
      if (behavior === 'restore') {
        await doRestore();
      } else if (behavior === 'new') {
        isRestoring.current = false;
        newSession();
      } else {
        // 'ask' — show dialog; keep isRestoring=true until user decides
        setStartupDialog({
          onRestore: () => {
            setStartupDialog(null);
            void doRestore();
          },
          onStartNew: () => {
            setStartupDialog(null);
            isRestoring.current = false;
            newSession();
          },
        });
      }
    } catch (err) {
      console.warn('[Session] Failed to restore session:', err);
      isRestoring.current = false;
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Step 7: Guard `beforeunload` sendBeacon**

In the `beforeunload` useEffect, add an early return at the top of the handler:

```typescript
const handler = () => {
  if (isRestoring.current) return; // don't overwrite session with empty state during startup
  // ... rest of existing handler unchanged ...
};
```

**Step 8: Update the return statement**

```typescript
return { sessionId, lastSavedAt, newSession, startupDialog };
```

**Step 9: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

**Step 10: Commit**

```bash
git add client/src/hooks/useSession.ts
git commit -m "feat: branch useSession restore logic on startupBehavior setting"
```

---

### Task 3: Create `StartupDialog` component

**Files:**
- Create: `client/src/components/StartupDialog.tsx`

**Step 1: Create the file**

```tsx
import type { StartupDialogState } from '../hooks/useSession.js';

export function StartupDialog({ onRestore, onStartNew }: StartupDialogState) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '28px 32px',
          width: 'min(90vw, 420px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
            发现上次会话
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            检测到上次未关闭的会话，是否继续？
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onStartNew}
            style={{
              padding: '8px 20px',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            开新会话
          </button>
          <button
            onClick={onRestore}
            style={{
              padding: '8px 20px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            恢复会话
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript**

```bash
cd client && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add client/src/components/StartupDialog.tsx
git commit -m "feat: add StartupDialog component for startup behavior ask mode"
```

---

### Task 4: Rewrite `SettingsModal` with left-nav layout

**Files:**
- Modify: `client/src/components/SettingsModal.tsx`

**Step 1: Read the current file**

Read `client/src/components/SettingsModal.tsx`.

**Step 2: Replace the entire file**

```tsx
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel, type StartupBehavior } from '../hooks/useSettingsStore.js';
import { SegmentedControl } from './SegmentedControl.js';

const REVERSE_PROMPT_MODELS: { value: ReversePromptModel; label: string }[] = [
  { value: 'Qwen3VL', label: 'Qwen3VL' },
  { value: 'Florence', label: 'Florence' },
  { value: 'WD-14', label: 'WD-14' },
];

const STARTUP_BEHAVIOR_OPTIONS: { value: StartupBehavior; label: string }[] = [
  { value: 'restore', label: '恢复上次' },
  { value: 'new', label: '开新会话' },
  { value: 'ask', label: '询问我' },
];

const CATEGORIES = [
  { id: 'workflow', label: '工作流' },
  { id: 'session', label: '会话' },
];

export function SettingsModal() {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const reversePromptModel = useSettingsStore((s) => s.reversePromptModel);
  const setReversePromptModel = useSettingsStore((s) => s.setReversePromptModel);
  const startupBehavior = useSettingsStore((s) => s.startupBehavior);
  const setStartupBehavior = useSettingsStore((s) => s.setStartupBehavior);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeSection, setActiveSection] = useState('workflow');

  // Escape key
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, closeSettings]);

  // IntersectionObserver — highlight the nav item whose section heading is nearest the top
  useEffect(() => {
    if (!settingsOpen) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-section');
            if (id) setActiveSection(id);
          }
        }
      },
      {
        root,
        threshold: 0,
        rootMargin: '-10% 0px -80% 0px', // triggers when section heading enters top 10% of scroll area
      }
    );
    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const scrollTo = (sectionId: string) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={closeSettings}
    >
      <div
        style={{
          width: 'min(92vw, 1200px)',
          height: 'min(90vh, 820px)',
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>设置</span>
          <button
            onClick={closeSettings}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 4, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-secondary)', borderRadius: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: left nav + right content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

          {/* Left nav */}
          <nav style={{
            width: 120,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border)',
            padding: '16px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            {CATEGORIES.map((cat) => {
              const active = activeSection === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => scrollTo(cat.id)}
                  style={{
                    textAlign: 'left',
                    padding: '7px 16px',
                    border: 'none',
                    background: active ? 'var(--color-surface-hover, rgba(255,255,255,0.06))' : 'transparent',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    borderRadius: 0,
                    transition: 'background-color 0.15s, color 0.15s',
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </nav>

          {/* Right scrolling content */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

            {/* ── Section: 工作流 ── */}
            <div
              ref={(el) => { sectionRefs.current['workflow'] = el; }}
              data-section="workflow"
            >
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
              }}>
                工作流
              </div>

              {/* Row: 反推模型 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: '1px solid var(--color-border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
                    反推模型
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    用于图像提示词反推的 AI 模型
                  </div>
                </div>
                <SegmentedControl
                  options={REVERSE_PROMPT_MODELS}
                  value={reversePromptModel}
                  onChange={(v) => setReversePromptModel(v as ReversePromptModel)}
                />
              </div>
            </div>

            <div style={{ height: 40 }} />

            {/* ── Section: 会话 ── */}
            <div
              ref={(el) => { sectionRefs.current['session'] = el; }}
              data-section="session"
            >
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
              }}>
                会话
              </div>

              {/* Row: 启动时行为 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: '1px solid var(--color-border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
                    启动时行为
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    打开应用时对上次会话的处理方式
                  </div>
                </div>
                <SegmentedControl
                  options={STARTUP_BEHAVIOR_OPTIONS}
                  value={startupBehavior}
                  onChange={(v) => setStartupBehavior(v as StartupBehavior)}
                />
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Verify TypeScript**

```bash
cd client && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add client/src/components/SettingsModal.tsx
git commit -m "feat: redesign SettingsModal with left-nav layout and 启动时行为 setting"
```

---

### Task 5: Wire `StartupDialog` into `App`

**Files:**
- Modify: `client/src/components/App.tsx`

**Step 1: Read the current file**

Read `client/src/components/App.tsx`.

**Step 2: Add the import**

Add after the existing `SettingsModal` import:

```tsx
import { StartupDialog } from './StartupDialog.js';
```

**Step 3: Destructure `startupDialog` from `useSession`**

The existing line:
```tsx
const { sessionId, lastSavedAt, newSession } = useSession();
```
Becomes:
```tsx
const { sessionId, lastSavedAt, newSession, startupDialog } = useSession();
```

**Step 4: Render `StartupDialog` alongside other modals**

Find the block near the bottom that has `<Toast />`, `<MaskEditor />`, `<SettingsModal />`. Add `<StartupDialog />` just before `<Toast />`:

```tsx
{startupDialog && (
  <StartupDialog
    onRestore={startupDialog.onRestore}
    onStartNew={startupDialog.onStartNew}
  />
)}
<Toast />
<MaskEditor />
<SettingsModal />
```

**Step 5: Verify TypeScript**

```bash
cd client && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add client/src/components/App.tsx
git commit -m "feat: render StartupDialog in App when startup behavior is ask"
```

---

### Task 6: Create `docs/settings-panel.md` developer reference

**Files:**
- Create: `docs/settings-panel.md`

**Step 1: Create the file**

```markdown
# Settings Panel — Developer Quick Reference

> See design doc: `docs/plans/2026-03-01-settings-panel-design.md`

## Architecture

The settings panel is a fixed-position modal rendered by `SettingsModal.tsx`.
State lives in `useSettingsStore` (Zustand, localStorage-persisted).
Layout: left sidebar (120 px) + right scrolling content area.

## Adding a New Setting

### 1. Decide the category

Current categories: `工作流` (id: `workflow`), `会话` (id: `session`).
To add a new category: add an entry to `CATEGORIES` in `SettingsModal.tsx` and create a new section `<div data-section="<id">` in the right content.

### 2. Add state to the store

In `client/src/hooks/useSettingsStore.ts`:

```typescript
// 1. Export the type
export type MyOption = 'a' | 'b';

// 2. Add to SettingsState interface
myOption: MyOption;
setMyOption: (v: MyOption) => void;

// 3. Initialize in create()
myOption: (localStorage.getItem('settings_myOption') as MyOption | null) ?? 'a',
setMyOption: (v) => {
  localStorage.setItem('settings_myOption', v);
  set({ myOption: v });
},
```

### 3. Add a row in SettingsModal

Each row follows this pattern:

```tsx
<div style={{
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 0', borderBottom: '1px solid var(--color-border)',
}}>
  <div>
    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
      设置名称
    </div>
    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
      一句话说明
    </div>
  </div>
  <SegmentedControl
    options={MY_OPTIONS}
    value={myOption}
    onChange={(v) => setMyOption(v as MyOption)}
  />
</div>
```

## Navigation

- `CATEGORIES` array in `SettingsModal.tsx` drives both the left nav and the section list.
- Each section root div must have `data-section="<id>"` and a ref registered into `sectionRefs.current`.
- `IntersectionObserver` (root = scroll container, `rootMargin: '-10% 0px -80% 0px'`) updates `activeSection` as the user scrolls.
- Clicking a nav item calls `scrollTo(id)` → `sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth' })`.

## Startup Behavior Flow

Setting: `startupBehavior: 'restore' | 'new' | 'ask'` (default: `'restore'`).

Logic lives in `client/src/hooks/useSession.ts` inside the mount `useEffect`:

| Value | Behavior |
|-------|----------|
| `'restore'` | Restore previous session (original behavior) |
| `'new'` | Skip restore, call `newSession()` immediately |
| `'ask'` + session exists | Set `startupDialog` state → renders `StartupDialog` in `App.tsx` |
| `'ask'` + no session | Skip restore silently (nothing to ask about) |

`StartupDialog` is a **blocking** modal (z-index 2000, no backdrop dismissal).
`isRestoring.current` stays `true` while the dialog is visible to suppress auto-saves.

## Key Files

| File | Role |
|------|------|
| `client/src/hooks/useSettingsStore.ts` | All settings state + localStorage persistence |
| `client/src/components/SettingsModal.tsx` | Modal UI, left-nav layout, IntersectionObserver |
| `client/src/components/SegmentedControl.tsx` | Reusable pill-style segmented control |
| `client/src/components/StartupDialog.tsx` | Startup choice dialog ("询问我" mode) |
| `client/src/hooks/useSession.ts` | Session restore — reads `startupBehavior` to branch |
```

**Step 2: Commit**

```bash
git add docs/settings-panel.md
git commit -m "docs: add settings panel developer quick reference"
```

---

### Task 7: Update `CLAUDE.md` to point to the settings panel reference

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Read CLAUDE.md**

Read `CLAUDE.md` in full.

**Step 2: Add a pointer in the Key Files section**

Find the `## Key Files` section and add this line:

```markdown
- `docs/settings-panel.md` — Settings panel architecture & how to add new settings (see also `docs/plans/2026-03-01-settings-panel-design.md`)
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: link settings panel reference from CLAUDE.md"
```

---

### Task 8: Manual verification

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Verify settings modal layout**

- Open settings (gear icon in header)
- Confirm left nav shows "工作流" and "会话"
- Confirm "工作流" is highlighted by default
- Click "会话" in the left nav → right panel scrolls to 会话 section
- Scroll right panel manually → left nav highlight updates

**Step 3: Verify 反推模型 still works**

- Switch the model in settings → verify it persists on page reload

**Step 4: Verify 启动时行为 = "开新会话"**

- Set "启动时行为" to "开新会话" in settings
- Add some images to the photo wall
- Reload the page
- Confirm photo wall is empty (new session started)

**Step 5: Verify 启动时行为 = "恢复上次"**

- Set "启动时行为" to "恢复上次" in settings
- Add some images
- Reload the page
- Confirm images are restored

**Step 6: Verify 启动时行为 = "询问我"**

- Set "启动时行为" to "询问我" in settings
- Add some images
- Reload the page
- Confirm startup dialog appears: "发现上次会话"
- Click "恢复会话" → images restored, dialog gone
- Reload again → dialog appears again
- Click "开新会话" → photo wall empty, dialog gone

**Step 7: Verify "询问我" with no history**

- Set behavior to "询问我"
- Clear all sessions (or use a fresh browser profile)
- Reload → no dialog appears, app starts fresh
