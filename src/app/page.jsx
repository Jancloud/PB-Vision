import PoseAnalyzer from "../ui/PoseAnalyzer";
import ScoreLogicSimulator from "../ui/ScoreLogicSimulator";

export default function Page() {
  const showDevSimulator = process.env.NODE_ENV !== "production";

  return (
    <main className="home-main">
      <PoseAnalyzer />
      {showDevSimulator ? (
        <details
          style={{
            marginTop: 20,
            border: "1px solid #1d2a38",
            borderRadius: 12,
            padding: 12,
            background: "#0d131b",
          }}
        >
          <summary style={{ cursor: "pointer", color: "#00f3ff", fontWeight: 700 }}>
            开发调试：评分逻辑模拟器（点击展开/收起）
          </summary>
          <div style={{ marginTop: 12 }}>
            <ScoreLogicSimulator />
          </div>
        </details>
      ) : null}
    </main>
  );
}
