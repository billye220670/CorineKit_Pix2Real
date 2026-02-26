// client/src/hooks/useDragStore.ts
import { create } from 'zustand';

export type DragItem =
  | { type: 'card'; imageId: string }
  | { type: 'output'; imageId: string; outputIndex: number };

interface DragStore {
  dragging: DragItem | null;
  setDragging: (item: DragItem | null) => void;
}

export const useDragStore = create<DragStore>((set) => ({
  dragging: null,
  setDragging: (item) => set({ dragging: item }),
}));
