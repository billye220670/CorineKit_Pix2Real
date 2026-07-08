// server/src/middleware/apiKeyAuth.ts
// 对外 API（/api/v1）鉴权中间件：
//   1) 若对外 API 未开启 → 403；
//   2) 校验请求头 x-api-key 是否在允许列表 → 不在则 401；
//   3) 通过则放行。
// 安全约束：任何情况下都不得在日志中打印 API Key。

import type { Request, Response, NextFunction } from 'express';
import {
  isExternalApiEnabled,
  getExternalApiKeys,
} from '../config/externalApiConfig.js';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isExternalApiEnabled()) {
    res.status(403).json({ error: 'External API disabled' });
    return;
  }

  const headerKey = req.headers['x-api-key'];
  const providedKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;

  const allowedKeys = getExternalApiKeys();
  if (typeof providedKey !== 'string' || !allowedKeys.includes(providedKey)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // 校验通过：把已验证的 key 挂到 req，供路由层做任务归属校验（防越权）。
  // 安全约束：仅挂载，绝不打印。
  (req as any).externalApiKey = providedKey;

  next();
}
