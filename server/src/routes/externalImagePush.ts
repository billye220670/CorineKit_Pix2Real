// server/src/routes/externalImagePush.ts
// External image push route (/api/external-image-push).
// A local bridge program (same machine) POSTs either a local absolute file path
// (application/json) or a multipart binary, together with a target workflowId.
// We record a lightweight staging reference (no in-memory read for the path form),
// broadcast an "external media arrived" event to all frontend clients over the
// existing WebSocket channel (via wsHub), and let the frontend pull the bytes by
// stagingId. Staging entries auto-expire after a TTL if not fetched.

import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { broadcast } from '../services/wsHub.js';

const router = Router();

// ── Constraints ──────────────────────────────────────────────────────────────
const STAGING_TTL_MS = 120000; // 120s: auto-drop staged entries not fetched in time
const IMAGE_MAX_BYTES = 20 * 1024 * 1024; // 20MB
const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200MB

// Extension whitelist -> content type. Also used to classify image vs video for size limits.
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

// multipart limit uses the larger cap; per-kind size is enforced manually after upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_BYTES },
});

// ── Staging store ─────────────────────────────────────────────────────────────
// Path-based entries only hold a reference to an external file (never owned/deleted).
// Buffer-based entries hold the multipart bytes in memory (GC'd on drop).
interface StagingEntry {
  contentType: string;
  originalName?: string;
  absolutePath?: string; // path form
  buffer?: Buffer; // multipart form
  timer: NodeJS.Timeout; // TTL timer
}

const staging = new Map<string, StagingEntry>();

/** Remove a staged entry and clear its TTL timer. Path-based sources keep the external file. */
function dropStaging(stagingId: string): void {
  const entry = staging.get(stagingId);
  if (!entry) return;
  clearTimeout(entry.timer);
  staging.delete(stagingId);
}

/**
 * Resolve content type from a file extension, or null if not in the whitelist.
 * Also returns the size cap that applies to that kind.
 */
function resolveType(ext: string): { contentType: string; maxBytes: number } | null {
  const lower = ext.toLowerCase();
  if (IMAGE_CONTENT_TYPES[lower]) {
    return { contentType: IMAGE_CONTENT_TYPES[lower], maxBytes: IMAGE_MAX_BYTES };
  }
  if (VIDEO_CONTENT_TYPES[lower]) {
    return { contentType: VIDEO_CONTENT_TYPES[lower], maxBytes: VIDEO_MAX_BYTES };
  }
  return null;
}

/** Validate workflowId: must be an integer in [0, 10]. Returns the number or null. */
function parseWorkflowId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  return n;
}

/** Stage an entry, wire its TTL, broadcast the arrival event, and respond. */
function stageAndBroadcast(
  res: Response,
  workflowId: number,
  entry: Omit<StagingEntry, 'timer'>,
  targetSessionId: string | undefined,
): void {
  const stagingId = crypto.randomUUID();
  const timer = setTimeout(() => {
    // Auto-expire if not fetched. Buffer is released by GC; path sources own no file.
    staging.delete(stagingId);
  }, STAGING_TTL_MS);
  staging.set(stagingId, { ...entry, timer });

  // Strict WS contract — field names/types must match the frontend parser exactly.
  broadcast({
    type: 'external_image_push',
    tabId: workflowId,
    stagingId,
    originalName: entry.originalName,
    targetSessionId,
  });

  res.json({ ok: true, stagingId });
}

// ── POST /api/external-image-push ─────────────────────────────────────────────
// Two intake shapes are supported and dispatched by Content-Type:
//   1) application/json      -> path-based reference { workflowId, filePath, ... }
//   2) multipart/form-data   -> in-memory buffer { image (file), workflowId, ... }
router.post('/', (req: Request, res: Response) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    // Multipart fallback: let multer parse the "image" file field, then validate.
    upload.single('image')(req, res, (err: unknown) => {
      if (err) {
        // multer LIMIT_FILE_SIZE (or other) -> treat oversize as 413, else 400.
        const code = (err as { code?: string } | null)?.code;
        if (code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File too large' });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
        return;
      }
      handleMultipart(req, res);
    });
    return;
  }

  // Default: JSON path-based form.
  handleJsonPath(req, res);
});

