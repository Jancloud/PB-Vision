# AI 跑姿视觉诊断助手

## 1. 项目目标
让普通跑者只用一段侧面跑步视频，就能获得基础跑姿问题诊断和可执行建议，降低请私教的门槛与成本。

## 2. MVP（最小可行产品）范围
1. 上传并预览侧面跑步视频。
2. 调用 AI 视觉能力识别关键骨骼点（髋、膝、踝、肩）。
3. 计算核心指标（步幅倾向、落地点相对身体位置、躯干前倾角）。
4. 输出简洁中文建议（问题 + 原因 + 1 条可执行改进动作）。
5. 结果页展示并保存本次分析结果。

## 3. 架构分层（解耦）
- 表现层（UI）：只负责上传、预览、展示结果，不做计算。
- 处理层（Logic）：只负责视频帧处理、调用模型、坐标清洗、视频合规性自检（光线、拍摄角度、人体是否完整入镜）。
- 分析层（Analysis）：只负责把坐标和指标转成文字建议规则。

### 3.1 数据契约（层之间传递的“信物”）
处理层给分析层提供统一格式的 JSON 坐标序列。  
只要这个 JSON 格式不变，未来替换 AI 模型（例如从 MediaPipe 换成其他模型）时，分析层不需要改动。

示例：
```json
{
  "videoId": "run_20260429_001",
  "fps": 30,
  "frames": [
    {
      "frameIndex": 12,
      "timestampMs": 400,
      "keypoints": {
        "hip": { "x": 0.52, "y": 0.61, "confidence": 0.93 },
        "knee": { "x": 0.58, "y": 0.74, "confidence": 0.91 },
        "ankle": { "x": 0.62, "y": 0.89, "confidence": 0.90 },
        "shoulder": { "x": 0.48, "y": 0.43, "confidence": 0.94 }
      }
    }
  ],
  "qualityCheck": {
    "isValid": true,
    "issues": []
  }
}
```

## 4. 目录结构（建议）
```text
AI 跑姿视觉诊断助手/
├─ readme.md
├─ docs/
│  └─ mvp-feature-list.md
├─ assets/               # 静态资源与示例素材
├─ temp/                 # 用户上传的临时视频与中间截图（可定期清理）
├─ src/
│  ├─ ui/                # 上传、预览、结果展示
│  ├─ logic/             # AI 调用、坐标计算、异常处理、合规性自检
│  ├─ analysis/          # 诊断规则与建议生成
│  └─ shared/            # 通用类型、配置、工具函数
└─ tests/
   ├─ logic/
   └─ analysis/
```

## 5. 异常处理原则（MVP 必做）
1. 识别不到人体：提示“请确保拍到完整侧身和全身”。
2. 光线过暗或画面模糊：提示“请在白天或补光环境重拍”。
3. 视频角度不合规（非侧面）：提示“请保持镜头与跑步方向侧向平行”。
4. AI 返回关键点置信度过低：终止分析并给出重拍建议，不输出误导性结论。

## 6. 当前状态
当前处于产品规划阶段。下一步先固化“核心功能清单（MVP vs 后续扩展）”，再进入技术选型与原型开发。

## 7. 已落地模块（2026-04-29）
1. 已创建目录：`src/ui`、`src/logic`、`src/analysis`。
2. 已新增分析函数文件：`src/analysis/runningPhysics.js`。
3. 函数说明：`calculateTorsoLeanAngle(shoulder, hip)`，输入肩膀与胯部坐标，输出躯干前倾角（度）。
4. 使用示例：
```js
import { calculateTorsoLeanAngle } from "./src/analysis/runningPhysics";

const angle = calculateTorsoLeanAngle(
  { x: 0.48, y: 0.43 },
  { x: 0.52, y: 0.61 }
);
console.log(angle); // 例如：12.53
```

## 8. Logic 层接口说明（2026-04-29）
文件：`src/logic/poseDetector.js`

### 8.1 函数
`detectPoseFromVideo(videoElement, options?)`

### 8.2 入参
- `videoElement`：HTML 视频元素（当前帧可读取）
- `options.minConfidence`：最低置信度阈值，默认 `0.6`
- `options.modelComplexity`：MediaPipe 模型复杂度，默认 `1`
- `options.timeoutMs`：超时时间（毫秒），默认 `8000`

### 8.3 返回结构（解耦后的标准对象）
成功：
```json
{
  "ok": true,
  "data": {
    "shoulder": { "x": 0.48, "y": 0.43, "pixelX": 307.2, "pixelY": 154.8, "confidence": 0.93 },
    "hip":      { "x": 0.52, "y": 0.61, "pixelX": 332.8, "pixelY": 219.6, "confidence": 0.92 },
    "knee":     { "x": 0.58, "y": 0.74, "pixelX": 371.2, "pixelY": 266.4, "confidence": 0.90 },
    "ankle":    { "x": 0.62, "y": 0.89, "pixelX": 396.8, "pixelY": 320.4, "confidence": 0.89 }
  },
  "meta": {
    "selectedSide": "left",
    "minConfidence": 0.6,
    "score": 0.91,
    "videoSize": { "width": 640, "height": 360 }
  }
}
```

