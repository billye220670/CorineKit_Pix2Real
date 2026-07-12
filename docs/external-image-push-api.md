# 外部图片推送 API（External Image Push）

面向外部 **bridge** 程序的对外 HTTP 契约文档。用于将本地图片/视频实时推送到正在运行的 Pix2Real 界面的指定工作流 Tab。

> 本文档以服务端实现为准：
> - 端点实现：`server/src/routes/externalImagePush.ts`
> - 挂载路径：`server/src/index.ts`（`app.use('/api/external-image-push', ...)`）
> - 广播：`server/src/services/wsHub.ts`

---

## 1. 概述

- **功能用途**：外部软件（bridge）向 Pix2Real 推送一张本地图片或一个本地视频，指定目标 `workflowId`，该媒体会实时出现在运行中的 Pix2Real 前端界面对应工作流 Tab 上。
- **同机前提**：bridge 与 Pix2Real 运行在**同一台机器**上。
  - 「路径版」直接传本地文件的**绝对路径**，服务端只记录引用、不复制文件；前端稍后通过 `stagingId` 异步拉取字节。因此该路径必须是 Pix2Real 后端进程可访问的本机路径。
  - 「multipart 版」直接上传二进制，适合无法保证文件路径可被后端读取的场景。
- **"Pix2Real 必须正在运行" 前提**：该端点由 Pix2Real 后端提供，且推送后需要**至少一个前端窗口在线**才能接收广播并拉取字节。若 Pix2Real 未运行，端点不可达（连接失败）。

### 工作原理（简述）

1. bridge `POST /api/external-image-push`（路径版或 multipart 版）。
2. 服务端校验参数，生成一个 `stagingId`，通过 WebSocket 向所有前端客户端广播「外部媒体到达」事件。
3. 前端收到事件后，通过 `GET /api/external-image-push/:stagingId` **一次性**拉取字节并展示。
4. 暂存条目在被前端取走后立即失效；若 **120 秒**内未被取走，则自动过期。

---

## 2. 端点

默认 base URL：`http://localhost:3000`

> 端口由后端 `process.env.PORT || 3000` 决定，默认 **3000**（见 `server/src/index.ts`）。若通过环境变量 `PORT` 覆盖，请以实际启动端口为准。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/external-image-push` | bridge 推送图片/视频（路径版 或 multipart 版） |
| `GET`  | `/api/external-image-push/:stagingId` | **前端内部拉取用**：一次性取回暂存字节。bridge 一般无需调用，此处列出仅为完整性。 |

---

## 3. 两种请求形态

服务端通过请求的 `Content-Type` 分发：
- `multipart/form-data` → multipart 版（内存缓冲）
- 其它（默认按 `application/json` 处理） → 路径版（文件引用）

### 3.1 路径版（application/json）

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | number | 否 | 预留扩展字段，见 [§9](#9-version-字段扩展说明)。当前可省略或填 `1`。 |
| `workflowId` | number | **是** | 目标工作流编号，整数 `[0, 10]`，见 [§5 映射表](#5-workflowid--工作流映射表)。 |
| `sessionId` | string | 否 | 目标会话窗口 ID，用于多窗口精确路由，见 [§10](#10-重要使用约束)。 |
| `originalName` | string | 否 | 展示用文件名。省略时取 `filePath` 的文件名（basename）。 |
| `filePath` | string | **是** | 本地文件的**绝对路径**，必须存在、且是一个文件。**扩展名**决定媒体类型与大小上限。 |
| `autoStart` | boolean | 否 | 是否在图片加入目标 Tab 后自动触发工作流执行。默认 `false`。设为 `true` 时，前端会在图片添加完成后立即提交该图片到对应工作流处理，无需用户手动点击发送按钮。 |

**curl 示例：**

```bash
curl -X POST http://localhost:3000/api/external-image-push \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "workflowId": 0,
    "originalName": "hero.png",
    "filePath": "C:\\Users\\billy\\Pictures\\hero.png"
  }'
```

**带 autoStart 的 curl 示例（推送后自动执行）：**

```bash
curl -X POST http://localhost:3000/api/external-image-push \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "workflowId": 0,
    "autoStart": true,
    "originalName": "hero.png",
    "filePath": "C:\\Users\\billy\\Pictures\\hero.png"
  }'
```

> 说明：JSON 字符串中 Windows 路径的反斜杠需转义为 `\\`。

### 3.2 multipart 版（multipart/form-data）

表单字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | file | **是** | 上传的文件（图片或视频）。**类型判定依据文件名的扩展名**（取 `originalName` 或上传文件的原始文件名）。 |
| `workflowId` | text | **是** | 目标工作流编号，整数 `[0, 10]`。 |
| `sessionId` | text | 否 | 目标会话窗口 ID，用于多窗口精确路由。 |
| `originalName` | text | 否 | 展示用文件名。省略时取上传文件的原始文件名。 |
| `autoStart` | text | 否 | `"true"` 或 `"false"`。是否在图片加入目标 Tab 后自动触发工作流执行。默认 `false`。 |

**curl 示例：**

```bash
curl -X POST http://localhost:3000/api/external-image-push \
  -F "image=@C:\\Users\\billy\\Pictures\\hero.png" \
  -F "workflowId=0" \
  -F "originalName=hero.png"
