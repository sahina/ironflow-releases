export const metadata = {
  title: "Doc Processor — Ironflow Agent Demo",
  description:
    "Browser-driven demo of ironflow.agents.invoke + subscribe against doc-processor agent",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#0b0f17",
          color: "#e6e8eb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
