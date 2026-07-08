# CorineKit 对外 API 测试工具

一个**零依赖**的轻量 Web 工具，用于测试 CorineKit Pix2Real 项目的对外 API（`/api/v1`）。
纯原生 JS 前端 + Node.js 内置模块实现的静态服务器与反向代理，无需 `npm install`。

## 目录结构

```
api-tester/
├── server.js     # 零依赖静态服务器 + 反向代理（仅用 http/fs/path/url）
├── index.html    # 中文界面
├── app.js        # 前端逻辑（加载工作流 / 动态表单 / 提交 / 轮询 / 结果展示 / 日志）
├── styles.css    # 样式
└── README.md     # 本说明
```

## 运行方式

前置条件：已安装 Node.js（无需任何 npm 依赖）。

```bash
cd api-tester
node server.js
```

启动后访问：**http://localhost:4100**

### 可选环境变量

| 变量           | 说明                        | 默认值                  |
| -------------- | --------------------------- | ----------------------- |
| `PORT`         | 本工具监听端口              | `4100`                  |
| `PIX2REAL_URL` | CorineKit 后端地址（代理目标） | `http://localhost:3000` |

Windows PowerShell 示例（临时指定后端地址与端口）：

```powershell
$env:PIX2REAL_URL="http://localhost:8080"; $env:PORT="4100"; node server.js
```

## 使用步骤

1. 在页面顶部填入 **API Key**（会自动保存到浏览器 localStorage）。
2. 点击 **加载工作流**：请求 `GET /api/v1/workflows`，用返回的 schema 填充下拉框。
3. 选择一个工作流，页面会**根据其 schema 动态生成表单**（文件上传 + 参数输入，必填项标红 `*`）。
4. 点击 **提交任务**：以 `multipart/form-data` 提交到 `POST /api/v1/tasks`，显示返回的 `taskId`。
5. 提交成功后**自动轮询**任务状态（每 1500ms），实时更新进度条与阶段文字：
   - 完成：内联展示图片 / 视频，并提供下载链接；
   - 失败：红色显示错误信息。
6. 需要时点击 **取消任务** 终止。
7. 底部 **请求日志** 记录每次请求/响应摘要，便于排查。

## 代理如何规避跨域

前端所有 API 调用都打到本工具自身的 `/proxy/*` 路径（与页面同源），`server.js` 收到后去掉 `/proxy` 前缀，用 `http.request` 把请求（完整保留 method、请求头含 `x-api-key`/`content-type`、以及流式请求体）转发给后端 `PIX2REAL_URL`，再把后端响应原样透传回浏览器——因此浏览器始终认为是同源请求，从根本上**绕开了 CORS 限制**，二进制产物（图片/视频）也能正确透传。
