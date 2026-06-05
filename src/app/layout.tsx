import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIA Stock Score",
  description: "국내·미국 주식 점수와 핵심 지표를 조회하는 리더",
};

const themeInitScript = `
try {
  var theme = window.localStorage.getItem("sia-stock-score:theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
} catch (_) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
