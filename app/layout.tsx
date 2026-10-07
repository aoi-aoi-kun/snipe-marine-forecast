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
  title: "七里ヶ浜沖の予報",
  description:
    "七里ヶ浜沖のECMWF 3時間予報と江の島ヨットハーバー実況。スナイプ出艇向けの参考画面。",
  appleWebApp: {
    capable: true,
    title: "七里ヶ浜沖",
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
