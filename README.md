# CorineKit Pix2Real

A local web UI for batch image/video processing via [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Drop images, pick a workflow, and let ComfyUI do the work — with real-time progress updates and one-click output folder access.

## Features

- **5 built-in workflows**: anime-to-realistic, portrait refinement, upscaling, image-to-video, video upscaling
- **Batch processing**: drop multiple files and execute all at once
- **Real-time progress**: WebSocket relay from ComfyUI to the browser
- **Per-tab image isolation**: each workflow tab maintains its own image list
- **View size toggle**: small / medium / large card grid, no whitespace gaps
- **Open output folder**: one click to open the OS file explorer at the workflow output directory
- **VRAM release**: trigger ComfyUI memory cleanup from the UI
- **Dark / light theme**

## Prerequisites

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running at `http://localhost:8188`
- Node.js 18+

## Setup

```bash
npm run install:all
```

## Development

```bash
npm run dev
```

Opens the frontend at `http://localhost:5173` (proxied to the Express backend on port 3000).

## Build

```bash
npm run build
```

## Project Structure

```
CorineKit_Pix2Real/
├── client/                  # Vite + React + TypeScript
│   └── src/
│       ├── components/      # App, TabSwitcher, PhotoWall, ImageCard, DropZone, ...
│       ├── hooks/           # useWorkflowStore (Zustand), useWebSocket
│       └── types/
├── server/                  # Express + TypeScript
│   └── src/
│       ├── adapters/        # One adapter per workflow (0–4)
│       ├── routes/          # workflow.ts, output.ts
│       └── services/        # comfyui.ts (HTTP + WS client)
├── ComfyUI_API/             # Workflow JSON templates
└── output/                  # Generated files (git-ignored)
    ├── 0-二次元转真人/
    ├── 1-真人精修/
    ├── 2-精修放大/
    ├── 3-快速生成视频/
    └── 4-视频放大/
```

## Workflows

| ID | Name | Input | Prompt |
|----|------|-------|--------|
| 0 | 二次元转真人 | Image | Appended to base |
| 1 | 真人精修 | Image | Appended to base |
| 2 | 精修放大 | Image | — |
| 3 | 快速生成视频 | Image | Replaces base |
| 4 | 视频放大 | Video | — |

## Architecture Notes

- **Adapter pattern**: each workflow adapter loads its JSON template and patches only the nodes that need changing (image name, prompt, seed)
- **WebSocket**: backend creates one ComfyUI WS connection per browser client; progress events are forwarded in real time
- **Singleton hook**: `useWebSocket` uses module-level globals to ensure exactly one WS connection regardless of how many components mount the hook