```

**带 autoStart 的 curl 示例（推送后自动执行）：**

```bash
curl -X POST http://localhost:3000/api/external-image-push \
  -F "image=@C:\\Users\\billy\\Pictures\\hero.png" \
  -F "workflowId=0" \
  -F "originalName=hero.png" \
  -F "autoStart=true"
```

> 注意：字段名必须为 `image`。类型白名单校验基于文件名扩展名，请确保上传文件名（或 `originalName`）带有受支持的扩展名。

---

## 4. 响应

### 成功

HTTP `200`：

```json
{ "ok": true, "stagingId": "550e8400-e29b-41d4-a716-446655440000" }
```

- `stagingId`：本次推送的暂存标识（UUID）。前端通过它一次性拉取字节。
- **TTL**：暂存条目在 **120 秒** 内若未被前端取走，将自动失效；被取走后立即删除（每个 `stagingId` 只能被成功拉取一次）。
- 路径版：服务端仅保存对外部文件的**引用**，不读入内存、不复制、不删除源文件。
- multipart 版：字节暂存在服务端内存中，取走或过期后释放。

---

## 5. workflowId ↔ 工作流映射表

`workflowId` 必须为整数，取值范围 `[0, 10]`：

| workflowId | 工作流 |
| --- | --- |
| `0` | 二次元转真人 |
| `1` | 真人精修 |
| `2` | 精修放大 |
| `3` | 图生视频 |
| `4` | 视频补帧 |
| `5` | 解除装备 |
| `6` | 真人转二次元 |
| `7` | 快速出图 |
| `8` | 黑兽换脸 |
| `9` | ZIT快出 |
| `10` | 区域编辑 |

---

## 6. 支持的文件类型

类型判定依据**扩展名**（大小写不敏感）：

- **图片**：`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`
- **视频**：`.mp4`、`.webm`、`.mov`、`.mkv`、`.avi`

扩展名不在白名单内 → `400`。

---

## 7. 大小上限

| 类型 | 上限 |
| --- | --- |
| 图片 | 20 MB |
| 视频 | 200 MB |

> 大小上限按媒体类型（由扩展名判定）分别校验。multipart 版底层上传的全局硬上限为 200MB（视频上限）；对图片，超过 20MB 会由服务端手动校验拦截并返回 `413`。

---

## 8. 错误码

以服务端实际返回为准，响应体形如 `{ "error": "<原因>" }`。

### 400 Bad Request

| 触发条件 | error 文案 |
| --- | --- |
| `workflowId` 非整数或不在 `[0, 10]` | `workflowId must be an integer in [0, 10]` |
| （路径版）`filePath` 缺失或非绝对路径 | `filePath must be an absolute path` |
| （路径版）`filePath` 不存在 | `filePath does not exist` |
| （路径版）`filePath` 无法访问 | `filePath is not accessible` |
| （路径版）`filePath` 指向的不是文件 | `filePath is not a file` |
| 扩展名不在白名单 | `Unsupported file extension` |
| （multipart 版）缺少 `image` 文件字段 | `Missing required field: image` |
| （multipart 版）上传解析失败（非超限） | `Upload failed`（或 multer 具体报错信息） |

### 413 Payload Too Large

| 触发条件 | error 文案 |
| --- | --- |
| 文件超过对应类型上限（图片 20MB / 视频 200MB） | `File too large` |
| （multipart 版）超过底层全局硬上限（200MB，multer `LIMIT_FILE_SIZE`） | `File too large` |

### 404 Not Found（GET 拉取）

| 触发条件 | error 文案 |
| --- | --- |
| `stagingId` 不存在，或已被取走 / 已过期（超 120 秒 TTL） | `Staging entry not found` |

---

## 9. version 字段扩展说明

- `version` 为**预留字段**，用于未来扩展（例如随推送携带提示词、生成参数、回调地址等）。
- 当前实现**不校验、不使用**该字段，可省略；如需填写，建议填 `1`。

---

## 10. 重要使用约束

- **路径版文件生命周期**：服务端只记录文件引用，前端会在稍后**异步 GET 一次**该文件的字节。因此该本地文件必须在前端拉取完成前**保持存在且可读**。若在拉取前被移动/删除，拉取将失败。
- **Pix2Real 必须在运行**：Pix2Real 未运行时端点不可达（连接失败）。bridge 侧需自行实现**重试 / 超时**处理。同时，推送成功仅代表已广播；若此时没有任何前端窗口在线拉取，暂存条目会在 120 秒后过期。
- **多窗口路由**：可选的 `sessionId` 用于将媒体**精确路由**到指定会话窗口；省略时，当前打开的窗口会接收该推送。

---

## 附录：WebSocket 广播事件（内部）

推送成功后，服务端向所有前端客户端广播如下事件（字段供前端解析，bridge 无需关心）：

```json
{
  "type": "external_image_push",
  "tabId": 0,
  "stagingId": "550e8400-e29b-41d4-a716-446655440000",
  "originalName": "hero.png",
  "targetSessionId": "<sessionId 或未定义>",
  "autoStart": true
}
```

- `tabId` 即请求中的 `workflowId`。
- `targetSessionId` 即请求中的 `sessionId`（省略时为未定义，表示广播给当前窗口）。
- `autoStart` 仅在请求中设为 `true` 时包含；前端据此决定是否自动触发工作流执行。
