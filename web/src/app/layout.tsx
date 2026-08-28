import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IM-Training-Agent",
  description: "面向个性化技能训练的多智能体协同学习平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
