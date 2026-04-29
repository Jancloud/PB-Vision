import "./globals.css";

export const metadata = {
  title: "AI 跑姿视觉诊断助手",
  description: "上传视频，识别关键点，实时查看躯干前倾角",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
