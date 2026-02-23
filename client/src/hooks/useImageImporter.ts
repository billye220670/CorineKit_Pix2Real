import { useState, useCallback } from 'react';
import { useWorkflowStore } from './useWorkflowStore.js';

export interface DuplicateDialog {
  files: File[];
  duplicateNames: string[];
}

export function useImageImporter() {
  const images = useWorkflowStore((s) => s.tabData[s.activeTab]?.images ?? []);
  const addImages = useWorkflowStore((s) => s.addImages);
  const removeImage = useWorkflowStore((s) => s.removeImage);
  const [dialog, setDialog] = useState<DuplicateDialog | null>(null);

  const importFiles = useCallback(
    (files: File[]) => {
      const existingNames = new Set(images.map((img) => img.originalName));
      const duplicateNames = [
        ...new Set(files.filter((f) => existingNames.has(f.name)).map((f) => f.name)),
      ];
      if (duplicateNames.length > 0) {
        setDialog({ files, duplicateNames });
      } else {
        addImages(files);
      }
    },
    [images, addImages],
  );

  const overwrite = useCallback(() => {
    if (!dialog) return;
    const dupeSet = new Set(dialog.duplicateNames);
    images.filter((img) => dupeSet.has(img.originalName)).forEach((img) => removeImage(img.id));
    addImages(dialog.files);
    setDialog(null);
  }, [dialog, images, addImages, removeImage]);

  const keepBoth = useCallback(() => {
    if (!dialog) return;
    addImages(dialog.files);
    setDialog(null);
  }, [dialog, addImages]);

  const cancel = useCallback(() => setDialog(null), []);

  return { importFiles, dialog, overwrite, keepBoth, cancel };
}
