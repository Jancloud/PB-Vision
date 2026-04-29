"use client";

export const POSE_CANVAS_THEME = {
  neonBlue: "#00f3ff",
  neonRed: "#ff3b5f",
  blackMask: "#02050a",
  normalPoint: "#9cf8ff",
};

const CONTROL_BAR_ESTIMATE = 48;

function mapPointToCanvas(point, sx, sy) {
  return { x: point.x * sx, y: point.y * sy };
}

export function resolveCanvasDisplayRect(wrap, videoEl) {
  const width = videoEl?.clientWidth || wrap?.clientWidth || 0;
  const wrapHeight = wrap?.clientHeight || 0;
  const videoHeight = videoEl?.clientHeight || wrapHeight;
  const frameW = videoEl?.videoWidth || 0;
  const frameH = videoEl?.videoHeight || 0;

  if (!width || !videoHeight) {
    return { width: 0, height: 0 };
  }

  if (!frameW || !frameH) {
    const fallbackHeight = Math.max(1, videoHeight - CONTROL_BAR_ESTIMATE);
    return { width, height: fallbackHeight };
  }

  // 画面真实高度按视频长宽比推导，避免把底部 controls 区域覆盖掉。
  const contentHeight = Math.round(width * (frameH / frameW));
  return { width, height: Math.max(1, Math.min(videoHeight, contentHeight)) };
}

export function clearPoseCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export function syncPoseCanvasSize(canvas, wrap, videoEl) {
  if (!canvas || !wrap) return;
  const { width, height } = resolveCanvasDisplayRect(wrap, videoEl);
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
  return { width, height };
}

export function drawPrivacyMask({ canvas, wrap, videoEl }) {
  if (!canvas || !wrap) return;
  syncPoseCanvasSize(canvas, wrap, videoEl);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (!displayWidth || !displayHeight) return;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = POSE_CANVAS_THEME.blackMask;
  ctx.fillRect(0, 0, displayWidth, displayHeight);
  ctx.restore();
}

function resolveStrokeStyle(alertLevel, timestampMs) {
  if (alertLevel === "normal") {
    return {
      strokeColor: POSE_CANVAS_THEME.neonBlue,
      pointColor: POSE_CANVAS_THEME.normalPoint,
      lineWidth: 4,
      shadowColor: "rgba(0, 243, 255, 0.65)",
      shadowBlur: 8,
    };
  }

  // 异常状态使用脉冲值，让荧光红光感更明显。
  const pulse = 0.55 + 0.45 * Math.sin(timestampMs / 160);
  return {
    strokeColor: POSE_CANVAS_THEME.neonRed,
    pointColor: "#ffd6de",
    lineWidth: 4 + pulse * 1.5,
    shadowColor: "rgba(255, 59, 95, 0.95)",
    shadowBlur: 12 + pulse * 16,
  };
}

export function drawPoseSkeleton({
  canvas,
  wrap,
  videoEl,
  points,
  frameSize,
  privacyMode,
  alertLevel,
  timestampMs = performance.now(),
}) {
  if (!canvas || !wrap || !points || !frameSize?.width || !frameSize?.height) return;
  syncPoseCanvasSize(canvas, wrap, videoEl);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const sx = displayWidth / frameSize.width;
  const sy = displayHeight / frameSize.height;
  const dpr = window.devicePixelRatio || 1;

  const shoulder = mapPointToCanvas(points.shoulder, sx, sy);
  const hip = mapPointToCanvas(points.hip, sx, sy);
  const knee = mapPointToCanvas(points.knee, sx, sy);
  const ankle = mapPointToCanvas(points.ankle, sx, sy);

  const style = resolveStrokeStyle(alertLevel, timestampMs);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  if (privacyMode) {
    ctx.fillStyle = POSE_CANVAS_THEME.blackMask;
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  }

  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = style.shadowBlur;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();

  ctx.fillStyle = style.pointColor;
  [shoulder, hip, knee, ankle].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}
