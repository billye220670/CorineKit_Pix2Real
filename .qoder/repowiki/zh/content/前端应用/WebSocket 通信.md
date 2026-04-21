# WebSocket 通信

<cite>
**本文引用的文件**
- [useWebSocket.ts](file://client/src/hooks/useWebSocket.ts)
- [useAgentStore.ts](file://client/src/hooks/useAgentStore.ts)
- [AgentDialog.tsx](file://client/src/components/AgentDialog.tsx)
- [AgentFab.tsx](file://client/src/components/AgentFab.tsx)
- [index.ts](file://client/src/types/index.ts)
- [useWorkflowStore.ts](file://client/src/hooks/useWorkflowStore.ts)
- [index.ts](file://server/src/index.ts)
- [App.tsx](file://client/src/components/App.tsx)
- [QueuePanel.tsx](file://client/src/components/QueuePanel.tsx)
- [sessionService.ts](file://client/src/services/sessionService.ts)
- [agent.ts](file://server/src/routes/agent.ts)
- [agentService.ts](file://server/src/services/agentService.ts)
- [comfyui.ts](file://server/src/services/comfyui.ts)
</cite>

## 更新摘要
**变更内容**
- 新增WebSocket竞态条件修复：服务器端增加等待机制确保completion事件可靠传递
- 优化completion事件处理：在completion事件前等待客户端注册消息
- 增强事件缓冲与回放机制：改进客户端注册时机的容错处理
- 完善错误处理：增强completion事件处理过程中的异常保护

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [AI代理通信架构](#ai代理通信架构)
7. [竞态条件修复机制](#竞态条件修复机制)
8. [依赖关系分析](#依赖关系分析)
9. [性能考量](#性能考量)
10. [故障排除指南](#故障排除指南)
11. [结论](#结论)
11. [附录](#附录)

## 简介
本文件系统性阐述本项目中的 WebSocket 实时通信实现与最佳实践，重点覆盖：
- 连接建立、消息传输、状态同步等核心机制
- useWebSocket Hook 的连接管理、消息监听、错误处理与重连策略
- AI代理通信架构，支持智能对话和工作流执行
- 服务器端 WebSocket 服务与 ComfyUI 的对接
- 应用场景：任务进度实时更新、状态同步、输出下载与通知、AI代理智能交互
- 性能优化与故障排除建议
- **新增**：竞态条件修复机制，确保completion事件的可靠传递

## 项目结构
前端通过自定义 Hook 统一管理 WebSocket 连接，支持工作流任务和AI代理两种通信模式。服务器端基于 ws 构建 WebSocket 服务，负责与 ComfyUI 交互并将进度/完成/错误事件回传给前端。**新增**：服务器端增加了对completion事件的等待机制，解决客户端注册和完成事件之间的竞态条件问题。

```mermaid
graph TB
subgraph "客户端"
A["App.tsx<br/>挂载 useWebSocket"]
B["useWebSocket.ts<br/>全局单例连接"]
C["useWorkflowStore.ts<br/>工作流状态管理"]
D["useAgentStore.ts<br/>AI代理状态管理"]
E["AgentDialog.tsx<br/>AI代理对话界面"]
F["AgentFab.tsx<br/>AI代理浮动按钮"]
G["QueuePanel.tsx<br/>发送注册消息"]
end
subgraph "服务器"
H["server/index.ts<br/>WebSocketServer /ws<br/>竞态条件修复"]
I["server/routes/agent.ts<br/>AI代理路由"]
J["server/services/agentService.ts<br/>AI代理服务"]
K["ComfyUI<br/>执行引擎"]
L["comfyui.ts<br/>ComfyUI连接管理<br/>事件去重机制"]
end
A --> B
E --> B
G --> B
B <- --> H
H --> K
H --> L
B --> C
B --> D
I --> J
E --> I
```

**图表来源**
- [App.tsx:74](file://client/src/components/App.tsx#L74)
- [useWebSocket.ts:75-98](file://client/src/hooks/useWebSocket.ts#L75-L98)
- [useWorkflowStore.ts:398-499](file://client/src/hooks/useWorkflowStore.ts#L398-L499)
- [useAgentStore.ts:124-225](file://client/src/hooks/useAgentStore.ts#L124-L225)
- [AgentDialog.tsx:1-800](file://client/src/components/AgentDialog.tsx#L1-L800)
- [AgentFab.tsx:1-46](file://client/src/components/AgentFab.tsx#L1-L46)
- [QueuePanel.tsx:35](file://client/src/components/QueuePanel.tsx#L35)
- [index.ts:63](file://server/src/index.ts#L63)
- [agent.ts:369](file://server/src/routes/agent.ts#L369)
- [agentService.ts:1-118](file://server/src/services/agentService.ts#L1-L118)
- [comfyui.ts:127-188](file://server/src/services/comfyui.ts#L127-L188)

**章节来源**
- [useWebSocket.ts:1-202](file://client/src/hooks/useWebSocket.ts#L1-L202)
- [index.ts:63](file://server/src/index.ts#L63)

## 核心组件
- 客户端 Hook：统一管理 WebSocket 生命周期、消息分发与重连
- AI代理状态管理：useAgentStore 管理对话状态、执行状态和收藏功能
- 类型系统：定义服务端消息协议（连接、开始、进度、完成、错误）
- 状态管理：将 WebSocket 事件映射为 UI 状态变更
- 服务器端：转发客户端注册请求、缓冲事件、回放丢失事件、下载输出并回传
- AI代理服务：提供智能对话、意图解析、工作流执行和生成历史管理
- **新增**：ComfyUI连接管理：处理ComfyUI事件流，防止重复触发和事件去重

**章节来源**
- [useWebSocket.ts:10-73](file://client/src/hooks/useWebSocket.ts#L10-L73)
- [useAgentStore.ts:54-122](file://client/src/hooks/useAgentStore.ts#L54-L122)
- [index.ts:27-57](file://client/src/types/index.ts#L27-L57)
- [useWorkflowStore.ts:398-499](file://client/src/hooks/useWorkflowStore.ts#L398-L499)
- [agent.ts:369](file://server/src/routes/agent.ts#L369)
- [agentService.ts:1-118](file://server/src/services/agentService.ts#L1-L118)
- [comfyui.ts:127-188](file://server/src/services/comfyui.ts#L127-L188)

## 架构总览
WebSocket 通信链路由客户端 Hook 建立，服务器作为代理与 ComfyUI 交互，最终将事件回传至客户端，驱动 UI 实时更新。AI代理通信通过独立的状态管理和对话流程实现智能交互。**新增**：服务器端在处理completion事件时增加了等待机制，确保客户端注册消息的可靠接收。

```mermaid
sequenceDiagram
participant UI as "界面组件"
participant Hook as "useWebSocket"
participant Srv as "服务器 WebSocket"
participant Agent as "AI代理服务"
participant Cfg as "ComfyUI"
participant RaceFix as "竞态条件修复"
UI->>Hook : 调用 sendMessage(...)
Hook->>Srv : 发送消息(如注册)
Srv->>RaceFix : 检查completion等待机制
RaceFix->>Srv : 等待客户端注册(最多2秒)
Srv->>Cfg : 转发/触发执行
Cfg-->>Srv : 执行开始/进度/完成/错误
Srv-->>Hook : 回传事件(带 promptId)
Hook->>Hook : 解析消息类型
Hook->>UI : 触发状态更新(进度/完成/错误)
Hook->>Agent : 处理AI代理事件
Agent->>UI : 更新对话状态和执行进度
```

**图表来源**
- [useWebSocket.ts:26-51](file://client/src/hooks/useWebSocket.ts#L26-L51)
- [agent.ts:633](file://server/src/routes/agent.ts#L633)
- [useWorkflowStore.ts:398-499](file://client/src/hooks/useWorkflowStore.ts#L398-L499)
- [index.ts:132-144](file://server/src/index.ts#L132-L144)

## 详细组件分析

### useWebSocket Hook 设计与实现
- 单例连接：全局缓存 WebSocket 实例，避免重复连接；连接数计数用于优雅断开
- 自动重连：断开后延迟重连，仅当存在订阅者时进行
- 消息路由：解析服务端消息，调用状态管理函数更新任务状态
- 发送消息：封装 JSON 序列化与 readyState 校验
- AI代理支持：独立处理AI代理执行状态，与工作流任务状态分离

```mermaid
flowchart TD
Start(["useEffect 挂载"]) --> Inc["连接计数+1"]
Inc --> GetConn["getOrCreateConnection()"]
GetConn --> ConnReady{"已有有效连接?"}
ConnReady --> |是| UseConn["复用连接"]
ConnReady --> |否| NewConn["创建新连接"]
NewConn --> Setup["绑定 onopen/onmessage/onclose/onerror"]
Setup --> UseConn
UseConn --> ParseMsg["解析服务端消息"]
ParseMsg --> WorkFlow{"工作流任务?"}
WorkFlow --> |是| UpdateWF["更新工作流状态"]
WorkFlow --> |否| AgentMsg{"AI代理消息?"}
AgentMsg --> |是| UpdateAgent["更新代理状态"]
AgentMsg --> |否| Ignore["忽略消息"]
UpdateWF --> Send["sendMessage(data)"]
UpdateAgent --> Send
Send --> Ready{"readyState=OPEN?"}
Ready --> |是| WSsend["ws.send(JSON)"]
Ready --> |否| Ignore2["忽略发送"]
WSsend --> End(["返回"])
Ignore2 --> End
```

**图表来源**
- [useWebSocket.ts:75-98](file://client/src/hooks/useWebSocket.ts#L75-L98)
- [useWebSocket.ts:10-73](file://client/src/hooks/useWebSocket.ts#L10-L73)
- [useWebSocket.ts:131-153](file://client/src/hooks/useWebSocket.ts#L131-L153)

**章节来源**
- [useWebSocket.ts:10-73](file://client/src/hooks/useWebSocket.ts#L10-L73)
- [useWebSocket.ts:75-98](file://client/src/hooks/useWebSocket.ts#L75-L98)
- [useWebSocket.ts:131-153](file://client/src/hooks/useWebSocket.ts#L131-L153)

### 服务器端 WebSocket 服务
- 路由与实例：在 /ws 上启动 WebSocketServer
- 客户端分配：为每个连接生成唯一 clientId 并立即回传
- 事件缓冲：按 promptId 缓存 execution_start/progress，支持客户端"迟到"重放
- 注册与回放：接收客户端注册消息，回放缓冲事件
- 输出下载：完成事件触发后下载输出到会话目录并回传 outputs
- 错误处理：捕获异常并回传 error 事件，清理映射与缓冲
- AI代理集成：支持AI代理执行状态的独立进度跟踪
- **新增**：竞态条件修复：completion事件处理前等待客户端注册消息，最多等待2秒

```mermaid
flowchart TD
Conn["客户端连接"] --> Assign["生成 clientId 并回传"]
Assign --> Register["等待客户端注册(含 promptId)"]
Register --> Buffer["按 promptId 缓存事件"]
Buffer --> Events{"收到执行事件?"}
Events --> |execution_start| SendStart["回传 execution_start"]
Events --> |progress| SendProgress["回传 progress(百分比)"]
Events --> |complete| WaitCheck["竞态条件检查"]
WaitCheck --> CheckReg{"客户端已注册?"}
CheckReg --> |是| Download["下载输出到会话目录"]
CheckReg --> |否| Wait["等待最多2秒"]
Wait --> Download
Download --> SendComplete["回传 complete(含 outputs)"]
Events --> |error| SendError["回传 error"]
SendComplete --> Cleanup["清理映射与缓冲"]
SendError --> Cleanup
```

**图表来源**
- [index.ts:73-219](file://server/src/index.ts#L73-L219)
- [index.ts:132-144](file://server/src/index.ts#L132-L144)

**章节来源**
- [index.ts:63](file://server/src/index.ts#L63)
- [index.ts:73-219](file://server/src/index.ts#L73-L219)

### 消息协议与数据模型
- 客户端类型定义：统一描述服务端消息类型与字段
- 关键消息：
  - connected：首次连接返回 clientId
  - execution_start：任务开始
  - progress：进度值与百分比
  - complete：任务完成，携带输出文件信息
  - error：任务失败，携带错误信息

```mermaid
classDiagram
class WSConnectedMessage {
+type : "connected"
+clientId : string
}
class WSExecutionStartMessage {
+type : "execution_start"
+promptId : string
}
class WSProgressMessage {
+type : "progress"
+promptId : string
+value : number
+max : number
+percentage : number
}
class WSCompleteMessage {
+type : "complete"
+promptId : string
+outputs : Array<object>
}
class WSErrorMessage {
+type : "error"
+promptId : string
+message : string
}
class WSMessage {
}
WSMessage <|-- WSConnectedMessage
WSMessage <|-- WSExecutionStartMessage
WSMessage <|-- WSProgressMessage
WSMessage <|-- WSCompleteMessage
WSMessage <|-- WSErrorMessage
```

**图表来源**
- [index.ts:27-57](file://client/src/types/index.ts#L27-L57)

**章节来源**
- [index.ts:27-57](file://client/src/types/index.ts#L27-L57)

### 状态同步与 UI 更新
- 客户端状态：任务状态、进度、输出列表、错误信息
- AI代理状态：对话消息、执行状态、收藏管理
- 事件驱动：根据消息类型调用状态管理函数，跨标签页同步
- UI 响应：进度条、完成态高亮、错误提示、对话界面

```mermaid
sequenceDiagram
participant WS as "WebSocket"
participant WFStore as "useWorkflowStore"
participant AgentStore as "useAgentStore"
participant UI as "各组件"
WS->>WFStore : updateProgress(promptId, percentage)
WS->>AgentStore : updateAgentProgress(percentage)
WFStore-->>UI : 重新渲染工作流进度
AgentStore-->>UI : 更新AI代理执行状态
WS->>WFStore : completeTask(promptId, outputs)
WS->>AgentStore : completeAgentExecution(outputs)
WFStore-->>UI : 切换为完成态并默认选中输出
AgentStore-->>UI : 显示生成结果和后续建议
WS->>WFStore : failTask(promptId, message)
WS->>AgentStore : failAgentExecution(message)
WFStore-->>UI : 标记错误并显示
AgentStore-->>UI : 显示错误状态
```

**图表来源**
- [useWebSocket.ts:35-46](file://client/src/hooks/useWebSocket.ts#L35-L46)
- [useWorkflowStore.ts:421-499](file://client/src/hooks/useWorkflowStore.ts#L421-L499)
- [useAgentStore.ts:209-224](file://client/src/hooks/useAgentStore.ts#L209-L224)

**章节来源**
- [useWebSocket.ts:26-51](file://client/src/hooks/useWebSocket.ts#L26-L51)
- [useWorkflowStore.ts:398-499](file://client/src/hooks/useWorkflowStore.ts#L398-L499)
- [useAgentStore.ts:204-225](file://client/src/hooks/useAgentStore.ts#L204-L225)

### 应用场景与使用示例
- 任务进度实时更新：服务器回传 progress 百分比，UI 渲染进度条
- 状态同步：execution_start 将任务从排队切换为处理中
- 完成与输出：complete 后自动保存输出并回传文件信息
- 通知与错误：error 事件触发错误提示与状态标记
- 队列操作：QueuePanel 通过 sendMessage 注册新的 promptId 映射，必要时回放历史事件
- AI代理对话：AgentDialog 提供智能对话界面，支持意图解析和工作流执行
- 生成历史：自动记录生成日志，支持收藏和后续处理

**章节来源**
- [useWebSocket.ts:91-95](file://client/src/hooks/useWebSocket.ts#L91-L95)
- [QueuePanel.tsx:107-112](file://client/src/components/QueuePanel.tsx#L107-L112)
- [index.ts:195-213](file://server/src/index.ts#L195-L213)
- [AgentDialog.tsx:162-393](file://client/src/components/AgentDialog.tsx#L162-L393)

## AI代理通信架构

### AgentDialog 组件设计
- 对话界面：提供消息气泡、输入框、图片上传等功能
- 执行状态：显示AI代理执行进度和结果
- 建议系统：提供暖场建议和后续建议
- 导航功能：支持跳转到生成结果卡片

```mermaid
flowchart TD
Start(["打开AgentDialog"]) --> Load["加载对话历史"]
Load --> Render["渲染对话界面"]
Render --> UserInput["用户输入消息"]
UserInput --> Analyze["LLM分析意图"]
Analyze --> Execute["执行工作流"]
Execute --> Progress["实时进度更新"]
Progress --> Result["显示生成结果"]
Result --> Suggestions["生成后续建议"]
Suggestions --> End(["等待下一轮对话"])
```

**图表来源**
- [AgentDialog.tsx:162-393](file://client/src/components/AgentDialog.tsx#L162-L393)
- [AgentDialog.tsx:438-531](file://client/src/components/AgentDialog.tsx#L438-L531)

### useAgentStore 状态管理
- 收藏管理：支持图片收藏和取消收藏
- 对话状态：管理消息历史和执行状态
- 执行状态：跟踪AI代理工作流执行进度
- 上传图片：支持图片上传和预览
- 最后意图：保存最近解析的意图供后续使用

**章节来源**
- [useAgentStore.ts:54-122](file://client/src/hooks/useAgentStore.ts#L54-L122)
- [useAgentStore.ts:204-225](file://client/src/hooks/useAgentStore.ts#L204-L225)

### 服务器端 AI代理服务
- 意图解析：解析用户需求为具体的工作流配置
- LLM集成：调用大语言模型进行对话和意图分析
- 工作流执行：根据意图执行相应的ComfyUI工作流
- 历史记录：管理生成历史和收藏状态
- 建议生成：提供暖场建议和后续建议

**章节来源**
- [agent.ts:492-602](file://server/src/routes/agent.ts#L492-L602)
- [agent.ts:633-800](file://server/src/routes/agent.ts#L633-L800)
- [agentService.ts:1-118](file://server/src/services/agentService.ts#L1-L118)

## 竞态条件修复机制

### 问题背景
在WebSocket通信中，存在客户端注册和ComfyUI完成事件之间的竞态条件。当任务执行非常快时，completion事件可能在客户端完成注册之前到达，导致服务器无法找到对应的workflow映射，从而丢失完成事件。

### 解决方案
服务器端在处理completion事件时增加了等待机制，确保客户端注册消息的可靠接收：

```mermaid
flowchart TD
Completion["收到ComfyUI completion事件"] --> CheckMap{"promptWorkflowMap中存在该promptId?"}
CheckMap --> |是| Process["直接处理完成事件"]
CheckMap --> |否| WaitLoop["进入等待循环"]
WaitLoop --> CheckAgain{"再次检查promptWorkflowMap"}
CheckAgain --> |存在| Process
CheckAgain --> |不存在| RetryCount{"重试次数 < 20次?"}
RetryCount --> |是| Sleep["等待100ms"] --> WaitLoop
RetryCount --> |否| Timeout["超时处理"]
Process --> Download["下载输出文件"]
Download --> SendComplete["发送complete消息"]
Timeout --> Fallback["发送空outputs的complete消息"]
SendComplete --> Cleanup["清理映射和缓冲"]
Fallback --> Cleanup
```

**图表来源**
- [index.ts:132-144](file://server/src/index.ts#L132-L144)

### 实现细节
- **等待时间**：最多等待2秒（20次 × 100ms）
- **重试机制**：每次等待100ms，避免CPU占用过高
- **超时处理**：超过最大重试次数后，即使没有注册也发送complete消息
- **日志记录**：记录等待时间和调试信息，便于问题排查
- **异常保护**：在等待过程中捕获异常，确保系统稳定性

### ComfyUI事件去重机制
除了completion事件的等待机制外，ComfyUI连接管理还实现了事件去重：

- **执行开始去重**：使用Set跟踪已触发的promptId，防止重复触发
- **完成事件去重**：使用completedPrompts集合防止重复的completion事件
- **执行状态管理**：startedPrompts和completedPrompts配合使用，确保状态一致性

**章节来源**
- [index.ts:132-144](file://server/src/index.ts#L132-L144)
- [comfyui.ts:127-188](file://server/src/services/comfyui.ts#L127-L188)

## 依赖关系分析
- 客户端依赖
  - useWebSocket 依赖 useWorkflowStore 和 useAgentStore 进行状态更新
  - AgentDialog 依赖 useAgentStore 和 useWorkflowStore 进行状态管理
  - App.tsx 在应用入口挂载 useWebSocket，确保全局连接可用
  - QueuePanel.tsx 使用 sendMessage 发送注册消息
- 服务器端依赖
  - WebSocketServer 依赖 ws
  - AI代理路由依赖 LLM服务、意图解析、ComfyUI服务
  - 与会话系统协作，将输出保存到会话目录
  - **新增**：ComfyUI连接管理依赖事件去重机制，防止重复触发

```mermaid
graph LR
App["App.tsx"] --> Hook["useWebSocket.ts"]
Hook --> WFStore["useWorkflowStore.ts"]
Hook --> AgentStore["useAgentStore.ts"]
AgentDialog["AgentDialog.tsx"] --> Hook
AgentDialog --> AgentStore
AgentDialog --> WFStore
QueuePanel["QueuePanel.tsx"] --> Hook
Server["server/index.ts"] --> WS["ws"]
Server --> Comfy["ComfyUI"]
Server --> RaceFix["竞态条件修复"]
AgentRoute["server/routes/agent.ts"] --> AgentService["server/services/agentService.ts"]
AgentRoute --> LLM["server/services/llmService.ts"]
AgentRoute --> Intent["server/services/intentParser.ts"]
AgentRoute --> Profile["server/services/profileService.ts"]
ComfyService["server/services/comfyui.ts"] --> EventDedup["事件去重机制"]
```

**图表来源**
- [App.tsx:74](file://client/src/components/App.tsx#L74)
- [useWebSocket.ts:2](file://client/src/hooks/useWebSocket.ts#L2)
- [useAgentStore.ts:1](file://client/src/hooks/useAgentStore.ts#L1)
- [useWorkflowStore.ts:2](file://client/src/hooks/useWorkflowStore.ts#L2)
- [AgentDialog.tsx:1-800](file://client/src/components/AgentDialog.tsx#L1-L800)
- [QueuePanel.tsx:107-112](file://client/src/components/QueuePanel.tsx#L107-L112)
- [index.ts:4](file://server/src/index.ts#L4)
- [agent.ts:1-800](file://server/src/routes/agent.ts#L1-L800)
- [agentService.ts:1-118](file://server/src/services/agentService.ts#L1-L118)
- [comfyui.ts:127-188](file://server/src/services/comfyui.ts#L127-L188)

**章节来源**
- [App.tsx:74](file://client/src/components/App.tsx#L74)
- [useWebSocket.ts:2](file://client/src/hooks/useWebSocket.ts#L2)
- [index.ts:4](file://server/src/index.ts#L4)

## 性能考量
- 连接复用与单例：避免多处重复创建连接，降低握手与资源消耗
- 事件缓冲与回放：对"迟到"的客户端进行事件重放，减少 UI 不一致
- 百分比回传：服务端计算百分比，前端可直接渲染，减少计算开销
- 精简消息：仅传输必要字段，避免冗余数据
- 会话输出异步下载：完成后异步写盘，避免阻塞主流程
- AI代理缓存：LLM调用结果和用户画像数据进行缓存，减少重复计算
- 异步写入：生成日志和收藏数据采用异步写入，不阻塞主线程
- **新增**：竞态条件修复的性能影响：2秒等待时间对用户体验影响最小，但显著提高了completion事件的可靠性

## 故障排除指南
- 连接无法建立
  - 检查服务器是否在 /ws 上启动 WebSocketServer
  - 确认客户端协议与主机地址匹配（http/https 对应 ws/wss）
- 无进度更新
  - 确认服务器已正确回传 progress 事件
  - 检查客户端 onmessage 是否解析成功
- 完成未回调
  - **新增**：检查是否存在竞态条件，确认客户端注册消息是否在completion事件前到达
  - 确认服务器完成阶段已下载输出并回传 complete
  - 检查会话目录权限与保存逻辑
  - 查看服务器日志中的等待时间记录
- 断线重连
  - 观察控制台日志与连接计数，确认重连定时器是否被清理
- 注册缺失导致事件丢失
  - 确保在收到 execution_start/progress 前发送注册消息
  - 服务器会自动回放缓冲事件
  - **新增**：如果completion事件仍然丢失，检查是否超过2秒等待时间限制
- AI代理无响应
  - 检查LLM服务是否正常运行
  - 确认意图解析是否正确
  - 验证工作流模板是否正确加载
- **新增**：竞态条件相关问题
  - 检查客户端注册消息的发送时机
  - 查看服务器日志中的等待时间统计
  - 确认任务执行时间是否过短导致竞态条件

**章节来源**
- [useWebSocket.ts:53-65](file://client/src/hooks/useWebSocket.ts#L53-L65)
- [index.ts:195-213](file://server/src/index.ts#L195-L213)

## 结论
本项目采用"客户端单例连接 + 服务器事件缓冲回放"的方案，实现了稳定高效的实时通信。通过明确的消息协议与状态管理解耦，前端 UI 能够及时响应任务生命周期变化。新增的AI代理通信架构进一步增强了系统的智能化水平，通过意图解析和工作流执行，为用户提供更加自然的交互体验。

**重要更新**：本次竞态条件修复显著提升了系统的可靠性。通过在completion事件处理前增加等待机制，确保了客户端注册消息的可靠接收，解决了任务执行过快时的事件丢失问题。这一改进在不影响用户体验的前提下，大幅提高了系统的稳定性。

建议在生产环境中进一步完善心跳、背压与限流策略，并对异常路径进行更细粒度的日志记录与告警。同时，监控竞态条件修复的效果，确保2秒等待时间的设置满足实际业务需求。

## 附录

### WebSocket 消息格式参考
- 连接确认
  - type: "connected"
  - clientId: 字符串
- 执行开始
  - type: "execution_start"
  - promptId: 字符串
- 进度更新
  - type: "progress"
  - promptId: 字符串
  - value: 数字
  - max: 数字
  - percentage: 数字（0-100）
- 完成
  - type: "complete"
  - promptId: 字符串
  - outputs: 数组（包含 filename 与 url）
- 错误
  - type: "error"
  - promptId: 字符串
  - message: 字符串

**章节来源**
- [index.ts:27-57](file://client/src/types/index.ts#L27-L57)

### 客户端 Hook 使用要点
- 在应用入口挂载一次 useWebSocket，确保全局连接可用
- 通过 sendMessage 发送注册消息，携带 promptId、workflowId、sessionId、tabId
- 依赖状态管理自动更新 UI，避免手动 DOM 操作
- AI代理通信通过 AgentDialog 组件进行，支持智能对话和工作流执行

**章节来源**
- [App.tsx:74](file://client/src/components/App.tsx#L74)
- [QueuePanel.tsx:107-112](file://client/src/components/QueuePanel.tsx#L107-L112)
- [useWebSocket.ts:91-95](file://client/src/hooks/useWebSocket.ts#L91-L95)
- [AgentDialog.tsx:162-393](file://client/src/components/AgentDialog.tsx#L162-L393)

### AI代理通信流程
- 用户通过 AgentDialog 输入需求
- 系统调用LLM进行意图解析
- 根据意图执行相应的工作流
- 实时显示执行进度和结果
- 提供后续建议和收藏功能

**章节来源**
- [AgentDialog.tsx:438-531](file://client/src/components/AgentDialog.tsx#L438-L531)
- [agent.ts:492-602](file://server/src/routes/agent.ts#L492-L602)
- [agent.ts:633-800](file://server/src/routes/agent.ts#L633-L800)

### 竞态条件修复技术细节
- **等待时间**：最多2秒（20次 × 100ms）
- **重试策略**：指数退避式等待，避免CPU占用
- **超时处理**：超过最大重试次数后发送空outputs的complete消息
- **日志记录**：记录等待时间和调试信息
- **异常保护**：在等待过程中捕获异常，确保系统稳定性

**章节来源**
- [index.ts:132-144](file://server/src/index.ts#L132-L144)
- [comfyui.ts:127-188](file://server/src/services/comfyui.ts#L127-L188)