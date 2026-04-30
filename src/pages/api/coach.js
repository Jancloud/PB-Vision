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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeRound(n, digits = 4) {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function sanitizeMetrics(input) {
  const obj = isPlainObject(input) ? input : {};
  const frameCount = Math.max(0, Math.round(toNum(obj.frameCount)));
  const keptFrameCount = Math.max(0, Math.round(toNum(obj.keptFrameCount, frameCount)));
  const sampleSeconds = Math.max(0, Math.round(toNum(obj.sampleSeconds)));
  const abnormalRate = clamp(toNum(obj.abnormalRate), 0, 100);
  const denoiseThreshold = clamp(toNum(obj.denoiseThreshold, 0.6), 0, 1);

  return {
    frameCount,
    keptFrameCount,
    sampleSeconds,
    abnormalRate: safeRound(abnormalRate, 2),
    denoiseThreshold: safeRound(denoiseThreshold, 3),
    torsoLean: {
      avg: safeRound(toNum(obj.torsoLeanAvg), 2),
      min: safeRound(toNum(obj.torsoLeanMin), 2),
      max: safeRound(toNum(obj.torsoLeanMax), 2),
      cv: safeRound(Math.max(0, toNum(obj.torsoLeanCv)), 4),
    },
    kneeFlexion: {
      avg: safeRound(toNum(obj.kneeFlexionAvg), 2),
      min: safeRound(toNum(obj.kneeFlexionMin), 2),
      max: safeRound(toNum(obj.kneeFlexionMax), 2),
      cv: safeRound(Math.max(0, toNum(obj.kneeFlexionCv)), 4),
    },
  };
}

function findDisallowedKey(input, path = "") {
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      const found = findDisallowedKey(input[i], `${path}[${i}]`);
      if (found) return found;
    }
    return "";
  }
  if (!isPlainObject(input)) return "";

  const blockedKeyPattern =
    /(base64|snapshot|face|identity|idcard|phone|email|avatar|selfie|portrait|video(blob|file|url)|image(blob|file|url))/i;

  for (const [key, value] of Object.entries(input)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (blockedKeyPattern.test(key)) return nextPath;
    const found = findDisallowedKey(value, nextPath);
    if (found) return found;
  }
  return "";
}

function validateMetrics(metrics) {
  if (!metrics.keptFrameCount) {
    const err = new Error("No valid high-confidence frames after denoise (threshold=0.6).");
    err.statusCode = 400;
    throw err;
  }
  if (metrics.keptFrameCount > metrics.frameCount && metrics.frameCount > 0) {
    const err = new Error("Invalid metrics: keptFrameCount cannot exceed frameCount.");
    err.statusCode = 400;
    throw err;
  }
}

function enforceMaxChars(text, maxChars = 500) {
  const input = String(text || "").trim();
  const chars = Array.from(input);
  if (chars.length <= maxChars) return input;
  return `${chars.slice(0, maxChars - 1).join("")}…`;
}

function buildCoachPrompt(m) {
  const eliteNorm = [
    "精英跑者躯干前倾常模：约 6°~10°（平路中速侧面拍摄）。",
    "精英跑者动作稳定性常模：关键角度变异系数通常 < 12%。",
    "精英跑者落地缓冲常模：膝盖弯曲不会接近 0° 硬顶落地。",
  ].join("\n");

  const metricText = [
    `frameCount: ${m.frameCount}`,
    `keptFrameCount(after denoise): ${m.keptFrameCount}`,
    `sampleSeconds: ${m.sampleSeconds}`,
    `deviationRate(%): ${m.abnormalRate.toFixed(2)}`,
    `torsoLean(avg/min/max/cv): ${m.torsoLean.avg.toFixed(2)} / ${m.torsoLean.min.toFixed(2)} / ${m.torsoLean.max.toFixed(2)} / ${m.torsoLean.cv.toFixed(4)}`,
    `kneeFlexion(avg/min/max/cv): ${m.kneeFlexion.avg.toFixed(2)} / ${m.kneeFlexion.min.toFixed(2)} / ${m.kneeFlexion.max.toFixed(2)} / ${m.kneeFlexion.cv.toFixed(4)}`,
    `denoiseThreshold: ${m.denoiseThreshold}`,
  ].join("\n");

  const systemPrompt = `
你是一位国家队跑步专项教练与体能教练。
输出必须简洁、直接、数据优先，不要任何开场白、客套话、结语。
总字数（含标点与换行）必须 <= 500 字。
严格按以下模板输出：
【技术分析】
1) 仅写最严重问题1（1句）
2) 仅写最严重问题2（1句）
【常模对比】
1) 躯干前倾：高于/低于精英常模X%
2) 膝盖缓冲：高于/低于精英常模X%
【针对性建议】
1) 动作A（<=30字）
2) 动作B（<=30字）
【复测目标】
1) 仅给2个可量化目标（短句）
禁止输出模板外内容。
`.trim();

  const userPrompt = `
请基于以下“去噪后的跑姿统计数据”输出报告：

${metricText}

精英常模参考：
${eliteNorm}

要求：
1) 报告总字数必须 <= 500 字；
2) 技术分析只保留最严重2个问题；
3) 针对性建议仅2个核心动作，每个动作描述 <= 30字；
4) 常模对比必须使用“高于/低于精英常模X%”短语；
5) 不要开场白、客套话、结语，直接给核心结果。
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
    const rawMetrics = req.body?.metrics || {};
    const blockedKey = findDisallowedKey(rawMetrics);
    if (blockedKey) {
      return res.status(400).json({
        ok: false,
        error: `Sensitive field is not allowed in metrics payload: ${blockedKey}`,
      });
    }

    const cleanMetrics = sanitizeMetrics(rawMetrics);
    validateMetrics(cleanMetrics);

    const config = pickProviderConfig();
    if (!config.apiKey) {
      throw new Error(`Missing API key for provider: ${config.provider}`);
    }

    const { systemPrompt, userPrompt } = buildCoachPrompt(cleanMetrics);
    const report = await callCoachModel(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const compactReport = enforceMaxChars(report, 500);

    return res.status(200).json({
      ok: true,
      report: compactReport,
      provider: config.provider,
      cleanMetrics,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}
