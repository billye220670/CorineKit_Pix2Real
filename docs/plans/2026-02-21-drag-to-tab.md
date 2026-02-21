# Drag Image to Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to drag any ImageCard from the PhotoWall onto a workflow tab to import that image (output if exists, otherwise original) into that tab.

**Architecture:** HTML5 drag API — `ImageCard` sets `dataTransfer` with the imageId on dragstart; `TabSwitcher` tabs act as drop targets that look up the image in the store, optionally fetch the output, and call a new `addImagesToTab` action. A lightweight singleton toast system shows confirmation.

**Tech Stack:** React, Zustand, HTML5 Drag & Drop API, browser Fetch API

---

### Task 1: Add `addImagesToTab` action to store

**Files:**
- Modify: `client/src/hooks/useWorkflowStore.ts`

**Step 1: Add to the `WorkflowStore` interface** (after line 30, alongside `addImages`)

```typescript
addImagesToTab: (tabId: number, files: File[]) => void;
```

**Step 2: Add implementation** inside `create<WorkflowStore>((set, get) => ({`, after the `addImages` action (after line 84):

```typescript
addImagesToTab: (tabId, files) => {
  const newImages: ImageItem[] = files.map((file) => ({
    id: `img_${Date.now()}_${imageCounter++}`,
    file,
    previewUrl: URL.createObjectURL(file),
    originalName: file.name,
  }));
  set((state) => {
    const prev = state.tabData[tabId] || emptyTabData();
    return {
      tabData: {
        ...state.tabData,
        [tabId]: { ...prev, images: [...prev.images, ...newImages] },
      },
    };
  });
},
```

**Step 3: Verify TypeScript compiles**

Run: `npm run build --workspace=client` (or `cd client && npx tsc --noEmit`)
Expected: no errors

**Step 4: Commit**

```bash
git add client/src/hooks/useWorkflowStore.ts
git commit -m "feat: add addImagesToTab store action"
```

---

### Task 2: Create toast system

**Files:**
- Create: `client/src/hooks/useToast.ts`
- Create: `client/src/components/Toast.tsx`

**Step 1: Create `client/src/hooks/useToast.ts`**

```typescript
import { useState, useEffect } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function useToastMessage() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler: Listener = (msg) => {
      setMessage(msg);
      setTimeout(() => setMessage(null), 1500);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return message;
}
```

**Step 2: Create `client/src/components/Toast.tsx`**

```tsx
import { useToastMessage } from '../hooks/useToast.js';

export function Toast() {
  const message = useToastMessage();
  if (!message) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 'var(--spacing-lg)',
      right: 'var(--spacing-lg)',
      zIndex: 9999,
      backgroundColor: 'var(--color-primary)',
      color: '#fff',
      padding: 'var(--spacing-sm) var(--spacing-md)',
      fontSize: '13px',
      fontWeight: 500,
      pointerEvents: 'none',
    }}>
      {message}
    </div>
  );
}
```

**Step 3: Mount Toast in App** — open `client/src/components/App.tsx`

Add import at top:
```tsx
import { Toast } from './Toast.js';
```

Inside the returned root `<div>` (before `</div>` closing the root), add:
```tsx
<Toast />
```

**Step 4: Verify dev server shows no errors**

Run: `npm run dev:client`
Expected: compiles without errors

**Step 5: Commit**

```bash
git add client/src/hooks/useToast.ts client/src/components/Toast.tsx client/src/components/App.tsx
git commit -m "feat: add toast notification system"
```

---

### Task 3: Make ImageCard draggable

**Files:**
- Modify: `client/src/components/ImageCard.tsx`

**Step 1: Add drag state** — after the existing `useState` on line 23, add:

```typescript
const [isDragging, setIsDragging] = useState(false);
```

**Step 2: Add drag handlers** — after `handleMouseLeave` (around line 55), add:

