// 桌面通知（Windows 右下角系统 Toast）
// 基于浏览器 Notifications API；Chrome/Edge 在 Windows 10+ 会转为系统级通知

let permissionPromise: Promise<NotificationPermission> | null = null;

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** 确保已获得通知权限；仅在 default 时发起请求，其余直接返回当前状态。 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!supported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  if (!permissionPromise) {
    permissionPromise = Notification.requestPermission().finally(() => {
      permissionPromise = null;
    });
  }
  return permissionPromise;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  tag?: string;       // 用于同类通知合并（同 tag 会覆盖而非堆叠）
  icon?: string;
  silent?: boolean;
  /** 仅在页面不可见时才弹出（前台时不打扰）。默认 true。 */
  onlyWhenHidden?: boolean;
}

/** 发出桌面通知；不满足条件时静默返回。 */
export async function notify(opts: NotifyOptions): Promise<void> {
  if (!supported()) return;
  const onlyWhenHidden = opts.onlyWhenHidden !== false;
  if (onlyWhenHidden && typeof document !== 'undefined' && !document.hidden) return;

  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return;

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: opts.icon ?? '/logo.png',
      silent: opts.silent,
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* noop */ }
      n.close();
    };
  } catch {
    // 某些环境构造 Notification 可能失败，忽略
  }
}

/** 任务完成通知（便捷封装） */
export function notifyTaskComplete(workflowName: string, count?: number, tag?: string) {
  const body = count && count > 0
    ? `${workflowName} 已生成 ${count} 张`
    : `${workflowName} 已完成`;
  notify({ title: 'CorineKit · 任务完成', body, tag });
}

/** 任务失败通知（便捷封装） */
export function notifyTaskError(workflowName: string, message?: string, tag?: string) {
  notify({
    title: 'CorineKit · 任务失败',
    body: message ? `${workflowName}：${message}` : `${workflowName} 执行失败`,
    tag,
  });
}
