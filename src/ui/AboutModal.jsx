"use client";

import { ShieldAlert, Sparkles, X } from "lucide-react";

export default function AboutModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About PB Vision"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3400,
        background: "rgba(3, 10, 20, 0.62)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: "18px 14px",
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: 760,
          margin: "0 auto",
          border: "1px solid rgba(0,243,255,0.45)",
          borderRadius: 16,
          background: "rgba(7, 20, 34, 0.8)",
          color: "#d8ebfa",
          boxShadow: "0 0 24px rgba(0, 243, 255, 0.16)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 14px 10px",
            borderBottom: "1px solid rgba(30, 61, 84, 0.85)",
          }}
        >
          <div style={{ color: "#00f3ff", fontWeight: 800, letterSpacing: 1.2 }}>PB Vision · About</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 About"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid rgba(255, 90, 110, 0.9)",
              color: "#ff5f7a",
              background: "rgba(16, 22, 32, 0.7)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <section
            style={{
              border: "1px solid rgba(0,243,255,0.3)",
              borderRadius: 12,
              background: "rgba(8, 28, 45, 0.46)",
              padding: "11px 12px",
            }}
          >
            <div style={{ color: "#00f3ff", fontWeight: 800, marginBottom: 6 }}>【The Vision】</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#cde3f4" }}>
              作为马拉松跑者，希望把训练中的“动作纠错”做成每个人身边的 AI
              助手。目标不是制造焦虑，而是让每次训练更安全，让每位跑者都能长期、健康地进步。
            </div>
          </section>

          <section
            style={{
              border: "1px solid rgba(0,243,255,0.3)",
              borderRadius: 12,
              background: "rgba(8, 28, 45, 0.46)",
              padding: "11px 12px",
            }}
          >
            <div style={{ color: "#00f3ff", fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={15} />【The Tech】
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#cde3f4" }}>
              前端通过 MediaPipe 提取骨骼关键点，逻辑层只输出标准坐标契约；分析层独立计算跑姿指标；教练层可接
              DeepSeek 生成“人话建议”。核心链路可本地运行，模型层可替换而不影响分析规则。
            </div>
          </section>

          <section
            style={{
              border: "1px solid rgba(255, 90, 110, 0.55)",
              borderRadius: 12,
              background: "rgba(45, 10, 22, 0.55)",
              padding: "11px 12px",
            }}
          >
            <div style={{ color: "#ff97ad", fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <ShieldAlert size={15} />【Safety】
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#ffd7df" }}>
              本系统仅提供运动技术参考，不构成医疗建议或诊断结论。若出现疼痛、伤病或异常症状，请及时咨询专业医生或康复师。
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