失败：
```json
{
  "ok": false,
  "error": {
    "code": "LOW_CONFIDENCE",
    "message": "关键点置信度过低，建议重拍：保持侧面、补光、避免遮挡。",
    "details": {}
  }
}
```

### 8.4 常见错误码
- `INVALID_VIDEO`：未传入视频对象
- `VIDEO_NOT_READY`：视频未加载到可读帧
- `NO_PERSON_DETECTED`：未识别到完整人体
- `LOW_CONFIDENCE`：关键点置信度低于阈值
- `POSE_TIMEOUT`：识别超时
- `POSE_RUNTIME_ERROR`：运行期异常

### 8.5 与 analysis 层串联示例
```js
import { detectPoseFromVideo } from "./src/logic/poseDetector";
import { calculateTorsoLeanAngle } from "./src/analysis/runningPhysics";

async function runOnce(videoEl) {
  const poseResult = await detectPoseFromVideo(videoEl, { minConfidence: 0.6 });

  if (!poseResult.ok) {
    console.error(poseResult.error.message);
    return;
  }

  // runningPhysics 当前用的是 {x, y}，这里喂“像素坐标”更适合算角度。
  const shoulderPx = {
    x: poseResult.data.shoulder.pixelX,
    y: poseResult.data.shoulder.pixelY,
  };
  const hipPx = {
    x: poseResult.data.hip.pixelX,
    y: poseResult.data.hip.pixelY,
  };

  const torsoAngle = calculateTorsoLeanAngle(shoulderPx, hipPx);
  console.log("躯干前倾角:", torsoAngle, "度");
}
```

## 9. 数据工厂流水线（UI + Logic + Analysis）
### 9.1 流转路径
1. UI 部门（`src/ui/PoseAnalyzer.jsx`）接收用户上传视频并播放。
2. UI 部门通过 `requestAnimationFrame` 按节奏读取“当前视频帧”。
3. Logic 部门（`src/logic/poseDetector.js`）提取当前帧关键点：`shoulder/hip/knee/ankle`。
4. Analysis 部门（`src/analysis/runningPhysics.js`）用肩膀与胯部坐标计算躯干前倾角。
5. UI 部门更新实时仪表盘，并在“架构日志”区告诉用户当前哪个部门在工作。

### 9.2 前端链路示意
```js
const poseResult = await detectPoseFromVideo(videoEl);
if (poseResult.ok) {
  const angle = calculateTorsoLeanAngle(
    { x: poseResult.data.shoulder.pixelX, y: poseResult.data.shoulder.pixelY },
    { x: poseResult.data.hip.pixelX, y: poseResult.data.hip.pixelY }
  );
  // 然后把 angle 显示在 UI 仪表盘
}
```

## 10. 运行 MVP 的简单指令
> 如果你还没初始化 Next.js 项目，先执行：

```bash
npx create-next-app@latest . --typescript --eslint --src-dir --app --import-alias "@/*" --use-npm
```

> 安装 MediaPipe Pose：

```bash
npm install @mediapipe/pose
```

> 启动开发环境：

```bash
npm run dev
```

> 打开浏览器访问：

```text
http://localhost:3000
```

> 在页面中引入并使用组件（例如 `src/app/page.tsx`）：

```tsx
import PoseAnalyzer from "../ui/PoseAnalyzer";

export default function Page() {
  return <PoseAnalyzer />;
}
```

## 11. ENOENT 报错修复记录（2026-04-29）
问题：执行 `npm run dev` 时提示缺少 `package.json`。

已修复：已在项目根目录创建 Next.js 必需启动文件：
- `package.json`
- `src/app/layout.jsx`
- `src/app/page.jsx`
- `src/app/globals.css`

现在你在本机执行以下命令即可：
```bash
npm install
npm run dev
```

如果端口正常，浏览器访问：
```text
http://localhost:3000
```

## 12. 性能优化：跳帧分析策略（2026-04-29）
为避免视频处理卡顿，UI 调度已升级为：
1. 播放仍按浏览器原速进行（不卡视频）。
2. 分析改为“每 3 帧做 1 次 AI 识别”。
3. 如果 AI 还在处理上一帧，当前分析帧直接跳过（不排队），防止越积越卡。

实现位置：`src/ui/PoseAnalyzer.jsx`
关键参数：`ANALYZE_EVERY_NTH_FRAME = 3`

