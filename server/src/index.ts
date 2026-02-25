import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import workflowRouter from './routes/workflow.js';
import outputRouter from './routes/output.js';
import { connectWebSocket, getHistory, getImageBuffer } from './services/comfyui.js';
import { getAdapter } from './adapters/index.js';

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
];
for (const dir of OUTPUT_DIRS) {
  const dirPath = path.join(outputBase, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

// Static serve output directory
app.use('/output', express.static(outputBase));

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

function generateClientId(): string {
  // Simple UUID-like ID without external dependency
  return `pix2real_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// Track prompt -> workflow mapping for output downloading
const promptWorkflowMap = new Map<string, number>();

wss.on('connection', (clientWs) => {
  const clientId = generateClientId();
  console.log(`[WS] Client connected, assigned clientId: ${clientId}`);

  // Send the clientId to the client
  clientWs.send(JSON.stringify({ type: 'connected', clientId }));

  // Connect to ComfyUI WebSocket with this clientId
  const comfyWs = connectWebSocket(clientId, {
    onExecutionStart(promptId) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'execution_start', promptId }));
      }
    },

    onProgress(promptId, progress) {
      const percentage = Math.round((progress.value / progress.max) * 100);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'progress',
          promptId,
          value: progress.value,
          max: progress.max,
          percentage,
        }));
      }
    },

    async onComplete(promptId) {
      console.log(`[WS] Prompt ${promptId} completed`);

      try {
        // Download outputs to local output directory
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
                  // Determine which workflow directory to save to
                  const workflowId = promptWorkflowMap.get(promptId);
                  if (workflowId !== undefined) {
                    const adapter = getAdapter(workflowId);
                    if (adapter) {
                      const outputDir = path.join(outputBase, adapter.outputDir);
                      const outputPath = path.join(outputDir, img.filename);
                      fs.writeFileSync(outputPath, buffer);
                      outputs.push({
                        filename: img.filename,
                        url: `/api/output/${workflowId}/${encodeURIComponent(img.filename)}`,
                      });
                    }
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
                  const workflowId = promptWorkflowMap.get(promptId);
                  if (workflowId !== undefined) {
                    const adapter = getAdapter(workflowId);
                    if (adapter) {
                      const outputDir = path.join(outputBase, adapter.outputDir);
                      const outputPath = path.join(outputDir, vid.filename);
                      fs.writeFileSync(outputPath, buffer);
                      outputs.push({
                        filename: vid.filename,
                        url: `/api/output/${workflowId}/${encodeURIComponent(vid.filename)}`,
                      });
                    }
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

  // Listen for messages from the client (e.g., register prompt -> workflow mapping)
  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register' && msg.promptId && msg.workflowId !== undefined) {
        promptWorkflowMap.set(msg.promptId, msg.workflowId);
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
