import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Score Reader",
  description: "국내·미국 주식 점수와 핵심 지표를 조회하는 Next.js 리더",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
