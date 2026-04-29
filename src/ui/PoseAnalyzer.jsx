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
import ReportView from "./ReportView";

const ANALYZE_EVERY_NTH_FRAME = 3;
const ABNORMAL_LOG_COOLDOWN_MS = 1500;
const QUALITY_WARN_THRESHOLD = 70;

const theme = {
  panelBg: "#151b22",
  panelBg2: "#10161d",
  border: "#232d38",
  text: "#e8f0fa",
  subText: "#93a4b7",
  accent: "#31ff9a",
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
  const latestSkeletonRef = useRef(null);
  const latestFrameSizeRef = useRef({ width: 0, height: 0 });
  const latestLineColorRef = useRef(theme.accent);
  const sessionStatsRef = useRef(createInitialStats());

  const [videoUrl, setVideoUrl] = useState("");
  const [status, setStatus] = useState("等待上传视频");
  const [errorText, setErrorText] = useState("");
  const [qualityWarning, setQualityWarning] = useState("");
  const [logs, setLogs] = useState([]);
  const [angle, setAngle] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState(createInitialAdvice);
  const [reportText, setReportText] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [reportPayload, setReportPayload] = useState({
    score: 0,
    tags: [],
    summary: "",
    details: "",
    source: "本地规则",
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

  const resetSessionStats = useCallback(() => {
    sessionStatsRef.current = createInitialStats();
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const syncCanvasSize = useCallback(() => {
    const wrap = videoWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }, []);

  const drawSkeletonOnCanvas = useCallback(
    (points, frameSize, lineColor) => {
      const canvas = canvasRef.current;
      const wrap = videoWrapRef.current;
      if (!canvas || !wrap || !points || !frameSize?.width || !frameSize?.height) return;

      syncCanvasSize();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const displayWidth = wrap.clientWidth;
      const displayHeight = wrap.clientHeight;
      const sx = displayWidth / frameSize.width;
      const sy = displayHeight / frameSize.height;
      const dpr = window.devicePixelRatio || 1;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      const mapped = {
        shoulder: { x: points.shoulder.x * sx, y: points.shoulder.y * sy },
        hip: { x: points.hip.x * sx, y: points.hip.y * sy },
        knee: { x: points.knee.x * sx, y: points.knee.y * sy },
        ankle: { x: points.ankle.x * sx, y: points.ankle.y * sy },
      };

      ctx.strokeStyle = lineColor || theme.accent;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(mapped.shoulder.x, mapped.shoulder.y);
      ctx.lineTo(mapped.hip.x, mapped.hip.y);
      ctx.lineTo(mapped.knee.x, mapped.knee.y);
      ctx.lineTo(mapped.ankle.x, mapped.ankle.y);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      [mapped.shoulder, mapped.hip, mapped.knee, mapped.ankle].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    },
    [syncCanvasSize]
  );

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
      if (latestSkeletonRef.current) {
        drawSkeletonOnCanvas(latestSkeletonRef.current, latestFrameSizeRef.current, latestLineColorRef.current);
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("resize", onResize);
      stopLoop();
      disposePoseDetector();
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, [drawSkeletonOnCanvas, pushLog, stopLoop, syncCanvasSize]);

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
      latestLineColorRef.current = skeletonAlert.lineColor;

      setAngle(metrics.torsoLeanAngle);
      setCoachAdvice(finalAdvice);
      setStatus("UI 部门：仪表盘、骨架层、教练点评已刷新");

      latestSkeletonRef.current = points;
      latestFrameSizeRef.current = {
        width: poseResult.meta?.frameSize?.width || videoEl.videoWidth,
        height: poseResult.meta?.frameSize?.height || videoEl.videoHeight,
      };
      drawSkeletonOnCanvas(points, latestFrameSizeRef.current, skeletonAlert.lineColor);
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
      if (!isMountedRef.current) return;
      const videoEl = videoRef.current;
      if (videoEl && !videoEl.paused && !videoEl.ended) rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [analyzeFrame]);

  const scheduleWithVideoFrameCallback = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || typeof videoEl.requestVideoFrameCallback !== "function") {
      scheduleWithRaf();
      return;
    }
    const tick = async () => {
      await analyzeFrame();
      if (!isMountedRef.current) return;
      if (!videoEl.paused && !videoEl.ended) vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
    };
    vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
  }, [analyzeFrame, scheduleWithRaf]);

  const startLoop = useCallback(() => {
    stopLoop();
    frameCountRef.current = 0;
    scheduleWithVideoFrameCallback();
  }, [scheduleWithVideoFrameCallback, stopLoop]);

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
    return {
      frameCount: s.validFrames,
      abnormalRate: safeDivide(s.abnormalFrames * 100, s.validFrames),
      sampleSeconds,
      frames: s.frames,
    };
  }, []);

  const downloadTextReport = useCallback((text) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `running-report-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const buildReportPayload = useCallback((detailsText, sourceLabel) => {
    const stats = sessionStatsRef.current;
    const score = buildScore(stats);
    const tags = buildRiskTags(stats);
    const summary = detailsText.split("\n").slice(0, 3).join("\n");
    return {
      score,
      tags,
      summary: summary || "暂无摘要",
      details: detailsText || "暂无详情",
      source: sourceLabel,
    };
  }, []);

  const handleSaveReport = useCallback(async () => {
    if (isDeepAnalyzing) return;
    const localSummary = buildLocalSummary();
    const metricsPayload = buildCoachMetricsPayload();

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
      setSaveNotice("云端教练报告已生成并保存到本地下载。");
      downloadTextReport(cloudReport);
      setStatus("UI 部门：云端报告已刷新");
      pushLog("Analysis 部门：云端教练返回成功，报告已渲染。");
    } catch (err) {
      setReportText(localSummary);
      setReportPayload(buildReportPayload(localSummary, "本地规则回退"));
      setShowReport(true);
      setSaveNotice("云端教练暂时不可用，已自动回退本地总结并完成保存。");
      downloadTextReport(localSummary);
      setStatus("系统：已回退本地总结");
      pushLog(`系统容错：云端失败，已回退本地建议（${String(err?.message || err)}）`);
    } finally {
      setIsDeepAnalyzing(false);
    }
  }, [buildCoachMetricsPayload, buildLocalSummary, buildReportPayload, downloadTextReport, isDeepAnalyzing, pushLog]);

  const handleDownloadPdf = useCallback(async () => {
    if (isDownloadingPdf) return;
    try {
      setIsDownloadingPdf(true);
      const res = await fetch("/api/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportPayload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "running-diagnostic-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      pushLog("UI 部门：PDF 报告已下载。");
    } catch (err) {
      setErrorText("PDF 下载失败，请稍后重试。");
      pushLog(`系统异常：PDF 下载失败（${String(err?.message || err)}）`);
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [isDownloadingPdf, pushLog, reportPayload]);

  const applyVideoFile = useCallback(
    (file) => {
      if (!file || !file.type?.startsWith("video/")) {
        setErrorText("请上传视频文件（mp4/mov/webm）。");
        return;
      }
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      const nextUrl = URL.createObjectURL(file);
      fileUrlRef.current = nextUrl;
      setVideoUrl(nextUrl);
      setAngle(null);
      setErrorText("");
      setQualityWarning("");
      setReportText("");
      setSaveNotice("");
      setShowReport(false);
      setCoachAdvice({
        ...createInitialAdvice(),
        currentStatus: "【当前状态】视频已加载，等待有效跑姿帧。",
        action: "【一句话改进动作】点击播放后，系统会实时给你教练点评。",
      });
      latestSkeletonRef.current = null;
      latestFrameSizeRef.current = { width: 0, height: 0 };
      latestLineColorRef.current = theme.accent;
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
        padding: "22px 16px 28px",
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
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: 0.5 }}>PB Vision · Sports Tech</h2>
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
          background: isDragging ? "#132222" : theme.panelBg2,
          cursor: "pointer",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>拖拽视频到这里，或点击选择文件</div>
        <div style={{ fontSize: 13, color: theme.subText, marginTop: 6 }}>
          智能拍摄助手：请确保摄影机与跑者呈 90° 侧面，光线充足，且全身入镜。
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileChange} style={{ display: "none" }} />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.panelBg }}>
          <div ref={videoWrapRef} style={{ position: "relative", width: "100%" }}>
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              controls
              preload="metadata"
              style={{ width: "100%", borderRadius: 10, background: "#090d12", display: "block" }}
              onLoadedData={() => {
                setStatus("UI 部门：视频可播放，等待点击播放");
                pushLog("UI 部门：视频帧准备完成。");
                syncCanvasSize();
                clearCanvas();
              }}
              onPlay={() => {
                setStatus("系统：播放中，开始异步分析");
                pushLog("系统：按帧抓图并发给 Worker（每 3 帧分析 1 次）。");
                startLoop();
              }}
              onPause={() => {
                stopLoop();
                setStatus("系统：视频已暂停，分析循环停止");
                pushLog("系统：已暂停分析。");
              }}
              onEnded={() => {
                stopLoop();
                setStatus("系统：视频播放结束");
                pushLog("系统：分析结束。");
              }}
            />
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 10 }} />
          </div>
        </div>

        <aside style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.panelBg }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>实时仪表盘</h3>
          <div style={{ fontSize: 13, color: theme.subText }}>当前帧躯干前倾角</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: angleColor, lineHeight: 1.1 }}>{angle == null ? "--" : `${angle}°`}</div>
          <div style={{ fontSize: 12, color: theme.subText, marginTop: 4 }}>正常骨架亮绿，异常自动变红</div>
          <div style={{ marginTop: 12, fontSize: 13 }}>状态：{status}</div>

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
                background: "#1a2530",
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
                background: "#111821",
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
        <ReportView
          reportScore={reportPayload.score}
          riskTags={reportPayload.tags}
          reportSummary={reportPayload.summary}
          reportDetails={reportPayload.details}
          sourceLabel={reportPayload.source}
          onDownloadPdf={handleDownloadPdf}
          isDownloadingPdf={isDownloadingPdf}
        />
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

