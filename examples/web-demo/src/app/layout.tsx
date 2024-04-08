import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PolyfillsOnClient } from "./polyfills-on-client";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "pgmock Web Demo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <PolyfillsOnClient />
      <body className={inter.className}>{children}</body>
    </html>
  );
}
