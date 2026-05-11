import React from 'react';
import { useAutoLoopStore } from '../hooks/useAutoLoopStore.js';

/**
 * 当用户在非循环 tab 试图提交任务时渲染的阻塞式模态框。
 * 由 useAutoLoopStore.guardBeforeSubmit() 触发，通过 resolveInterrupt 回传结果。
 */
export function AutoLoopInterruptDialog() {
  const request = useAutoLoopStore((s) => s.interruptRequest);
  const loopTabId = useAutoLoopStore((s) => s.tabId);
  const resolveInterrupt = useAutoLoopStore((s) => s.resolveInterrupt);

  if (!request) return null;

  const sourceName = loopTabId === 7 ? '快速出图' : loopTabId === 9 ? 'ZIT 快出' : '工作流';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 'min(90vw, 460px)',
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: '20px 22px',
          color: 'var(--color-text)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          当前有自动循环任务正在运行
        </div>
        <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          来源：{sourceName}
          <br /><br />
          要在此处添加新任务，需要先停止该循环。停止后仍在执行中的那一单会正常完成，只是不会再投递下一单。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => resolveInterrupt(false)}
            style={{
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
          >
            取消
          </button>
          <button
            onClick={() => resolveInterrupt(true)}
            style={{
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid #E53935',
              borderRadius: 6,
              background: '#E53935',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            停止循环并继续
          </button>
        </div>
      </div>
    </div>
  );
}
