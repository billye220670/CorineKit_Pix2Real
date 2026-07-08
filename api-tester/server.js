'use strict';

/**
 * CorineKit 对外 API 测试工具 —— 零依赖静态服务器 + 反向代理
 *
 * 仅使用 Node.js 内置模块（http、fs、path、url），无需 npm install。
 * 运行：node server.js
 *
 * 端口：PORT（默认 4100）
 * 后端：PIX2REAL_URL（默认 http://localhost:3000）
 *
 * 反向代理：/proxy/* 会被去掉 /proxy 前缀后转发到后端，
 * 从而让前端与后端“同源”，规避浏览器 CORS 限制。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT, 10) || 4100;
const TARGET = process.env.PIX2REAL_URL || 'http://localhost:3000';

const ROOT = __dirname;

// 静态资源 Content-Type 映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 反向代理：将 /proxy/<rest> 转发到 TARGET/<rest>
 * 完整保留 method / headers（含 x-api-key、content-type）/ body（流式 pipe）。
 * 后端响应的 statusCode / headers / body 原样透传（保证二进制正确）。
 */
function handleProxy(req, res, restPath) {
  const target = new url.URL(TARGET);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? require('https') : http;

  // 复制请求头，剔除会干扰转发的 hop-by-hop 头
  const headers = Object.assign({}, req.headers);
  delete headers['host'];
  delete headers['connection'];
  delete headers['content-length']; // 由底层根据实际流重新计算
  // 让后端认为请求来自目标主机
  headers['host'] = target.host;

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    method: req.method,
    path: restPath, // 已包含 query
    headers,
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    // 原样回传状态码与响应头
    const outHeaders = Object.assign({}, proxyRes.headers);
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(10 * 60 * 1000, () => {
    proxyReq.destroy(new Error('代理请求超时'));
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: '代理转发失败（Bad Gateway）',
        detail: err.message,
        target: TARGET,
      });
    } else {
      try { res.destroy(); } catch (_) { /* ignore */ }
    }
  });

  // 流式转发请求体（支持 multipart 大文件）
  req.pipe(proxyReq);

  req.on('error', () => {
    try { proxyReq.destroy(); } catch (_) { /* ignore */ }
  });
}

/**
 * 静态文件服务：从 ROOT 目录读取；默认返回 index.html。
 * 防目录穿越。
 */
function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 规范化并阻止穿越到 ROOT 之外
  const safePath = path.normalize(path.join(ROOT, rel));
  if (!safePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 找不到就回退到 index.html（单页工具）
      const indexPath = path.join(ROOT, 'index.html');
      fs.readFile(indexPath, (e2, data) => {
        if (e2) {
          sendJson(res, 404, { error: 'Not Found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const ctype = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': stat.size });
    const stream = fs.createReadStream(safePath);
    stream.on('error', () => {
      if (!res.headersSent) sendJson(res, 500, { error: '读取文件失败' });
    });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    const parsed = url.parse(req.url);
    pathname = parsed.pathname || '/';
  } catch (_) {
    sendJson(res, 400, { error: '非法请求 URL' });
    return;
  }

  // 反向代理入口
  if (pathname === '/proxy' || pathname.startsWith('/proxy/')) {
    // 去掉 /proxy 前缀，保留其余路径 + query
    const rest = req.url.replace(/^\/proxy/, '') || '/';
    handleProxy(req, res, rest);
    return;
  }

  // 其它路径 → 静态服务
  handleStatic(req, res, pathname);
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) { /* ignore */ }
});

server.listen(PORT, () => {
  console.log('==========================================');
  console.log(' CorineKit 对外 API 测试工具已启动');
  console.log(` 本地地址：http://localhost:${PORT}`);
  console.log(` 代理目标：${TARGET}  (通过 /proxy/* 转发)`);
  console.log('==========================================');
});
