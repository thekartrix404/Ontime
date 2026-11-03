import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnTime - Invoicing Agent That Prevents Late Payments",
  description: "AI-assisted invoicing with client risk scoring, smart payment terms, and automated PayPal delivery.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
