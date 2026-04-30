"use client";

export default function AppFooter() {
  return (
    <footer
      style={{
        marginTop: 16,
        borderTop: "1px solid rgba(31, 50, 68, 0.85)",
        paddingTop: 12,
        paddingBottom: 6,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <span className="pb-footer-text">v1.0.0-stable</span>
      <span className="pb-footer-text">Built by Jan | IT Workhorse & Marathoner</span>
      <style>{`
        .pb-footer-text {
          color: rgba(180, 194, 210, 0.56);
          font-size: 12px;
          transition: color .2s ease, text-shadow .2s ease;
        }
        .pb-footer-text:hover {
          color: #9af7ff;
          text-shadow: 0 0 8px rgba(0, 243, 255, 0.55);
        }
      `}</style>
    </footer>
  );
}

