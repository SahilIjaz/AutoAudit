import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoAudit — grounded AI code review",
  description: "Agentic code review that verifies real static-analysis findings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
