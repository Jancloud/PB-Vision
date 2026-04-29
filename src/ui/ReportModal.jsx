"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Gauge,
  Share2,
  Target,
  TrendingUp,
  X,
} from "lucide-react";

const MOBILE_BREAKPOINT = 768;

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

function parseCoachSections(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = {
    tech: [],
    norm: [],
    train: [],
    retest: [],
    misc: [],
  };

  const headingToKey = (line) => {
    if (/技术诊断/.test(line)) return "tech";
    if (/常模对比/.test(line)) return "norm";
    if (/训练处方/.test(line)) return "train";
    if (/复测目标/.test(line)) return "retest";
    return "";
  };

  let currentKey = "";

  lines.forEach((line) => {
    const normalized = line.replace(/^\s*[【\[]?\s*/, "");
    const nextKey = headingToKey(normalized);
    if (nextKey) {
      currentKey = nextKey;
      const stripped = line
        .replace(/[【\[]\s*(技术诊断|常模对比|训练处方|复测目标)\s*[】\]]\s*[:：]?/g, "")
        .replace(/^(技术诊断|常模对比|训练处方|复测目标)\s*[:：]?/g, "")
        .trim();
      if (stripped) sections[currentKey].push(stripped);
      return;
    }

    if (currentKey) sections[currentKey].push(line);
    else sections.misc.push(line);
  });

  return sections;
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

function sectionButtonStyle(expanded) {
  return {
    width: "100%",
    minHeight: 46,
    border: "1px solid #20445f",
    borderRadius: 12,
    background: expanded ? "rgba(7, 37, 61, 0.78)" : "rgba(7, 25, 42, 0.68)",
    color: "#cde8ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
  };
}

export default function ReportModal({ open, onClose, payload, onUiLog }) {
  const [isMobileView, setIsMobileView] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    tech: false,
    norm: false,
    train: false,
    retest: false,
  });
  const [shareHint, setShareHint] = useState("");
  const hasLoggedSafePaddingRef = useRef(false);

  const score = Number(payload?.score || 0);
  const animatedScore = useAnimatedNumber(score, { durationMs: 780, decimals: 0 });
  const metrics = payload?.metrics || {};
  const torsoAnimated = useAnimatedNumber(Number(metrics.torsoLeanAvg || 0), { durationMs: 760, decimals: 2 });
  const kneeAnimated = useAnimatedNumber(Number(metrics.kneeFlexionMin || 0), { durationMs: 760, decimals: 2 });
  const abnormalAnimated = useAnimatedNumber(Number(metrics.abnormalRatePercent || 0), { durationMs: 760, decimals: 2 });

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
    if (!open) return;
    setExpandedSections({ tech: false, norm: false, train: false, retest: false });
    setShareHint("");
    hasLoggedSafePaddingRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || !isMobileView || hasLoggedSafePaddingRef.current) return;
    const msg = "[UI 监控]: 已应用移动报告底部安全区留白补丁。";
    if (typeof onUiLog === "function") onUiLog(msg);
    else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info(msg);
    }
    hasLoggedSafePaddingRef.current = true;
  }, [isMobileView, onUiLog, open]);

  const coachText = payload?.details || payload?.summary || "";
  const coachBlocks = useMemo(() => normalizeMarkdownToBlocks(coachText), [coachText]);
  const riskCards = useMemo(() => buildRiskCards(metrics, payload?.tags), [metrics, payload]);
  const parsed = useMemo(() => parseCoachSections(coachText), [coachText]);

  const coachSections = useMemo(() => {
    const fallback = coachBlocks.length ? coachBlocks : ["暂无教练建议，请先生成报告。"];
    return [
      {
        key: "tech",
        title: "技术诊断",
        icon: Activity,
        lines: parsed.tech.length ? parsed.tech : fallback.slice(0, 2),
      },
      {
        key: "norm",
        title: "常模对比",
        icon: TrendingUp,
        lines: parsed.norm.length ? parsed.norm : fallback.slice(2, 3),
      },
      {
        key: "train",
        title: "训练处方",
        icon: Dumbbell,
        lines: parsed.train.length ? parsed.train : fallback.slice(3, 5),
      },
      {
        key: "retest",
        title: "复测目标",
        icon: Target,
        lines: parsed.retest.length ? parsed.retest : parsed.misc.slice(0, 2),
      },
    ];
  }, [coachBlocks, parsed]);

  if (!open) return null;

  const scoreRingBg = `conic-gradient(#00f3ff ${Math.max(0, Math.min(100, animatedScore))}%, #12324a 0)`;

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleShareHint = () => {
    setShareHint("建议：用系统截图（iOS 侧键+音量上 / Android 电源键+音量下）保存整页报告。\n若用于训练复盘，建议连同日期与评分一起分享。");
  };

  const maskStyle = {
    position: "fixed",
    inset: 0,
    zIndex: 3000,
    background: "rgba(2, 8, 18, 0.72)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    overflowY: "auto",
    scrollBehavior: "smooth",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  };

  if (isMobileView) {
    return (
      <div style={maskStyle} className="report-mask-mobile">
        <style>{`
          @keyframes mobileReportIn {
            0% { opacity: 0; transform: translateY(10px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes cardPulse {
            0% { box-shadow: 0 0 0 rgba(0,243,255,0.0); }
            50% { box-shadow: 0 0 14px rgba(0,243,255,0.22); }
            100% { box-shadow: 0 0 0 rgba(0,243,255,0.0); }
          }
          .report-mask-mobile::-webkit-scrollbar {
            width: 7px;
          }
          .report-mask-mobile::-webkit-scrollbar-thumb {
            background: rgba(0, 243, 255, 0.45);
            border-radius: 8px;
          }
        `}</style>

        <div
          style={{
            minHeight: "100vh",
            background: "linear-gradient(180deg, #050b14 0%, #0b1624 100%)",
            color: "#e5f2ff",
            animation: "mobileReportIn .24s ease-out",
          }}
        >
          <div style={{ padding: "16px 14px calc(100px + env(safe-area-inset-bottom))" }}>
            <div
              style={{
                textAlign: "center",
                color: "#00f3ff",
                letterSpacing: 3,
                fontSize: 18,
                textShadow: "0 0 6px rgba(0,243,255,.75), 0 0 18px rgba(0,243,255,.45)",
                marginBottom: 14,
                fontWeight: 700,
              }}
            >
              PB-VISION 深度诊断
            </div>

            <section
              style={{
                border: "1px solid rgba(0, 243, 255, 0.55)",
                background: "rgba(9, 20, 36, 0.78)",
                borderRadius: 16,
                padding: "18px 12px 14px",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "grid", placeItems: "center" }}>
                <div
                  style={{
                    width: 270,
                    maxWidth: "78vw",
                    aspectRatio: "1 / 1",
                    borderRadius: "50%",
                    background: scoreRingBg,
                    display: "grid",
                    placeItems: "center",
                    boxShadow: "0 0 24px rgba(0,243,255,.22)",
                  }}
                >
                  <div
                    style={{
                      width: "72%",
                      height: "72%",
                      borderRadius: "50%",
                      background: "#08111d",
                      border: "1px solid rgba(0,243,255,.35)",
                      display: "grid",
                      placeItems: "center",
                      color: "#00f3ff",
                      fontSize: 78,
                      fontWeight: 900,
                      textShadow: "0 0 10px rgba(0,243,255,.5)",
                    }}
                  >
                    {Math.round(animatedScore)}
                  </div>
                </div>
                <div style={{ marginTop: 10, color: "#8fb9d9", fontSize: 13 }}>综合评分 / 100</div>
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <article
                style={{
                  border: "1px solid rgba(0, 243, 255, 0.55)",
                  background: "rgba(11, 39, 62, 0.45)",
                  borderRadius: 14,
                  padding: 10,
                  animation: "cardPulse 1.4s ease-in-out infinite",
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#00f3ff", marginBottom: 6, fontWeight: 700 }}>
                  <AlertTriangle size={14} /> 核心风险区
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {riskCards.slice(0, 2).map((risk, idx) => (
                    <div key={`${risk}-${idx}`} style={{ fontSize: 12, lineHeight: 1.5, color: "#ffd7df" }}>
                      • {risk}
                    </div>
                  ))}
                </div>
              </article>

              <article
                style={{
                  border: "1px solid rgba(0, 243, 255, 0.55)",
                  background: "rgba(11, 39, 62, 0.45)",
                  borderRadius: 14,
                  padding: 10,
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#00f3ff", marginBottom: 6, fontWeight: 700 }}>
                  <Gauge size={14} /> 技术诊断
                </div>
                <div style={{ display: "grid", gap: 5, fontSize: 12, color: "#cde8ff" }}>
                  <div>前倾均值：{torsoAnimated.toFixed(2)}°</div>
                  <div>最小膝弯：{kneeAnimated.toFixed(2)}°</div>
                  <div>异常占比：{abnormalAnimated.toFixed(2)}%</div>
                </div>
              </article>
            </section>

            <section
              style={{
                border: "1px solid rgba(23, 64, 93, 0.95)",
                borderRadius: 14,
                background: "rgba(8, 18, 32, 0.72)",
                padding: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                {coachSections.map((section) => {
                  const Icon = section.icon;
                  const expanded = expandedSections[section.key];
                  return (
                    <div key={section.key}>
                      <button type="button" onClick={() => toggleSection(section.key)} style={sectionButtonStyle(expanded)}>
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <Icon size={15} color="#00f3ff" />
                          {section.title}
                        </span>
                        {expanded ? <ChevronUp size={16} color="#00f3ff" /> : <ChevronDown size={16} color="#00f3ff" />}
                      </button>
                      {expanded ? (
                        <div
                          style={{
                            marginTop: 6,
                            border: "1px solid #1b4560",
                            borderRadius: 10,
                            background: "rgba(7, 16, 28, 0.78)",
                            padding: "9px 10px",
                          }}
                        >
                          {(section.lines.length ? section.lines : ["暂无建议"]).map((line, idx) => (
                            <div key={`${line}-${idx}`} style={{ fontSize: 13, color: "#d5e9f7", lineHeight: 1.65, marginBottom: idx < section.lines.length - 1 ? 6 : 0 }}>
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <div style={{ color: "#83a8c6", fontSize: 12, marginTop: 6 }}>
              来源：{payload?.source || "本地规则"} | 时间：{payload?.generatedAt || "-"}
            </div>
            {shareHint ? (
              <div
                style={{
                  marginTop: 10,
                  border: "1px solid rgba(0,243,255,.45)",
                  borderRadius: 12,
                  background: "rgba(5, 32, 49, .65)",
                  padding: "10px 12px",
                  color: "#b6ebff",
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {shareHint}
              </div>
            ) : null}
          </div>

          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "10px 12px calc(10px + env(safe-area-inset-bottom))",
              background: "rgba(4, 10, 18, 0.94)",
              borderTop: "1px solid rgba(0,243,255,.25)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              zIndex: 8,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                minHeight: 46,
                border: "1px solid #00f3ff",
                borderRadius: 12,
                background: "linear-gradient(90deg, #006f8e, #00a3d0)",
                color: "#e9fdff",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              关闭报告
            </button>
            <button
              type="button"
              onClick={handleShareHint}
              style={{
                minHeight: 46,
                border: "1px solid #00f3ff",
                borderRadius: 12,
                background: "linear-gradient(90deg, #0082b3, #00f3ff)",
                color: "#041118",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Share2 size={16} /> 截屏分享建议
            </button>
          </div>
        </div>
      </div>
    );
  }

  const suggestionIcons = [Activity, Dumbbell, Bot];

  return (
    <div style={{ ...maskStyle, padding: "24px 20px" }} className="report-mask">
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

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#0f172a",
          border: "1px solid #00f3ff",
          borderRadius: 16,
          padding: 22,
          color: "#e5f2ff",
          animation: "modalIn .28s ease-out",
        }}
        className="report-modal"
      >
        <div
          style={{
            height: 2,
            borderRadius: 99,
            marginBottom: 10,
            background: "linear-gradient(90deg, rgba(0,243,255,.7), rgba(0,243,255,.15), transparent)",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 34, letterSpacing: 1, color: "#00f3ff" }}>PB-Vision 深度诊断</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭报告"
            style={{
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
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1.1fr 1fr" }}>
          <section style={{ border: "1px solid #19324a", borderRadius: 14, padding: 16, background: "#0b1220" }}>
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

          <section style={{ border: "1px solid #19324a", borderRadius: 14, padding: 16, background: "#0b1220" }}>
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

        <section style={{ border: "1px solid #19324a", borderRadius: 14, padding: 16, background: "#0b1220", marginTop: 16 }}>
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

        <div style={{ marginTop: 16, borderTop: "1px solid #173148", paddingTop: 12 }}>
          <div style={{ color: "#83a8c6", fontSize: 13, marginBottom: 6 }}>
            来源：{payload?.source || "本地规则"} | 时间：{payload?.generatedAt || "-"}
          </div>
          <div style={{ color: "#9fc6de", fontSize: 13 }}>💡 建议：您可以直接截图保存这份诊断报告，或随时在应用中查看。</div>
        </div>
      </div>
    </div>
  );
}
