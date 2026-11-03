import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/inter-tight";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "AfterSend: one announcement, one link, even when plans change", template: "%s · AfterSend" },
  description:
    "Write a school announcement, hear it spoken, and share one link. When the details change, update the announcement and the same link plays the correction.",
  openGraph: {
    title: "AfterSend",
    description: "One announcement. One link. Even when plans change.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AfterSend: One announcement. One link. Even when plans change." }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e0b" },
  ],
  colorScheme: "light dark",
};

// Applies a saved light/dark choice before first paint, so the page never flashes the wrong theme.
const themeBoot = `(function(){try{var t=localStorage.getItem("aftersend-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={GeistMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="font-sans">
        <a
          href="#main"
          className="sr-only z-[100] rounded-full bg-fg px-4 py-2 text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
