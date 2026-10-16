import { TOOLS } from "@jw/db";
import type { Metadata } from "next";
import Link from "next/link";
import { TOOL_INFO } from "@/lib/tools";

export const metadata: Metadata = { title: "Subscription", robots: { index: false } };

export default async function ConfirmResultPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string; invalid?: string }>;
}) {
  const { tool } = await searchParams;
  const info = TOOLS.find((t) => t === tool);
  if (!info) {
    return (
      <div>
        <h1 className="mb-4 text-[1.75rem] font-semibold">That link did not work</h1>
        <p>
          It may have expired or been used already. Sign up again, or email{" "}
          <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>.
        </p>
      </div>
    );
  }
  const { name, path } = TOOL_INFO[info];
  return (
    <div>
      <h1 className="mb-4 text-[1.75rem] font-semibold">You are subscribed</h1>
      <p>
        You will get {name} emails at this address. Every email has a one-click unsubscribe link.
      </p>
      <p>
        <Link href={path}>Back to the {name}</Link>
      </p>
    </div>
  );
}
