function buildPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    // pdfkit 是 CommonJS 包，这里用 require 兼容 Next.js API Route 运行时。
    // eslint-disable-next-line global-require
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const score = Number(payload?.score || 0);
    const tags = Array.isArray(payload?.tags) ? payload.tags : [];
    const summary = String(payload?.summary || "");
    const details = String(payload?.details || "");
    const source = String(payload?.source || "Local Rule");

    doc.fillColor("#111111").fontSize(22).text("Running Diagnostic Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fillColor("#00f3ff").fontSize(40).text(String(score), { continued: true });
    doc.fillColor("#666666").fontSize(14).text(" / 100");
    doc.moveDown(0.3);
    doc.fillColor("#444444").fontSize(11).text(`Source: ${source}`);
    doc.moveDown(0.6);

    doc.fillColor("#111111").fontSize(13).text("Core Risk Tags");
    doc.moveDown(0.2);
    doc.fillColor("#333333").fontSize(11).text(tags.length ? tags.map((t) => `#${t}`).join("  ") : "#stable_form");
    doc.moveDown(0.8);

    doc.fillColor("#111111").fontSize(13).text("Summary");
    doc.moveDown(0.2);
    doc.fillColor("#222222").fontSize(11).text(summary || "No summary", { lineGap: 2 });
    doc.moveDown(0.8);

    doc.fillColor("#111111").fontSize(13).text("Details");
    doc.moveDown(0.2);
    doc.fillColor("#222222").fontSize(11).text(details || "No details", { lineGap: 2 });

    doc.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const payload = req.body || {};
    const buffer = await buildPdfBuffer(payload);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="running-diagnostic-report.pdf"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}
