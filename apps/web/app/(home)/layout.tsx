import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./home.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://joewaltman.com"),
  title: "Joe Waltman",
  description:
    "Joe Waltman builds automation that removes manual work from operations. Based in San Diego, California.",
  openGraph: {
    type: "website",
    title: "Joe Waltman",
    description: "I build automation that removes manual work from operations.",
    images: ["/headshot3.png"],
  },
  twitter: {
    card: "summary",
    title: "Joe Waltman",
    description: "I build automation that removes manual work from operations.",
  },
};

export default function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
