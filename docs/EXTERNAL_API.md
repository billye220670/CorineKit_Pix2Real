# CorineKit 对外 API（External API）

面向**同机外部程序**开放全部 ComfyUI 工作流的 HTTP 接口层，统一前缀 `/api/v1`。
所有接口均需通过 API Key 鉴权，且仅在显式开启后才可用。

---

## 1. 鉴权方式

所有 `/api/v1/*` 请求必须携带请求头：

```
x-api-key: <你的 API Key>
```

- 未开启对外 API → 返回 `403 { "error": "External API disabled" }`
- Key 缺失或不在允许列表 → 返回 `401 { "error": "Invalid API key" }`

> 安全提示：服务端不会在任何日志中打印 API Key，请自行妥善保管。

---

## 2. 开启步骤

对外 API **默认关闭**。两种开启方式（可组合，环境变量优先级更高，会并入允许列表）：

### 方式 A：编辑项目根 `config.json`

```json
{
  "externalApi": {
    "enabled": true,
    "apiKeys": ["your-secret-key-1", "your-secret-key-2"],
    "corsOrigins": ["http://localhost:3000"]
  }
}
```

- `enabled`：设为 `true` 才启用对外 API。
- `apiKeys`：允许的 API Key 数组。
- `corsOrigins`：允许的 CORS 来源数组（浏览器跨域访问时使用）。

### 方式 B：环境变量覆盖

| 环境变量           | 说明                                        |
| ------------------ | ------------------------------------------- |
| `EXTERNAL_API_KEY` | 单个 API Key，若设置则**并入**允许列表      |
| `EXTERNAL_ORIGINS` | 逗号分隔的 CORS 来源，若设置则**并入**列表  |

> 注意：环境变量只影响 Key/来源列表，**是否启用**仍由 `config.json` 的 `externalApi.enabled` 控制。

---

## 3. 工作流 ID 映射表

| ID | 名称              | 输入文件               | 参数（? 表示可选）                                                                                   |
| -- | ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 0  | 二次元转真人      | `image`                | `prompt?`, `model?`(qwen/klein)                                                                      |
| 1  | 真人精修          | `image`                | `prompt?`                                                                                            |
| 2  | 精修放大          | `image`                | `model?`(seedvr2/klein/kleinpro/sd/remacri)                                                          |
| 3  | 图生视频          | `image`                | `prompt?`, `seconds?`, `fps?`, `megapixels?`                                                         |
| 4  | 视频补帧          | `video`                | `multiplier?`, `sourceFps?`                                                                          |
| 5  | 解除装备/区域编辑 | `image` + `mask`       | `prompt?`, `backPose?`                                                                               |
| 6  | 真人转二次元      | `image`                | `prompt?`                                                                                            |
| 7  | 快速出图          | 无（JSON）             | `model`, `prompt`, `width`, `height`, `steps`, `cfg`, `sampler`, `scheduler`（必填）；`loras[]?`, `negativePrompt?`, `seed?` |
| 8  | 换脸              | `targetImage` + `faceImage` | （无额外参数）                                                                                 |
| 9  | ZIT 快出          | 无（JSON）             | `unetModel`, `prompt`, `width`, `height`, `steps`, `cfg`, `sampler`, `scheduler`（必填）；`loras[]?`, `shift?` |
| 10 | 区域编辑（新）    | `image` + `mask`       | `prompt?`, `backPose?`                                                                               |

> 需要文件输入的工作流（0-6、8、10）使用 `multipart/form-data` 提交，文件字段名见"输入文件"列；
> 纯 JSON 工作流（7、9）使用 `application/json` 提交。

---

## 4. 接口说明

### 4.1 提交任务

```
POST /api/v1/tasks
```

- 需要文件的工作流：`Content-Type: multipart/form-data`，字段约定如下：
  - `workflowId`：工作流 ID（顶层表单字段）。
  - 文件字段（顶层）：`image` / `mask` / `video` / `targetImage` / `faceImage`，字段名见第 3 节。
  - `parameters`：**一个名为 `parameters` 的 JSON 字符串字段**，业务参数全部打包进该 JSON（如 `prompt`、`model`、`backPose` 等）。
