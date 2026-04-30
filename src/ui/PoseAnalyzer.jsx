"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectPoseFromVideo,
  disposePoseDetector,
  initPoseDetector,
} from "../logic/poseDetector";
import {
  buildGaitMetrics,
  getGaitAdvice,
  getSkeletonAlert,
} from "../analysis/runningPhysics";
import {
  clearPoseCanvas,
  drawPrivacyMask,
  drawPoseSkeleton,
  syncPoseCanvasSize,
} from "./PoseCanvas";
import CyberVideoControls from "./CyberVideoControls";
import ReportModal from "./ReportModal";

const ANALYZE_EVERY_NTH_FRAME = 3;
const ABNORMAL_LOG_COOLDOWN_MS = 1500;
const QUALITY_WARN_THRESHOLD = 70;
const MOBILE_BREAKPOINT = 768;
const MOBILE_RENDER_FPS = 30;
const DESKTOP_RENDER_FPS = 60;
const DOUBLE_TAP_WINDOW_MS = 280;

const theme = {
  panelBg: "#0d131b",
  panelBg2: "#0a1017",
  border: "#1d2a38",
  text: "#e8f0fa",
  subText: "#93a4b7",
  accent: "#00f3ff",
  warn: "#ff9f1a",
  danger: "#ff4d4d",
};

function formatNow() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function LoadingDots() {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 42,
        letterSpacing: 2,
        fontWeight: 700,
        animation: "blinkDots 1s infinite",
      }}
    >
      ...
    </span>
  );
}

function easeOutExpo(progress) {
  if (progress >= 1) return 1;
  return 1 - 2 ** (-10 * progress);
}

function useAnimatedMetric(target, options = {}) {
  const { durationMs = 680, decimals = 2, startFromZeroOnFirst = true } = options;
  const [displayValue, setDisplayValue] = useState(0);
  const prevTargetRef = useRef(null);
  const currentValueRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplayValue(0);
      prevTargetRef.current = null;
      currentValueRef.current = 0;
      return undefined;
    }

    const factor = 10 ** decimals;
    const to = Math.round(target * factor) / factor;
    const from = prevTargetRef.current == null && startFromZeroOnFirst ? 0 : currentValueRef.current;
    const startAt = performance.now();
    let rafId = 0;

    const tick = (now) => {
      const progress = Math.min(1, (now - startAt) / durationMs);
      const eased = easeOutExpo(progress);
      const raw = from + (to - from) * eased;
      const rounded = Math.round(raw * factor) / factor;
      setDisplayValue(rounded);
      currentValueRef.current = rounded;
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayValue(to);
        currentValueRef.current = to;
      }
    };

    rafId = requestAnimationFrame(tick);
    prevTargetRef.current = to;
    return () => cancelAnimationFrame(rafId);
  }, [decimals, durationMs, startFromZeroOnFirst, target]);

  return displayValue;
}

function createInitialAdvice() {
  return {
    currentStatus: "【当前状态】等待视频帧数据。",
    potentialRisk: "【潜在风险】暂无。",
    action: "【一句话改进动作】先上传并播放一段侧面跑步视频。",
    isAbnormal: false,
    issueTag: "normal",
    skeletonAlert: { alertLevel: "normal", lineColor: theme.accent },
    metrics: null,
  };
}

function createInitialStats() {
  return {
    validFrames: 0,
    abnormalFrames: 0,
    stiffKneeFrames: 0,
    backLeanFrames: 0,
    overLeanFrames: 0,
    torsoSum: 0,
    torsoMin: Infinity,
    torsoMax: -Infinity,
    kneeFlexMin: Infinity,
    kneeFlexMax: -Infinity,
    startAt: null,
    endAt: null,
    frames: [],
  };
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safeDivide(a, b) {
  if (!b) return 0;
  return a / b;
}

function stdDev(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, n) => sum + (n - m) * (n - m), 0) / arr.length;
  return Math.sqrt(variance);
}

function coeffOfVariation(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  if (Math.abs(m) < 1e-8) return 0;
  return stdDev(arr) / Math.abs(m);
}

function buildRiskTags(stats) {
  const tags = [];
  if (stats.stiffKneeFrames > 0) tags.push("落地冲击过大");
  if (stats.backLeanFrames > 0) tags.push("躯干后仰趋势");
  if (stats.overLeanFrames > 0) tags.push("躯干不稳定");
  return tags.slice(0, 3);
}

function buildScore(stats) {
  if (stats.validFrames === 0) return 0;
  const abnormalRate = safeDivide(stats.abnormalFrames, stats.validFrames);
  const stiffRate = safeDivide(stats.stiffKneeFrames, stats.validFrames);
  const torsoRange = stats.torsoMax - stats.torsoMin;

  let score = 100;
  score -= abnormalRate * 40;
  score -= stiffRate * 25;
  score -= Math.min(20, torsoRange * 0.8);
  return Math.max(0, Math.round(score));
}

