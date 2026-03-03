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

- **Adapter pattern**: each workflow has an adapter in `server/src/adapters/` that loads a JSON template from `ComfyUI_API/` and patches nodes
- **WebSocket relay**: backend connects to ComfyUI WS per client, forwards progress/complete/error to frontend
- **Singleton WS**: frontend uses a module-level singleton to avoid connection floods
- **Output**: files saved to `output/<workflow-dir>/` after each task completes
- **Sessions**: stored in `sessions/`; no auto-pruning on startup

## Workflows

| ID | Name | Needs Prompt | Seed Node |
|----|------|-------------|-----------|
| 0 | 二次元转真人 | Yes | KSampler `"14"` |
| 1 | 真人精修 | Yes | easy seed `"392"` |
| 2 | 精修放大 | No | SeedVR2VideoUpscaler `"1148"` |
| 3 | 快速生成视频 | Yes | WanMoeKSampler `"165"` |
| 4 | 视频放大 | No | SeedVR2VideoUpscaler `"1153"` |
| 5 | 解除装备 | Yes | Seed (rgthree) `"315"` |
| 6 | 真人转二次元 | Yes (optional) | dual KSampler `"3"` + `"15"` |
| 7 | 快速出图 | No (text-to-image) | dedicated route, JSON body |

**Special routes** (registered before generic `/:id/execute`):
- Workflow 5: `POST /api/workflow/5/execute` — `image` + `mask` files + `backPose` bool; mask = white/black opaque RGB PNG
- Workflow 7: `POST /api/workflow/7/execute` — JSON body only (no file upload)

Max safe seed: `1125899906842624` (SeedVR2VideoUpscaler: `4294967295`)

## Key Files

- `client/src/hooks/useWorkflowStore.ts` — Zustand store (images, tasks, progress, selectedOutputIndex, backPoseToggles)
- `client/src/config/maskConfig.ts` — `TAB_MASK_MODE` per tab, `maskKey(imageId, outputIndex)`
- `client/src/hooks/useWebSocket.ts` — Singleton WS hook
- `client/src/components/ThumbnailStrip.tsx` — Multi-output thumbnail navigator
- `server/src/adapters/index.ts` — Register adapters here
- `server/src/routes/workflow.ts` — Execute, batch, release-memory, open-folder, mask auto-recognize
- `server/src/services/sessionManager.ts` — Session CRUD, no auto-pruning
- `docs/settings-panel.md` — Settings panel architecture

## Store Notes

- `selectedOutputIndex`: `-1` = original selected, `>=0` = index into `task.outputs`
- `backPoseToggles`: per-card 后位 LoRA toggle (workflow 5 only)
- `startTask` preserves existing outputs (re-executions accumulate on same card)
- `completeTask` appends new outputs; defaults selection to first of new batch

## Mask Editor Notes

- `TAB_MASK_MODE`: `0→A`, `1→B`, `5→A`; others `none`
- Mode A: paint on original, stored at `maskKey(id, -1)`; Mode B: paint on result, stored at `maskKey(id, selectedOutputIdx)`
- Auto-recognize: `POST /api/workflow/mask/auto-recognize` — SAM via `Pix2Real-自动识别Fixed.json`
