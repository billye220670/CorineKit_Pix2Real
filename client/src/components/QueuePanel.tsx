import { useState, useEffect, useCallback } from 'react';
import { X, ChevronsUp, Trash2 } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
interface QueueRow {
  promptId: string;
  isRunning: boolean;
  imageId: string | null;
  tabId: number | null;
  imageName: string;
  workflowName: string;
  progress: number;
}

interface RawQueueItem {
  promptId: string;
  queueNumber: number;
}

interface QueuePanelProps {
  onClose: () => void;
}

export function QueuePanel({ onClose }: QueuePanelProps) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const workflows = useWorkflowStore((s) => s.workflows);
  const tabData = useWorkflowStore((s) => s.tabData);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const setFlashingImage = useWorkflowStore((s) => s.setFlashingImage);
  const remapTaskPromptIds = useWorkflowStore((s) => s.remapTaskPromptIds);
  const { sendMessage } = useWebSocket();

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/workflow/queue');
      if (!res.ok) return;
      const data = (await res.json()) as { running: RawQueueItem[]; pending: RawQueueItem[] };

      // Build promptId → image info lookup from store
      const lookup: Record<string, { imageId: string; tabId: number; imageName: string; progress: number }> = {};
      for (const [tabKey, tab] of Object.entries(tabData)) {
        const tid = Number(tabKey);
        for (const [imgId, task] of Object.entries(tab.tasks)) {
          if (!task.promptId) continue;
          const img = tab.images.find((i) => i.id === imgId);
          lookup[task.promptId] = {
            imageId: imgId,
            tabId: tid,
            imageName: img?.originalName ?? imgId,
            progress: task.progress ?? 0,
          };
        }
      }

      const toRow = (item: RawQueueItem, isRunning: boolean): QueueRow => {
        const info = lookup[item.promptId];
        return {
          promptId: item.promptId,
          isRunning,
          imageId: info?.imageId ?? null,
          tabId: info?.tabId ?? null,
          imageName: info?.imageName ?? `${item.promptId.slice(0, 8)}…`,
          workflowName: info
            ? (workflows.find((w) => w.id === info.tabId)?.name ?? '未知')
            : '系统',
          progress: info?.progress ?? 0,
        };
      };

      setRows([
        ...data.running.map((i) => toRow(i, true)),
        ...data.pending.map((i) => toRow(i, false)),
      ]);
    } catch {
      // ComfyUI unavailable — leave list as-is
    }
  }, [tabData, workflows]);

  useEffect(() => {
    fetchQueue();
    const timer = setInterval(fetchQueue, 2000);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  const handlePrioritize = useCallback(async (promptId: string) => {
    const res = await fetch(`/api/workflow/queue/prioritize/${promptId}`, { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      const data = await res.json() as { mapping?: Array<{ oldPromptId: string; newPromptId: string }> };
      if (data.mapping?.length) {
        // Snapshot old promptId → workflowId BEFORE remapping (store still has old IDs)
        const snapshot = useWorkflowStore.getState();
        const oldIdToWorkflow: Record<string, number> = {};
        for (const [tabKey, tab] of Object.entries(snapshot.tabData)) {
          for (const task of Object.values(tab.tasks)) {
            if (task.promptId) oldIdToWorkflow[task.promptId] = Number(tabKey);
          }
        }

        // Update store with new prompt IDs
        remapTaskPromptIds(data.mapping);

        // Re-register new prompt IDs with the server so outputs get saved correctly
        for (const { oldPromptId, newPromptId } of data.mapping) {
          const workflowId = oldIdToWorkflow[oldPromptId];
          if (workflowId !== undefined) {
            sendMessage({ type: 'register', promptId: newPromptId, workflowId });
          }
        }
      }
    }
    fetchQueue();
  }, [fetchQueue, remapTaskPromptIds, sendMessage]);

  const handleDelete = useCallback(async (promptId: string) => {
    await fetch(`/api/workflow/cancel-queue/${promptId}`, { method: 'POST' }).catch(() => {});
    fetchQueue();
  }, [fetchQueue]);

  const handleLocate = useCallback((row: QueueRow) => {
    if (row.tabId === null || row.imageId === null) return;
    setActiveTab(row.tabId);
    setTimeout(() => {
      const el = document.getElementById(`card-${row.imageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashingImage(row.imageId);
      }
    }, 80);
  }, [setActiveTab, setFlashingImage]);

  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 4px)',
      right: 0,
      width: 380,
      maxHeight: 440,
      backgroundColor: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
          任务队列
          {rows.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: 400, color: 'var(--color-text-secondary)' }}>
              {rows.filter((r) => r.isRunning).length} 处理中 · {rows.filter((r) => !r.isRunning).length} 排队中
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          style={{ padding: 4, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--color-text-secondary)',
          fontSize: '13px',
        }}>
          队列为空
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows.map((row, idx) => (
            <div
              key={row.promptId}
              onMouseEnter={() => setHoveredId(row.promptId)}
              onMouseLeave={() => setHoveredId(null)}
              onDoubleClick={() => handleLocate(row)}
              title={row.imageId ? '双击定位卡片' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderBottom: idx < rows.length - 1 ? '1px solid var(--color-border)' : 'none',
                backgroundColor: hoveredId === row.promptId ? 'var(--color-surface-hover)' : 'transparent',
                userSelect: 'none',
              }}
            >
              {/* Status dot */}
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: row.isRunning ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                opacity: row.isRunning ? 1 : 0.45,
                animation: row.isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: row.isRunning && row.progress > 0 ? 4 : 0,
                }}>
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 5px',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {row.workflowName}
                  </span>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {row.imageName}
                  </span>
                </div>
                {row.isRunning && row.progress > 0 && (
                  <div style={{ height: 2, backgroundColor: 'var(--color-border)', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{
                      width: `${row.progress}%`,
                      height: '100%',
                      backgroundColor: 'var(--color-primary)',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                )}
              </div>

              {/* Hover actions — always take up space to avoid layout shift */}
              <div style={{
                display: 'flex',
                gap: 4,
                flexShrink: 0,
                visibility: hoveredId === row.promptId ? 'visible' : 'hidden',
              }}>
                {!row.isRunning && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePrioritize(row.promptId); }}
                    title="置顶（排到下一个）"
                    style={{
                      padding: '3px 5px',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--color-primary)',
                      border: '1px solid var(--color-primary)',
                      backgroundColor: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <ChevronsUp size={12} />
                  </button>
                )}
                {/* placeholder so delete doesn't jump when prioritize is hidden */}
                {row.isRunning && <div style={{ width: 24 }} />}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(row.promptId); }}
                  title="从队列删除"
                  style={{
                    padding: '3px 5px',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--color-error)',
                    border: '1px solid var(--color-error)',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
