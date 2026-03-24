# ComfyUI 集成

<cite>
**本文引用的文件**
- [server/src/services/comfyui.ts](file://server/src/services/comfyui.ts)
- [server/src/routes/workflow.ts](file://server/src/routes/workflow.ts)
- [server/src/routes/output.ts](file://server/src/routes/output.ts)
- [server/src/routes/session.ts](file://server/src/routes/session.ts)
- [server/src/services/sessionManager.ts](file://server/src/services/sessionManager.ts)
- [server/src/adapters/index.ts](file://server/src/adapters/index.ts)
- [server/src/adapters/BaseAdapter.ts](file://server/src/adapters/BaseAdapter.ts)
- [server/src/adapters/Workflow0Adapter.ts](file://server/src/adapters/Workflow0Adapter.ts)
- [server/src/types/index.ts](file://server/src/types/index.ts)
- [server/src/index.ts](file://server/src/index.ts)
- [client/src/hooks/useWebSocket.ts](file://client/src/hooks/useWebSocket.ts)
- [client/src/hooks/useWorkflowStore.ts](file://client/src/hooks/useWorkflowStore.ts)
- [client/src/types/index.ts](file://client/src/types/index.ts)
- [README.md](file://README.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本技术文档面向 CorineKit Pix2Real 的 ComfyUI 集成服务，聚焦于以下方面：
- HTTP API 调用封装：工作流提交、参数传递、响应处理、错误处理与超时策略
- WebSocket 连接管理：连接建立、消息路由、事件监听、断线重连策略
- 文件上传下载处理：二进制数据传输、进度监控、内存管理
- ComfyUI 服务集成流程：认证机制（clientId）、超时处理、性能优化建议

该系统通过适配器模式加载 ComfyUI 工作流模板，统一构建 prompt JSON 并提交队列；后端以单例 WebSocket 代理与 ComfyUI 实时通信，同时在任务完成后将输出文件下载到本地会话目录，供前端按需访问。

## 项目结构
整体采用前后端分离架构：
- 前端（React + TypeScript）：负责用户交互、状态管理、WebSocket 事件消费与 UI 展示
- 后端（Express + ws）：提供 REST API、WebSocket 中继、文件系统会话持久化、与 ComfyUI 的 HTTP/WS 交互

```mermaid
graph TB
subgraph "前端"
FE_Client["浏览器客户端"]
FE_WS["useWebSocket 钩子<br/>单例连接"]
FE_Store["useWorkflowStore 状态库"]
end
subgraph "后端"
BE_Express["Express 应用"]
BE_WS["WebSocket 服务器<br/>/ws"]
BE_Routes["REST 路由<br/>workflow/output/session"]
BE_Services["ComfyUI 服务层<br/>HTTP/WS 封装"]
BE_Session["会话管理<br/>sessionsBase"]
end
subgraph "外部服务"
COMFY["ComfyUI 服务<br/>HTTP/WS"]
end
FE_Client --> FE_WS
FE_WS --> BE_WS
BE_WS --> BE_Services
BE_Services --> COMFY
FE_Client --> BE_Express
BE_Express --> BE_Routes
BE_Routes --> BE_Services
BE_Routes --> BE_Session
BE_Services --> BE_Session
```

图表来源
- [server/src/index.ts:62-219](file://server/src/index.ts#L62-L219)
- [server/src/routes/workflow.ts:1-862](file://server/src/routes/workflow.ts#L1-L862)
- [server/src/routes/output.ts:1-134](file://server/src/routes/output.ts#L1-L134)
- [server/src/routes/session.ts:1-95](file://server/src/routes/session.ts#L1-L95)
- [server/src/services/comfyui.ts:1-285](file://server/src/services/comfyui.ts#L1-L285)
- [server/src/services/sessionManager.ts:1-164](file://server/src/services/sessionManager.ts#L1-L164)
- [client/src/hooks/useWebSocket.ts:1-99](file://client/src/hooks/useWebSocket.ts#L1-L99)
- [client/src/hooks/useWorkflowStore.ts:1-645](file://client/src/hooks/useWorkflowStore.ts#L1-L645)

章节来源
- [README.md:41-79](file://README.md#L41-L79)
- [server/src/index.ts:1-228](file://server/src/index.ts#L1-L228)

## 核心组件
- ComfyUI 服务层（HTTP/WS）
  - HTTP：上传图像/视频、提交 prompt、查询历史、获取图片、系统统计、队列管理、模型列表等
  - WebSocket：连接 ComfyUI，转发进度、执行开始、完成、错误事件
- 路由层
  - 工作流路由：执行单图/批量、取消队列、优先级调整、释放内存、系统统计、导出混合图等
  - 输出路由：列出/下载输出文件、打开文件或文件夹
  - 会话路由：保存输入图/蒙版、保存/加载/删除会话状态
- 适配器层
  - 每个工作流一个适配器，加载模板并按需填充节点（如图像名、提示词、随机种子）
- 会话管理
  - 会话目录结构化存储输入图、蒙版、输出文件与状态 JSON
- 前端 WebSocket 与状态
  - 单例 WebSocket 连接、断线重连、事件分发至状态库
  - 状态库维护任务生命周期、进度、输出文件映射

章节来源
- [server/src/services/comfyui.ts:1-285](file://server/src/services/comfyui.ts#L1-L285)
- [server/src/routes/workflow.ts:1-862](file://server/src/routes/workflow.ts#L1-L862)
- [server/src/routes/output.ts:1-134](file://server/src/routes/output.ts#L1-L134)
- [server/src/routes/session.ts:1-95](file://server/src/routes/session.ts#L1-L95)
- [server/src/adapters/index.ts:1-31](file://server/src/adapters/index.ts#L1-L31)
- [server/src/adapters/Workflow0Adapter.ts:1-35](file://server/src/adapters/Workflow0Adapter.ts#L1-L35)
- [server/src/services/sessionManager.ts:1-164](file://server/src/services/sessionManager.ts#L1-L164)
- [client/src/hooks/useWebSocket.ts:1-99](file://client/src/hooks/useWebSocket.ts#L1-L99)
- [client/src/hooks/useWorkflowStore.ts:1-645](file://client/src/hooks/useWorkflowStore.ts#L1-L645)

## 架构总览
后端启动时创建 Express 与 WebSocketServer，分别监听 HTTP 与 WS 请求。每个浏览器客户端连接后，后端分配唯一 clientId 并与 ComfyUI 建立 WebSocket 连接，将 ComfyUI 的进度/完成/错误事件转换为统一格式回传给前端。完成事件中包含输出文件信息，后端从 ComfyUI 下载对应二进制并保存到会话目录，随后通知前端。

```mermaid
sequenceDiagram
participant Browser as "浏览器"
participant WS_Server as "后端 WebSocket 服务器"
participant WS_Comfy as "ComfyUI WebSocket"
participant HTTP as "后端 HTTP 服务"
participant FS as "会话文件系统"
Browser->>WS_Server : 建立 /ws 连接
WS_Server->>Browser : 发送 {type : "connected", clientId}
WS_Server->>WS_Comfy : connectWebSocket(clientId,...)
Browser->>WS_Server : 注册 promptId 映射
WS_Server->>HTTP : queuePrompt(prompt, clientId)
HTTP-->>WS_Comfy : 提交到 ComfyUI 队列
WS_Comfy-->>WS_Server : progress/executing/execution_success/error
WS_Server-->>Browser : 转发进度/开始/完成/错误
WS_Server->>HTTP : getHistory(promptId)
HTTP-->>WS_Server : 历史输出列表
loop 遍历输出
WS_Server->>HTTP : getImageBuffer(filename, subfolder, type)
HTTP-->>WS_Server : Buffer
WS_Server->>FS : 保存到会话 output 目录
end
WS_Server-->>Browser : 完成事件 + 输出文件 URL
```

图表来源
- [server/src/index.ts:73-219](file://server/src/index.ts#L73-L219)
- [server/src/services/comfyui.ts:47-125](file://server/src/services/comfyui.ts#L47-L125)
- [server/src/services/sessionManager.ts:34-57](file://server/src/services/sessionManager.ts#L34-L57)

章节来源
- [server/src/index.ts:62-228](file://server/src/index.ts#L62-L228)

## 详细组件分析

### HTTP API 调用封装与工作流执行
- 上传文件
  - 支持图像与视频上传，使用表单数据提交至 ComfyUI 的上传接口
  - 返回 ComfyUI 内部文件名，用于后续模板节点引用
- 提交工作流
  - 将适配器构建好的 prompt JSON 通过 /prompt 接口提交
  - 返回 prompt_id，作为后续历史查询与输出下载的标识
- 历史与输出
  - 通过 /history/{promptId} 获取输出文件列表
  - 通过 /view 接口下载具体文件为 Buffer
- 队列与系统
  - 查询队列、删除队列项、提升优先级、系统统计（VRAM/内存）
- 模型列表
  - 通过 /object_info/* 接口动态获取可用模型名称

```mermaid
flowchart TD
Start(["开始"]) --> Upload["上传图像/视频<br/>返回内部文件名"]
Upload --> BuildPrompt["适配器构建 prompt JSON"]
BuildPrompt --> Submit["POST /prompt 提交"]
Submit --> Resp{"响应成功?"}
Resp --> |否| Err["抛出错误"]
Resp --> |是| SaveId["记录 prompt_id"]
SaveId --> Wait["等待 ComfyUI 执行"]
Wait --> History["GET /history/{promptId}"]
History --> HasOut{"有输出?"}
HasOut --> |否| Done["结束"]
HasOut --> |是| View["GET /view 下载 Buffer"]
View --> Save["保存到会话 output 目录"]
Save --> Done
```

图表来源
- [server/src/services/comfyui.ts:9-83](file://server/src/services/comfyui.ts#L9-L83)
- [server/src/routes/workflow.ts:407-455](file://server/src/routes/workflow.ts#L407-L455)
- [server/src/services/sessionManager.ts:34-57](file://server/src/services/sessionManager.ts#L34-L57)

章节来源
- [server/src/services/comfyui.ts:9-125](file://server/src/services/comfyui.ts#L9-L125)
- [server/src/routes/workflow.ts:407-455](file://server/src/routes/workflow.ts#L407-L455)

### WebSocket 连接管理与事件路由
- 连接建立
  - 客户端首次连接后，后端分配 clientId 并发送 connected 事件
  - 后端为该客户端创建 ComfyUI WebSocket 连接
- 事件路由
  - progress：计算百分比并转发
  - executing：首次节点非空触发 execution_start，节点为空触发 complete
  - execution_success：显式完成信号
  - execution_error：错误事件
- 断线重连
  - 前端 useWebSocket 使用模块级全局连接与计数，断开后延迟重连
  - 后端在客户端断开时关闭对应的 ComfyUI 连接
- 事件缓冲与重放
  - 对每个 promptId 维护事件缓冲，若客户端注册较晚可重放已发生的 execution_start/progress

```mermaid
sequenceDiagram
participant FE as "前端"
participant WS as "后端 WS 服务器"
participant CW as "ComfyUI WS"
FE->>WS : 建立 /ws 连接
WS-->>FE : {type : "connected", clientId}
WS->>CW : connectWebSocket(clientId,...)
CW-->>WS : progress/executing/...
WS-->>FE : 转发进度/开始/完成/错误
FE->>WS : 注册 promptId 映射
WS-->>FE : 重放缓冲事件
FE-->>WS : 关闭连接
WS->>CW : 关闭连接
```

图表来源
- [server/src/index.ts:73-219](file://server/src/index.ts#L73-L219)
- [client/src/hooks/useWebSocket.ts:1-99](file://client/src/hooks/useWebSocket.ts#L1-L99)

章节来源
- [server/src/index.ts:73-219](file://server/src/index.ts#L73-L219)
- [client/src/hooks/useWebSocket.ts:1-99](file://client/src/hooks/useWebSocket.ts#L1-L99)

### 文件上传下载处理与内存管理
- 上传
  - 使用 multer 内存存储，直接将 Buffer 传入 ComfyUI 上传接口
  - 图像与视频分别调用不同的上传函数
- 下载
  - 通过 /view 接口获取 Buffer，再写入会话 output 目录
  - 保存路径通过 /api/session-files 暴露静态访问
- 内存管理
  - 服务端使用内存存储上传文件，适合小批量场景
  - 大批量或大尺寸文件建议结合 ComfyUI 的本地存储或外部对象存储
- 输出访问
  - 输出路由支持直接下载与打开文件，默认应用

章节来源
- [server/src/routes/workflow.ts:22-27](file://server/src/routes/workflow.ts#L22-L27)
- [server/src/services/comfyui.ts:9-83](file://server/src/services/comfyui.ts#L9-L83)
- [server/src/routes/output.ts:1-134](file://server/src/routes/output.ts#L1-L134)
- [server/src/services/sessionManager.ts:20-57](file://server/src/services/sessionManager.ts#L20-L57)

### 适配器模式与工作流模板
- 适配器职责
  - 加载对应 JSON 模板，仅修改必要节点（图像名、提示词、随机种子等）
  - 统一输出结构，便于路由层复用
- 典型流程
  - 读取模板 → 填充节点 → 随机种子 → 提交队列 → 记录 prompt_id → 等待完成 → 下载输出

```mermaid
classDiagram
class WorkflowAdapter {
+id : number
+name : string
+needsPrompt : boolean
+basePrompt : string
+outputDir : string
+buildPrompt(imageName, userPrompt) object
}
class Workflow0Adapter {
+id = 0
+name = "二次元转真人"
+needsPrompt = true
+basePrompt = "... "
+outputDir = "0-二次元转真人"
+buildPrompt(imageName, userPrompt) object
}
Workflow0Adapter ..|> WorkflowAdapter
```

图表来源
- [server/src/adapters/BaseAdapter.ts:1-4](file://server/src/adapters/BaseAdapter.ts#L1-L4)
- [server/src/adapters/Workflow0Adapter.ts:1-35](file://server/src/adapters/Workflow0Adapter.ts#L1-L35)
- [server/src/adapters/index.ts:1-31](file://server/src/adapters/index.ts#L1-L31)

章节来源
- [server/src/adapters/Workflow0Adapter.ts:1-35](file://server/src/adapters/Workflow0Adapter.ts#L1-L35)
- [server/src/adapters/index.ts:1-31](file://server/src/adapters/index.ts#L1-L31)

### 会话与状态持久化
- 目录结构
  - sessions/{sessionId}/tab-{tabId}/{input|masks|output}
- 功能
  - 保存输入图、蒙版、输出文件
  - 保存/加载/删除会话状态 JSON
  - 列出最近会话并裁剪旧会话
- 与输出路由配合
  - 输出文件通过 /api/session-files 暴露，支持打开文件默认应用

章节来源
- [server/src/services/sessionManager.ts:1-164](file://server/src/services/sessionManager.ts#L1-L164)
- [server/src/routes/output.ts:1-134](file://server/src/routes/output.ts#L1-L134)
- [server/src/routes/session.ts:1-95](file://server/src/routes/session.ts#L1-L95)

## 依赖关系分析
- 路由依赖服务层
  - workflow 路由依赖 comfyui 服务与会话管理
  - output 路由依赖会话管理与文件系统
- 服务层依赖
  - comfyui 服务依赖 node-fetch、ws 与 ComfyUI API
  - 会话管理依赖文件系统
- 前端依赖
  - useWebSocket 依赖 WebSocket 与 Zustand 状态库
  - 类型定义统一前后端事件结构

```mermaid
graph LR
WF["workflow.ts"] --> SVC["comfyui.ts"]
WF --> SM["sessionManager.ts"]
OUT["output.ts"] --> SM
IDX["index.ts"] --> SVC
IDX --> SM
FE_WS["useWebSocket.ts"] --> FE_TYPES["types/index.ts"]
FE_STORE["useWorkflowStore.ts"] --> FE_TYPES
```

图表来源
- [server/src/routes/workflow.ts:1-11](file://server/src/routes/workflow.ts#L1-L11)
- [server/src/routes/output.ts:1-6](file://server/src/routes/output.ts#L1-L6)
- [server/src/routes/session.ts:1-13](file://server/src/routes/session.ts#L1-L13)
- [server/src/services/comfyui.ts:1-5](file://server/src/services/comfyui.ts#L1-L5)
- [server/src/services/sessionManager.ts:1-6](file://server/src/services/sessionManager.ts#L1-L6)
- [server/src/index.ts:1-12](file://server/src/index.ts#L1-L12)
- [client/src/hooks/useWebSocket.ts:1-4](file://client/src/hooks/useWebSocket.ts#L1-L4)
- [client/src/hooks/useWorkflowStore.ts:1-5](file://client/src/hooks/useWorkflowStore.ts#L1-L5)
- [client/src/types/index.ts:1-58](file://client/src/types/index.ts#L1-L58)

章节来源
- [server/src/routes/workflow.ts:1-11](file://server/src/routes/workflow.ts#L1-L11)
- [server/src/routes/output.ts:1-6](file://server/src/routes/output.ts#L1-L6)
- [server/src/routes/session.ts:1-13](file://server/src/routes/session.ts#L1-L13)
- [server/src/services/comfyui.ts:1-5](file://server/src/services/comfyui.ts#L1-L5)
- [server/src/services/sessionManager.ts:1-6](file://server/src/services/sessionManager.ts#L1-L6)
- [server/src/index.ts:1-12](file://server/src/index.ts#L1-L12)
- [client/src/hooks/useWebSocket.ts:1-4](file://client/src/hooks/useWebSocket.ts#L1-L4)
- [client/src/hooks/useWorkflowStore.ts:1-5](file://client/src/hooks/useWorkflowStore.ts#L1-L5)
- [client/src/types/index.ts:1-58](file://client/src/types/index.ts#L1-L58)

## 性能考虑
- HTTP 超时与重试
  - 当前实现未内置 HTTP 重试逻辑，建议在关键路径（如 /prompt、/history、/view）增加指数退避重试与超时控制
- WebSocket 重连
  - 前端已具备断线重连，建议在后端也对 ComfyUI 连接进行健壮性处理（异常捕获、自动重建）
- 内存占用
  - multer 使用内存存储，建议限制单次上传大小与并发数；对大批量任务采用分批提交与队列优先级调整
- 输出下载
  - 下载完成后立即清理临时文件，避免磁盘膨胀；对大文件建议流式传输或分块下载
- 模型与资源
  - 通过 /object_info 接口动态获取模型列表，减少硬编码；在 UI 中缓存模型列表以降低请求频率

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- ComfyUI 不可用
  - 现象：HTTP 错误、WebSocket 连接失败
  - 排查：确认 ComfyUI 在 127.0.0.1:8188 运行；检查防火墙与跨域配置
- 上传失败
  - 现象：/upload/image 返回错误
  - 排查：检查文件类型与大小限制；确认 ComfyUI 上传目录权限
- 提交队列失败
  - 现象：/prompt 返回错误
  - 排查：检查 prompt JSON 结构是否符合模板；确认 clientId 是否正确传递
- 无进度/无完成事件
  - 现象：WebSocket 无 progress 或 complete
  - 排查：确认客户端已注册 promptId 映射；检查后端事件缓冲与重放逻辑
- 输出文件缺失
  - 现象：完成事件存在但无法下载
  - 排查：检查 /history 返回的输出列表；确认 /view 参数与文件存在；查看后端日志中的下载错误

章节来源
- [server/src/services/comfyui.ts:47-83](file://server/src/services/comfyui.ts#L47-L83)
- [server/src/routes/workflow.ts:522-579](file://server/src/routes/workflow.ts#L522-L579)
- [server/src/index.ts:92-189](file://server/src/index.ts#L92-L189)

## 结论
本系统通过适配器模式与统一的 HTTP/WS 封装，实现了对多种 ComfyUI 工作流的标准化接入。前端以单例 WebSocket 与状态库协同，提供实时进度与输出管理；后端负责与 ComfyUI 的桥接与本地文件持久化。建议在生产环境中增强 HTTP 重试与超时、优化大文件处理与内存占用，并完善错误监控与日志追踪。

[本节为总结，不直接分析具体文件]

## 附录

### API 一览（节选）
- 工作流执行
  - POST /api/workflow/:id/execute（单图）
  - POST /api/workflow/:id/batch（多图）
  - POST /api/workflow/:id/execute/5（解除装备）
  - POST /api/workflow/:id/execute/7（快速出图）
  - POST /api/workflow/:id/execute/8（黑兽换脸）
  - POST /api/workflow/:id/execute/9（ZIT快出）
- 队列与系统
  - POST /api/workflow/cancel-queue/:promptId
  - GET /api/workflow/system-stats
  - POST /api/workflow/release-memory
  - GET /api/workflow/queue
  - POST /api/workflow/queue/prioritize/:promptId
- 输出与会话
  - GET /api/output/:workflowId
  - GET /api/output/:workflowId/:filename
  - POST /api/output/open-file
  - POST /api/session/:sessionId/images
  - POST /api/session/:sessionId/masks
  - PUT/POST /api/session/:sessionId/state
  - GET /api/session/:sessionId
  - GET /api/sessions
  - DELETE /api/session/:sessionId

章节来源
- [server/src/routes/workflow.ts:29-579](file://server/src/routes/workflow.ts#L29-L579)
- [server/src/routes/output.ts:22-131](file://server/src/routes/output.ts#L22-L131)
- [server/src/routes/session.ts:18-92](file://server/src/routes/session.ts#L18-L92)