import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Todo App — Ironflow",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">
            Todo App
          </h1>
          <p className="text-sm text-gray-500">Powered by Ironflow</p>
        </header>
        <main className="max-w-xl mx-auto py-8 px-4">{children}</main>
      </body>
    </html>
  );
}
