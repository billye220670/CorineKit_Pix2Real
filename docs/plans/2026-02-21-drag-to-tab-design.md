# Design: Drag Image to Tab for Import

**Date:** 2026-02-21

## Feature Summary

Users can drag any image card from the PhotoWall and drop it onto a workflow tab at the top. This imports that image into the target tab as a new input, enabling seamless chaining between workflows (e.g., drag a generated result from "二次元转真人" into "真人精修").

All image cards are draggable regardless of whether they have a generated output.

## Data Flow

```
ImageCard dragstart
  → dataTransfer stores { imageId }
  → Tab onDragOver → highlight tab
  → Tab onDrop
      → look up imageId in store
      → has output (tasks[id].outputs[0]) → fetch(outputUrl) → Blob → File
      → no output → use original image.file directly
      → addImagesToTab(targetTabId, [file])
      → Toast "已导入到「工作流名」" (auto-dismiss after 1.5s)
```

## Files to Modify

| File | Change |
|---|---|
| `client/src/hooks/useWorkflowStore.ts` | Add `addImagesToTab(tabId, files[])` action |
| `client/src/components/ImageCard.tsx` | Add `draggable`, `onDragStart`, drag opacity feedback |
| `client/src/components/TabSwitcher.tsx` | Add `onDragOver`, `onDragLeave`, `onDrop`, highlight on hover |
| `client/src/components/Toast.tsx` | New simple toast component |
| `client/src/hooks/useToast.ts` | New toast state hook (global singleton) |
| `client/src/App.tsx` | Render `<Toast />` at root level |

## Key Decisions

- **Which image to import**: If the card has a generated output (`tasks[imageId].outputs[0]`), import the output image. Otherwise import the original `image.file`.
- **Output fetch**: `fetch(url)` → `.blob()` → `new File([blob], filename, { type: blob.type })`.
- **Tab highlight**: Add a CSS class during `dragover`, remove on `dragleave` and `drop`.
- **No tab switch**: Import is silent; user stays on current tab and sees a toast notification.
- **Toast content**: "已导入到「{workflowName}」", shown top-right, 1.5s auto-dismiss.

## Non-Goals

- No support for dragging between external apps or the OS file manager.
- No reordering of images within the same tab.
