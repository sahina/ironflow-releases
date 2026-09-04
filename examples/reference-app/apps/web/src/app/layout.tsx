import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Ironflow reference app",
  description: "A polyglot order-processing system coordinated by one local Ironflow server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>Ironflow reference app</strong>
          <nav aria-label="Sections">
            <Link href="/shop">Shop</Link>
            <Link href="/operations">Operations</Link>
            <Link href="/system">System</Link>
          </nav>
        </header>
        <p className="banner" role="note">
          Local demo. The engine runs with authentication disabled and is reachable on this machine
          only — a deliberate choice for a demo you run yourself, and never a production pattern.
        </p>
        <main>{children}</main>
      </body>
    </html>
  );
}
