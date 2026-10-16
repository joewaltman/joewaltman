import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/server";
import { signOutAction } from "../actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const NAV: Array<[string, string]> = [
  ["/admin", "Overview"],
  ["/admin/hand-raises", "Hand-raises"],
  ["/admin/subscribers", "Subscribers"],
  ["/admin/partners", "Partners"],
  ["/admin/jobs", "Jobs"],
  ["/admin/emails", "Emails"],
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const email = await requireAdmin();
  return (
    <div>
      <nav className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-rule pb-3 text-[0.95rem]">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <form action={signOutAction} className="ml-auto">
          <span className="mr-3 text-muted">{email}</span>
          <button type="submit" className="cursor-pointer text-accent underline">
            Sign out
          </button>
        </form>
      </nav>
      {children}
    </div>
  );
}
