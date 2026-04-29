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

const ANALYZE_EVERY_NTH_FRAME = 3;
const ABNORMAL_LOG_COOLDOWN_MS = 1500;

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
    skeletonAlert: { alertLevel: "normal", lineColor: "#22c55e" },
    metrics: null,
  };
}

export default function PoseAnalyzer() {
  const videoRef = useRef(null);
  const videoWrapRef = useRef(null);
  const canvasRef = useRef(null);
  const fileUrlRef = useRef("");
  const isMountedRef = useRef(true);
  const isAnalyzingRef = useRef(false);
  const frameCountRef = useRef(0);
  const rafIdRef = useRef(null);
  const vfcIdRef = useRef(null);
  const lastAbnormalLogAtRef = useRef(0);
  const latestSkeletonRef = useRef(null);
  const latestFrameSizeRef = useRef({ width: 0, height: 0 });
  const latestLineColorRef = useRef("#22c55e");

  const sessionStatsRef = useRef({
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
  });

  const [videoUrl, setVideoUrl] = useState("");
  const [status, setStatus] = useState("等待上传视频");
  const [errorText, setErrorText] = useState("");
  const [logs, setLogs] = useState([]);
  const [angle, setAngle] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [coachAdvice, setCoachAdvice] = useState(createInitialAdvice);
  const [reportText, setReportText] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

  const pushLog = useCallback((text) => {
    setLogs((prev) => {
      const next = [...prev, `[${formatNow()}] ${text}`];
      return next.length > 30 ? next.slice(next.length - 30) : next;
    });
  }, []);

  const angleColor = useMemo(() => {
    if (angle == null) {
      return "#6b7280";
    }
    return angle >= 5 && angle <= 10 ? "#16a34a" : "#f59e0b";
  }, [angle]);

  const resetSessionStats = useCallback(() => {
    sessionStatsRef.current = {
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
    };
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const syncCanvasSize = useCallback(() => {
    const wrap = videoWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) {
      return;
    }

    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) {
      return;
    }

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

  const drawSkeletonOnCanvas = useCallback((points, frameSize, lineColor) => {
    const canvas = canvasRef.current;
    const wrap = videoWrapRef.current;
    if (!canvas || !wrap || !points || !frameSize?.width || !frameSize?.height) {
      return;
    }

    syncCanvasSize();

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

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

    ctx.strokeStyle = lineColor || "#22c55e";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 连接肩 -> 胯 -> 膝 -> 踝
    ctx.beginPath();
    ctx.moveTo(mapped.shoulder.x, mapped.shoulder.y);
    ctx.lineTo(mapped.hip.x, mapped.hip.y);
    ctx.lineTo(mapped.knee.x, mapped.knee.y);
    ctx.lineTo(mapped.ankle.x, mapped.ankle.y);
    ctx.stroke();

    // 关节点高亮
    ctx.fillStyle = "#ffffff";
    [mapped.shoulder, mapped.hip, mapped.knee, mapped.ankle].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }, [syncCanvasSize]);

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
      if (!isMountedRef.current) {
        return;
      }

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
      if (!isMountedRef.current) {
        return;
      }
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
      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
      }
    };
  }, [drawSkeletonOnCanvas, pushLog, stopLoop, syncCanvasSize]);

  const updateSessionStats = useCallback((metrics, advice) => {
    const stats = sessionStatsRef.current;
    const now = Date.now();
    if (!stats.startAt) {
      stats.startAt = now;
    }
    stats.endAt = now;
    stats.validFrames += 1;
    stats.torsoSum += metrics.torsoLeanAngle;
    stats.torsoMin = Math.min(stats.torsoMin, metrics.torsoLeanAngle);
    stats.torsoMax = Math.max(stats.torsoMax, metrics.torsoLeanAngle);
    stats.kneeFlexMin = Math.min(stats.kneeFlexMin, metrics.kneeFlexionAngle);
    stats.kneeFlexMax = Math.max(stats.kneeFlexMax, metrics.kneeFlexionAngle);

    if (advice.isAbnormal) {
      stats.abnormalFrames += 1;
    }
    if (advice.issueTag === "stiff_knee") {
      stats.stiffKneeFrames += 1;
    }
    if (advice.issueTag === "back_lean") {
      stats.backLeanFrames += 1;
    }
    if (advice.issueTag === "over_lean" || advice.issueTag === "over_lean_severe") {
      stats.overLeanFrames += 1;
    }
  }, []);

  const analyzeFrame = useCallback(async () => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.readyState < 2 || videoEl.paused || videoEl.ended) {
      return;
    }

    if (isAnalyzingRef.current) {
      return;
    }

    frameCountRef.current += 1;
    if (frameCountRef.current % ANALYZE_EVERY_NTH_FRAME !== 0) {
      return;
    }

    isAnalyzingRef.current = true;
    try {
      const imageBitmap = await createImageBitmap(videoEl);
      const poseResult = await detectPoseFromVideo({
        imageBitmap,
        frameWidth: videoEl.videoWidth,
        frameHeight: videoEl.videoHeight,
        timestampMs: performance.now(),
      });

      if (!isMountedRef.current) {
        return;
      }

      if (!poseResult.ok) {
        setStatus("Logic 部门：识别未通过，保持上一帧结果");
        setErrorText(poseResult.error.message);
        pushLog(`Logic 部门提示：${poseResult.error.message}`);
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

      updateSessionStats(metrics, finalAdvice);

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
      if (!isMountedRef.current) {
        return;
      }
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
      if (!isMountedRef.current) {
        return;
      }
      const videoEl = videoRef.current;
      const keepRunning = videoEl && !videoEl.paused && !videoEl.ended;
      if (keepRunning) {
        rafIdRef.current = requestAnimationFrame(tick);
      }
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
      if (!isMountedRef.current) {
        return;
      }
      const keepRunning = !videoEl.paused && !videoEl.ended;
      if (keepRunning) {
        vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
      }
    };
    vfcIdRef.current = videoEl.requestVideoFrameCallback(tick);
  }, [analyzeFrame, scheduleWithRaf]);

  const startLoop = useCallback(() => {
    stopLoop();
    frameCountRef.current = 0;
    scheduleWithVideoFrameCallback();
  }, [scheduleWithVideoFrameCallback, stopLoop]);

  const buildCoachSummary = useCallback(() => {
    const s = sessionStatsRef.current;
    if (s.validFrames === 0) {
      return "本次还没有采集到有效跑姿帧。先播放视频几秒钟，再点“一键保存报告”。";
    }

    const avgTorso = s.torsoSum / s.validFrames;
    const abnormalRate = (s.abnormalFrames / s.validFrames) * 100;
    const durationSec = s.startAt && s.endAt ? Math.max(1, Math.round((s.endAt - s.startAt) / 1000)) : 0;

    let mainIssue = "整体姿态较稳定";
    if (s.stiffKneeFrames >= s.backLeanFrames && s.stiffKneeFrames >= s.overLeanFrames && s.stiffKneeFrames > 0) {
      mainIssue = "落地瞬间膝盖偏硬（易受伤风险）";
    } else if (s.backLeanFrames >= s.overLeanFrames && s.backLeanFrames > 0) {
      mainIssue = "躯干偏直/后仰趋势";
    } else if (s.overLeanFrames > 0) {
      mainIssue = "躯干前倾偏大";
    }

    return [
      `本次视频共分析 ${s.validFrames} 帧（约 ${durationSec} 秒），异常帧占比约 ${abnormalRate.toFixed(1)}%。`,
      `你的躯干前倾平均约 ${avgTorso.toFixed(1)}°，波动范围 ${s.torsoMin.toFixed(1)}° ~ ${s.torsoMax.toFixed(1)}°。`,
      `膝盖弯曲度范围 ${s.kneeFlexMin.toFixed(1)}° ~ ${s.kneeFlexMax.toFixed(1)}°。`,
      `主要问题：${mainIssue}。`,
      "教练总结：先把步子略收小，保持核心稳定，落地时让膝盖像弹簧先松一点，再逐步提速。",
    ].join("\n");
  }, []);

  const handleSaveReport = useCallback(() => {
    const summary = buildCoachSummary();
    setReportText(summary);
    setSaveNotice("报告已生成。");

    // 同时导出 txt 文件，让“保存”动作有明确反馈。
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const filename = `running-report-${stamp}.txt`;
    const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    pushLog("UI 部门：已生成并保存本次教练总结报告。");
  }, [buildCoachSummary, pushLog]);

  const handleFileChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
      }

      const nextUrl = URL.createObjectURL(file);
      fileUrlRef.current = nextUrl;
      setVideoUrl(nextUrl);
      setAngle(null);
      setErrorText("");
      setReportText("");
      setSaveNotice("");
      setCoachAdvice({
        ...createInitialAdvice(),
        currentStatus: "【当前状态】视频已加载，等待有效跑姿帧。",
        action: "【一句话改进动作】点击播放后，系统会实时给你教练点评。",
      });
      latestSkeletonRef.current = null;
      latestFrameSizeRef.current = { width: 0, height: 0 };
      latestLineColorRef.current = "#22c55e";
      resetSessionStats();
      clearCanvas();
      setStatus("UI 部门：视频已载入，等待播放");
      pushLog(`UI 部门：收到新视频 ${file.name}`);
    },
    [clearCanvas, pushLog, resetSessionStats]
  );

  return (
    <section style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <style>{`
        @keyframes blinkDots {
          0% { opacity: 0.2; }
          50% { opacity: 1; }
          100% { opacity: 0.2; }
        }
      `}</style>

      <h2 style={{ fontSize: 24, marginBottom: 12 }}>Pose Analyzer（跑姿分析工作台）</h2>

      <div
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 12,
          padding: 12,
          background: "#f9fafb",
          marginBottom: 16,
        }}
      >
        <label htmlFor="video-upload" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          上传跑步视频（侧面）
        </label>
        <input id="video-upload" type="file" accept="video/*" onChange={handleFileChange} />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            background: "#ffffff",
          }}
        >
          <div ref={videoWrapRef} style={{ position: "relative", width: "100%" }}>
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              controls
              preload="metadata"
              style={{ width: "100%", borderRadius: 8, background: "#111827", display: "block" }}
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
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                borderRadius: 8,
              }}
            />
          </div>
        </div>

        <aside
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            background: "#ffffff",
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>实时仪表盘</h3>
          <div style={{ fontSize: 14, color: "#4b5563", marginBottom: 6 }}>当前帧躯干前倾角</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: angleColor, lineHeight: 1.1 }}>
            {angle == null ? "--" : `${angle}°`}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>正常骨架亮绿，异常自动变橙/红</div>
          <div style={{ marginTop: 12, fontSize: 13, color: "#111827" }}>状态：{status}</div>
          {isLoading ? (
            <div style={{ marginTop: 10, color: "#2563eb", fontSize: 13 }}>
              模型加载中 <LoadingDots />
            </div>
          ) : null}
          {errorText ? (
            <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13 }}>提示：{errorText}</div>
          ) : null}
          <button
            type="button"
            onClick={handleSaveReport}
            style={{
              marginTop: 14,
              width: "100%",
              border: "none",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 700,
              background: "#0f766e",
              color: "#ffffff",
              cursor: "pointer",
              position: "relative",
              zIndex: 5,
            }}
          >
            一键保存报告
          </button>
          {saveNotice ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#065f46" }}>{saveNotice}</div>
          ) : null}
        </aside>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "2px solid #0f766e",
          borderRadius: 12,
          background: "#f0fdfa",
          padding: 14,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 22 }}>教练点评区</h3>
        <div style={{ fontSize: 16, color: "#0f172a", lineHeight: 1.7 }}>{coachAdvice.currentStatus}</div>
        <div style={{ fontSize: 16, color: "#991b1b", lineHeight: 1.7 }}>{coachAdvice.potentialRisk}</div>
        <div style={{ fontSize: 17, color: "#065f46", fontWeight: 700, lineHeight: 1.8 }}>
          {coachAdvice.action}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #d1d5db",
          borderRadius: 12,
          background: "#f8fafc",
          padding: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>教练总结报告</h3>
        <div style={{ fontSize: 14, color: "#1f2937" }}>
          {reportText || "点击“一键保存报告”后，这里会生成本次跑姿训练总结。"}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #d1d5db",
          borderRadius: 12,
          background: "#f8fafc",
          padding: 12,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>架构日志（大白话）</h3>
        <div style={{ fontSize: 13, color: "#374151", minHeight: 160 }}>
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
    </section>
  );
}
