import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsIdentify } from "@/components/analytics-identify";
import { CookieConsent, CookiePreferencesButton } from "@/components/cookie-consent";
import { HeaderAuth } from "@/components/header-auth";
import { Providers } from "@/components/providers";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: site.locale, siteName: site.name, url: "/" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <ClerkProvider appearance={{ cssLayerName: "clerk" }}>
          <Providers>
            <AnalyticsIdentify />
            <header className="border-b border-neutral-200 dark:border-neutral-800">
              <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
                <Link href="/" className="font-semibold">
                  {site.name}
                </Link>
                <div className="flex items-center gap-3 text-sm">
                  <HeaderAuth />
                </div>
              </nav>
            </header>
            <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
            <footer className="border-t border-neutral-200 dark:border-neutral-800">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-sm text-neutral-500">
                <span>
                  © {new Date().getFullYear()} {site.name}
                </span>
                <Link href="/privacidade" className="hover:underline">
                  Privacidade
                </Link>
                <Link href="/termos" className="hover:underline">
                  Termos de uso
                </Link>
                <CookiePreferencesButton />
              </div>
            </footer>
            <CookieConsent />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
