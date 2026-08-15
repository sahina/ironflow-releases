import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ironflow — Travel Booking",
  description: "A booking saga that survives failure, crashes, and a race for the last seat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
