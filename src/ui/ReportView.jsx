"use client";

const styles = {
  card: {
    marginTop: 16,
    border: "1px solid #1c2b3b",
    borderRadius: 16,
    background: "linear-gradient(180deg, #0c1219 0%, #090f16 100%)",
    padding: 16,
  },
  title: {
    margin: 0,
    marginBottom: 10,
    fontSize: 22,
    fontWeight: 800,
    color: "#e8f0fa",
  },
  scoreWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 12,
  },
  score: {
    fontSize: 56,
    lineHeight: 1,
    fontWeight: 900,
    color: "#00f3ff",
    textShadow: "0 0 10px rgba(0, 243, 255, 0.35)",
  },
  scoreLabel: {
    color: "#93a4b7",
    fontSize: 14,
  },
  tagsWrap: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  tag: {
    border: "1px solid #2e3b4a",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    color: "#d3deea",
    background: "#0b121a",
  },
  summary: {
    color: "#dce7f3",
    fontSize: 15,
    lineHeight: 1.7,
    marginBottom: 10,
    whiteSpace: "pre-wrap",
  },
  details: {
    border: "1px solid #2e3b4a",
    borderRadius: 12,
    background: "#0b121a",
    padding: 10,
    color: "#c6d3e3",
  },
  detailsSummary: {
    cursor: "pointer",
    fontWeight: 700,
    color: "#e8f0fa",
  },
  actions: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  btn: {
    border: "1px solid #2e3b4a",
    borderRadius: 10,
    padding: "8px 12px",
    fontWeight: 700,
    background: "#0f2234",
    color: "#e8f0fa",
    cursor: "pointer",
  },
};

export default function ReportView({
  reportScore = 0,
  riskTags = [],
  reportSummary = "",
  reportDetails = "",
  sourceLabel = "本地规则",
  onDownloadPdf,
  isDownloadingPdf = false,
}) {
  return (
    <section style={styles.card}>
      <h3 style={styles.title}>跑姿诊断报告（金字塔）</h3>

      <div style={styles.scoreWrap}>
        <div style={styles.score}>{reportScore}</div>
        <div style={styles.scoreLabel}>综合评分 / 100</div>
      </div>

      <div style={styles.tagsWrap}>
        {riskTags.length === 0 ? (
          <span style={styles.tag}>#动作整体稳定</span>
        ) : (
          riskTags.map((tag) => (
            <span key={tag} style={styles.tag}>
              #{tag}
            </span>
          ))
        )}
      </div>

      <div style={styles.summary}>{reportSummary || "暂无报告摘要。"}</div>

      <details style={styles.details}>
        <summary style={styles.detailsSummary}>查看详细分析与原理</summary>
        <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{reportDetails || "暂无详细内容。"}</div>
      </details>

      <div style={styles.actions}>
        <button type="button" onClick={onDownloadPdf} style={styles.btn} disabled={isDownloadingPdf}>
          {isDownloadingPdf ? "PDF 生成中..." : "下载 PDF"}
        </button>
        <span style={{ color: "#93a4b7", fontSize: 12 }}>报告来源：{sourceLabel}</span>
      </div>
    </section>
  );
}
