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

- **Adapter pattern**: each workflow (0–5) has an adapter in `server/src/adapters/` that loads a JSON template from `ComfyUI_API/` and patches the required nodes
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
| 5 | 解除装备 | Yes | Seed (rgthree) `"315"` |

Workflow 5 uses a **dedicated route** `POST /api/workflow/5/execute` (before generic `/:id/execute`) accepting `image` + `mask` files + `backPose` bool. Mask format: white/black opaque RGB PNG (RGBA alpha>0 → white). Prompt replaces JSON default entirely; empty = keep default.

Max safe seed value for ComfyUI: `1125899906842624`

## Key Files

- `client/src/hooks/useWorkflowStore.ts` — Zustand store (per-tab images, tasks, progress, selectedOutputIndex, backPoseToggles)
- `client/src/config/maskConfig.ts` — `TAB_MASK_MODE` (A/B/none per tab), `maskKey(imageId, outputIndex)`
- `client/src/hooks/useWebSocket.ts` — Singleton WS hook
- `client/src/components/ThumbnailStrip.tsx` — Multi-output thumbnail navigator
- `server/src/services/comfyui.ts` — ComfyUI HTTP + WS client
- `server/src/routes/workflow.ts` — Execute, batch, release-memory, open-folder, mask auto-recognize endpoints
- `docs/settings-panel.md` — Settings panel architecture & how to add new settings (see also `docs/plans/2026-03-01-settings-panel-design.md`)

## Store Notes

- `TabData.selectedOutputIndex`: `Record<imageId, number>` — `-1` = original image selected, `>= 0` = index into `task.outputs`
- `TabData.backPoseToggles`: `Record<imageId, boolean>` — per-card 后位 LoRA toggle (workflow 5 only)
- `startTask` preserves existing `outputs` so re-executions accumulate results on the same card
- `completeTask` appends new outputs to existing array; defaults selection to first of new batch

## Mask Editor Notes

- `TAB_MASK_MODE`: `0→A`, `1→B`, `5→A`; others `none`
- `maskKey(imageId, outputIndex)` — `-1` for Mode A (no output), `>=0` for Mode B
- Mode A: user paints on original; mask stored at `maskKey(id, -1)`
- Mode B: user paints on a result image; mask stored at `maskKey(id, selectedOutputIdx)`
- Mask auto-recognize: `POST /api/workflow/mask/auto-recognize` — uploads image, runs SAM via `Pix2Real-自动识别Fixed.json`, polls history, returns mask PNG

## UI Notes

- Photo wall uses CSS Grid `repeat(auto-fill, minmax(columnWidth, 1fr))` — no right-side whitespace
- ThumbnailStrip: original always at index 0, no background, thumb size adapts via ResizeObserver
- Release-memory button disabled when any task is queued/processing across all tabs; stats span sits outside button to preserve usage colors
- VRAM/RAM display uses continuous rAF lerp (factor 0.012) toward poll target for smooth animation
