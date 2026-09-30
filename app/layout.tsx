import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

// Fraunces carries the "passbook" personality — used only for the
// wordmark and the hero balance figures. Everything else (tables,
// forms, body text) stays in the neutral system sans set in globals.css,
// since financial data needs plain, highly legible digits, not serif
// flourish, at small sizes.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Family Emergency Fund",
  description: "A shared, transparent record of the family emergency fund.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
