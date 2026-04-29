function pickProviderConfig() {
  const provider = (process.env.COACH_PROVIDER || "deepseek").toLowerCase();

  if (provider === "glm") {
    return {
      provider: "glm",
      apiKey: process.env.GLM_API_KEY || "",
      model: process.env.GLM_MODEL || "glm-4-flash",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    };
  }

  return {
    provider: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    endpoint: "https://api.deepseek.com/chat/completions",
  };
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildCoachPrompt(metrics) {
  const torsoAvg = toNum(metrics?.torsoLean?.avg);
  const torsoCv = toNum(metrics?.torsoLean?.cv);
  const torsoMin = toNum(metrics?.torsoLean?.min);
  const torsoMax = toNum(metrics?.torsoLean?.max);

  const kneeAvg = toNum(metrics?.kneeFlexion?.avg);
  const kneeCv = toNum(metrics?.kneeFlexion?.cv);
  const kneeMin = toNum(metrics?.kneeFlexion?.min);
  const kneeMax = toNum(metrics?.kneeFlexion?.max);

  const frameCount = toNum(metrics?.frameCount);
  const abnormalRate = toNum(metrics?.abnormalRate);
  const sampleSeconds = toNum(metrics?.sampleSeconds);

  const eliteNorm = [
    "精英跑者躯干前倾常模：约 6°~10°（侧面视角，平路中速）。",
    "精英跑者动作稳定性常模：关键角度变异系数通常 < 12%。",
    "落地瞬间膝盖弯曲度常模：通常不会接近 0°（避免硬顶落地）。",
  ].join("\n");

  const metricText = [
    `frameCount: ${frameCount}`,
    `sampleSeconds: ${sampleSeconds}`,
    `abnormalRate(%): ${abnormalRate.toFixed(2)}`,
    `torsoLean(avg/min/max/cv): ${torsoAvg.toFixed(2)} / ${torsoMin.toFixed(2)} / ${torsoMax.toFixed(
      2
    )} / ${torsoCv.toFixed(4)}`,
    `kneeFlexion(avg/min/max/cv): ${kneeAvg.toFixed(2)} / ${kneeMin.toFixed(2)} / ${kneeMax.toFixed(
      2
    )} / ${kneeCv.toFixed(4)}`,
  ].join("\n");

  const systemPrompt = `
你是一位国家队体能与跑步技术联合教练，语气要求：
1) 专业、严谨、基于数据；
2) 对用户保持鼓励性，不打击；
3) 不夸张，不做医疗诊断结论。

输出必须严格使用以下结构（中文）：
【技术诊断】
【与精英常模对比】
【潜在风险】
【训练处方】
【下次复测目标（可量化）】

训练处方必须包含可执行动作，并给出组数/时长/频次，优先从以下动作中选择并组合：
- 保加利亚蹲
- 靠墙静蹲
- 台阶下放（离心控制）
- 小步高频跑（技术）
- 核心抗旋（平板支撑变式）
`.trim();

  const userPrompt = `
请基于以下跑姿统计数据给出教练报告：

${metricText}

精英常模参考：
${eliteNorm}

要求：
1) 必须解释“为什么这个指标偏离会影响跑步经济性或受伤风险”；
2) 给出 2~4 条具体训练建议，每条含频次；
3) 给一句鼓励性收尾。
`.trim();

  return { systemPrompt, userPrompt };
}

async function callCoachModel(payload) {
  const config = pickProviderConfig();
  if (!config.apiKey) {
    throw new Error(`Missing API key for provider: ${config.provider}`);
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.5,
      messages: payload.messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Coach API failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Coach API returned empty content.");
  }
  return content.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const metrics = req.body?.metrics || {};
    const { systemPrompt, userPrompt } = buildCoachPrompt(metrics);
    const report = await callCoachModel({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    return res.status(200).json({
      ok: true,
      report,
      provider: pickProviderConfig().provider,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}

