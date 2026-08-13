import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Лунный календарь — наблюдение синодического месяца",
  description:
    "Календарь с фазами луны (алгоритм Тригонометрический 2), нумерацией синодического месяца по наблюдению нового месяца и напоминаниями.",
  // manifest: "/manifest.json", // Not needed for Capacitor Android
  // icons: { icon: "/icon-512.png", apple: "/icon-512.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
