/**
 * Analysis 层：只做指标计算与建议决策，不处理 UI 渲染。
 */

function validatePoint(point, name) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    throw new Error(`坐标错误：${name} 必须包含数字类型 x/y。`);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toDegrees(radian) {
  return (radian * 180) / Math.PI;
}

/**
 * 计算躯干前倾角（相对竖直方向）。
 * 0 度越直立，角度越大表示越前倾。
 */
export function calculateTorsoLeanAngle(shoulder, hip) {
  validatePoint(shoulder, "shoulder");
  validatePoint(hip, "hip");

  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx === 0 && absDy === 0) {
    throw new Error("坐标异常：肩膀和胯部重合，无法计算躯干前倾角。");
  }

  return Number(toDegrees(Math.atan2(absDx, absDy)).toFixed(2));
}

/**
 * 计算膝关节角（hip-knee-ankle 三点夹角）。
 * 直腿接近 180 度，弯曲越多角度越小。
 */
export function calculateKneeJointAngle(hip, knee, ankle) {
  validatePoint(hip, "hip");
  validatePoint(knee, "knee");
  validatePoint(ankle, "ankle");

  const v1x = hip.x - knee.x;
  const v1y = hip.y - knee.y;
  const v2x = ankle.x - knee.x;
  const v2y = ankle.y - knee.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);

  if (len1 === 0 || len2 === 0) {
    throw new Error("坐标异常：膝关节向量长度为 0，无法计算膝关节角。");
  }

  const dot = v1x * v2x + v1y * v2y;
  const cosTheta = clamp(dot / (len1 * len2), -1, 1);
  return Number(toDegrees(Math.acos(cosTheta)).toFixed(2));
}

/**
 * 膝盖弯曲度 = 180 - 膝关节角
 * 越接近 0，表示越“硬顶”。
 */
export function calculateKneeFlexionAngle(hip, knee, ankle) {
  const kneeJointAngle = calculateKneeJointAngle(hip, knee, ankle);
  return Number((180 - kneeJointAngle).toFixed(2));
}

export function buildGaitMetrics(points) {
  const torsoLeanAngle = calculateTorsoLeanAngle(points.shoulder, points.hip);
  const kneeJointAngle = calculateKneeJointAngle(points.hip, points.knee, points.ankle);
  const kneeFlexionAngle = Number((180 - kneeJointAngle).toFixed(2));

  return {
    torsoLeanAngle,
    kneeJointAngle,
    kneeFlexionAngle,
  };
}

/**
 * 返回骨架报警级别和建议线条颜色（给 UI 层画布用）。
 */
export function getSkeletonAlert(metrics) {
  const torsoLean = metrics?.torsoLeanAngle;
  const kneeFlex = metrics?.kneeFlexionAngle;

  let alertLevel = "normal";
  let lineColor = "#22c55e"; // 正常：亮绿色

  // 后仰/过直
  if (torsoLean < 4) {
    alertLevel = "danger";
    lineColor = "#ef4444"; // 红色
  } else if (torsoLean < 5) {
    alertLevel = "warn";
    lineColor = "#f59e0b"; // 橙色
  }

  // 前倾过大
  if (torsoLean > 15) {
    alertLevel = "danger";
    lineColor = "#ef4444";
  } else if (torsoLean > 10 && alertLevel !== "danger") {
    alertLevel = "warn";
    lineColor = "#f59e0b";
  }

  // 膝盖过直（硬顶）直接提到 danger
  if (kneeFlex < 8) {
    alertLevel = "danger";
    lineColor = "#ef4444";
  }

  return { alertLevel, lineColor };
}

/**
 * 三段式教练建议：
 * 【当前状态】+【潜在风险】+【一句话改进动作】
 */
export function getGaitAdvice(metrics) {
  const torsoLean = metrics?.torsoLeanAngle;
  const kneeFlex = metrics?.kneeFlexionAngle;

  if (typeof torsoLean !== "number" || typeof kneeFlex !== "number") {
    throw new Error("metrics 数据不完整：需要 torsoLeanAngle 和 kneeFlexionAngle。");
  }

  const skeletonAlert = getSkeletonAlert(metrics);
  let currentStatus = "【当前状态】躯干前倾在合理区间。";
  let potentialRisk = "【潜在风险】当前姿态风险较低。";
  let action = "【一句话改进动作】保持抬头看前方，继续用小步快频率跑。";
  let issueTag = "normal";

  if (torsoLean < 5) {
    currentStatus = `【当前状态】躯干前倾 ${torsoLean.toFixed(1)}°，偏直甚至有后仰趋势。`;
    potentialRisk = "【潜在风险】重心容易落后，刹车感更重，跑久了更容易累。";
    action = "【一句话改进动作】从脚踝微微前倾，像整个人轻轻向前“倒”出去。";
    issueTag = "back_lean";
  } else if (torsoLean > 10 && torsoLean <= 15) {
    currentStatus = `【当前状态】躯干前倾 ${torsoLean.toFixed(1)}°，偏大。`;
    potentialRisk = "【潜在风险】腰背和小腿负担会增加，后程掉速概率上升。";
    action = "【一句话改进动作】收紧核心，想象头顶被线往上提，前倾减少一点。";
    issueTag = "over_lean";
  } else if (torsoLean > 15) {
    currentStatus = `【当前状态】躯干前倾 ${torsoLean.toFixed(1)}°，明显过大。`;
    potentialRisk = "【潜在风险】容易“扑着跑”，膝踝和腰背冲击都更大。";
    action = "【一句话改进动作】先降一点速度，稳住核心后再恢复配速。";
    issueTag = "over_lean_severe";
  }

  if (kneeFlex < 8) {
    currentStatus = `【当前状态】落地瞬间膝盖弯曲度 ${kneeFlex.toFixed(1)}°，接近完全蹬直。`;
    potentialRisk =
      "【潜在风险】易受伤预警：硬顶落地会放大膝关节和胫骨冲击，出现膝前侧不适概率上升。";
    action = "【一句话改进动作】落地前让膝盖像弹簧先微微松开，并把步子收小一点。";
    issueTag = "stiff_knee";
  }

  return {
    isAbnormal: skeletonAlert.alertLevel !== "normal",
    issueTag,
    metrics,
    skeletonAlert,
    currentStatus,
    potentialRisk,
    action,
  };
}