export default function PoseAnalyzer() {
  const videoRef = useRef(null);
  const videoWrapRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileUrlRef = useRef("");
  const isMountedRef = useRef(true);
  const isAnalyzingRef = useRef(false);
  const frameCountRef = useRef(0);
  const rafIdRef = useRef(null);
  const vfcIdRef = useRef(null);
  const lastAbnormalLogAtRef = useRef(0);
  const lastUiCalibrationLogAtRef = useRef(0);
  const latestSkeletonRef = useRef(null);
  const latestFrameSizeRef = useRef({ width: 0, height: 0 });
  const latestAlertLevelRef = useRef("normal");
  const privacyModeRef = useRef(false);
  const lastStableVideoSrcRef = useRef("");
  const lastCanvasGapRef = useRef(null);
  const sessionStatsRef = useRef(createInitialStats());
  const overlayLastRenderAtRef = useRef(0);
  const lastTapRef = useRef({ side: "", at: 0 });
  const renderModeLogRef = useRef("");

  const [videoUrl, setVideoUrl] = useState("");
  const [status, setStatus] = useState("等待上传视频");
  const [errorText, setErrorText] = useState("");
  const [qualityWarning, setQualityWarning] = useState("");
  const [logs, setLogs] = useState([]);
  const [angle, setAngle] = useState(null);
  const [canvasAlertLevel, setCanvasAlertLevel] = useState("normal");
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState(createInitialAdvice);
  const [reportText, setReportText] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [reportPayload, setReportPayload] = useState({
    score: 0,
    tags: [],
    summary: "",
    details: "",
    source: "本地规则",
    metrics: null,
    generatedAt: "",
  });

  const pushLog = useCallback((text) => {
    setLogs((prev) => {
      const next = [...prev, `[${formatNow()}] ${text}`];
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });
  }, []);

  const angleColor = useMemo(() => {
    if (angle == null) return theme.subText;
    return angle >= 5 && angle <= 10 ? theme.accent : theme.warn;
  }, [angle]);
  const animatedAngle = useAnimatedMetric(angle, { durationMs: 700, decimals: 2 });
  const liveScore = buildScore(sessionStatsRef.current);
  const abnormalFrameCount = sessionStatsRef.current.abnormalFrames || 0;
  const animatedScore = useAnimatedMetric(liveScore, { durationMs: 760, decimals: 0 });
  const animatedAbnormalFrames = useAnimatedMetric(abnormalFrameCount, { durationMs: 620, decimals: 0 });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const apply = () => setIsMobileView(media.matches);
    apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    overlayLastRenderAtRef.current = 0;
    const modeText = isMobileView ? "mobile-30fps" : "desktop-60fps";
    if (renderModeLogRef.current === modeText) return;
    renderModeLogRef.current = modeText;
    pushLog(`[Performance] UI 渲染节奏已切换为 ${isMobileView ? "30fps（移动端降温模式）" : "60fps（桌面模式）"}`);
  }, [isMobileView, pushLog]);

  const resetSessionStats = useCallback(() => {
    sessionStatsRef.current = createInitialStats();
  }, []);

  const clearCanvas = useCallback(() => {
    clearPoseCanvas(canvasRef.current);
  }, []);

  const syncCanvasSize = useCallback(() => {
    const rect = syncPoseCanvasSize(canvasRef.current, videoWrapRef.current, videoRef.current);
    if (process.env.NODE_ENV !== "production" && rect && videoWrapRef.current) {
      const gap = Math.max(0, Math.round(videoWrapRef.current.clientHeight - rect.height));
      if (lastCanvasGapRef.current !== gap) {
        // eslint-disable-next-line no-console
        console.info(`[UI 监控]: 正在尝试避开控件区，当前 Canvas 高度比视频容器矮 ${gap} 像素。`);
        lastCanvasGapRef.current = gap;
      }
    }
    return rect;
  }, []);

  const drawSkeletonOnCanvas = useCallback(
    (points, frameSize, alertLevel) => {
      drawPoseSkeleton({
        canvas: canvasRef.current,
        wrap: videoWrapRef.current,
        videoEl: videoRef.current,
        points,
        frameSize,
        privacyMode: privacyModeRef.current,
        alertLevel,
        timestampMs: performance.now(),
      });
    },
    []
  );

  const renderOverlayFrame = useCallback(() => {
    if (latestSkeletonRef.current) {
      drawSkeletonOnCanvas(latestSkeletonRef.current, latestFrameSizeRef.current, latestAlertLevelRef.current);
      return;
    }
    if (privacyModeRef.current) {
      drawPrivacyMask({ canvas: canvasRef.current, wrap: videoWrapRef.current, videoEl: videoRef.current });
      return;
    }
    clearCanvas();
  }, [clearCanvas, drawSkeletonOnCanvas]);

  const renderOverlayFrameForLoop = useCallback(() => {
    const now = performance.now();
    const targetFps = isMobileView ? MOBILE_RENDER_FPS : DESKTOP_RENDER_FPS;
    const minInterval = 1000 / targetFps;
    if (now - overlayLastRenderAtRef.current < minInterval) return;
    overlayLastRenderAtRef.current = now;
    renderOverlayFrame();
  }, [isMobileView, renderOverlayFrame]);

  const stopLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const videoEl = videoRef.current;
    if (videoEl && vfcIdRef.current != null && typeof videoEl.cancelVideoFrameCallback === "function") {
      videoEl.cancelVideoFrameCallback(vfcIdRef.current);
      vfcIdRef.current = null;
    }
  }, []);

  const releaseVideoResource = useCallback(() => {
    const videoEl = videoRef.current;
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = "";
    }
    if (videoEl) {
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    lastStableVideoSrcRef.current = "";
    setVideoUrl("");
  }, []);

  useEffect(() => {
    privacyModeRef.current = privacyMode;
    if (process.env.NODE_ENV === "production") return;

    const videoEl = videoRef.current;
    if (!videoEl) return;

    const expectedSrc = fileUrlRef.current || videoUrl || "";
    if (!expectedSrc) return;

    const currentSrc = videoEl.currentSrc || videoEl.src || "";
    const previousSrc = lastStableVideoSrcRef.current || expectedSrc;
    const isLost = !currentSrc;
    const isUnexpectedChanged = Boolean(currentSrc) && Boolean(previousSrc) && currentSrc !== previousSrc && currentSrc !== expectedSrc;

    if (isLost || isUnexpectedChanged) {
      // Dev-Only 回归检测：匿名开关切换后，视频句柄不应丢失或意外替换。
      // eslint-disable-next-line no-console
      console.warn(
        "%c[PB-Vision Dev Warning]%c 检测到视频源句柄异常重置，请检查组件卸载逻辑",
        "background:#3a0f1a;color:#ff6688;padding:2px 8px;border-radius:4px;font-weight:700;",
        "color:#ffd0da;font-weight:600;",
        { previousSrc, expectedSrc, currentSrc, privacyMode }
      );
      return;
    }

    lastStableVideoSrcRef.current = currentSrc;
  }, [privacyMode, videoUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    const boot = async () => {
      setIsLoading(true);
      setStatus("系统：正在加载 AI 模型");
      pushLog("Logic 部门：正在启动 Worker 并加载 MediaPipe 模型。");
      const initResult = await initPoseDetector({ minConfidence: 0.6 });
      if (!isMountedRef.current) return;
      if (!initResult.ok) {
        setStatus("系统：模型加载失败");
        setErrorText(initResult.error.message);
        pushLog(`系统提示：${initResult.error.message}`);
      } else {
        setStatus("系统：模型已就绪，等待上传视频");
        pushLog("Logic 部门：模型加载完成。");
      }
      setIsLoading(false);
    };

    boot().catch((err) => {
      if (!isMountedRef.current) return;
      setStatus("系统：初始化异常");
      setErrorText("模型初始化异常，请刷新重试。");
      pushLog(`系统异常：${String(err?.message || err)}`);
      setIsLoading(false);
    });

    const onResize = () => {
      syncCanvasSize();
      renderOverlayFrame();
    };
    window.addEventListener("resize", onResize);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("resize", onResize);
      stopLoop();
      disposePoseDetector();
      releaseVideoResource();
    };
  }, [pushLog, releaseVideoResource, renderOverlayFrame, stopLoop, syncCanvasSize]);

  useEffect(() => {
    syncCanvasSize();
    renderOverlayFrame();
  }, [privacyMode, renderOverlayFrame, syncCanvasSize]);

  useEffect(() => {
    if (!Number.isFinite(angle)) return undefined;
    const timer = setTimeout(() => {
      const now = Date.now();
      if (now - lastUiCalibrationLogAtRef.current >= 2500) {
        pushLog("[UI 部门]: 核心指标已完成高精度渲染校准。");
        lastUiCalibrationLogAtRef.current = now;
      }
    }, 720);
    return () => clearTimeout(timer);
  }, [angle, pushLog]);

  useEffect(() => {
    const wrap = videoWrapRef.current;
    const videoEl = videoRef.current;
    if (!wrap || !videoEl || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      syncCanvasSize();
      renderOverlayFrame();
    });
    observer.observe(wrap);
    observer.observe(videoEl);

    return () => observer.disconnect();
  }, [renderOverlayFrame, syncCanvasSize]);

  const updateSessionStats = useCallback((metrics, advice, confidenceScore) => {
    const stats = sessionStatsRef.current;
    const now = Date.now();
    if (!stats.startAt) stats.startAt = now;
    stats.endAt = now;
    stats.validFrames += 1;
    stats.torsoSum += metrics.torsoLeanAngle;
    stats.torsoMin = Math.min(stats.torsoMin, metrics.torsoLeanAngle);
    stats.torsoMax = Math.max(stats.torsoMax, metrics.torsoLeanAngle);
    stats.kneeFlexMin = Math.min(stats.kneeFlexMin, metrics.kneeFlexionAngle);
    stats.kneeFlexMax = Math.max(stats.kneeFlexMax, metrics.kneeFlexionAngle);
    if (advice.isAbnormal) stats.abnormalFrames += 1;
    if (advice.issueTag === "stiff_knee") stats.stiffKneeFrames += 1;
    if (advice.issueTag === "back_lean") stats.backLeanFrames += 1;
    if (advice.issueTag === "over_lean" || advice.issueTag === "over_lean_severe") stats.overLeanFrames += 1;

    if (stats.frames.length < 1200) {
      stats.frames.push({
        torsoLeanAngle: metrics.torsoLeanAngle,
        kneeFlexionAngle: metrics.kneeFlexionAngle,
        confidenceScore: Number(confidenceScore.toFixed(4)),
        isAbnormal: advice.isAbnormal,
      });
    }
  }, []);

  const analyzeFrame = useCallback(async () => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.readyState < 2 || videoEl.paused || videoEl.ended) return;
    if (isAnalyzingRef.current) return;

    frameCountRef.current += 1;
    if (frameCountRef.current % ANALYZE_EVERY_NTH_FRAME !== 0) return;

    isAnalyzingRef.current = true;
    try {
      const imageBitmap = await createImageBitmap(videoEl);
      const poseResult = await detectPoseFromVideo({
        imageBitmap,
        frameWidth: videoEl.videoWidth,
        frameHeight: videoEl.videoHeight,
        timestampMs: performance.now(),
      });

      if (!isMountedRef.current) return;

      if (!poseResult.ok) {
        setStatus("Logic 部门：识别未通过，保持上一帧结果");
        setErrorText(poseResult.error.message);
        pushLog(`Logic 部门提示：${poseResult.error.message}`);

        if (poseResult.error.code === "LOW_CONFIDENCE") {
          const lowCount = poseResult.error?.details?.lowConfidenceJoints?.length || 0;
          const completeness = ((4 - lowCount) / 4) * 100;
          if (completeness < QUALITY_WARN_THRESHOLD) {
            setQualityWarning("视频质量不佳（人体完整度低于 70%），分析结果可能不准。");
          }
        }
        return;
      }

      setErrorText("");
      setStatus("Analysis 部门：正在计算指标并生成建议");

      const points = {
        shoulder: { x: poseResult.data.shoulder.pixelX, y: poseResult.data.shoulder.pixelY },
        hip: { x: poseResult.data.hip.pixelX, y: poseResult.data.hip.pixelY },
        knee: { x: poseResult.data.knee.pixelX, y: poseResult.data.knee.pixelY },
        ankle: { x: poseResult.data.ankle.pixelX, y: poseResult.data.ankle.pixelY },
      };

      const confidenceScore = mean([
        poseResult.data.shoulder.confidence || 0,
        poseResult.data.hip.confidence || 0,
        poseResult.data.knee.confidence || 0,
        poseResult.data.ankle.confidence || 0,
      ]);
      const completeness = confidenceScore * 100;
      if (completeness < QUALITY_WARN_THRESHOLD) {
        setQualityWarning("视频质量不佳（人体完整度低于 70%），分析结果可能不准。");
      } else {
        setQualityWarning("");
      }

      const metrics = buildGaitMetrics(points);
      const advice = getGaitAdvice(metrics);
      const skeletonAlert = getSkeletonAlert(metrics);
      const finalAdvice = { ...advice, skeletonAlert };
      latestAlertLevelRef.current = skeletonAlert.alertLevel;
      setCanvasAlertLevel(skeletonAlert.alertLevel);

      setAngle(metrics.torsoLeanAngle);
      setCoachAdvice(finalAdvice);
      setStatus("UI 部门：仪表盘、骨架层、教练点评已刷新");

      latestSkeletonRef.current = points;
      latestFrameSizeRef.current = {
        width: poseResult.meta?.frameSize?.width || videoEl.videoWidth,
        height: poseResult.meta?.frameSize?.height || videoEl.videoHeight,
      };
      drawSkeletonOnCanvas(points, latestFrameSizeRef.current, skeletonAlert.alertLevel);
      updateSessionStats(metrics, finalAdvice, confidenceScore);

      const elapsed = poseResult.meta?.elapsedMs ?? 0;
      pushLog(`[Performance] 当前 AI 处理耗时：${elapsed} ms`);

      if (finalAdvice.isAbnormal) {
        const now = Date.now();
        if (now - lastAbnormalLogAtRef.current > ABNORMAL_LOG_COOLDOWN_MS) {
          pushLog("[Analysis 部门]：识别到异常跑姿，已发送纠正建议至 UI 部门。");
          lastAbnormalLogAtRef.current = now;
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setStatus("系统：处理异常");
      setErrorText("本帧处理失败，已自动跳过。");
      pushLog(`系统异常：${String(err?.message || err)}`);
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [drawSkeletonOnCanvas, pushLog, updateSessionStats]);

  const scheduleWithRaf = useCallback(() => {
    const tick = async () => {
      await analyzeFrame();
      renderOverlayFrameForLoop();
      if (!isMountedRef.current) return;
      const videoEl = videoRef.current;
      if (videoEl && !videoEl.paused && !videoEl.ended) rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [analyzeFrame, renderOverlayFrameForLoop]);

  const scheduleWithVideoFrameCallback = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || typeof videoEl.requestVideoFrameCallback !== "function") {
      scheduleWithRaf();
      return;
    }
    const tick = async () => {
      await analyzeFrame();
      renderOverlayFrameForLoop();
      if (!isMountedRef.current) return;
      if (!videoEl.paused && !videoEl.ended) vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
    };
    vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
  }, [analyzeFrame, renderOverlayFrameForLoop, scheduleWithRaf]);

  const startLoop = useCallback(() => {
    stopLoop();
    frameCountRef.current = 0;
    scheduleWithVideoFrameCallback();
  }, [scheduleWithVideoFrameCallback, stopLoop]);

  useEffect(() => {
    if (!isVideoPlaying) return;
    startLoop();
  }, [isMobileView, isVideoPlaying, startLoop]);

  const buildLocalSummary = useCallback(() => {
    const s = sessionStatsRef.current;
    if (s.validFrames === 0) {
      return "本次还没有采集到有效跑姿帧。先播放视频几秒钟，再点“一键保存报告”。";
    }
    const avgTorso = safeDivide(s.torsoSum, s.validFrames);
    const abnormalRate = safeDivide(s.abnormalFrames * 100, s.validFrames);
    const durationSec = s.startAt && s.endAt ? Math.max(1, Math.round((s.endAt - s.startAt) / 1000)) : 0;

    return [
      `本次视频共分析 ${s.validFrames} 帧（约 ${durationSec} 秒），异常帧占比约 ${abnormalRate.toFixed(1)}%。`,
      `躯干前倾平均约 ${avgTorso.toFixed(1)}°，范围 ${s.torsoMin.toFixed(1)}° ~ ${s.torsoMax.toFixed(1)}°。`,
      `膝盖弯曲度范围 ${s.kneeFlexMin.toFixed(1)}° ~ ${s.kneeFlexMax.toFixed(1)}°。`,
      "本地教练总结：先把步子略收小，保持核心稳定，落地时让膝盖像弹簧先松一点，再逐步提速。",
    ].join("\n");
  }, []);

  const buildCoachMetricsPayload = useCallback(() => {
    const s = sessionStatsRef.current;
    const sampleSeconds = s.startAt && s.endAt ? Math.max(1, Math.round((s.endAt - s.startAt) / 1000)) : 0;
    const threshold = 0.6;
    const filteredFrames = s.frames.filter((frame) => Number(frame.confidenceScore) >= threshold);
    const torsoSeries = filteredFrames.map((frame) => Number(frame.torsoLeanAngle) || 0);
    const kneeSeries = filteredFrames.map((frame) => Number(frame.kneeFlexionAngle) || 0);
    const keptFrameCount = filteredFrames.length;
    const abnormalCount = filteredFrames.filter((frame) => frame.isAbnormal).length;

    return {
      frameCount: s.validFrames,
      keptFrameCount,
      sampleSeconds,
      denoiseThreshold: threshold,
      abnormalRate: safeDivide(abnormalCount * 100, keptFrameCount),
      torsoLeanAvg: mean(torsoSeries),
      torsoLeanMin: torsoSeries.length ? Math.min(...torsoSeries) : 0,
      torsoLeanMax: torsoSeries.length ? Math.max(...torsoSeries) : 0,
      torsoLeanCv: coeffOfVariation(torsoSeries),
      kneeFlexionAvg: mean(kneeSeries),
      kneeFlexionMin: kneeSeries.length ? Math.min(...kneeSeries) : 0,
      kneeFlexionMax: kneeSeries.length ? Math.max(...kneeSeries) : 0,
      kneeFlexionCv: coeffOfVariation(kneeSeries),
    };
  }, []);

  const buildReportPayload = useCallback((detailsText, sourceLabel) => {
    const stats = sessionStatsRef.current;
    const score = buildScore(stats);
    const tags = buildRiskTags(stats);
    const summary = detailsText.split("\n").slice(0, 3).join("\n");
    const frameCount = stats.validFrames || 0;
    const abnormalRatePercent = safeDivide(stats.abnormalFrames * 100, frameCount);
    const torsoLeanAvg = safeDivide(stats.torsoSum, frameCount);

    return {
      score,
      tags,
      summary: summary || "暂无摘要",
      details: detailsText || "暂无详情",
      source: sourceLabel,
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      metrics: {
        frameCount,
        abnormalRatePercent,
        torsoLeanAvg,
        torsoLeanMin: Number.isFinite(stats.torsoMin) ? stats.torsoMin : 0,
        torsoLeanMax: Number.isFinite(stats.torsoMax) ? stats.torsoMax : 0,
        kneeFlexionMin: Number.isFinite(stats.kneeFlexMin) ? stats.kneeFlexMin : 0,
        kneeFlexionMax: Number.isFinite(stats.kneeFlexMax) ? stats.kneeFlexMax : 0,
      },
    };
  }, []);

  const handleSaveReport = useCallback(async () => {
    if (isDeepAnalyzing) return;
    const localSummary = buildLocalSummary();
    const metricsPayload = buildCoachMetricsPayload();
    if (metricsPayload.keptFrameCount <= 0) {
      setReportText(localSummary);
      setReportPayload(buildReportPayload(localSummary, "本地规则回退"));
      setShowReport(true);
      setSaveNotice("有效高置信度帧不足（<0.6 已过滤），已回退本地总结。");
      setStatus("系统：已回退本地总结");
      pushLog("系统容错：高置信度帧不足，已使用本地规则生成报告。");
      return;
    }

    setSaveNotice("");
    setIsDeepAnalyzing(true);
    setStatus("系统：教练正在深度分析...");
    pushLog("UI 部门：已向云端教练发起深度分析请求。");

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: metricsPayload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.ok || !data?.report) throw new Error(data?.error || "Empty report");

      const cloudReport = data.report;
      setReportText(cloudReport);
      setReportPayload(buildReportPayload(cloudReport, data.provider || "云端教练"));
      setShowReport(true);
      setSaveNotice("云端教练报告已生成，正在展示深度诊断弹窗。");
      setStatus("UI 部门：云端报告已刷新");
      pushLog("Analysis 部门：云端教练返回成功，报告已渲染。");
    } catch (err) {
      setReportText(localSummary);
      setReportPayload(buildReportPayload(localSummary, "本地规则回退"));
      setShowReport(true);
      setSaveNotice("云端教练暂时不可用，已自动回退本地总结并展示报告。");
      setStatus("系统：已回退本地总结");
      pushLog(`系统容错：云端失败，已回退本地建议（${String(err?.message || err)}）`);
    } finally {
      setIsDeepAnalyzing(false);
    }
  }, [buildCoachMetricsPayload, buildLocalSummary, buildReportPayload, isDeepAnalyzing, pushLog]);

  const handleTogglePlay = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoUrl) return;
    if (videoEl.paused || videoEl.ended) {
      void videoEl.play();
    } else {
      videoEl.pause();
    }
  }, [videoUrl]);

  const handleSeekVideo = useCallback((nextTime) => {
    const videoEl = videoRef.current;
    if (!videoEl || !Number.isFinite(nextTime)) return;
    const safeTime = Math.max(0, Math.min(videoEl.duration || 0, nextTime));
    videoEl.currentTime = safeTime;
    setVideoCurrentTime(safeTime);
  }, []);

  const handleGestureTap = useCallback(
    (side) => {
      const now = Date.now();
      const prev = lastTapRef.current;
      const isDoubleTap = prev.side === side && now - prev.at <= DOUBLE_TAP_WINDOW_MS;
      lastTapRef.current = { side, at: now };
      if (!isDoubleTap) return;

      const videoEl = videoRef.current;
      if (!videoEl) return;
      const delta = side === "left" ? -5 : 5;
      const nextTime = (videoEl.currentTime || 0) + delta;
      handleSeekVideo(nextTime);
      pushLog(`[UI 部门]: 手势跳转 ${side === "left" ? "快退" : "快进"} 5 秒`);
    },
    [handleSeekVideo, pushLog]
  );

  const applyVideoFile = useCallback(
    (file) => {
      if (!file || !file.type?.startsWith("video/")) {
        setErrorText("请上传视频文件（mp4/mov/webm）。");
        return;
      }
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      const nextUrl = URL.createObjectURL(file);
      fileUrlRef.current = nextUrl;
      lastStableVideoSrcRef.current = nextUrl;
      setVideoUrl(nextUrl);
      setAngle(null);
      setErrorText("");
      setQualityWarning("");
      setReportText("");
      setSaveNotice("");
      setShowReport(false);
      setIsVideoPlaying(false);
      setVideoCurrentTime(0);
      setVideoDuration(0);
      setCoachAdvice({
        ...createInitialAdvice(),
        currentStatus: "【当前状态】视频已加载，等待有效跑姿帧。",
        action: "【一句话改进动作】点击播放后，系统会实时给你教练点评。",
      });
      latestSkeletonRef.current = null;
      latestFrameSizeRef.current = { width: 0, height: 0 };
      latestAlertLevelRef.current = "normal";
      setCanvasAlertLevel("normal");
      lastCanvasGapRef.current = null;
      resetSessionStats();
      clearCanvas();
      setStatus("UI 部门：视频已载入，等待播放");
      pushLog(`UI 部门：收到新视频 ${file.name}`);
    },
    [clearCanvas, pushLog, resetSessionStats]
  );

  const handleFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) applyVideoFile(file);
  }, [applyVideoFile]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) applyVideoFile(file);
  }, [applyVideoFile]);

  return (
    <section
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: isMobileView ? "20px 14px 28px" : "22px 16px 28px",
        color: theme.text,
        fontFamily: "Rajdhani, Noto Sans SC, Microsoft YaHei, sans-serif",
      }}
    >
      <style>{`
        @keyframes blinkDots {
          0% { opacity: 0.2; }
          50% { opacity: 1; }
          100% { opacity: 0.2; }
        }
        @keyframes skeletonPulse {
          0% { filter: drop-shadow(0 0 2px rgba(255,59,95,.45)) drop-shadow(0 0 5px rgba(255,59,95,.35)); }
          50% { filter: drop-shadow(0 0 5px rgba(255,59,95,.8)) drop-shadow(0 0 12px rgba(255,59,95,.65)); }
          100% { filter: drop-shadow(0 0 2px rgba(255,59,95,.45)) drop-shadow(0 0 5px rgba(255,59,95,.35)); }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: "#fff",
            textShadow: "0 0 5px #fff, 0 0 10px #00f3ff, 0 0 15px #00f3ff, 0 0 20px #e0aaff",
          }}
        >
          PB Vision <span style={{ color: "#22c55e", textShadow: "0 0 6px #22c55e, 0 0 10px #22c55e" }}>·</span> Sports Tech
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            style={{
              background: "transparent",
              border: `1px solid ${theme.border}`,
              color: theme.subText,
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            {showLogs ? "隐藏架构日志" : "显示架构日志"}
          </button>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
        style={{
          border: `1px dashed ${isDragging ? theme.accent : theme.border}`,
          borderRadius: 14,
          padding: "22px 18px",
          marginBottom: 16,
          background: isDragging ? "#0c1f2d" : theme.panelBg2,
          cursor: "pointer",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.45, letterSpacing: isMobileView ? 0.2 : 0 }}>
          拖拽视频到这里，或点击选择文件
        </div>
        <div style={{ fontSize: 13, color: theme.subText, marginTop: 6, lineHeight: 1.7, letterSpacing: isMobileView ? 0.15 : 0 }}>
          智能拍摄助手：请确保摄影机与跑者呈 90° 侧面，光线充足，且全身入镜。
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileChange} style={{ display: "none" }} />
      </div>

      <div
        style={{
          marginBottom: 16,
          border: `1px solid #194256`,
          borderRadius: 12,
          padding: "10px 12px",
          background: "#091725",
          color: "#9ff7ff",
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        <span style={{ color: theme.accent, marginRight: 6 }}>🔒</span>
        隐私安全：全本地分析，视频不上传，肖像不存留。
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: isMobileView ? "1fr" : "2fr 1fr",
          alignItems: "start",
        }}
      >
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.panelBg }}>
          <div ref={videoWrapRef} className="video-container" style={{ position: "relative", width: "100%", overflow: "hidden" }}>
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              controls={false}
              preload="metadata"
              style={{
                width: "100%",
                height: "auto",
                borderRadius: 10,
                background: "#070c12",
                display: "block",
                position: "relative",
                zIndex: 1,
                opacity: 1,
                filter: "none",
                accentColor: theme.accent,
              }}
              onLoadedData={() => {
                setStatus("UI 部门：视频可播放，等待点击播放");
                pushLog("UI 部门：视频帧准备完成。");
                lastStableVideoSrcRef.current = videoRef.current?.currentSrc || videoRef.current?.src || fileUrlRef.current;
                setVideoDuration(videoRef.current?.duration || 0);
                syncCanvasSize();
                renderOverlayFrame();
              }}
              onLoadedMetadata={() => {
                setVideoDuration(videoRef.current?.duration || 0);
              }}
              onTimeUpdate={() => {
                setVideoCurrentTime(videoRef.current?.currentTime || 0);
              }}
              onPlay={() => {
                setIsVideoPlaying(true);
                setStatus("系统：播放中，开始异步分析");
                pushLog("系统：按帧抓图并发给 Worker（每 3 帧分析 1 次）。");
                startLoop();
              }}
              onPause={() => {
                setIsVideoPlaying(false);
                stopLoop();
                setStatus("系统：视频已暂停，分析循环停止");
                pushLog("系统：已暂停分析。");
              }}
              onEnded={() => {
                setIsVideoPlaying(false);
                stopLoop();
                setStatus("系统：视频播放结束");
                pushLog("系统：分析结束。");
                latestAlertLevelRef.current = "normal";
                setCanvasAlertLevel("normal");
                setVideoCurrentTime(0);
                setVideoDuration(0);
                releaseVideoResource();
                clearCanvas();
              }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                zIndex: 2,
                borderRadius: 10,
                background: "transparent",
                animation: canvasAlertLevel === "normal" ? "none" : "skeletonPulse 1.1s ease-in-out infinite",
              }}
            />
            <button
              type="button"
              aria-label="双击快退5秒"
              onPointerUp={() => handleGestureTap("left")}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "32%",
                height: "100%",
                zIndex: 4,
                border: "none",
                background: "transparent",
                cursor: videoUrl ? "pointer" : "default",
                display: videoUrl ? "block" : "none",
              }}
            />
            <button
              type="button"
              aria-label="双击快进5秒"
              onPointerUp={() => handleGestureTap("right")}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: "32%",
                height: "100%",
                zIndex: 4,
                border: "none",
                background: "transparent",
                cursor: videoUrl ? "pointer" : "default",
                display: videoUrl ? "block" : "none",
              }}
            />
          </div>
          <CyberVideoControls
            isPlaying={isVideoPlaying}
            currentTime={videoCurrentTime}
            duration={videoDuration}
            onTogglePlay={handleTogglePlay}
            onSeek={handleSeekVideo}
            privacyMode={privacyMode}
            onTogglePrivacy={() => setPrivacyMode((v) => !v)}
            disabled={!videoUrl}
          />
        </div>

        <aside style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.panelBg }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>实时仪表盘</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobileView ? "repeat(3, minmax(0, 1fr))" : "1fr",
              gap: 10,
            }}
          >
            <div
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: "10px 12px",
                background: "#0a1622",
              }}
            >
              <div style={{ fontSize: 12, color: theme.subText }}>躯干前倾角</div>
              <div style={{ fontSize: isMobileView ? 24 : 42, fontWeight: 800, color: angleColor, lineHeight: 1.1 }}>
                {angle == null ? "--" : `${animatedAngle.toFixed(2)}°`}
              </div>
            </div>
            <div
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: "10px 12px",
                background: "#0a1622",
              }}
            >
              <div style={{ fontSize: 12, color: theme.subText }}>实时评分</div>
              <div style={{ fontSize: isMobileView ? 24 : 32, fontWeight: 800, color: theme.accent, lineHeight: 1.1 }}>
                {Math.round(animatedScore)}
              </div>
            </div>
            <div
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: "10px 12px",
                background: "#0a1622",
              }}
            >
              <div style={{ fontSize: 12, color: theme.subText }}>异常帧</div>
              <div style={{ fontSize: isMobileView ? 24 : 32, fontWeight: 800, color: "#ff8d8d", lineHeight: 1.1 }}>
                {Math.round(animatedAbnormalFrames)}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: theme.subText, marginTop: 8 }}>正常骨架荧光蓝，异常骨架荧光红脉冲</div>
          <div style={{ marginTop: 10, fontSize: 13 }}>状态：{status}</div>

          {qualityWarning ? <div style={{ marginTop: 8, color: theme.warn, fontSize: 13 }}>质量自检：{qualityWarning}</div> : null}
          {isLoading ? (
            <div style={{ marginTop: 10, color: theme.accent, fontSize: 13 }}>
              模型加载中 <LoadingDots />
            </div>
          ) : null}
          {errorText ? <div style={{ marginTop: 10, color: theme.danger, fontSize: 13 }}>提示：{errorText}</div> : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={handleSaveReport}
              disabled={isDeepAnalyzing}
              style={{
                flex: 1,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                fontWeight: 700,
                background: "#102236",
                color: theme.text,
                cursor: isDeepAnalyzing ? "not-allowed" : "pointer",
                opacity: isDeepAnalyzing ? 0.7 : 1,
              }}
            >
              {isDeepAnalyzing ? "教练深度分析中..." : "一键保存报告"}
            </button>
            <button
              type="button"
              onClick={() => setShowReport(true)}
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                fontWeight: 700,
                background: "#0d1826",
                color: theme.text,
                cursor: "pointer",
              }}
            >
              查看报告
            </button>
          </div>
          {saveNotice ? <div style={{ marginTop: 8, fontSize: 12, color: theme.accent }}>{saveNotice}</div> : null}
        </aside>
      </div>

      <div style={{ marginTop: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.panelBg, padding: 14 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 22 }}>教练点评区</h3>
        <div style={{ fontSize: 16, color: theme.text, lineHeight: 1.7 }}>{coachAdvice.currentStatus}</div>
        <div style={{ fontSize: 16, color: "#ff8d8d", lineHeight: 1.7 }}>{coachAdvice.potentialRisk}</div>
        <div style={{ fontSize: 17, color: theme.accent, fontWeight: 700, lineHeight: 1.8 }}>{coachAdvice.action}</div>
      </div>

      <div style={{ marginTop: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.panelBg, padding: 12 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>教练总结文本</h3>
        {isDeepAnalyzing ? (
          <div style={{ fontSize: 14, color: theme.accent }}>
            教练正在深度分析... <LoadingDots />
          </div>
        ) : (
          <div style={{ fontSize: 14, color: theme.text, whiteSpace: "pre-wrap" }}>
            {reportText || "点击“一键保存报告”后，这里会生成本次跑姿训练总结。"}
          </div>
        )}
      </div>

      {showReport ? (
        <ReportModal open={showReport} onClose={() => setShowReport(false)} payload={reportPayload} onUiLog={pushLog} />
      ) : null}

      {showLogs ? (
        <div style={{ marginTop: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.panelBg, padding: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>架构日志（可折叠）</h3>
          <div style={{ fontSize: 13, color: theme.subText, minHeight: 120 }}>
            {logs.length === 0 ? (
              <div>日志还没开始，先上传并播放一个视频。</div>
            ) : (
              logs.map((line, index) => (
                <div key={`${line}-${index}`} style={{ marginBottom: 4 }}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
