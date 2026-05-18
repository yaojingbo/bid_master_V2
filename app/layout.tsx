import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bid Master Web",
  description: "招投标智能分析工具箱 - AI驱动的招标文件智能提取、模拟编制、开标报价分析",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <Script src="https://tweakcn.com/live-preview.min.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}