## 13. 第三阶段性能重构（Worker 版）
### 13.1 新架构
1. `src/ui/PoseAnalyzer.jsx`（表现层）：只负责上传/播放/仪表盘渲染与日志。
2. `src/logic/poseDetector.js`（逻辑代理层）：只负责主线程与 Worker 通信。
3. `src/logic/poseDetector.worker.js`（逻辑计算层）：加载 MediaPipe 模型并提取关键点坐标。
4. `src/analysis/runningPhysics.js`（分析层）：只负责角度计算，不关心模型实现。

### 13.2 数据工厂流水线（异步）
1. UI 用 `requestVideoFrameCallback` 抓视频帧（不支持则回退 `requestAnimationFrame`）。
2. UI 每 3 帧生成一次 `ImageBitmap`，通过 transferable object 零拷贝发送给 Worker。
3. Worker 返回标准坐标对象（`shoulder/hip/knee/ankle`）与 `elapsedMs`。
4. Analysis 层计算躯干前倾角。
5. UI 更新仪表盘；若本帧结果未返回，保持上一帧显示，不等待、不阻塞视频播放。

### 13.3 性能与体验保障
1. 新增 `isLoading`：模型加载中显示 Loading 动画。
2. 新增性能日志：`[Performance] 当前 AI 处理耗时：XX ms`。
3. 当识别结果未及时返回时，自动跳过当前分析帧，避免主线程卡顿。

### 13.4 运行指令（更新）
```bash
npm install
npm install @mediapipe/tasks-vision
npm run dev
```

## 14. 分析层升级（教练建议版）
### 14.1 新增函数
文件：`src/analysis/runningPhysics.js`
- `buildGaitMetrics(points)`：输入肩/胯/膝/踝坐标，输出
  - `torsoLeanAngle`（躯干前倾角）
  - `kneeJointAngle`（膝关节角）
  - `kneeFlexionAngle`（落地瞬间膝盖弯曲度，定义为 `180 - kneeJointAngle`）
- `getGaitAdvice(metrics)`：输出三段式中文建议
  - 【当前状态】
  - 【潜在风险】
  - 【一句话改进动作】

### 14.2 易受伤预警规则
当 `kneeFlexionAngle < 8°`（膝盖接近完全蹬直）时，触发“易受伤预警”。

## 15. UI 联动升级
文件：`src/ui/PoseAnalyzer.jsx`
1. 实时仪表盘下新增“大型教练点评区”。
2. 视频播放时，Analysis 部门会把当前帧建议实时推送到该区域。
3. 架构日志新增异常提示：
`[Analysis 部门]：识别到异常跑姿，已发送纠正建议至 UI 部门。`

## 16. 可视化骨架与报告功能（2026-04-29）
### 16.1 透明 Canvas 骨架叠层
- 在视频上方新增透明 `canvas`（`src/ui/PoseAnalyzer.jsx`）。
- UI 部门实时接收 Logic 部门坐标，绘制：`shoulder -> hip -> knee -> ankle` 连线。
- 正常线条：亮绿色；异常时按 Analysis 部门报警级别自动切换橙色/红色。

### 16.2 异常颜色决策（Analysis）
文件：`src/analysis/runningPhysics.js`
- 新增 `getSkeletonAlert(metrics)` 返回：
  - `alertLevel`（normal/warn/danger）
  - `lineColor`（绿色/橙色/红色）
- 典型触发：
  - 后仰或过直（躯干角过小）
  - 前倾过大
  - 膝盖硬顶（弯曲度过低）

### 16.3 对齐与同步策略
- 画布绝对定位覆盖视频容器。
- 按视频原始分辨率到显示分辨率的缩放比映射坐标，确保骨架和画面对齐。
- 使用 `requestVideoFrameCallback`（回退 `requestAnimationFrame`）保持逐帧同步。

### 16.4 一键生成报告
- 新增“一键生成报告”按钮。
- 点击后汇总全过程统计（有效帧、异常占比、躯干角范围、膝盖弯曲度范围）并生成通俗版教练总结。

## 17. 报告保存交互修复（2026-04-29）
- 点击“一键生成报告”后，系统会：
1. 在页面“教练总结报告”区写入文本；
2. 自动下载一个 `running-report-时间戳.txt` 文件；
3. 显示“报告已生成”提示。

## 18. 国内可访问优化（本地模型资源化）
为解决中国大陆访问不稳定，Logic 层已从外网依赖改为站内本地资源：

1. Worker 加载路径改为：
- Wasm：`/mediapipe/wasm`
- 模型：`/mediapipe/models/pose_landmarker_lite.task`

2. 新增静态资源目录：
- `public/mediapipe/wasm/*`
- `public/mediapipe/models/pose_landmarker_lite.task`

3. 这样部署到 Vercel/EdgeOne 后，前端不再请求 `cdn.jsdelivr.net` 和 `storage.googleapis.com`，
能明显减少国内网络环境下的加载失败概率。

4. 如果后续要切换 full 模型，请再补充：
- `public/mediapipe/models/pose_landmarker_full.task`