- 纯 JSON 工作流（7、9）：`Content-Type: application/json`，请求体结构为 `{ "workflowId": 7, "parameters": { ... } }`，业务参数放入 `parameters` 对象。
- 返回 `taskId`，随后通过轮询查询进度与结果。

> 兼容说明：`workflowId` 为契约字段；服务端同时兼容旧字段 `workflowType`，但请统一使用 `workflowId`。

### 4.2 查询任务状态

```
GET /api/v1/tasks/:taskId
```

返回任务的 `status`、`progress`、`createdAt`、`completedAt` 等；任务完成后成功产物位于 `results.outputs`，失败时错误位于 `error`。

> 归属校验：任务仅可被创建它的那把 API Key 访问；其他合法 Key 访问将返回 `403 { "error": "Forbidden" }`。

### 4.3 下载结果

```
GET /api/v1/tasks/:taskId/result/:index
```

`index` 对应 `outputs` 数组下标，返回产物文件流。

### 4.4 取消任务

```
POST /api/v1/tasks/:taskId/cancel
```

### 4.5 查询工作流契约

```
GET /api/v1/workflows
```

返回全部工作流 ID 的描述、输入文件与参数契约（即第 3 节内容的机器可读版本）。

---

## 5. 请求 / 响应示例

### 提交任务响应

```json
{
  "taskId": "ext_1751990400000_a1b2c3d4",
  "workflowId": 0,
  "workflowName": "二次元转真人",
  "status": "queued"
}
```

### 查询任务状态响应（进行中）

```json
{
  "taskId": "ext_1751990400000_a1b2c3d4",
  "workflowId": 0,
  "workflowName": "二次元转真人",
  "status": "processing",
  "progress": { "percentage": 42, "stage": "采样中" },
  "createdAt": "2026-07-08T12:00:00.000Z",
  "completedAt": null
}
```

### 查询任务状态响应（完成）

```json
{
  "taskId": "ext_1751990400000_a1b2c3d4",
  "workflowId": 0,
  "workflowName": "二次元转真人",
  "status": "completed",
  "progress": { "percentage": 100 },
  "results": {
    "outputs": [
      { "filename": "result_0001.png", "url": "/api/v1/tasks/ext_1751990400000_a1b2c3d4/result/0" }
    ]
  },
  "createdAt": "2026-07-08T12:00:00.000Z",
  "completedAt": "2026-07-08T12:00:35.000Z"
}
```

---

## 6. 错误码

| 状态码 | 含义                                             |
| ------ | ------------------------------------------------ |
| 400    | 请求参数错误（缺少必填参数、workflowId 非法、数值参数非法等）  |
| 401    | API Key 无效或缺失                               |
| 403    | 对外 API 未开启，或访问非本 Key 创建的任务（Forbidden） |
| 404    | 任务不存在、结果下标越界                         |
| 500    | 服务端内部错误（含 ComfyUI 执行失败）            |

错误响应统一格式：

```json
{ "error": "错误描述" }
```

---

## 7. 轮询建议

任务为异步执行，建议轮询 `GET /api/v1/tasks/:taskId`：

- 初始间隔 **500ms**；
- 每次失败/未完成后按 **指数退避** 递增（如 ×2）；
- 退避上限 **5s**；
- 直到 `status` 为 `completed` 或 `error` 停止。

---

## 8. 完整调用示例

以下以 **工作流 0（二次元转真人，需上传图片）** 与 **工作流 7（快速出图，纯 JSON）** 为例。

### 8.1 cURL

工作流 0（multipart）：

```bash
# 提交（业务参数打包进名为 parameters 的 JSON 字符串字段，文件字段在顶层）
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "x-api-key: your-secret-key-1" \
  -F "workflowId=0" \
  -F "image=@./input.png" \
  -F 'parameters={"prompt":"photorealistic portrait","model":"qwen"}'

# 轮询（用返回的 taskId）
curl http://localhost:8080/api/v1/tasks/ext_1751990400000_a1b2c3d4 \
  -H "x-api-key: your-secret-key-1"

# 下载第 0 个结果
curl -o out.png \
  http://localhost:8080/api/v1/tasks/ext_1751990400000_a1b2c3d4/result/0 \
  -H "x-api-key: your-secret-key-1"
```

