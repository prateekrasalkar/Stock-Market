import "./globals.css";

export const metadata = {
  title: "Stock Market Analytics Dashboard",
  description: "Real-time stock trend monitoring and prediction dashboard"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          Copyright (c) Made by Prateek Rasalkar. Deployed on 15/04/2026.
        </footer>
      </body>
    </html>
  );
}