## 19. UI/UX 升级规范（Sports Tech 主题）
### 19.1 主题规范
1. 全站使用深色模式：页面背景深灰（#0b0f14），卡片背景微亮灰（#151b22）。
2. 取消生硬阴影，统一使用边框分层（低对比边框）。
3. 字体统一为科技感无衬线：`Rajdhani / Noto Sans SC / Microsoft YaHei`。

### 19.2 极简工作流
1. 上传区升级为可拖拽 Drop Zone，支持点击选择文件与拖拽上传。
2. 架构日志默认隐藏，仅通过右上角菜单开关展开。

### 19.3 Canvas 骨架叠层（关键链路）
1. UI 层在视频上方覆盖透明 Canvas。
2. Logic 层（Worker）持续输出标准坐标（shoulder/hip/knee/ankle）。
3. UI 层把坐标映射到显示分辨率后实时画线（肩 -> 胯 -> 膝 -> 踝）。
4. Analysis 层根据指标返回报警级别，驱动骨架颜色联动。

### 19.4 状态联动规则
1. 正常姿态：骨架亮绿色。
2. 异常姿态（如后仰、前倾过大、膝盖过硬）：骨架立即切红色进行视觉报警。
3. 仪表盘角度颜色与骨架颜色保持一致的状态语义（正常绿、异常警示色）。

## 20. 云端教练 API（DeepSeek/GLM）
### 20.1 后端接口
- 新增文件：`src/pages/api/coach.js`
- 职责：服务端安全调用大模型，前端不暴露 API Key。

### 20.2 环境变量
按需二选一：

DeepSeek：
- `COACH_PROVIDER=deepseek`
- `DEEPSEEK_API_KEY=你的密钥`
- `DEEPSEEK_MODEL=deepseek-chat`（可选）

GLM：
- `COACH_PROVIDER=glm`
- `GLM_API_KEY=你的密钥`
- `GLM_MODEL=glm-4-flash`（可选）

### 20.3 Prompt 结构
后端会把前端上传的 metrics（角度、变异系数、帧数、异常率）转成结构化 Prompt，
要求 AI 输出：
1. 技术诊断
2. 与精英常模对比
3. 潜在风险
4. 训练处方（含保加利亚蹲、靠墙静蹲等可执行动作）
5. 下次复测目标

### 20.4 容错与体验
- 点击“一键生成报告”后，UI 显示“教练正在深度分析...”加载态。
- 若云端接口失败，自动回退到本地静态总结，不中断用户体验。
- 回退后仍会正常生成并下载报告文件。

## 21. 商业化 UI/UX 与 AI 报告升级
### 21.1 智能拍摄助手（前端）
1. 上传区新增拍摄指引：
   - 请确保摄影机与跑者呈 90° 侧面，光线充足，且全身入镜。
2. 新增视频质量自检：
   - 基于关键点置信度估算人体完整度。
   - 完整度低于 70% 时，前端提示“视频质量不佳，分析结果可能不准”。

### 21.2 去噪预处理（后端）
文件：`src/pages/api/coach.js`
1. 在调用 DeepSeek/GLM 前执行“置信度过滤器”。
2. 过滤规则：剔除 `confidenceScore < 0.6` 的帧。
3. 仅使用过滤后的帧重新统计：
   - 躯干前倾均值 / 最小 / 最大 / 变异系数
   - 膝盖弯曲均值 / 最小 / 最大 / 变异系数

### 21.3 金字塔报告结构
新增组件：`src/ui/ReportView.jsx`
1. 塔尖：综合评分（0~100）
2. 塔中：核心风险标签（如 #落地冲击过大）
3. 塔基：折叠详细分析与原理

### 21.4 云端深度分析与容错
1. 点击“一键生成报告”后，UI 显示“教练正在深度分析...”。
2. 云端成功：渲染 AI 报告并保存。
3. 云端失败：自动回退本地静态建议，不中断用户体验。

### 21.5 PDF 下载
新增接口：`src/pages/api/report-pdf.js`
1. 前端“下载 PDF”按钮调用后端生成 PDF 并下载。
2. 依赖：`pdfkit`。

## 22. 环境变量模板
- 已新增 `.env.example`。
- 本地开发请先复制：
  - Windows: `copy .env.example .env.local`
  - macOS/Linux: `cp .env.example .env.local`
- 然后填入真实 API Key。

## 23. 隐私安全专项升级（v2）
### 23.1 前端隐私提示
- 上传区下方新增隐私徽章：`隐私安全：全本地分析，视频不上传，肖像不存留。`
- 作用：让用户在上传前就知道数据边界，降低隐私顾虑。

### 23.2 匿名模式（Privacy Mode）
文件：`src/ui/PoseAnalyzer.jsx`
1. 新增“匿名模式”开关。
2. 开启后：不再把视频设为透明，而是改为 Canvas 黑幕模式（先画纯黑，再画骨架）。
3. Canvas 只覆盖视频画面区域，底部预留控制栏安全区（约 52px），保证原生播放/暂停/全屏控件可点击。
4. 正常骨架线在匿名模式下切换为赛博蓝（`#00e5ff`），异常仍保留红色告警。
5. 分析链路不变：Logic/Analysis 仍照常运行，UI 仅改变可视层。

