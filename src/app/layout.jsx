import "./globals.css";
import PwaBootstrap from "../ui/PwaBootstrap";

export const metadata = {
  title: "AI 跑姿视觉诊断助手",
  description: "上传视频，识别关键点，实时查看躯干前倾角",
  manifest: "/manifest.json",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black",
  },
};

export const viewport = {
  themeColor: "#00e5ff",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <PwaBootstrap />
        {children}
      </body>
    </html>
  );
}
