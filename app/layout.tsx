import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Email Triage", description: "Private deterministic Gmail triage console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