/** Handle the JSON path-based form: validate an existing absolute file and stage a reference. */
function handleJsonPath(req: Request, res: Response): void {
  const body = (req.body ?? {}) as {
    version?: unknown;
    workflowId?: unknown;
    sessionId?: unknown;
    originalName?: unknown;
    filePath?: unknown;
  };

  const workflowId = parseWorkflowId(body.workflowId);
  if (workflowId === null) {
    res.status(400).json({ error: 'workflowId must be an integer in [0, 10]' });
    return;
  }

  const filePath = typeof body.filePath === 'string' ? body.filePath : '';
  if (!filePath || !path.isAbsolute(filePath)) {
    res.status(400).json({ error: 'filePath must be an absolute path' });
    return;
  }

  let stat: fs.Stats;
  try {
    if (!fs.existsSync(filePath)) {
      res.status(400).json({ error: 'filePath does not exist' });
      return;
    }
    stat = fs.statSync(filePath);
  } catch {
    res.status(400).json({ error: 'filePath is not accessible' });
    return;
  }
  if (!stat.isFile()) {
    res.status(400).json({ error: 'filePath is not a file' });
    return;
  }

  const resolved = resolveType(path.extname(filePath));
  if (!resolved) {
    res.status(400).json({ error: 'Unsupported file extension' });
    return;
  }
  if (stat.size > resolved.maxBytes) {
    res.status(413).json({ error: 'File too large' });
    return;
  }

  const originalName =
    typeof body.originalName === 'string' && body.originalName
      ? body.originalName
      : path.basename(filePath);
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined;

  // Record a reference only — never read the file into memory here.
  stageAndBroadcast(
    res,
    workflowId,
    { absolutePath: filePath, contentType: resolved.contentType, originalName },
    sessionId,
  );
}

/** Handle the multipart form: validate the uploaded buffer and stage it in memory. */
function handleMultipart(req: Request, res: Response): void {
  const body = (req.body ?? {}) as {
    workflowId?: unknown;
    sessionId?: unknown;
    originalName?: unknown;
  };

  const workflowId = parseWorkflowId(body.workflowId);
  if (workflowId === null) {
    res.status(400).json({ error: 'workflowId must be an integer in [0, 10]' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'Missing required field: image' });
    return;
  }

  const originalName =
    typeof body.originalName === 'string' && body.originalName ? body.originalName : file.originalname;
  const resolved = resolveType(path.extname(originalName || ''));
  if (!resolved) {
    res.status(400).json({ error: 'Unsupported file extension' });
    return;
  }
  // Manual size guard (multer's global limit is the larger video cap).
  if (file.buffer.length > resolved.maxBytes) {
    res.status(413).json({ error: 'File too large' });
    return;
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined;

  stageAndBroadcast(
    res,
    workflowId,
    { buffer: file.buffer, contentType: resolved.contentType, originalName },
    sessionId,
  );
}

// ── GET /api/external-image-push/:stagingId ───────────────────────────────────
// Return the staged bytes once. Path sources stream from disk (zero buffering);
// multipart sources send the in-memory buffer. The entry is dropped after delivery.
router.get('/:stagingId', (req: Request, res: Response) => {
  const stagingId = String(req.params.stagingId);
  const entry = staging.get(stagingId);
  if (!entry) {
    res.status(404).json({ error: 'Staging entry not found' });
    return;
  }

  res.setHeader('Content-Type', entry.contentType);

  if (entry.absolutePath) {
    // Stream from disk; drop staging after the stream finishes. Never delete the source file.
    const stream = fs.createReadStream(entry.absolutePath);
    stream.on('error', (err) => {
      console.error(`[external-image-push] stream error for ${stagingId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read staged file' });
      } else {
        res.destroy();
      }
      dropStaging(stagingId);
    });
    stream.on('close', () => {
      dropStaging(stagingId);
    });
    stream.pipe(res);
    return;
  }

  // Multipart source: send the in-memory buffer, then drop staging.
  res.send(entry.buffer);
  dropStaging(stagingId);
});

export default router;
