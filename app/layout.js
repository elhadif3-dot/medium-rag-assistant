import "./globals.css";

export const metadata = {
  title: "Medium RAG Assistant",
  description: "RAG assistant for the Individual Medium Articles assignment"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
