import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_JP, Shippori_Mincho } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_JP({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const mincho = Shippori_Mincho({
  variable: "--font-mincho",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "七里ヶ浜 · ハーバー実況",
  description:
    "江の島ヨットハーバー実況とナウキャスト・急上昇マッチ。スナイプ出艇の参考画面です。3時間予報は Windy を参照。",
  appleWebApp: {
    capable: true,
    title: "ハーバー実況",
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
    <html lang="ja" className={`${plex.variable} ${mincho.variable} h-full`}>
      <body className="min-h-full touch-manipulation antialiased">{children}</body>
    </html>
  );
}
