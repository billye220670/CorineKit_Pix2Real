# Settings Panel — Developer Quick Reference

> See design doc: `docs/plans/2026-03-01-settings-panel-design.md`

## Architecture

The settings panel is a fixed-position modal rendered by `SettingsModal.tsx`.
State lives in `useSettingsStore` (Zustand, localStorage-persisted).
Layout: left sidebar (120 px, fixed) + right scrolling content area.

---

## Adding a New Setting

### 1. Choose the category

Current categories:

| id | 标签 |
|----|------|
| `workflow` | 工作流 |
| `session` | 会话 |

To add a **new category**: append an entry to `CATEGORIES` in `SettingsModal.tsx` and create a matching `<div data-section="<id>">` block in the right content area.

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

### 3. Add a row in `SettingsModal.tsx`

All rows share this pattern — left: label + description, right: `SegmentedControl`:

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

---

## Left-Nav Scroll Sync

- `CATEGORIES` array drives both the left nav buttons and the right content sections.
- Each section root `<div>` must have:
  - `data-section="<id>"` — for `IntersectionObserver` to read
  - a ref registered into `sectionRefs.current[id]`
- `IntersectionObserver` config: `root = scrollRef.current`, `threshold: 0`, `rootMargin: '-10% 0px -80% 0px'`
  → triggers when a section heading enters the top 10 % of the scroll container.
- Clicking a nav button calls `scrollTo(id)` → `sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth' })`.
- `activeSection` state controls the highlighted nav item.

---

## Startup Behavior Flow

Setting key: `startupBehavior: 'restore' | 'new' | 'ask'` (default: `'restore'`).

Logic lives in `client/src/hooks/useSession.ts` inside the mount `useEffect`:

| Value | Session exists | Behavior |
|-------|---------------|----------|
| `'restore'` | yes | Restore previous session (original behavior) |
| `'restore'` | no | Start fresh (nothing to restore) |
| `'new'` | yes | Skip restore, call `newSession()` |
| `'new'` | no | Start fresh |
| `'ask'` | yes | Render `StartupDialog` — user chooses |
| `'ask'` | no | Start fresh silently |

`StartupDialog` is a **blocking** modal (z-index 2000). The backdrop is non-dismissible — the user must click a button.

`isRestoring.current` stays `true` while the dialog is visible, suppressing auto-saves and the `beforeunload` beacon. It is set to `false` once the user makes a choice.

---

## Key Files

| File | Role |
|------|------|
| `client/src/hooks/useSettingsStore.ts` | All settings state + localStorage persistence |
| `client/src/components/SettingsModal.tsx` | Modal UI — left-nav layout, `IntersectionObserver`, all setting rows |
| `client/src/components/SegmentedControl.tsx` | Reusable pill-style segmented control (shared across settings) |
| `client/src/components/StartupDialog.tsx` | Startup choice dialog for "询问我" mode |
| `client/src/hooks/useSession.ts` | Session restore — reads `startupBehavior` to branch; exposes `startupDialog` state |
