// Sidebar group definitions – shared across Sidebar, useWorkflowStore, useSession.
// Extracted here to avoid circular dependencies.

export const GROUPS: { label: string; ids: number[] }[] = [
  { label: '图像生成', ids: [7, 9] },
  { label: '图像处理', ids: [2] },
  { label: '风格转换', ids: [0, 6] },
  { label: '区域重绘', ids: [1, 5, 8, 10] },
  // { label: '视频处理', ids: [3, 4] },  // 暂时屏蔽
];

/** The first visible tab ID according to GROUPS ordering. */
export const DEFAULT_TAB = GROUPS[0]?.ids[0] ?? 0;
