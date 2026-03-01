# Settings Panel Redesign — Design Doc

Date: 2026-03-01

## Goal

Redesign the settings modal to use a left-nav + right-scrolling-content layout, and add a "启动时行为" (Startup Behavior) setting with three options: restore last session, start new session, or ask on every launch.

## Layout

Left sidebar (120 px fixed width) lists category names. Clicking a category calls `scrollIntoView({ behavior: 'smooth' })` on the corresponding section heading in the right panel. An `IntersectionObserver` watches each section heading and highlights the corresponding nav item as the user scrolls.

```
┌────────────────────────────────────────────────────────────────┐
│ 设置                                                       [X]  │
├─────────────┬──────────────────────────────────────────────────┤
│ [工作流]    │  工作流                                           │
│  会话       │  ────────────────────────────────────────────    │
│             │  反推模型        [Qwen3VL | Florence | WD-14]    │
│             │                                                   │
│             │  会话                                             │
│             │  ────────────────────────────────────────────    │
│             │  启动时行为      [恢复上次 | 开新会话 | 询问我]   │
└─────────────┴──────────────────────────────────────────────────┘
```

## Startup Behavior Logic

```
App starts
  └─ getSession(sessionId) → session exists?
        ├─ setting = "restore" → restore as-is (current behavior)
        ├─ setting = "new"     → call newSession(), skip restore
        └─ setting = "ask"
              ├─ session exists → show StartupDialog
              │     [恢复会话]  →  restore
              │     [开新会话]  →  newSession()
              └─ no session    → newSession() silently
```

`StartupDialog` blocks the UI with a modal overlay; the backdrop is non-dismissible so the user must choose.

## New Setting

- Key: `startupBehavior`
- Type: `'restore' | 'new' | 'ask'`
- Default: `'restore'` (preserves current behavior)
- Persisted in `localStorage` under key `settings_startupBehavior`

## Files Changed

| File | Change |
|------|--------|
| `client/src/hooks/useSettingsStore.ts` | Add `startupBehavior` state + setter |
| `client/src/hooks/useSession.ts` | Read `startupBehavior`, branch restore logic; expose `isAskingStartup` flag and resolve callbacks to `App` |
| `client/src/components/SettingsModal.tsx` | Rewrite to left-nav + scrolling-content layout; add 会话 section |
| `client/src/components/StartupDialog.tsx` | New component — startup choice modal |
| `client/src/components/App.tsx` | Render `<StartupDialog />` |
| `docs/settings-panel.md` | Developer quick-reference for settings panel |
| `CLAUDE.md` | Add pointer to `docs/settings-panel.md` in Key Files |

## Design Decisions

- `IntersectionObserver` threshold: `0.5` — section heading must be at least 50% visible to activate its nav item.
- `StartupDialog` is rendered in `App.tsx` alongside `SettingsModal`, `MaskEditor`, and `Toast`.
- `useSession` exposes the dialog state via a returned object so `App` can pass it to `StartupDialog` without prop-drilling through the hook.
- Default startup behavior is `'restore'` so existing users see no change.