工作流 7（JSON）：

```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "x-api-key: your-secret-key-1" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": 7,
    "parameters": {
      "model": "sd_xl_base.safetensors",
      "prompt": "a scenic mountain, masterpiece",
      "width": 1024,
      "height": 1024,
      "steps": 30,
      "cfg": 7,
      "sampler": "dpmpp_2m",
      "scheduler": "karras",
      "negativePrompt": "lowres, blurry",
      "seed": 12345,
      "loras": [{ "model": "detail.safetensors", "enabled": true, "strength": 0.8 }]
    }
  }'
```

### 8.2 JavaScript（fetch）

```javascript
const BASE = 'http://localhost:8080/api/v1';
const API_KEY = 'your-secret-key-1';

// 通用轮询：初始 500ms，指数退避，上限 5s
async function pollTask(taskId) {
  let delay = 500;
  while (true) {
    const res = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: { 'x-api-key': API_KEY },
    });
    const task = await res.json();
    if (task.status === 'completed') return task;
    if (task.status === 'error') throw new Error(task.error);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 5000);
  }
}

// 工作流 0：上传图片（文件字段在顶层，业务参数放入 parameters JSON 字符串）
async function anime2real(file) {
  const form = new FormData();
  form.append('workflowId', '0');
  form.append('image', file);
  form.append('parameters', JSON.stringify({
    prompt: 'photorealistic portrait',
    model: 'qwen',
  }));
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY },
    body: form,
  });
  const { taskId } = await res.json();
  const task = await pollTask(taskId);
  return task.results.outputs;
}

// 工作流 7：纯 JSON 文生图（业务参数放入 parameters 对象）
async function quickGenerate() {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: 7,
      parameters: {
        model: 'sd_xl_base.safetensors',
        prompt: 'a scenic mountain, masterpiece',
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
      },
    }),
  });
  const { taskId } = await res.json();
  return pollTask(taskId);
}
```

### 8.3 Python（requests）

```python
import json
import time
import requests

BASE = "http://localhost:8080/api/v1"
API_KEY = "your-secret-key-1"
HEADERS = {"x-api-key": API_KEY}


def poll_task(task_id):
    delay = 0.5  # 初始 500ms
    while True:
        r = requests.get(f"{BASE}/tasks/{task_id}", headers=HEADERS)
        task = r.json()
        if task["status"] == "completed":
            return task
        if task["status"] == "error":
            raise RuntimeError(task["error"])
        time.sleep(delay)
        delay = min(delay * 2, 5.0)  # 指数退避，上限 5s


def anime_to_real(image_path):
    with open(image_path, "rb") as f:
        files = {"image": f}
        # 业务参数打包进名为 parameters 的 JSON 字符串字段，workflowId 在顶层
        data = {
            "workflowId": "0",
            "parameters": json.dumps({"prompt": "photorealistic portrait", "model": "qwen"}),
        }
        r = requests.post(f"{BASE}/tasks", headers=HEADERS, files=files, data=data)
    task_id = r.json()["taskId"]
    task = poll_task(task_id)
    # 下载第 0 个结果
    out = requests.get(f"{BASE}/tasks/{task_id}/result/0", headers=HEADERS)
    with open("out.png", "wb") as f:
        f.write(out.content)
    return task["results"]["outputs"]


def quick_generate():
    payload = {
        "workflowId": 7,
        "parameters": {
            "model": "sd_xl_base.safetensors",
            "prompt": "a scenic mountain, masterpiece",
            "width": 1024,
            "height": 1024,
            "steps": 30,
            "cfg": 7,
            "sampler": "dpmpp_2m",
            "scheduler": "karras",
        },
    }
    r = requests.post(f"{BASE}/tasks", headers=HEADERS, json=payload)
    task_id = r.json()["taskId"]
    return poll_task(task_id)
```

> 示例中的端口 `8080` 仅为占位，请替换为实际服务监听端口。
