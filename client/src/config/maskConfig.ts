// client/src/config/maskConfig.ts

export type TabMaskMode = 'A' | 'B' | 'none';

export const TAB_MASK_MODE: Record<number, TabMaskMode> = {
  0: 'A',    // dev/test — Mode A overlay
  1: 'B',    // 真人精修 — Mode B realtime blend
  2: 'none',
  3: 'none',
  4: 'none',
};

export const maskKey = (imageId: string, outputIndex: number): string =>
  `${imageId}:${outputIndex}`;
