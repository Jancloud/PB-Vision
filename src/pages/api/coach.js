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

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr, m) {
  if (!arr.length) return 0;
  return arr.reduce((sum, x) => sum + (x - m) * (x - m), 0) / arr.length;
}

function cv(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  if (Math.abs(m) < 1e-8) return 0;
  return Math.sqrt(variance(arr, m)) / Math.abs(m);
}

function safeMin(arr) {
  return arr.length ? Math.min(...arr) : 0;
}

function safeMax(arr) {
  return arr.length ? Math.max(...arr) : 0;
}

function preprocessMetrics(input) {
  const rawFrames = Array.isArray(input?.frames) ? input.frames : [];
  const filteredFrames = rawFrames.filter((f) => toNum(f?.confidenceScore) >= 0.6);

  const used = filteredFrames.length > 0 ? filteredFrames : rawFrames;
  const torsoArr = used.map((f) => toNum(f?.torsoLeanAngle));
  const kneeArr = used.map((f) => toNum(f?.kneeFlexionAngle));
  const sampleSeconds = toNum(input?.sampleSeconds);
  const frameCount = used.length;
  const abnormalRate = frameCount
    ? (used.filter((f) => Boolean(f?.isAbnormal)).length / frameCount) * 100
    : toNum(input?.abnormalRate);

  return {
    frameCount,
    sampleSeconds,
    abnormalRate,
    denoise: {
      rawCount: rawFrames.length,
      keptCount: filteredFrames.length,
      threshold: 0.6,
    },
    torsoLean: {
      avg: mean(torsoArr),
      min: safeMin(torsoArr),
      max: safeMax(torsoArr),
      cv: cv(torsoArr),
    },
    kneeFlexion: {
      avg: mean(kneeArr),
      min: safeMin(kneeArr),
      max: safeMax(kneeArr),
      cv: cv(kneeArr),
    },
  };
}

function buildCoachPrompt(m) {
  const eliteNorm = [
    "精英跑者躯干前倾常模：约 6°~10°（平路中速侧面拍摄）。",
    "精英跑者动作稳定性常模：关键角度变异系数通常 < 12%。",
    "精英跑者落地缓冲常模：膝盖弯曲不会接近 0°硬顶落地。",
  ].join("\n");

  const metricText = [
    `frameCount: ${m.frameCount}`,
    `sampleSeconds: ${m.sampleSeconds}`,
    `abnormalRate(%): ${m.abnormalRate.toFixed(2)}`,
    `torsoLean(avg/min/max/cv): ${m.torsoLean.avg.toFixed(2)} / ${m.torsoLean.min.toFixed(2)} / ${m.torsoLean.max.toFixed(2)} / ${m.torsoLean.cv.toFixed(4)}`,
    `kneeFlexion(avg/min/max/cv): ${m.kneeFlexion.avg.toFixed(2)} / ${m.kneeFlexion.min.toFixed(2)} / ${m.kneeFlexion.max.toFixed(2)} / ${m.kneeFlexion.cv.toFixed(4)}`,
    `denoise(raw/kept, threshold): ${m.denoise.rawCount}/${m.denoise.keptCount}, ${m.denoise.threshold}`,
  ].join("\n");

  const systemPrompt = `
你是一位国家队跑步专项教练与体能教练。
你的输出语气必须：专业、严谨、鼓励性，不夸张，不制造恐慌。

请严格按以下结构输出中文报告：
【技术诊断】
【与精英常模对比】
【潜在风险】
【训练处方】
【下次复测目标（可量化）】

训练处方必须包含具体动作、组数、次数/时长、每周频次。
优先从这些动作组合：保加利亚蹲、靠墙静蹲、台阶下放（离心）、小步高频跑、核心抗旋训练。
`.trim();

  const userPrompt = `
请基于以下“去噪后的跑姿统计数据”给出教练报告：

${metricText}

精英常模参考：
${eliteNorm}

要求：
1. 必须解释指标偏离为什么会影响跑步经济性或受伤风险；
2. 给出 2~4 条可执行训练建议（包含频次）；
3. 结尾给一句鼓励性总结。
`.trim();

  return { systemPrompt, userPrompt };
}

async function callCoachModel(config, messages) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.5,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Coach API failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Coach API returned empty content");
  }
  return content.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const config = pickProviderConfig();
    if (!config.apiKey) {
      throw new Error(`Missing API key for provider: ${config.provider}`);
    }

    const rawInput = req.body?.metrics || {};
    const cleanMetrics = preprocessMetrics(rawInput);
    const { systemPrompt, userPrompt } = buildCoachPrompt(cleanMetrics);

    const report = await callCoachModel(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return res.status(200).json({
      ok: true,
      report,
      provider: config.provider,
      cleanMetrics,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}

