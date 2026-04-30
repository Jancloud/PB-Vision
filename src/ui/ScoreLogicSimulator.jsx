"use client";

import { useMemo, useState } from "react";
import styles from "./ScoreLogicSimulator.module.css";

const NORM_THRESHOLDS = {
  health: {
    maxLean: 12,
    minKnee: 35,
    maxCv: 15,
  },
  elite: {
    maxLean: 20,
    minKnee: 20,
    maxCv: 50,
  },
};

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateScoreFromInputs(data, isEliteMode) {
  const thresholds = isEliteMode ? NORM_THRESHOLDS.elite : NORM_THRESHOLDS.health;
  let score = 100;

  const leanOverflow = Math.max(0, data.torsoLean - thresholds.maxLean);
  const kneeDeficit = Math.max(0, thresholds.minKnee - data.minKnee);
  const cvOverflow = Math.max(0, data.cv - thresholds.maxCv);

  score -= leanOverflow * (isEliteMode ? 1.4 : 2.8);
  score -= kneeDeficit * (isEliteMode ? 1.2 : 2.2);
  score -= cvOverflow * (isEliteMode ? 0.18 : 0.65);

  // 用代理指标表达“腾空比例 + 动作对称性”的奖励
  score += (data.airtimeProxy - 0.5) * 18;
  score += (data.symmetryProxy - 0.5) * 18;

  return clamp(0, Math.round(score), 100);
}

function getStatusLabel(score) {
  if (score >= 85) return "优秀";
  if (score >= 70) return "稳定";
  if (score >= 55) return "预警";
  return "需调整";
}

function getStatusClass(score) {
  if (score >= 85) return styles.good;
  if (score >= 70) return styles.steady;
  if (score >= 55) return styles.warn;
  return styles.bad;
}

function getRingColor(score) {
  if (score >= 85) return "#0f7c35";
  if (score >= 70) return "#2f8cff";
  if (score >= 55) return "#a79a2e";
  return "#d94848";
}

export default function ScoreLogicSimulator() {
  const [isEliteMode, setIsEliteMode] = useState(false);
  const [torsoLean, setTorsoLean] = useState(16.4);
  const [minKnee, setMinKnee] = useState(43);
  const [cv, setCv] = useState(24.7);

  const airtimeProxy = useMemo(() => clamp(0, 1 - Math.abs(minKnee - 34) / 30, 1), [minKnee]);
  const symmetryProxy = useMemo(
    () => clamp(0, 1 - Math.abs(torsoLean - (isEliteMode ? 14 : 9)) / 18, 1),
    [isEliteMode, torsoLean]
  );

  const score = useMemo(
    () =>
      calculateScoreFromInputs(
        { torsoLean, minKnee, cv, airtimeProxy, symmetryProxy },
        isEliteMode
      ),
    [airtimeProxy, cv, isEliteMode, minKnee, symmetryProxy, torsoLean]
  );
  const status = getStatusLabel(score);
  const modeLabel = isEliteMode ? "精英竞技" : "大众健康";
  const ringStyle = {
    background: `conic-gradient(${getRingColor(score)} ${score}%, #d4d9e1 0)`,
  };

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3>跑姿评分逻辑模拟器</h3>
        <div className={styles.metaGrid}>
          <div>分析模式</div>
          <div>实时总分</div>
          <div>状态</div>
          <strong>{modeLabel}</strong>
          <strong>{score}</strong>
          <strong className={getStatusClass(score)}>{status}</strong>
        </div>
      </header>

      <div className={styles.ringWrap}>
        <span className={styles.badge}>{isEliteMode ? "ELITE ATHLETE" : "HEALTH RUNNER"}</span>
        <div className={styles.ring} style={ringStyle}>
          <div className={styles.ringInner}>
            <div className={styles.score}>{score}</div>
            <div className={styles.label}>RUNNING SCORE</div>
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <label className={styles.rowToggle}>
          <span>竞技精英模式 (Elite)</span>
          <input type="checkbox" checked={isEliteMode} onChange={(e) => setIsEliteMode(e.target.checked)} />
        </label>

        <label className={styles.row}>
          <span>最小膝弯 (°)</span>
          <input type="range" min="10" max="60" step="0.1" value={minKnee} onChange={(e) => setMinKnee(Number(e.target.value))} />
          <output>{minKnee.toFixed(1)}</output>
        </label>

        <label className={styles.row}>
          <span>躯干前倾角 (°)</span>
          <input type="range" min="0" max="30" step="0.1" value={torsoLean} onChange={(e) => setTorsoLean(Number(e.target.value))} />
          <output>{torsoLean.toFixed(1)}</output>
        </label>

        <label className={styles.row}>
          <span>缓冲变异系数 (%)</span>
          <input type="range" min="0" max="60" step="0.1" value={cv} onChange={(e) => setCv(Number(e.target.value))} />
          <output>{cv.toFixed(1)}</output>
        </label>
      </div>
    </section>
  );
}

