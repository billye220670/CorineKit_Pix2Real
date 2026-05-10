// server/src/routes/settings.ts
// 后端设置接口：目前仅管理 sessionsBase 路径，未来可扩展其它服务端配置。

import express, { Router } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSessionsBase,
  getDefaultSessionsBase,
  setSessionsBase,
  validateSessionsBase,
} from '../config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/dist/routes/settings.js → server/scripts/pick-folder.ps1
const pickFolderScript = path.resolve(__dirname, '../../scripts/pick-folder.ps1');

const router = Router();

// GET /api/settings — 读取当前服务端配置
router.get('/', (_req, res) => {
  res.json({
    sessionsBase: getSessionsBase(),
    defaultSessionsBase: getDefaultSessionsBase(),
  });
});

// PUT /api/settings — 更新配置
// body: { sessionsBase?: string | null }
//   - 绝对路径：切换为自定义路径
//   - null：恢复默认路径
router.put('/', express.json(), (req, res) => {
  const body = (req.body ?? {}) as { sessionsBase?: string | null };

  if ('sessionsBase' in body) {
    const value = body.sessionsBase;
    if (value === null) {
      try {
        setSessionsBase(null);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
    } else if (typeof value === 'string') {
      const err = validateSessionsBase(value);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      try {
        setSessionsBase(value);
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
        return;
      }
    } else {
      res.status(400).json({ error: 'sessionsBase 必须为字符串或 null' });
      return;
    }
  }

  res.json({
    sessionsBase: getSessionsBase(),
    defaultSessionsBase: getDefaultSessionsBase(),
  });
});

// POST /api/settings/browse-folder — 弹出 Windows 资源管理器风格的文件夹选择对话框（IFileOpenDialog）
// 响应：{ path: string } | { cancelled: true } | { error: string }
router.post('/browse-folder', (req, res) => {
  if (process.platform !== 'win32') {
    res.status(501).json({ error: '该平台暂不支持原生目录选择（目前仅 Windows）' });
    return;
  }

  const initialPath = ((req.body ?? {}) as { initialPath?: string }).initialPath ?? '';

  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy', 'Bypass',
      '-File', pickFolderScript,
      '-Title', '选择 Session 存储路径',
      '-InitialPath', initialPath,
    ],
    { windowsHide: true, timeout: 5 * 60_000 },
    (err, stdout) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const selected = String(stdout).trim();
      if (!selected) {
        res.json({ cancelled: true });
        return;
      }
      res.json({ path: selected });
    }
  );
});

export default router;
