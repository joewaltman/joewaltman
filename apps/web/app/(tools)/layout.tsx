import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { bookingUrl } from "@/lib/server";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://joewaltman.com"),
  title: { default: "Free tools from Joe Waltman", template: "%s | Joe Waltman" },
};

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-[720px] items-baseline justify-between gap-4 px-5 py-4">
            <Link href="/" className="font-semibold text-ink no-underline">
              Free tools from Joe Waltman
            </Link>
            <a href={bookingUrl()} className="text-[0.95rem] whitespace-nowrap">
              Work with me
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-[720px] px-5 pt-10 pb-20">{children}</main>
        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-[720px] gap-5 px-5 py-6 text-[0.9rem] text-muted">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