### 23.3 内存回收机制
文件：`src/ui/PoseAnalyzer.jsx`
1. 新增 `releaseVideoResource()`：
   - `URL.revokeObjectURL(...)` 释放本地对象 URL。
   - 清理 `<video>` 的 `src` 并 `load()`，避免资源残留。
2. 触发时机：
   - `video.onended`
   - 组件卸载（`useEffect` cleanup）

### 23.4 云端接口脱敏与白名单
文件：`src/pages/api/coach.js`
1. 前端上报给 `/api/coach` 的数据改为“纯数字统计”对象（如帧数、均值、CV、异常率等），不再发送逐帧数组。
2. 后端新增敏感字段拦截：若 payload 出现 `base64/snapshot/face/identity/...` 等字段，直接拒绝。
3. 后端仅保留白名单数字字段并清洗（数值化、范围裁剪、四舍五入）后，再组装 Prompt 调用 DeepSeek/GLM。

### 23.5 去噪策略（0.6 阈值）
1. 前端先按 `confidenceScore >= 0.6` 过滤低置信度帧。
2. 仅用高置信度帧计算并上报统计指标，降低光照抖动导致的误报。
3. 若高置信度帧不足，自动回退本地静态总结，避免用户体验中断。

## 24. 视觉美化专项升级（Neon Blue Theme）
### 24.1 新增骨架渲染模块
- 新增文件：`src/ui/PoseCanvas.jsx`
- 职责：
  1. 统一管理 Canvas 尺寸同步。
  2. 统一管理骨架绘制样式（正常/异常）。
  3. 在匿名模式下先绘制黑幕，再绘制骨架。
- 默认骨架色：`#00f3ff`（霓虹荧光蓝）。

### 24.2 异常状态视觉规则
1. 当 analysis 层返回 `alertLevel !== "normal"` 时：
   - 骨架线切换为荧光红 `#ff3b5f`。
   - 启用发光（shadow blur）与轻微脉冲动画（Pulse）。
2. 这样不会只是“平面变红”，而是明确的动态告警效果。

### 24.3 UI 配色统一
1. PoseAnalyzer 全局主题 `accent` 改为荧光蓝：`#00f3ff`。
2. 上传区隐私提示加入蓝色锁图标，Loading 文案与重点提示统一蓝色系。
3. 卡片背景整体调暗，提升荧光色对比度与科技感。

### 24.4 PDF 报告配色对齐
- 文件：`src/pages/api/report-pdf.js`
- 诊断分数主色从绿色替换为荧光蓝：`#00f3ff`。

### 24.5 报告卡片配色对齐
- 文件：`src/ui/ReportView.jsx`
- 综合评分、按钮、背景层次同步到 Neon Blue + 深色卡片方案。

## 25. 全屏赛博报告模态框（Cyber-Report Modal）
### 25.1 新增组件
- 新增：`src/ui/ReportModal.jsx`
- 角色：只负责报告展示与打印，不参与分析计算。

### 25.2 视觉规范
1. 全屏深色背景：`#0f172a`。
2. 模态框边框：荧光蓝 `#00f3ff` 细边框。
3. 右上角关闭按钮：荧光红。
4. 得分区：荧光蓝圆环 + 分数动态计数。
5. 核心风险区：红色发光风险卡片（Pulse）。

### 25.3 交互变更
1. 点击“一键生成报告”后：
   - 不再自动下载文本/PDF。
   - 直接弹出全屏赛博报告 Modal。
2. Modal 底部保留“打印 / 保存”按钮，调用 `window.print()`。

