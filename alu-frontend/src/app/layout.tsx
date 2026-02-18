import { ClerkProvider } from "@/app/lib/auth";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

export const dynamic = 'force-dynamic';

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://alu-teal-pi.vercel.app'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'alu',
    description: 'Create. Share. Discover. - The AI-powered social network.',
    url: '/',
    siteName: 'alu',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'alu',
    description: 'Create. Share. Discover. - The AI-powered social network.',
  },
  title: "alu",
  description: "Create. Share. Discover. - The AI-powered social network.",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "alu",
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#D4A017",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${plusJakarta.variable} font-sans antialiased`} style={{ fontFamily: 'var(--font-plus-jakarta), system-ui, sans-serif' }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

