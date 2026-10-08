import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "七里ヶ浜 · ハーバー実況",
  description:
    "七里ヶ浜・江の島ヨットハーバーの実況と約1時間先のナウキャスト。スナイプ出艇の参考画面です。",
  appleWebApp: {
    capable: true,
    title: "七里ヶ浜",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eef4f5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full touch-manipulation antialiased">{children}</body>
    </html>
  );
}
