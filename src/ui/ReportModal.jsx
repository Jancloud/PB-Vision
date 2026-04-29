"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bot, Dumbbell, Gauge, X } from "lucide-react";

function easeOutExpo(progress) {
  if (progress >= 1) return 1;
  return 1 - 2 ** (-10 * progress);
}

function useAnimatedNumber(target, options = {}) {
  const { durationMs = 720, decimals = 2, startFromZeroOnFirst = true } = options;
  const [value, setValue] = useState(0);
  const prevTargetRef = useRef(null);
  const currentRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setValue(0);
      prevTargetRef.current = null;
      currentRef.current = 0;
      return undefined;
    }

    const factor = 10 ** decimals;
    const to = Math.round(target * factor) / factor;
    const from = prevTargetRef.current == null && startFromZeroOnFirst ? 0 : currentRef.current;
    let rafId = 0;
    const startAt = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - startAt) / durationMs);
      const eased = easeOutExpo(progress);
      const raw = from + (to - from) * eased;
      const rounded = Math.round(raw * factor) / factor;
      setValue(rounded);
      currentRef.current = rounded;
      if (progress < 1) rafId = requestAnimationFrame(tick);
      else {
        setValue(to);
        currentRef.current = to;
      }
    };

    prevTargetRef.current = to;
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [decimals, durationMs, startFromZeroOnFirst, target]);

  return value;
}

