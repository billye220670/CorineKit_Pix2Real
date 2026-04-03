import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// 配置
const COMFYUI_DEFAULT_PATH = 'D:\\ComfyUI-V12';
const COMFYUI_URL = 'http://127.0.0.1:8188';
const CHECK_TIMEOUT_MS = 3000;
const MAX_WAIT_ATTEMPTS = 60;
const WAIT_INTERVAL_MS = 2000;

/**
 * 获取 ComfyUI 安装路径（支持环境变量覆盖）
 */
function getComfyUIPath(): string {
  return process.env.COMFYUI_PATH || COMFYUI_DEFAULT_PATH;
}

/**
 * 检测 ComfyUI 服务是否正在运行
 * 通过请求 /system_stats 接口判断
 */
export async function isComfyUIRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL('/system_stats', COMFYUI_URL);
    
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        timeout: CHECK_TIMEOUT_MS,
      },
      (res) => {
        // 只要收到响应就认为服务在运行
        resolve(res.statusCode === 200);
      }
    );

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * 启动 ComfyUI 服务
 */
export async function launchComfyUI(): Promise<void> {
  const comfyuiPath = getComfyUIPath();
  const pythonPath = path.join(comfyuiPath, 'python', 'python.exe');
  const mainPath = path.join(comfyuiPath, 'ComfyUI', 'main.py');
  const workDir = path.join(comfyuiPath, 'ComfyUI');

  // 验证路径存在
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Python 可执行文件不存在: ${pythonPath}`);
  }

  if (!fs.existsSync(mainPath)) {
    throw new Error(`ComfyUI main.py 不存在: ${mainPath}`);
  }

  console.log(`[ComfyUI] 使用路径: ${comfyuiPath}`);
  console.log(`[ComfyUI] 启动命令: ${pythonPath} ${mainPath}`);

  // 使用 spawn 启动 ComfyUI
  const child = spawn(pythonPath, [mainPath], {
    cwd: workDir,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });

  // 让进程独立运行
  child.unref();

  console.log(`[ComfyUI] 启动进程 PID: ${child.pid}`);
}

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 确保 ComfyUI 服务正在运行
 * 如果未运行则自动启动并等待就绪
 */
export async function ensureComfyUI(): Promise<void> {
  console.log('[ComfyUI] 检测服务状态...');

  // 先检测是否已运行
  const running = await isComfyUIRunning();
  
  if (running) {
    console.log('[ComfyUI] ✅ 服务已在运行');
    return;
  }

  // 未运行，尝试启动
  console.log('[ComfyUI] 未运行，正在自动启动...');
  await launchComfyUI();

  // 轮询等待服务就绪
  for (let attempt = 1; attempt <= MAX_WAIT_ATTEMPTS; attempt++) {
    await sleep(WAIT_INTERVAL_MS);
    console.log(`[ComfyUI] 等待服务就绪... (${attempt}/${MAX_WAIT_ATTEMPTS})`);
    
    const isReady = await isComfyUIRunning();
    if (isReady) {
      console.log('[ComfyUI] ✅ 启动成功！');
      return;
    }
  }

  // 超时
  throw new Error(`ComfyUI 启动超时（等待了 ${(MAX_WAIT_ATTEMPTS * WAIT_INTERVAL_MS) / 1000} 秒）`);
}
