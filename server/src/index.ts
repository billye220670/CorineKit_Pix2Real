import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import workflowRouter from './routes/workflow.js';
import outputRouter from './routes/output.js';
import sessionRouter from './routes/session.js';
import { connectWebSocket, getHistory, getImageBuffer } from './services/comfyui.js';
import { sessionsBase, saveOutputFile } from './services/sessionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputBase = path.resolve(__dirname, '../../output');

// Ensure output directories exist
const OUTPUT_DIRS = [
  '0-二次元转真人',
  '1-真人精修',
  '2-精修放大',
  '3-快速生成视频',
  '4-视频放大',
  '5-解除装备',
  '6-真人转二次元',
  '7-快速出图',
];
for (const dir of OUTPUT_DIRS) {
  const dirPath = path.join(outputBase, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Ensure sessions directory exists
if (!fs.existsSync(sessionsBase)) {
  fs.mkdirSync(sessionsBase, { recursive: true });
}

const app = express();
const server = createServer(app);

// CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/workflow', workflowRouter);
app.use('/api/output', outputRouter);
app.use('/api/session', sessionRouter);

// Static serve output and sessions directories
app.use('/output', express.static(outputBase));
app.use('/api/session-files', express.static(sessionsBase));

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

function generateClientId(): string {
  // Simple UUID-like ID without external dependency
  return `pix2real_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// Track prompt -> workflow/session mapping for output downloading
const promptWorkflowMap = new Map<string, { workflowId: number; sessionId: string; tabId: number }>();

wss.on('connection', (clientWs) => {
  const clientId = generateClientId();
  console.log(`[WS] Client connected, assigned clientId: ${clientId}`);

  // Send the clientId to the client
  clientWs.send(JSON.stringify({ type: 'connected', clientId }));

  // Buffer recent execution_start/progress events per promptId so they can be
  // replayed if the client registers AFTER ComfyUI has already started processing
  // (common for the first card in a batch — no queue delay).
  const eventBuffer = new Map<string, object[]>();
  function bufferAndSend(promptId: string, event: object) {
    if (!eventBuffer.has(promptId)) eventBuffer.set(promptId, []);
    eventBuffer.get(promptId)!.push(event);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(event));
    }
  }

  // Connect to ComfyUI WebSocket with this clientId
  const comfyWs = connectWebSocket(clientId, {
    onExecutionStart(promptId) {
      bufferAndSend(promptId, { type: 'execution_start', promptId });
    },

    onProgress(promptId, progress) {
      const percentage = Math.round((progress.value / progress.max) * 100);
      bufferAndSend(promptId, {
        type: 'progress',
        promptId,
        value: progress.value,
        max: progress.max,
        percentage,
      });
    },

    async onComplete(promptId) {
      console.log(`[WS] Prompt ${promptId} completed`);

      try {
        // Download outputs to session output directory
        const history = await getHistory(promptId);
        const outputs: Array<{ filename: string; url: string }> = [];

        if (history && history.outputs) {
          for (const nodeOutput of Object.values(history.outputs)) {
            // Handle image outputs (only type "output", skip temp/preview)
            if (nodeOutput.images) {
              for (const img of nodeOutput.images) {
                if (img.type !== 'output') continue;
                try {
                  const buffer = await getImageBuffer(img.filename, img.subfolder, img.type);
                  const info = promptWorkflowMap.get(promptId);
                  if (info?.sessionId) {
                    const url = saveOutputFile(info.sessionId, info.tabId, img.filename, buffer);
                    outputs.push({ filename: img.filename, url });
                  }
                } catch (err) {
                  console.error(`[WS] Failed to download output ${img.filename}:`, err);
                }
              }
            }

            // Handle video outputs (gifs field from VHS_VideoCombine)
            if (nodeOutput.gifs) {
              for (const vid of nodeOutput.gifs) {
                try {
                  const buffer = await getImageBuffer(vid.filename, vid.subfolder, vid.type);
                  const info = promptWorkflowMap.get(promptId);
                  if (info?.sessionId) {
                    const url = saveOutputFile(info.sessionId, info.tabId, vid.filename, buffer);
                    outputs.push({ filename: vid.filename, url });
                  }
                } catch (err) {
                  console.error(`[WS] Failed to download video ${vid.filename}:`, err);
                }
              }
            }
          }
        }

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'complete',
            promptId,
            outputs,
          }));
        }

        // Cleanup
        promptWorkflowMap.delete(promptId);
        eventBuffer.delete(promptId);
      } catch (err) {
        console.error(`[WS] Error processing completion for ${promptId}:`, err);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'complete',
            promptId,
            outputs: [],
          }));
        }
      }
    },

    onError(promptId, message) {
      console.error(`[WS] Prompt ${promptId} error: ${message}`);
      eventBuffer.delete(promptId);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          promptId,
          message,
        }));
      }
      promptWorkflowMap.delete(promptId);
    },
  });

  // Listen for messages from the client (e.g., register prompt -> workflow/session mapping)
  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register' && msg.promptId && msg.workflowId !== undefined) {
        promptWorkflowMap.set(msg.promptId, {
          workflowId: msg.workflowId,
          sessionId: msg.sessionId || '',
          tabId: msg.tabId ?? msg.workflowId,
        });
        // Replay any buffered events the client may have missed because ComfyUI
        // started processing before the client finished registering.
        const buffered = eventBuffer.get(msg.promptId) ?? [];
        for (const event of buffered) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(event));
          }
        }
      }
    } catch {
      // ignore
    }
  });

  clientWs.on('close', () => {
    console.log(`[WS] Client ${clientId} disconnected`);
    comfyWs.close();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`);
  console.log(`[Server] Output directory: ${outputBase}`);
});