### 25.4 文本清洗
- 在渲染教练建议前，对 DeepSeek/GLM 返回文本执行 Markdown 轻清洗：
  - 去标题符号（#）
  - 去粗体标记（**）
  - 规范列表符号（-/*）
- 再按段落展示为可读文本块。

### 25.5 打印优化
- `ReportModal.jsx` 内置：
  - `@media print { .no-print { display: none; } }`
- 打印时隐藏关闭/操作按钮，只保留报告主体内容。

### 25.6 依赖
- 新增依赖：`lucide-react`（用于教练建议区图标）。

## 26. 报告压缩策略（精英效率版）
文件：`src/pages/api/coach.js`
1. Prompt 强约束：
   - 总字数 <= 500 字。
   - 技术诊断仅 2 个最严重问题。
   - 训练处方仅 2 个动作，单条 <= 30 字。
   - 常模对比必须用“高于/低于精英常模X%”短语。
   - 禁止开场白、客套话、结语。
2. 后端硬闸门：
   - 新增 `enforceMaxChars()`，对模型返回再做二次截断，确保最终返回不超过 500 字。

### 25.7 打印单页优先优化（ReportModal）
文件：`src/ui/ReportModal.jsx`
1. 打印时切换到专用布局（`print-only`）：
   - 第一行双列：技术诊断 | 训练处方
   - 第二行双列：常模对比 | 复测目标
2. 紧凑排版：
   - 降低标题字号（打印态 20px）
   - 缩小模块 margin/padding（`print-compact`）
3. 隐藏冗余：
   - 隐藏关闭按钮、底部交互按钮、顶部装饰线（`no-print`）
4. 防分页切断：
   - 核心模块统一加 `break-inside: avoid; page-break-inside: avoid;`（`print-block`）

### 25.8 匿名模式句柄保护修复（稳定播放）
文件：`src/ui/PoseAnalyzer.jsx`
1. 新增 `privacyModeRef`，匿名开关只改 UI 渲染策略，不参与组件生命周期依赖。
2. `syncCanvasSize` / `drawSkeletonOnCanvas` 改为读取 `privacyModeRef.current`，避免匿名切换触发初始化 useEffect 的 cleanup。
3. `URL.revokeObjectURL` 仍只在真实释放场景执行（视频结束或组件最终卸载），切换匿名开关不会释放视频 Blob URL。
4. Worker 不重启：匿名开关期间仅改变 Canvas 黑幕与骨架绘制，视频播放可持续不中断。

### 25.9 Dev-Only 句柄回归检测
文件：`src/ui/PoseAnalyzer.jsx`
1. 在 `privacyMode` 切换的 `useEffect` 中新增句柄校验：
   - 若 `video.currentSrc` 丢失或发生非预期变更，输出高亮 `console.warn`：
   - 『检测到视频源句柄异常重置，请检查组件卸载逻辑』。
2. 该检测仅在开发环境生效（`NODE_ENV !== production`）。
3. 检测结果只输出到浏览器控制台，不写入“架构日志”面板，避免污染生产视图。

### 25.10 匿名模式控件恢复修复（UI 紧急）
文件：`src/ui/PoseCanvas.jsx`、`src/ui/PoseAnalyzer.jsx`
1. Canvas 尺寸改为按视频“画面内容高度”计算（基于 `videoWidth/videoHeight`），不再覆盖底部 controls 区域。
2. Canvas 保持 `pointer-events: none`，并设置高于视频的 `z-index`，点击可穿透到原生播放条。
3. 匿名黑幕改为 Canvas 每帧绘制：
   - 先 `fillRect(0,0,w,h)` 纯黑遮罩
   - 再叠加荧光蓝骨架
4. 视频标签不再用 CSS 隐藏（`opacity` 固定为 1），句柄持续有效，切换匿名模式不会中断播放与分析。

### 25.11 容器隔离方案（控件可点击保障）
文件：`src/ui/PoseAnalyzer.jsx`、`src/ui/PoseCanvas.jsx`
1. 视频容器采用相对定位并 `overflow: hidden`，视频保持 `width:100%/height:auto/display:block`。
2. Canvas 不再按整容器全高覆盖，而是按视频真实画面高度裁剪（不含底部控制条）。
3. 引入 `ResizeObserver` 监听容器和视频尺寸变化，实时同步 Canvas 尺寸。
4. 匿名模式黑幕由 Canvas 每帧绘制（`fillRect`）实现，Worker 不重启。
5. 开发环境输出自检日志：
   - `[UI 监控]: 正在尝试避开控件区，当前 Canvas 高度比视频容器矮 X 像素。`

### 25.12 自定义赛博控件（Custom Cyber Controls）
文件：`src/ui/CyberVideoControls.jsx`、`src/ui/PoseAnalyzer.jsx`
1. 视频原生控件已禁用：`<video controls={false} />`。
2. 新增荧光蓝自定义控制条：
   - 播放/暂停按钮（Lucide 图标）
   - 可点击进度条（通过 `video.currentTime` 跳转）
   - 当前时间 / 总时长显示
3. 匿名模式开关已集成到底部控制条。
4. 由于不再依赖原生 controls，Canvas 与视频层级冲突问题被结构性规避；Worker 生命周期不受影响。

### 25.13 报告输出策略调整（放弃打印）
文件：`src/ui/ReportModal.jsx`、`src/ui/PoseAnalyzer.jsx`
1. 已移除报告弹窗中的“打印/保存”按钮。
2. 已删除 `@media print` 相关样式与打印专用布局代码，减少冗余。
3. 报告底部新增提示：
   - `💡 建议：您可以直接截图保存这份诊断报告，或随时在应用中查看。`
4. 弹窗滚动体验增强：
   - `scroll-behavior: smooth`
   - `-webkit-overflow-scrolling: touch`
   - `overscroll-behavior: contain`
   - 赛博风滚动条样式（桌面 WebKit）

### 25.14 仪表盘数字滚动动画（高精度渲染）
文件：`src/ui/PoseAnalyzer.jsx`、`src/ui/ReportModal.jsx`
1. 核心数值采用 `easeOutExpo` 动画（约 700~780ms）：
   - 躯干前倾角（仪表盘）
   - 报告分数与核心指标（Modal）
2. 数值渲染统一保留两位小数（角度/比例类指标），滚动中间值同样保持一致格式。
3. 分数滚动与环形进度条同步增长，保持荧光蓝发光轨迹。
4. 架构日志联动：
   - `[UI 部门]: 核心指标已完成高精度渲染校准。`
   - 采用节流策略，避免日志刷屏。

## 26. EdgeOne 部署指南（中国大陆优先）
### 26.1 部署目标
把当前 Next.js 项目部署到 EdgeOne Pages，利用大陆就近节点提升访问稳定性；不改 UI/Logic/Analysis 三层业务代码。

### 26.2 已新增部署配置
文件：`edgeone.json`
```json
{
  "name": "pb-vision",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "nodeVersion": "20.18.0",
  "nodeFunctionsConfig": {
    "maxDuration": 60
  }
}
```
说明：
1. `nodeFunctionsConfig.maxDuration=60`：给 `/api/coach` 预留更稳的模型调用时间，避免云函数过早超时。
2. 该配置只管理部署，不侵入业务模块，符合“单一职责”和“极致解耦”。

### 26.3 控制台发布步骤（推荐）
1. 打开 EdgeOne Pages 控制台，创建新项目。
2. 选择「从 Git 仓库导入」，连接 GitHub 并选择仓库：`Jancloud/PB-Vision`。
3. 框架选择 `Next.js`（或自动识别）。
4. 构建设置保持默认；若未自动识别，则填：
   - Install Command: `npm ci`
   - Build Command: `npm run build`
   - Output Directory: `.next`
5. 在项目环境变量中二选一配置：
   - DeepSeek：
     - `COACH_PROVIDER=deepseek`
     - `DEEPSEEK_API_KEY=你的密钥`
     - `DEEPSEEK_MODEL=deepseek-chat`（可选）
   - GLM：
     - `COACH_PROVIDER=glm`
     - `GLM_API_KEY=你的密钥`
     - `GLM_MODEL=glm-4-flash`（可选）
6. 点击部署，等待构建完成。

### 26.4 上线后 3 项自检
1. 打开首页上传视频，确认骨架叠层与仪表盘实时更新。
2. 点击「一键生成报告」，确认云端建议正常返回（若失败应自动回退本地建议）。
3. 在浏览器网络面板确认只请求 `/api/coach` 数字指标，不上传视频帧或个人图像数据。

### 26.5 常见问题
1. 模型接口报错：先查环境变量名是否与 `.env.example` 完全一致（包括大小写）。
2. 国内偶发慢：优先使用 DeepSeek 国内可达域名；并确保 `public/mediapipe` 静态模型已随仓库发布。
3. 部署成功但页面空白：检查构建日志中 Node 版本，建议使用 `20.x`。

## 27. Mobile-First 架构优化（2026-04-29）
### 27.1 响应式布局策略
文件：`src/ui/PoseAnalyzer.jsx`
1. 当视口宽度 `<= 768px` 时，主布局从双列切换为单列。
2. 移动端内容顺序固定为：视频分析区 -> 实时仪表盘 -> 教练点评区。

### 27.2 仪表盘卡片化（运动手表风格）
文件：`src/ui/PoseAnalyzer.jsx`
1. 实时仪表盘在手机上改为横向 3 卡并排：
   - 躯干前倾角
   - 实时评分
   - 异常帧数
2. 保留数值滚动动画，避免生硬跳变。

### 27.3 触控交互优化
文件：`src/ui/CyberVideoControls.jsx`、`src/ui/PoseAnalyzer.jsx`
1. 播放/暂停按钮与匿名模式开关点击热区提升到 `44px` 及以上。
2. 进度条点击区域加厚（视觉仍细线，触控命中更大）。
3. 新增双击手势：
   - 视频左侧双击：快退 5 秒
   - 视频右侧双击：快进 5 秒

### 27.4 高 DPI 画布适配
文件：`src/ui/PoseCanvas.jsx`
1. Canvas 按 `window.devicePixelRatio` 同步物理像素尺寸。
2. 绘制前使用 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`，移动端骨骼线保持清晰不发虚。

### 27.5 性能与发热控制
文件：`src/ui/PoseAnalyzer.jsx`
1. 桌面端骨骼层维持约 `60fps` 刷新。
2. 移动端自动降为约 `30fps` 刷新（仅限 UI 叠层渲染节奏），减少发热与耗电。
3. AI 检测链路仍保持 Worker 异步解耦，不阻塞视频播放。

## 28. 报告视图 Mobile-Only 升级（2026-04-29）
文件：`src/ui/ReportModal.jsx`

### 28.1 全屏固定报告层
1. 当视口宽度 `<= 768px` 时，不再使用桌面弹窗布局。
2. 移动端改为全屏 `fixed` 报告层，背景使用深色 + `backdrop-filter: blur(10px)`。

### 28.2 评分头部强化
1. 保留原有分数滚动动画（easeOutExpo）。
2. 综合评分圆环在手机端放大约 1.5 倍并居中展示。
3. 顶部标题使用赛博蓝霓虹风格，并加大字间距。

### 28.3 扁平双栏卡片
1. 将“核心风险区”与“技术诊断核心数据”改为 2 栏网格，减少纵向滚动。
2. 卡片使用半透明蓝背景与发光描边，保持赛博视觉一致性。

### 28.4 手风琴交互（移动端默认收起）
1. 教练建议拆分为四大板块：
   - 技术诊断
   - 常模对比
   - 训练处方
   - 复测目标
2. 默认全部收起，点击标题展开。
3. 每个折叠按钮点击热区不小于 `44px`。

### 28.5 底部固定操作栏
1. 新增固定浮动条，包含：
   - 关闭报告
   - 截屏分享建议
2. 按钮统一亮蓝渐变，适配 iPhone/Android 单手操作。

### 28.6 移动端底部安全区补丁
文件：`src/ui/ReportModal.jsx`、`src/ui/PoseAnalyzer.jsx`
1. 移动端底部操作栏改为文档流内布局（不再使用 `position: fixed`），作为报告正文最后一个子元素。
2. 按钮区增加底部留白，避免紧贴系统导航栏：
   - `padding-bottom: calc(2rem + env(safe-area-inset-bottom))`
3. 新增顶部快速关闭入口：
   - 右上角 `X` 按钮（`position: absolute; top: 1rem; right: 1rem;`）
4. 按钮在移动端改为纵向堆叠，保留赛博蓝发光风格，提升大拇指点击体验。
5. 新增架构监控日志：
   - `[UI 监控]: 已切换移动报告操作栏为底部文档流布局。`

## 29. 首页移动端空间优化（2026-04-30）
文件：`src/app/page.jsx`、`src/app/globals.css`、`src/ui/PoseAnalyzer.jsx`
1. 首页外层容器改为 `home-main` 类统一管理。
2. 桌面端保持 `padding: 24px` 与居中布局。
3. 移动端（`<= 768px`）外层容器改为 `padding: 0`，释放横向空间给核心内容。
4. `PoseAnalyzer` 在移动端使用更贴近报告页的水平内边距：
   - `padding: 20px 14px 28px`
5. 上传区文字做“去拥挤”微调（移动端）：
   - 主文案增加 `line-height`
   - 提示文案增加 `line-height` 与轻微 `letter-spacing`

## 30. UI 品牌化升级：Footer 与 About（2026-04-30）
文件：`src/ui/PoseAnalyzer.jsx`、`src/ui/AboutModal.jsx`、`src/ui/AppFooter.jsx`
1. 新增页脚 Footer：
   - 左侧：`v1.0.0-stable`
   - 右侧：`Built by Jan | IT Architect & Marathoner`
2. Footer 文案默认半透明灰，Hover 触发赛博蓝发光。
3. 在标题 `PB Vision` 右侧新增微型 Info 按钮。
4. 点击 Info 打开 AboutModal（磨砂玻璃背景），分三块内容：
   - `The Vision`
   - `The Tech`
   - `Safety`（醒目免责声明，非医疗建议）
5. 移动端报告标题防遮挡补丁：
   - 在标题容器增加 `padding-right: 60px`，确保右上角 `X` 不覆盖标题文字。

## 31. PWA 升级（2026-04-30）
文件：`public/manifest.json`、`public/sw.js`、`src/ui/PwaBootstrap.jsx`、`src/app/layout.jsx`
1. 新增 `manifest.json`：
   - `name`: PB Vision - AI Gait Analysis
   - `short_name`: PB Vision
   - `theme_color`: `#00e5ff`
   - `background_color`: `#000000`
   - `display`: `standalone`
   - `start_url`: `/`
   - 图标路径预留：`/icons/icon-192.png`、`/icons/icon-512.png`
2. 新增基础 Service Worker：
   - 预缓存首页与 manifest
   - 导航请求优先回退首页缓存
   - 同源静态资源走缓存优先策略（API 请求不缓存）
3. 在 `layout.jsx` 注入 PWA Header 信息：
   - `manifest: "/manifest.json"`
   - iOS meta：`apple-mobile-web-app-capable=yes`
   - iOS meta：`apple-mobile-web-app-status-bar-style=black`
   - `themeColor: #00e5ff`
4. 新增安装条件日志：
   - 当命中 `beforeinstallprompt` 时，控制台输出
   - `[PWA Service]: Ready to install on home screen.`