```typescript
const handleDragStart = useCallback((e: React.DragEvent) => {
  e.dataTransfer.setData('application/x-workflow-image', image.id);
  e.dataTransfer.effectAllowed = 'copy';
  setIsDragging(true);
}, [image.id]);

const handleDragEnd = useCallback(() => {
  setIsDragging(false);
}, []);
```

**Step 3: Apply to the outer `<div>`** — the root `<div>` on line 90, add:

```tsx
<div
  draggable
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  style={{
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    overflow: 'hidden',
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    transition: 'opacity 0.15s',
  }}
>
```

**Step 4: Verify drag works visually**

Run the dev server, try dragging an image card — it should go semi-transparent.

**Step 5: Commit**

```bash
git add client/src/components/ImageCard.tsx
git commit -m "feat: make ImageCard draggable"
```

---

### Task 4: Make tabs drop targets

**Files:**
- Modify: `client/src/components/TabSwitcher.tsx`

**Step 1: Add imports** — add at top of file:

```typescript
import { useCallback, useState } from 'react';
import { showToast } from '../hooks/useToast.js';
```

**Step 2: Add store subscriptions** inside `TabSwitcher()`, after existing store selectors:

```typescript
const addImagesToTab = useWorkflowStore((s) => s.addImagesToTab);
const [dragOverTab, setDragOverTab] = useState<number | null>(null);
```

**Step 3: Add drop handler** inside `TabSwitcher()`, before the return:

```typescript
const handleDrop = useCallback(async (e: React.DragEvent, targetTab: number) => {
  e.preventDefault();
  setDragOverTab(null);

  const imageId = e.dataTransfer.getData('application/x-workflow-image');
  if (!imageId) return;

  const state = useWorkflowStore.getState();
  let sourceFile: File | null = null;

  for (const tabEntry of Object.values(state.tabData)) {
    const img = tabEntry.images.find((i) => i.id === imageId);
    if (!img) continue;

    const outputs = tabEntry.tasks[imageId]?.outputs ?? [];
    if (outputs.length > 0) {
      const last = outputs[outputs.length - 1];
      try {
        const res = await fetch(last.url);
        const blob = await res.blob();
        sourceFile = new File([blob], last.filename, { type: blob.type });
      } catch {
        sourceFile = img.file;
      }
    } else {
      sourceFile = img.file;
    }
    break;
  }

  if (!sourceFile) return;

  addImagesToTab(targetTab, [sourceFile]);
  const targetName = state.workflows.find((w) => w.id === targetTab)?.name ?? '';
  showToast(`已导入到「${targetName}」`);
}, [addImagesToTab]);
```

**Step 4: Update the tab `<button>` JSX** — add three event handlers and a highlight style to each tab button:

```tsx
<button
  key={wf.id}
  onClick={() => setActiveTab(wf.id)}
  onDragOver={(e) => { e.preventDefault(); setDragOverTab(wf.id); }}
  onDragLeave={() => setDragOverTab(null)}
  onDrop={(e) => handleDrop(e, wf.id)}
  style={{
    position: 'relative',
    padding: 'var(--spacing-sm) var(--spacing-md)',
    backgroundColor: activeTab === wf.id ? 'var(--color-primary)' : 'transparent',
    color: activeTab === wf.id ? '#ffffff' : 'var(--color-text)',
    border: '1px solid',
    borderColor: dragOverTab === wf.id
      ? 'var(--color-primary)'
      : activeTab === wf.id
        ? 'var(--color-primary)'
        : 'var(--color-border)',
    outline: dragOverTab === wf.id ? '2px solid var(--color-primary)' : 'none',
    outlineOffset: '2px',
    borderRadius: 0,
    fontSize: '13px',
    fontWeight: activeTab === wf.id ? 600 : 400,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  }}
>
```

**Step 5: Test the full flow**

1. Start dev server
2. Import an image into any tab
3. Execute it to get an output
4. Drag the card onto a different tab
5. Verify: toast appears, image shows up in target tab
6. Also test dragging a card with no output

**Step 6: Commit**

```bash
git add client/src/components/TabSwitcher.tsx
git commit -m "feat: tabs accept drag-and-drop image import with toast"
```
