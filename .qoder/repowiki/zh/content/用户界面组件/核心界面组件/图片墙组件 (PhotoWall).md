# 图片墙组件 (PhotoWall)

<cite>
**本文档引用的文件**
- [PhotoWall.tsx](file://client/src/components/PhotoWall.tsx)
- [ImageCard.tsx](file://client/src/components/ImageCard.tsx)
- [FaceSwapPhotoWall.tsx](file://client/src/components/FaceSwapPhotoWall.tsx)
- [ThumbnailStrip.tsx](file://client/src/components/ThumbnailStrip.tsx)
- [useWorkflowStore.ts](file://client/src/hooks/useWorkflowStore.ts)
- [useDragStore.ts](file://client/src/hooks/useDragStore.ts)
- [useMaskStore.ts](file://client/src/hooks/useMaskStore.ts)
- [maskConfig.ts](file://client/src/config/maskConfig.ts)
- [index.ts](file://client/src/types/index.ts)
</cite>

## 更新摘要
**变更内容**
- 更新 ImageCard 组件性能优化部分，包含 React.memo 和 useShallow 浅订阅实现
- 增强 LazyCard 组件 IntersectionObserver 优化策略说明
- 新增 FaceSwapPhotoWall 组件的详细功能说明
- 更新性能考虑章节，反映最新的优化措施

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
PhotoWall 是一个高性能的图片瀑布流展示组件，支持响应式列宽、懒加载、多选模式、批量操作与拖拽删除等高级功能。它通过 CSS 多列布局实现瀑布流效果，并结合 IntersectionObserver 与手动滚动补偿策略优化首屏渲染与滚动体验。组件与 ImageCard、ThumbnailStrip、拖拽存储、蒙版存储等模块深度协作，形成完整的图片工作流界面。

**更新** 新增 FaceSwapPhotoWall 组件，专门用于人脸交换工作流的双区域布局管理。

## 项目结构
PhotoWall 位于客户端前端代码中，作为主界面的核心展示区域之一，负责组织与渲染当前工作区的图片卡片，并提供多选、批量执行、拖拽删除等交互能力。

```mermaid
graph TB
subgraph "组件层"
PW["PhotoWall<br/>图片墙容器"]
IC["ImageCard<br/>单张图片卡片"]
TS["ThumbnailStrip<br/>缩略条"]
FSPW["FaceSwapPhotoWall<br/>换脸图片墙"]
end
subgraph "状态层"
WFS["useWorkflowStore<br/>工作流状态"]
DS["useDragStore<br/>拖拽状态"]
MS["useMaskStore<br/>蒙版状态"]
end
subgraph "配置与类型"
MC["maskConfig<br/>蒙版模式配置"]
T["types/index<br/>类型定义"]
end
PW --> IC
IC --> TS
PW --> WFS
PW --> DS
PW --> MS
PW --> MC
IC --> WFS
IC --> MS
IC --> T
FSPW --> IC
FSPW --> WFS
FSPW --> DS
```

**图表来源**
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)
- [ImageCard.tsx:42-88](file://client/src/components/ImageCard.tsx#L42-L88)
- [FaceSwapPhotoWall.tsx:213-229](file://client/src/components/FaceSwapPhotoWall.tsx#L213-L229)
- [useWorkflowStore.ts:96-115](file://client/src/hooks/useWorkflowStore.ts#L96-L115)
- [useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16)
- [useMaskStore.ts:32-30](file://client/src/hooks/useMaskStore.ts#L32-L30)
- [maskConfig.ts:5-16](file://client/src/config/maskConfig.ts#L5-L16)
- [index.ts:1-58](file://client/src/types/index.ts#L1-L58)

**章节来源**
- [PhotoWall.tsx:103-125](file://client/src/components/PhotoWall.tsx#L103-L125)
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)

## 核心组件
- PhotoWall：主容器，负责瀑布流布局、懒加载、多选模式、批量操作、拖拽删除与工具栏显示逻辑。
- LazyCard：轻量级懒加载包装器，基于 IntersectionObserver 实现延迟渲染与预加载，配合滚动补偿避免内容跳变。
- ImageCard：单张图片卡片，包含预览、输出叠加、进度覆盖、蒙版菜单、长按多选、拖拽等交互。**更新** 使用 React.memo 和 useShallow 浅订阅优化渲染性能。
- ThumbnailStrip：底部缩略条，用于在非文本工作流中切换原图与生成结果。
- FaceSwapPhotoWall：**新增** 专门的人脸交换工作流组件，提供双区域布局（脸部参考区和目标图区）和拖拽换脸功能。
- 状态存储：
  - useWorkflowStore：全局工作流状态（图片列表、任务、提示词、选中项等）。
  - useDragStore：拖拽状态（卡片或输出拖拽）。
  - useMaskStore：蒙版数据与编辑器状态。
- 配置与类型：maskConfig 定义各工作流的蒙版模式；types/index 定义图片与任务类型。

**章节来源**
- [PhotoWall.tsx:18-97](file://client/src/components/PhotoWall.tsx#L18-L97)
- [ImageCard.tsx:17-42](file://client/src/components/ImageCard.tsx#L17-L42)
- [FaceSwapPhotoWall.tsx:10-12](file://client/src/components/FaceSwapPhotoWall.tsx#L10-L12)
- [useWorkflowStore.ts:35-88](file://client/src/hooks/useWorkflowStore.ts#L35-L88)
- [useDragStore.ts:4-16](file://client/src/hooks/useDragStore.ts#L4-L16)
- [useMaskStore.ts:4-30](file://client/src/hooks/useMaskStore.ts#L4-L30)
- [maskConfig.ts:3-19](file://client/src/config/maskConfig.ts#L3-L19)
- [index.ts:1-58](file://client/src/types/index.ts#L1-L58)

## 架构总览
PhotoWall 采用"容器-展示"分层设计：
- 容器层：PhotoWall 负责数据获取、状态计算、事件处理与布局控制。
- 展示层：LazyCard 负责懒加载与占位符，ImageCard 负责单卡渲染与交互。
- 状态层：通过 zustand store 管理跨组件共享状态。
- 协作层：与 ThumbnailStrip、蒙版系统、拖拽系统协同完成复杂交互。

```mermaid
sequenceDiagram
participant U as "用户"
participant PW as "PhotoWall"
participant LC as "LazyCard"
participant IC as "ImageCard"
participant FSPW as "FaceSwapPhotoWall"
participant WFS as "useWorkflowStore"
participant DS as "useDragStore"
participant MS as "useMaskStore"
U->>PW : 滚动页面
PW->>LC : 渲染 LazyCard 列表
LC->>LC : IntersectionObserver 监听
LC-->>PW : 可见时触发渲染真实内容
U->>IC : 长按进入多选模式
IC->>WFS : enterMultiSelect / toggleImageSelection
U->>FSPW : 拖拽脸部参考到目标图
FSPW->>WFS : setFaceSwapZone / startTask
U->>PW : 工具栏批量操作
PW->>WFS : 批量执行 / 删除 / 替换提示词
U->>DS : 拖拽卡片到删除区域
DS-->>PW : dragging 状态变化
PW->>PW : 显示拖拽删除遮罩
U->>PW : 放下执行删除
PW->>MS : 清理蒙版如有
PW->>WFS : removeImages / removeOutput
```

**图表来源**
- [PhotoWall.tsx:18-97](file://client/src/components/PhotoWall.tsx#L18-L97)
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)
- [ImageCard.tsx:217-231](file://client/src/components/ImageCard.tsx#L217-L231)
- [FaceSwapPhotoWall.tsx:256-282](file://client/src/components/FaceSwapPhotoWall.tsx#L256-L282)
- [useWorkflowStore.ts:117-129](file://client/src/hooks/useWorkflowStore.ts#L117-L129)
- [useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16)
- [useMaskStore.ts:36-43](file://client/src/hooks/useMaskStore.ts#L36-L43)

## 详细组件分析

### LazyCard 组件（IntersectionObserver 优化与滚动补偿）
LazyCard 是 PhotoWall 中实现"懒加载 + 预加载 + 滚动补偿"的关键模块，其设计目标是：
- 使用 IntersectionObserver 在元素即将进入视口前触发渲染，减少首屏阻塞。
- 通过不对称 rootMargin（上 200px、下 1200px）实现"向上微预加载 + 向下强预加载"，提升滚动流畅度。
- 在占位符转真实内容时进行手动滚动补偿，避免因高度变化导致的视口跳变。

```mermaid
flowchart TD
Start(["进入 LazyCard"]) --> Observe["创建 IntersectionObserver<br/>rootMargin: 上200px 下1200px"]
Observe --> Wait["等待可见"]
Wait --> |可见| SetVisible["设置 isVisible=true<br/>停止观察"]
SetVisible --> RenderPlaceholder{"是否仍为占位符？"}
RenderPlaceholder --> |是| Compensate["requestAnimationFrame 计算滚动补偿"]
Compensate --> AdjustScroll["若卡片在视口上方且实际高度更大<br/>增加 scrollTop 补偿"]
AdjustScroll --> RenderReal["渲染真实内容"]
RenderPlaceholder --> |否| RenderReal
RenderReal --> End(["退出 LazyCard"])
```

**图表来源**
- [PhotoWall.tsx:28-43](file://client/src/components/PhotoWall.tsx#L28-L43)
- [PhotoWall.tsx:46-70](file://client/src/components/PhotoWall.tsx#L46-L70)

**章节来源**
- [PhotoWall.tsx:18-97](file://client/src/components/PhotoWall.tsx#L18-L97)

### PhotoWall 主容器（瀑布流布局与多选模式）
PhotoWall 通过 CSS 多列布局实现瀑布流效果，并结合以下特性：
- 响应式列宽：通过 VIEW_CONFIG 配置不同视图尺寸的小、中、大三档列宽与估算卡片高度。
- 懒加载卡片：每个卡片外层包裹 LazyCard，仅在接近视口时渲染真实内容。
- 多选模式：长按或点击进入多选，工具栏根据选中状态动态显示批量操作按钮。
- 批量操作：批量执行、批量删除、批量替换提示词、批量删除蒙版。
- 拖拽删除：全局拖拽状态驱动底部删除遮罩显示，放下时清理对应图片与蒙版。

```mermaid
classDiagram
class PhotoWall {
+viewSize : ViewSize
+images : ImageItem[]
+selectedImageIds : string[]
+handleSelectAll()
+handleBatchExecute()
+handleBatchDelete()
+handleBulkReplacePrompts()
+handleBatchDeleteMasks()
+handleDeleteZoneDrop()
}
class LazyCard {
+estimatedHeight : number
+isVisible : boolean
+renderPlaceholder()
+renderRealContent()
+compensateScroll()
}
class ImageCard {
+image : ImageItem
+isMultiSelectMode : boolean
+isSelected : boolean
+onLongPress()
+onToggleSelect()
}
PhotoWall --> LazyCard : "包裹"
PhotoWall --> ImageCard : "渲染"
PhotoWall --> useWorkflowStore : "读取状态"
PhotoWall --> useDragStore : "读取拖拽状态"
PhotoWall --> useMaskStore : "读取蒙版状态"
```

**图表来源**
- [PhotoWall.tsx:99-101](file://client/src/components/PhotoWall.tsx#L99-L101)
- [PhotoWall.tsx:18-97](file://client/src/components/PhotoWall.tsx#L18-L97)
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)
- [ImageCard.tsx:17-25](file://client/src/components/ImageCard.tsx#L17-L25)

**章节来源**
- [PhotoWall.tsx:103-125](file://client/src/components/PhotoWall.tsx#L103-L125)
- [PhotoWall.tsx:165-266](file://client/src/components/PhotoWall.tsx#L165-L266)
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)

### ImageCard 组件（性能优化与浅订阅）
**更新** ImageCard 组件经过重大性能优化，采用 React.memo 和 useShallow 浅订阅策略：

- **React.memo 包装**：通过 `arePropsEqual` 函数精确比较 props 变化，避免不必要的重渲染。
- **useShallow 浅订阅**：将大型状态拆分为多个独立订阅，只在相关状态变化时触发重渲染。
- **状态拆分策略**：
  - actions：稳定的函数引用，很少变化
  - globalState：影响所有卡片的全局状态
  - cardData：仅当前卡片相关的数据，按 image.id 过滤

```mermaid
flowchart TD
Start(["ImageCard 渲染"]) --> Memo["React.memo 包装"]
Memo --> Shallow1["useShallow(actions)"]
Memo --> Shallow2["useShallow(globalState)"]
Memo --> Shallow3["useShallow(cardData)"]
Shallow1 --> CompareProps["arePropsEqual 比较"]
Shallow2 --> CompareProps
Shallow3 --> CompareProps
CompareProps --> |props 变化| ReRender["重新渲染"]
CompareProps --> |props 未变化| SkipRender["跳过渲染"]
SkipRender --> End(["结束"])
ReRender --> End
```

**图表来源**
- [ImageCard.tsx:27-40](file://client/src/components/ImageCard.tsx#L27-L40)
- [ImageCard.tsx:46-83](file://client/src/components/ImageCard.tsx#L46-L83)

**章节来源**
- [ImageCard.tsx:17-42](file://client/src/components/ImageCard.tsx#L17-L42)
- [ImageCard.tsx:27-40](file://client/src/components/ImageCard.tsx#L27-L40)
- [ImageCard.tsx:46-83](file://client/src/components/ImageCard.tsx#L46-L83)

### FaceSwapPhotoWall 组件（新增）
**新增** FaceSwapPhotoWall 是专门用于人脸交换工作流的双区域布局组件：

- **双区域设计**：左侧脸部参考区（face zone），右侧目标图区（target zone）
- **拖拽换脸**：支持将脸部参考图拖拽到目标图上执行换脸操作
- **跨区域拖拽**：支持区域间的图片交叉导入和交换
- **多选批量**：支持多选模式下的批量换脸操作
- **视图适配**：使用独立的 VIEW_CONFIG 配置，针对换脸场景优化布局

```mermaid
flowchart LR
FaceZone["脸部参考区<br/>face zone"] --> TargetZone["目标图区<br/>target zone"]
FaceZone --> Drag["拖拽换脸"]
TargetZone --> Drag
FaceZone --> CrossImport["跨区域导入"]
TargetZone --> CrossImport
FaceZone --> MultiSelect["多选批量"]
TargetZone --> MultiSelect
```

**图表来源**
- [FaceSwapPhotoWall.tsx:14-19](file://client/src/components/FaceSwapPhotoWall.tsx#L14-L19)
- [FaceSwapPhotoWall.tsx:556-689](file://client/src/components/FaceSwapPhotoWall.tsx#L556-L689)
- [FaceSwapPhotoWall.tsx:691-875](file://client/src/components/FaceSwapPhotoWall.tsx#L691-L875)

**章节来源**
- [FaceSwapPhotoWall.tsx:213-229](file://client/src/components/FaceSwapPhotoWall.tsx#L213-L229)
- [FaceSwapPhotoWall.tsx:556-689](file://client/src/components/FaceSwapPhotoWall.tsx#L556-L689)
- [FaceSwapPhotoWall.tsx:691-875](file://client/src/components/FaceSwapPhotoWall.tsx#L691-L875)

### 状态管理与协作关系
- useWorkflowStore：提供图片列表、任务状态、提示词、选中项、闪动高亮等全局状态，PhotoWall 与 ImageCard 均通过该 store 订阅所需数据。
- useDragStore：统一管理拖拽状态（卡片或输出），PhotoWall 基于该状态显示拖拽删除遮罩。
- useMaskStore：管理蒙版数据与编辑器状态，PhotoWall 在批量删除时清理对应蒙版键值。
- maskConfig：定义各工作流的蒙版模式（A/B/none），影响蒙版菜单与编辑器行为。

```mermaid
graph LR
WFS["useWorkflowStore"] --> PW["PhotoWall"]
WFS --> IC["ImageCard"]
WFS --> FSPW["FaceSwapPhotoWall"]
DS["useDragStore"] --> PW
MS["useMaskStore"] --> PW
MS --> IC
MC["maskConfig"] --> IC
T["types/index"] --> IC
```

**图表来源**
- [useWorkflowStore.ts:96-115](file://client/src/hooks/useWorkflowStore.ts#L96-L115)
- [useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16)
- [useMaskStore.ts:32-30](file://client/src/hooks/useMaskStore.ts#L32-L30)
- [maskConfig.ts:5-16](file://client/src/config/maskConfig.ts#L5-L16)
- [index.ts:1-58](file://client/src/types/index.ts#L1-L58)

**章节来源**
- [useWorkflowStore.ts:35-88](file://client/src/hooks/useWorkflowStore.ts#L35-L88)
- [useDragStore.ts:4-16](file://client/src/hooks/useDragStore.ts#L4-L16)
- [useMaskStore.ts:4-30](file://client/src/hooks/useMaskStore.ts#L4-L30)
- [maskConfig.ts:3-19](file://client/src/config/maskConfig.ts#L3-L19)
- [index.ts:1-58](file://client/src/types/index.ts#L1-L58)

## 依赖关系分析
PhotoWall 的依赖关系清晰，遵循"低耦合、高内聚"的原则：
- 与 ImageCard 的依赖：通过 props 传递图片数据与交互回调，保持渲染职责单一。
- 与 LazyCard 的依赖：仅依赖其懒加载与占位符渲染能力，不关心内部实现细节。
- 与状态存储的依赖：通过 hooks 订阅所需状态，避免直接访问全局对象。
- 与配置的依赖：通过 VIEW_CONFIG 与 maskConfig 控制布局与功能开关。

```mermaid
graph TB
PW["PhotoWall"] --> IC["ImageCard"]
PW --> LC["LazyCard"]
PW --> WFS["useWorkflowStore"]
PW --> DS["useDragStore"]
PW --> MS["useMaskStore"]
PW --> MC["maskConfig"]
IC --> TS["ThumbnailStrip"]
IC --> WFS
IC --> MS
FSPW["FaceSwapPhotoWall"] --> IC
FSPW --> WFS
FSPW --> DS
```

**图表来源**
- [PhotoWall.tsx:493-506](file://client/src/components/PhotoWall.tsx#L493-L506)
- [ImageCard.tsx:42-88](file://client/src/components/ImageCard.tsx#L42-L88)
- [FaceSwapPhotoWall.tsx:213-229](file://client/src/components/FaceSwapPhotoWall.tsx#L213-L229)
- [ThumbnailStrip.tsx:34-61](file://client/src/components/ThumbnailStrip.tsx#L34-L61)

**章节来源**
- [PhotoWall.tsx:103-125](file://client/src/components/PhotoWall.tsx#L103-L125)
- [ImageCard.tsx:17-42](file://client/src/components/ImageCard.tsx#L17-L42)

## 性能考虑
- **ImageCard 性能优化**：**更新** 通过 React.memo 和 useShallow 浅订阅显著减少重渲染次数，特别是在多卡片场景下性能提升明显。
- 懒加载与预加载：LazyCard 使用不对称 rootMargin，在用户向下滚动时提前渲染，减少空白感；向上微偏移避免不必要的上拉预加载。
- 占位符与滚动补偿：占位符使用最小高度，真实内容渲染后通过 requestAnimationFrame 计算高度差并补偿 scrollTop，避免视口跳变。
- CSS 多列布局：瀑布流由浏览器原生多列布局实现，无需自研排版算法，性能稳定。
- 组件记忆化：LazyCard 与 ImageCard 均使用 memo 包裹，减少不必要的重渲染。
- 状态订阅：通过 useWorkflowStore 的浅订阅（useShallow）降低订阅粒度，避免无关状态变更引发的重渲染。
- 视图配置：VIEW_CONFIG 将列宽与估算高度解耦，便于在不同设备与场景下调整性能与视觉平衡。
- **FaceSwapPhotoWall 优化**：**新增** 使用独立的布局配置和拖拽状态管理，避免与主 PhotoWall 的状态冲突。

**章节来源**
- [PhotoWall.tsx:18-97](file://client/src/components/PhotoWall.tsx#L18-L97)
- [PhotoWall.tsx:12-16](file://client/src/components/PhotoWall.tsx#L12-L16)
- [ImageCard.tsx:27-40](file://client/src/components/ImageCard.tsx#L27-L40)
- [FaceSwapPhotoWall.tsx:14-19](file://client/src/components/FaceSwapPhotoWall.tsx#L14-L19)

## 故障排除指南
- 懒加载不生效
  - 检查 LazyCard 的 IntersectionObserver 是否正确创建与断开连接。
  - 确认 rootMargin 设置是否合理，过小可能导致频繁触发，过大可能影响预加载效果。
  - 参考路径：[PhotoWall.tsx:28-43](file://client/src/components/PhotoWall.tsx#L28-L43)
- 内容跳变或滚动位置异常
  - 检查滚动补偿逻辑是否在占位符转真实内容时执行。
  - 确认容器元素是否带有 data-photo-wall-scroll 属性以便定位滚动容器。
  - 参考路径：[PhotoWall.tsx:46-70](file://client/src/components/PhotoWall.tsx#L46-L70)
- 多选模式按钮不可用
  - 确认 isMultiSelectMode 计算逻辑与 selectedImageIds 是否正确更新。
  - 检查 enterMultiSelect 与 toggleImageSelection 的调用链路。
  - 参考路径：[PhotoWall.tsx:139-142](file://client/src/components/PhotoWall.tsx#L139-L142), [useWorkflowStore.ts:117-125](file://client/src/hooks/useWorkflowStore.ts#L117-L125)
- 批量删除未清理蒙版
  - 确认 maskKey 生成规则与删除范围是否覆盖选中图片的所有蒙版键。
  - 参考路径：[PhotoWall.tsx:258-266](file://client/src/components/PhotoWall.tsx#L258-L266), [maskConfig.ts:18-19](file://client/src/config/maskConfig.ts#L18-L19), [useMaskStore.ts:39-43](file://client/src/hooks/useMaskStore.ts#L39-L43)
- 拖拽删除遮罩不显示
  - 检查 useDragStore 的 dragging 状态是否正确设置与清理。
  - 确认 PhotoWall 对 dragging 的监听与 deleteZoneDragCount 的计数逻辑。
  - 参考路径：[useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16), [PhotoWall.tsx:132-137](file://client/src/components/PhotoWall.tsx#L132-L137), [PhotoWall.tsx:511-574](file://client/src/components/PhotoWall.tsx#L511-L574)
- **ImageCard 性能问题**
  - 检查 arePropsEqual 函数是否正确比较了所有关键 props。
  - 确认 useShallow 订阅是否按预期拆分了状态。
  - 参考路径：[ImageCard.tsx:27-40](file://client/src/components/ImageCard.tsx#L27-L40), [ImageCard.tsx:46-83](file://client/src/components/ImageCard.tsx#L46-L83)
- **FaceSwapPhotoWall 拖拽异常**
  - 检查拖拽数据类型是否正确设置（application/x-face-swap-face/target）。
  - 确认跨区域拖拽的 dropEffect 配置是否匹配。
  - 参考路径：[FaceSwapPhotoWall.tsx:422-442](file://client/src/components/FaceSwapPhotoWall.tsx#L422-L442), [FaceSwapPhotoWall.tsx:748-752](file://client/src/components/FaceSwapPhotoWall.tsx#L748-L752)

**章节来源**
- [PhotoWall.tsx:28-70](file://client/src/components/PhotoWall.tsx#L28-L70)
- [PhotoWall.tsx:132-137](file://client/src/components/PhotoWall.tsx#L132-L137)
- [PhotoWall.tsx:258-266](file://client/src/components/PhotoWall.tsx#L258-L266)
- [useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16)
- [maskConfig.ts:18-19](file://client/src/config/maskConfig.ts#L18-L19)
- [useMaskStore.ts:39-43](file://client/src/hooks/useMaskStore.ts#L39-L43)
- [ImageCard.tsx:27-40](file://client/src/components/ImageCard.tsx#L27-L40)
- [ImageCard.tsx:46-83](file://client/src/components/ImageCard.tsx#L46-L83)
- [FaceSwapPhotoWall.tsx:422-442](file://client/src/components/FaceSwapPhotoWall.tsx#L422-L442)
- [FaceSwapPhotoWall.tsx:748-752](file://client/src/components/FaceSwapPhotoWall.tsx#L748-L752)

## 结论
PhotoWall 通过 LazyCard 的 IntersectionObserver 优化、CSS 多列布局与占位符滚动补偿，实现了高性能的图片瀑布流展示。配合多选模式、批量操作与拖拽删除，满足了复杂工作流中的图片管理需求。**更新** 最新的 ImageCard 性能优化进一步提升了大规模图片场景下的渲染效率，而新增的 FaceSwapPhotoWall 组件为特定工作流提供了专业化的双区域布局解决方案。组件间通过明确的状态订阅与配置约定，保持了良好的可维护性与扩展性。

## 附录

### 使用示例与最佳实践
- 视图大小配置
  - 通过 viewSize 参数选择 small/medium/large，组件会自动应用对应的列宽与估算高度。
  - 参考路径：[PhotoWall.tsx:12-16](file://client/src/components/PhotoWall.tsx#L12-L16), [PhotoWall.tsx:487-490](file://client/src/components/PhotoWall.tsx#L487-L490)
  - **更新** FaceSwapPhotoWall 使用独立的 VIEW_CONFIG 配置：[FaceSwapPhotoWall.tsx:14-19](file://client/src/components/FaceSwapPhotoWall.tsx#L14-L19)
- 事件处理
  - 长按进入多选：在 ImageCard 中触发 enterMultiSelect，随后 PhotoWall 显示工具栏。
  - 批量执行：根据 isMultiSelectMode 与 hasIdleSelected 动态启用执行按钮。
  - **新增** 换脸拖拽：在 FaceSwapPhotoWall 中将脸部参考图拖拽到目标图上执行换脸。
  - 参考路径：[ImageCard.tsx:171-181](file://client/src/components/ImageCard.tsx#L171-L181), [PhotoWall.tsx:165-240](file://client/src/components/PhotoWall.tsx#L165-L240)
  - **更新** 换脸拖拽处理：[FaceSwapPhotoWall.tsx:256-282](file://client/src/components/FaceSwapPhotoWall.tsx#L256-L282)
- 状态管理
  - 使用 useWorkflowStore 管理图片、任务、提示词与选中项；使用 useDragStore 管理拖拽状态；使用 useMaskStore 管理蒙版数据。
  - **更新** FaceSwapPhotoWall 使用 setFaceSwapZone 管理换脸区域状态：[FaceSwapPhotoWall.tsx:148-161](file://client/src/components/FaceSwapPhotoWall.tsx#L148-L161)
  - 参考路径：[useWorkflowStore.ts:96-115](file://client/src/hooks/useWorkflowStore.ts#L96-L115), [useDragStore.ts:13-16](file://client/src/hooks/useDragStore.ts#L13-L16), [useMaskStore.ts:32-30](file://client/src/hooks/useMaskStore.ts#L32-L30)
- 与其他组件协作
  - 与 ImageCard 协同渲染与交互；与 ThumbnailStrip 协同切换输出；与蒙版系统协作管理蒙版数据。
  - **更新** FaceSwapPhotoWall 与 ImageCard 协同实现换脸功能：[FaceSwapPhotoWall.tsx:786-796](file://client/src/components/FaceSwapPhotoWall.tsx#L786-L796)
  - 参考路径：[ImageCard.tsx:769-787](file://client/src/components/ImageCard.tsx#L769-L787), [maskConfig.ts:5-16](file://client/src/config/maskConfig.ts#L5-L16)