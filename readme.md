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

### 16.4 一键保存报告
- 新增“一键保存报告”按钮。
- 点击后汇总全过程统计（有效帧、异常占比、躯干角范围、膝盖弯曲度范围）并生成通俗版教练总结。

## 17. 报告保存交互修复（2026-04-29）
- 点击“一键保存报告”后，系统会：
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
- 点击“一键保存报告”后，UI 显示“教练正在深度分析...”加载态。
- 若云端接口失败，自动回退到本地静态总结，不中断用户体验。
- 回退后仍会正常生成并下载报告文件。
