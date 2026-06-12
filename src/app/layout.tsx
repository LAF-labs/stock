import type { Metadata } from "next";
import QueryProvider from "@/components/QueryProvider";
import { STOCKSTALKER_DEFAULT_DESCRIPTION, STOCKSTALKER_SERVICE_NAME } from "@/lib/stockShareMetadata";
import "./globals.css";

export const metadata: Metadata = {
  title: STOCKSTALKER_SERVICE_NAME,
  description: STOCKSTALKER_DEFAULT_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
