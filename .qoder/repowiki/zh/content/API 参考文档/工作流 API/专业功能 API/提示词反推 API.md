# 提示词反推 API

<cite>
**本文档引用的文件**
- [workflow.ts](file://server/src/routes/workflow.ts)
- [comfyui.ts](file://server/src/services/comfyui.ts)
- [Pix2Real-提示词反推Flo.json](file://ComfyUI_API/Pix2Real-提示词反推Flo.json)
- [Pix2Real-提示词反推Q3.json](file://ComfyUI_API/Pix2Real-提示词反推Q3.json)
- [Pix2Real-提示词反推WD14.json](file://ComfyUI_API/Pix2Real-提示词反推WD14.json)
- [systemPrompts.ts](file://client/src/components/prompt-assistant/systemPrompts.ts)
- [README.md](file://README.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件详细说明了提示词反推 API 的完整接口规范，该功能能够从图像内容反推出可能的提示词。系统提供了三种不同的反推模型：
- **Florence 模型**：基于 Florence-2 大语言模型的详细图像描述生成
- **Qwen3VL 模型**：基于 Qwen3-VL 多模态大语言模型的中文详细描述
- **WD-14 模型**：基于 WD-14 标签器的视觉标签提取

该 API 支持多种输入格式，包括 JPG、PNG、WEBP 等常见图像格式，并提供统一的接口来调用不同的反推模型。

## 项目结构
提示词反推功能位于服务器端的 workflow 路由模块中，通过 ComfyUI 工作流模板实现具体的功能逻辑。

```mermaid
graph TB
subgraph "客户端"
WebApp[Web 应用]
API[API 客户端]
end
subgraph "服务器端"
Router[工作流路由]
Adapter[适配器模式]
Service[ComfyUI 服务]
end
subgraph "ComfyUI"
Template[Florence 模板]
Template2[Qwen3VL 模板]
Template3[WD14 模板]
Engine[推理引擎]
end
WebApp --> Router
API --> Router
Router --> Adapter
Adapter --> Service
Service --> Template
Service --> Template2
Service --> Template3
Template --> Engine
Template2 --> Engine
Template3 --> Engine
```

**图表来源**
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)
- [comfyui.ts:47-71](file://server/src/services/comfyui.ts#L47-L71)

**章节来源**
- [README.md:41-62](file://README.md#L41-L62)
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)

## 核心组件
提示词反推 API 的核心组件包括：

### 主要接口
- **POST /api/workflow/reverse-prompt** - 主要的提示词反推接口
- **查询参数** - model: Qwen3VL | Florence | WD-14
- **请求体** - 单个图像文件上传
- **响应** - 返回生成的提示词文本

### 模型配置映射
系统维护了一个模型配置映射表，定义了每个模型对应的 ComfyUI 模板和保存节点：

| 模型名称 | 模板路径 | 保存节点 | 特点 |
|---------|---------|---------|------|
| Qwen3VL | Pix2Real-提示词反推Q3.json | 节点 66 | 中文详细描述，多模态理解 |
| Florence | Pix2Real-提示词反推Flo.json | 节点 67 | 英文详细描述，多任务支持 |
| WD-14 | Pix2Real-提示词反推WD14.json | 节点 67 | 视觉标签提取，标签过滤 |

**章节来源**
- [workflow.ts:659-672](file://server/src/routes/workflow.ts#L659-L672)
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)

## 架构概览
提示词反推功能采用分层架构设计，实现了清晰的关注点分离：

```mermaid
sequenceDiagram
participant Client as 客户端
participant Router as 路由器
participant Adapter as 适配器
participant Service as 服务层
participant ComfyUI as ComfyUI 引擎
Client->>Router : POST /api/workflow/reverse-prompt
Router->>Router : 验证图像文件
Router->>Router : 选择模型配置
Router->>Service : 上传图像到 ComfyUI
Service->>ComfyUI : 上传图像文件
ComfyUI-->>Service : 返回文件名
Router->>Service : 加载并修改工作流模板
Service->>ComfyUI : 排队执行工作流
ComfyUI-->>Service : 返回任务ID
Router->>Router : 轮询任务状态
loop 轮询直到完成
Router->>Service : 获取历史记录
Service->>ComfyUI : 查询任务状态
ComfyUI-->>Service : 返回状态信息
end
Router->>Router : 读取生成的文本文件
Router-->>Client : 返回提示词文本
```

**图表来源**
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)
- [comfyui.ts:47-71](file://server/src/services/comfyui.ts#L47-L71)

## 详细组件分析

### Florence 模型反推
Florence 模型专注于生成详细的英文图像描述，具有以下特点：

#### 模型参数配置
- **模型名称**: MiaoshouAI/Florence-2-large-PromptGen-v2.0
- **精度设置**: fp16
- **注意力机制**: sdpa
- **任务类型**: more_detailed_caption
- **生成参数**: 
  - max_new_tokens: 1024
  - num_beams: 3
  - do_sample: false

#### 输出格式
Florence 模型生成的是完整的英文描述文本，适合需要详细场景描述的应用场景。

**章节来源**
- [Pix2Real-提示词反推Flo.json:13-31](file://ComfyUI_API/Pix2Real-提示词反推Flo.json#L13-L31)
- [Pix2Real-提示词反推Flo.json:25-31](file://ComfyUI_API/Pix2Real-提示词反推Flo.json#L25-L31)

### Qwen3VL 模型反推
Qwen3VL 模型专门针对中文用户，能够生成详细的中文图像描述：

#### 模型参数配置
- **模型名称**: Qwen3-VL-8B-Instruct-abliterated-v2.0.Q6_K.gguf
- **多模态投影**: Qwen3-VL-8B-Instruct-abliterated-v2.0.mmproj-f16.gguf
- **推理模式**: one by one
- **生成参数**:
  - temperature: 0.8
  - top_k: 30
  - top_p: 0.9
  - min_p: 0.05

#### 系统提示词
Qwen3VL 使用预设的系统提示词，要求生成详细的中文描述，特别关注性器官和面部表情的精确描述。

**章节来源**
- [Pix2Real-提示词反推Q3.json:63-69](file://ComfyUI_API/Pix2Real-提示词反推Q3.json#L63-L69)
- [Pix2Real-提示词反推Q3.json:34-35](file://ComfyUI_API/Pix2Real-提示词反推Q3.json#L34-L35)

### WD-14 模型反推
WD-14 模型专注于视觉标签提取，生成逗号分隔的标签列表：

#### 模型参数配置
- **模型名称**: wd-eva02-large-tagger-v3
- **阈值设置**:
  - threshold: 0.35
  - character_threshold: 0.85
- **输出格式**:
  - replace_underscore: true
  - trailing_comma: false

#### 输出特点
WD-14 生成的是标准化的英文标签列表，适合需要精确视觉元素标注的应用场景。

**章节来源**
- [Pix2Real-提示词反推WD14.json:13-18](file://ComfyUI_API/Pix2Real-提示词反推WD14.json#L13-L18)
- [Pix2Real-提示词反推WD14.json:31-35](file://ComfyUI_API/Pix2Real-提示词反推WD14.json#L31-L35)

### API 接口规范

#### 基本请求格式
```
POST /api/workflow/reverse-prompt?model={模型类型}
Content-Type: multipart/form-data

参数:
- image: 图像文件 (必需)
- model: 模型类型 (可选，默认: Qwen3VL)
```

#### 请求参数说明

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| image | 文件 | 是 | - | 输入的图像文件 |
| model | 字符串 | 否 | Qwen3VL | 反推模型类型 |

#### 模型类型选项

| 模型名称 | 用途 | 输出格式 | 适用场景 |
|----------|------|----------|----------|
| Qwen3VL | 中文详细描述 | 中文段落 | 中文图像理解，本地化应用 |
| Florence | 英文详细描述 | 英文段落 | 国际化应用，学术研究 |
| WD-14 | 视觉标签提取 | 英文标签列表 | 标签管理，检索系统 |

#### 响应格式
```json
{
  "text": "生成的提示词文本"
}
```

#### 错误响应
```json
{
  "error": "错误消息"
}
```

**章节来源**
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)

## 依赖关系分析

### 组件依赖图
```mermaid
graph TD
ReversePrompt[提示词反推 API] --> UploadService[上传服务]
ReversePrompt --> ConfigMap[配置映射]
ReversePrompt --> HistoryPolling[历史轮询]
UploadService --> ComfyUIUpload[ComfyUI 上传]
ConfigMap --> TemplateLoader[模板加载]
HistoryPolling --> ComfyUIHistory[ComfyUI 历史]
TemplateLoader --> FlorenceTemplate[Florence 模板]
TemplateLoader --> QwenTemplate[Qwen3VL 模板]
TemplateLoader --> WD14Template[WD14 模板]
ComfyUIUpload --> ComfyUIEngine[ComfyUI 引擎]
ComfyUIHistory --> ComfyUIEngine
FlorenceTemplate --> ComfyUIEngine
QwenTemplate --> ComfyUIEngine
WD14Template --> ComfyUIEngine
```

**图表来源**
- [workflow.ts:659-672](file://server/src/routes/workflow.ts#L659-L672)
- [workflow.ts:694-704](file://server/src/routes/workflow.ts#L694-L704)

### 数据流分析
提示词反推的数据流遵循以下模式：

```mermaid
flowchart TD
Start([开始]) --> Validate[验证图像文件]
Validate --> Valid{文件有效?}
Valid --> |否| Error[返回错误]
Valid --> |是| SelectModel[选择模型配置]
SelectModel --> Upload[上传图像到 ComfyUI]
Upload --> LoadTemplate[加载工作流模板]
LoadTemplate --> PatchTemplate[修补模板参数]
PatchTemplate --> Queue[排队执行]
Queue --> Poll[轮询任务状态]
Poll --> Complete{任务完成?}
Complete --> |否| Poll
Complete --> |是| ReadFile[读取生成文件]
ReadFile --> Return[返回结果]
Error --> End([结束])
Return --> End
```

**图表来源**
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)

**章节来源**
- [comfyui.ts:9-25](file://server/src/services/comfyui.ts#L9-L25)
- [comfyui.ts:47-71](file://server/src/services/comfyui.ts#L47-L71)

## 性能考虑

### 处理时间对比
根据系统实现，不同模型的处理时间存在显著差异：

| 模型类型 | 预估处理时间 | 资源消耗 | 适用场景 |
|----------|-------------|----------|----------|
| WD-14 | 快速 (几秒) | 低 | 标签提取，批量处理 |
| Florence | 中等 (10-30秒) | 中等 | 详细描述，多任务 |
| Qwen3VL | 较慢 (30-60秒) | 高 | 中文详细描述，复杂场景 |

### 资源优化策略
1. **内存管理**: 系统自动清理临时文件和 VRAM
2. **并发控制**: 通过队列系统管理任务执行顺序
3. **缓存机制**: 模型加载后保持在内存中以提高性能

### 性能监控
系统提供 VRAM 和 RAM 使用情况监控：
- **VRAM 使用率**: 显示 GPU 内存占用百分比
- **RAM 使用率**: 显示系统内存占用百分比

**章节来源**
- [workflow.ts:532-540](file://server/src/routes/workflow.ts#L532-L540)
- [comfyui.ts:106-125](file://server/src/services/comfyui.ts#L106-L125)

## 故障排除指南

### 常见错误及解决方案

#### 1. 图像文件上传失败
**错误信息**: "No image file provided"
**解决方案**: 
- 确保使用 multipart/form-data 格式
- 检查文件大小限制 (默认 50MB)
- 验证文件扩展名是否受支持

#### 2. 模型配置错误
**错误信息**: "Unknown model: {model}"
**解决方案**:
- 使用允许的模型名称: Qwen3VL, Florence, WD-14
- 检查模型名称大小写

#### 3. 反推超时
**错误信息**: "反推提示词超时，请重试"
**解决方案**:
- 检查 ComfyUI 服务状态
- 增加等待时间或重试
- 确认模型已正确加载

#### 4. 文本文件缺失
**错误信息**: "ComfyUI 未返回提示词文本"
**解决方案**:
- 检查 rp_temp 目录权限
- 确认文件写入成功
- 验证 ComfyUI 工作流配置

### 调试建议
1. **检查 ComfyUI 连接**: 确保 ComfyUI 在 `http://localhost:8188` 正常运行
2. **验证模型可用性**: 确认所需模型已下载并加载
3. **监控系统资源**: 关注 VRAM 和 RAM 使用情况
4. **查看日志输出**: 检查服务器端错误日志

**章节来源**
- [workflow.ts:676-744](file://server/src/routes/workflow.ts#L676-L744)
- [comfyui.ts:1-25](file://server/src/services/comfyui.ts#L1-L25)

## 结论
提示词反推 API 提供了灵活且强大的图像内容理解能力，支持三种不同类型的反推模型以满足各种应用场景的需求。系统采用模块化设计，具有良好的可扩展性和维护性。

### 主要优势
1. **多模型支持**: 提供三种不同风格的反推模型
2. **统一接口**: 通过单一 API 支持多种模型切换
3. **实时反馈**: 支持任务状态轮询和进度监控
4. **资源管理**: 自动化的内存和文件管理

### 使用建议
- **小规模快速处理**: 优先选择 WD-14 模型
- **中文应用场景**: 选择 Qwen3VL 模型
- **学术研究应用**: 选择 Florence 模型
- **批量处理**: 考虑模型的处理时间和资源消耗

## 附录

### 支持的输入格式
- **图像格式**: JPG, PNG, WEBP, BMP
- **文件大小**: 最大 50MB
- **分辨率**: 无硬性限制，建议不超过 4096x4096

### API 使用示例

#### curl 示例
```bash
# 使用 Qwen3VL 模型
curl -X POST "http://localhost:3000/api/workflow/reverse-prompt?model=Qwen3VL" \
  -F "image=@photo.jpg" \
  -H "Content-Type: multipart/form-data"

# 使用 Florence 模型
curl -X POST "http://localhost:3000/api/workflow/reverse-prompt?model=Florence" \
  -F "image=@photo.jpg" \
  -H "Content-Type: multipart/form-data"

# 使用 WD-14 模型
curl -X POST "http://localhost:3000/api/workflow/reverse-prompt?model=WD-14" \
  -F "image=@photo.jpg" \
  -H "Content-Type: multipart/form-data"
```

### 模型选择建议
1. **准确性优先**: Florence 模型提供最详细的描述
2. **中文本地化**: Qwen3VL 模型更适合中文应用场景
3. **标签管理**: WD-14 模型最适合需要结构化标签的场景
4. **性能考虑**: WD-14 处理速度最快，Qwen3VL 最慢

### 系统要求
- **ComfyUI**: 版本 1.0 或更高
- **Node.js**: 18 或更高版本
- **GPU**: 推荐 NVIDIA RTX 3060 或更高
- **内存**: 至少 16GB RAM

**章节来源**
- [README.md:16-25](file://README.md#L16-L25)
- [workflow.ts:674-744](file://server/src/routes/workflow.ts#L674-L744)