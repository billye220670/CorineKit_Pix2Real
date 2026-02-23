# CorineKit Pix2Real

## Project Structure

Monorepo: `client/` (Vite + React + TypeScript) and `server/` (Express + TypeScript).

## Commands

```bash
npm run dev          # Start both client and server
npm run dev:client   # Vite dev server only
npm run dev:server   # Express dev server only
npm run build        # Build both
npm run install:all  # Install all dependencies
```

## Architecture

- **Adapter pattern**: each workflow (0–4) has an adapter in `server/src/adapters/` that loads a JSON template from `ComfyUI_API/` and patches the required nodes
- **WebSocket relay**: backend connects to ComfyUI WS per client, forwards progress/complete/error to frontend
- **Singleton WS**: frontend uses a module-level singleton to avoid connection floods
- **Output**: files saved to `output/<workflow-dir>/` after each task completes

## Workflows

| ID | Name | Needs Prompt | Seed Node |
|----|------|-------------|-----------|
| 0 | 二次元转真人 | Yes | KSampler `"14"` |
| 1 | 真人精修 | Yes | easy seed `"392"` |
| 2 | 精修放大 | No | SeedVR2VideoUpscaler `"1148"` |
| 3 | 快速生成视频 | Yes | WanMoeKSampler `"165"` |
| 4 | 视频放大 | No | SeedVR2VideoUpscaler `"1153"` |

Max safe seed value for ComfyUI: `1125899906842624`

## Key Files

- `client/src/hooks/useWorkflowStore.ts` — Zustand store (per-tab images, tasks, progress, selectedOutputIndex)
- `client/src/hooks/useWebSocket.ts` — Singleton WS hook
- `client/src/components/ThumbnailStrip.tsx` — Multi-output thumbnail navigator
- `server/src/services/comfyui.ts` — ComfyUI HTTP + WS client
- `server/src/routes/workflow.ts` — Execute, batch, release-memory, open-folder endpoints

## Store Notes

- `TabData.selectedOutputIndex`: `Record<imageId, number>` — `-1` = original image selected, `>= 0` = index into `task.outputs`
- `startTask` preserves existing `outputs` so re-executions accumulate results on the same card
- `completeTask` appends new outputs to existing array; defaults selection to first of new batch

## UI Notes

- Photo wall uses CSS Grid `repeat(auto-fill, minmax(columnWidth, 1fr))` — no right-side whitespace
- ThumbnailStrip: original always at index 0, no background, thumb size adapts via ResizeObserver
- Release-memory button disabled when any task is queued/processing across all tabs; stats span sits outside button to preserve usage colors
- VRAM/RAM display uses continuous rAF lerp (factor 0.012) toward poll target for smooth animation
