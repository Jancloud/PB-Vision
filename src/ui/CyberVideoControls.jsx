"use client";

import { Lock, Pause, Play, Unlock } from "lucide-react";

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function CyberVideoControls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  privacyMode,
  onTogglePrivacy,
  disabled = false,
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progress = safeDuration ? Math.min(100, Math.max(0, (currentTime / safeDuration) * 100)) : 0;

  return (
    <div
      className="no-print"
      style={{
        marginTop: 10,
        border: "1px solid #1f3f57",
        borderRadius: 10,
        padding: "8px 10px",
        background: "#071321",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="跳转进度"
        onClick={(event) => {
          if (disabled || !safeDuration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          onSeek(ratio * safeDuration);
        }}
        onKeyDown={(event) => {
          if (disabled || !safeDuration) return;
          if (event.key === "ArrowRight") onSeek(Math.min(safeDuration, currentTime + 3));
          if (event.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 3));
        }}
        style={{
          position: "relative",
          height: 6,
          borderRadius: 999,
          background: "#0f2434",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${progress}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, #00f3ff, #66fbff)",
            boxShadow: "0 0 10px rgba(0,243,255,.55)",
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={onTogglePlay}
            style={{
              width: 34,
              height: 34,
              border: "1px solid #00f3ff",
              borderRadius: 8,
              background: "#0a2033",
              color: "#00f3ff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div style={{ color: "#8fc9e3", fontSize: 12, minWidth: 94 }}>
            {formatTime(currentTime)} / {formatTime(safeDuration)}
          </div>
        </div>

        <button
          type="button"
          onClick={onTogglePrivacy}
          style={{
            border: `1px solid ${privacyMode ? "#00f3ff" : "#2b465f"}`,
            borderRadius: 8,
            padding: "6px 10px",
            background: privacyMode ? "#0b2b35" : "#0c1622",
            color: privacyMode ? "#00f3ff" : "#8fc9e3",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {privacyMode ? <Lock size={14} /> : <Unlock size={14} />}
          {privacyMode ? "匿名模式 开" : "匿名模式 关"}
        </button>
      </div>
    </div>
  );
}
