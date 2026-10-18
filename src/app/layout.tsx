import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "AfterSend — A spoken notice you can correct after the link is shared", template: "%s · AfterSend" },
  description:
    "Turn important notices into spoken announcements. Correct the words, approve the new voice, and keep everyone on the same link.",
  openGraph: {
    title: "AfterSend",
    description: "The message changed. The link didn't.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AfterSend — The message changed. The link didn't." }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d0c",
  colorScheme: "dark",
};

// Hides [data-reveal]/[data-hero] elements only when motion will run; a failsafe reveals them if it never does.
const motionBoot = `(function(){try{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var d=document.documentElement;d.classList.add('motion-ready');setTimeout(function(){if(!d.dataset.motion)d.classList.remove('motion-ready')},2500)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: motionBoot }} />
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
