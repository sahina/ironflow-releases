import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CQRS + Event Sourcing — Ironflow Example",
  description: "End-to-end CQRS walkthrough running on Ironflow",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <header className="border-b bg-white px-6 py-4">
          <h1 className="text-lg font-semibold">CQRS + Event Sourcing</h1>
          <p className="text-sm text-gray-500">
            A working implementation of{" "}
            <code className="bg-gray-100 px-1 rounded">
              docs/tutorials/cqrs-walkthrough.md
            </code>
          </p>
        </header>
        <nav className="border-b bg-white px-6 py-2 flex gap-4 text-sm">
          <a href="/" className="hover:underline">
            Place Order
          </a>
        </nav>
        <main className="p-6 max-w-4xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
