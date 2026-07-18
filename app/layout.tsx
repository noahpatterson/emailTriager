import type { ReactNode } from "react";
import type { Metadata } from "next";
import { InsecureLocalBanner } from "@/app/insecure-local-banner";
import { isInsecureLocalDevRequested } from "@/src/server/auth/local-dev-flags";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Triage",
  description: "Private deterministic Gmail triage console",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const insecureLocal = isInsecureLocalDevRequested();
  return (
    <html lang="en">
      <body data-insecure-local={insecureLocal ? "true" : undefined}>
        <InsecureLocalBanner />
        {children}
      </body>
    </html>
  );
}
