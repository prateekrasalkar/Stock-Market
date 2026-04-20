import "./globals.css";

export const metadata = {
  title: "Stock Market Analytics Dashboard",
  description: "Real-time stock trend monitoring and prediction dashboard"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