function normalizeMarkdownToBlocks(input) {
  const raw = String(input || "");
  if (!raw.trim()) return [];

  const cleaned = raw
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  return cleaned
    .split(/\n\s*\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildRiskCards(metrics, tags) {
  const m = metrics || {};
  const cards = [];

  if (typeof m.kneeFlexionMin === "number" && m.kneeFlexionMin < 8) {
    cards.push(`膝盖最小弯曲仅 ${m.kneeFlexionMin.toFixed(1)}°，接近硬顶落地风险。`);
  }
  if (typeof m.torsoLeanMax === "number" && m.torsoLeanMax > 15) {
    cards.push(`躯干最大前倾 ${m.torsoLeanMax.toFixed(1)}°，存在前扑负荷风险。`);
  }
  if (typeof m.abnormalRatePercent === "number" && m.abnormalRatePercent > 30) {
    cards.push(`异常帧占比 ${m.abnormalRatePercent.toFixed(1)}%，动作稳定性需优先提升。`);
  }

  if (!cards.length && Array.isArray(tags) && tags.length) {
    return tags.map((t) => `${t}：建议优先做针对性力量与稳定训练。`);
  }
  return cards.length ? cards : ["当前关键风险可控，建议继续巩固核心与步频稳定性。"];
}

const styles = {
  mask: {
    position: "fixed",
    inset: 0,
    background: "rgba(2, 8, 18, 0.82)",
    zIndex: 3000,
    padding: "24px 20px",
    overflowY: "auto",
    scrollBehavior: "smooth",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  },
  modal: {
    maxWidth: 1200,
    margin: "0 auto",
    background: "#0f172a",
    border: "1px solid #00f3ff",
    borderRadius: 16,
    padding: 22,
    color: "#e5f2ff",
    animation: "modalIn .28s ease-out",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 34,
    letterSpacing: 1,
    color: "#00f3ff",
  },
  closeBtn: {
    border: "1px solid #ff3b5f",
    color: "#ff3b5f",
    background: "transparent",
    borderRadius: 10,
    width: 42,
    height: 42,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "1.1fr 1fr",
  },
  panel: {
    border: "1px solid #19324a",
    borderRadius: 14,
    padding: 16,
    background: "#0b1220",
  },
};

export default function ReportModal({ open, onClose, payload }) {
  const score = Number(payload?.score || 0);
  const animatedScore = useAnimatedNumber(score, { durationMs: 780, decimals: 0 });
  const metrics = payload?.metrics || {};
  const torsoAnimated = useAnimatedNumber(Number(metrics.torsoLeanAvg || 0), { durationMs: 760, decimals: 2 });
  const kneeAnimated = useAnimatedNumber(Number(metrics.kneeFlexionMin || 0), { durationMs: 760, decimals: 2 });
  const abnormalAnimated = useAnimatedNumber(Number(metrics.abnormalRatePercent || 0), { durationMs: 760, decimals: 2 });

  const coachBlocks = useMemo(() => normalizeMarkdownToBlocks(payload?.details || payload?.summary), [payload]);
  const riskCards = useMemo(() => buildRiskCards(metrics, payload?.tags), [metrics, payload]);

  if (!open) return null;

  const scoreRingBg = `conic-gradient(#00f3ff ${Math.max(0, Math.min(100, animatedScore))}%, #12324a 0)`;
  const suggestionIcons = [Activity, Dumbbell, Bot];

  return (
    <div style={styles.mask} className="report-mask">
      <style>{`
        @keyframes modalIn {
          0% { opacity: 0; transform: translateY(16px) scale(.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes riskPulse {
          0% { box-shadow: 0 0 0 rgba(255,59,95,0.0); }
          50% { box-shadow: 0 0 16px rgba(255,59,95,0.38); }
          100% { box-shadow: 0 0 0 rgba(255,59,95,0.0); }
        }
        .report-mask::-webkit-scrollbar {
          width: 9px;
        }
        .report-mask::-webkit-scrollbar-thumb {
          background: rgba(0, 243, 255, 0.45);
          border-radius: 8px;
        }
        .report-mask::-webkit-scrollbar-track {
          background: rgba(8, 22, 36, 0.75);
        }
      `}</style>

      <div style={styles.modal} className="report-modal">
        <div
          style={{
            height: 2,
            borderRadius: 99,
            marginBottom: 10,
            background: "linear-gradient(90deg, rgba(0,243,255,.7), rgba(0,243,255,.15), transparent)",
          }}
        />
        <div style={styles.topBar}>
          <h2 style={styles.title}>
            PB-Vision 深度诊断
          </h2>
          <button type="button" onClick={onClose} style={styles.closeBtn} aria-label="关闭报告">
            <X size={18} />
          </button>
        </div>

        <div style={styles.grid}>
          <section style={styles.panel}>
            <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 14 }}>
              <div
                style={{
                  width: 180,
                  height: 180,
                  borderRadius: "50%",
                  background: scoreRingBg,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  style={{
                    width: 138,
                    height: 138,
                    borderRadius: "50%",
                    background: "#0b1220",
                    border: "1px solid #1b3c56",
                    display: "grid",
                    placeItems: "center",
                    color: "#00f3ff",
                    fontSize: 52,
                    fontWeight: 900,
                  }}
                >
                  {Math.round(animatedScore)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 18, color: "#8db4d2", marginBottom: 8 }}>综合评分 / 100</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#b8d4ea", marginBottom: 6 }}>
                  <Gauge size={16} color="#00f3ff" />
                  躯干前倾均值：{torsoAnimated.toFixed(2)}°
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#b8d4ea", marginBottom: 6 }}>
                  <AlertTriangle size={16} color="#ff3b5f" />
                  最小膝盖弯曲：{kneeAnimated.toFixed(2)}°
                </div>
                <div style={{ color: "#b8d4ea" }}>异常帧占比：{abnormalAnimated.toFixed(2)}%</div>
              </div>
            </div>
          </section>

          <section style={styles.panel}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: "#ff7a90", fontSize: 20 }}>核心风险区</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {riskCards.map((text, idx) => (
                <article
                  key={`${text}-${idx}`}
                  style={{
                    border: "1px solid #ff3b5f",
                    background: "linear-gradient(180deg, #2b0f1a 0%, #1a0b13 100%)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    animation: "riskPulse 1.4s ease-in-out infinite",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <AlertTriangle size={16} color="#ff3b5f" />
                    <span style={{ color: "#ffd8df", fontSize: 14 }}>{text}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section style={{ ...styles.panel, marginTop: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 10, color: "#00f3ff", fontSize: 20 }}>教练建议区</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {(coachBlocks.length ? coachBlocks : ["暂无教练建议，请先生成报告。"]).map((line, idx) => {
              const Icon = suggestionIcons[idx % suggestionIcons.length];
              return (
                <div
                  key={`${line}-${idx}`}
                  style={{
                    border: "1px solid #1f3a55",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "#0a1423",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Icon size={16} color="#00f3ff" style={{ marginTop: 2 }} />
                    <div style={{ lineHeight: 1.75, whiteSpace: "pre-wrap", color: "#d5e9f7" }}>{line}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div
          style={{
            marginTop: 16,
            borderTop: "1px solid #173148",
            paddingTop: 12,
          }}
        >
          <div style={{ color: "#83a8c6", fontSize: 13, marginBottom: 6 }}>来源：{payload?.source || "本地规则"} | 时间：{payload?.generatedAt || "-"}</div>
          <div style={{ color: "#9fc6de", fontSize: 13 }}>
            💡 建议：您可以直接截图保存这份诊断报告，或随时在应用中查看。
          </div>
        </div>
      </div>
    </div>
  );
}
