import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/server";
import { requestLoginAction } from "../actions";

export const metadata: Metadata = { title: "Admin sign-in", robots: { index: false } };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  if (await currentAdmin()) redirect("/admin");
  const { sent, error } = await searchParams;
  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-[1.75rem] font-semibold">Admin sign-in</h1>
      {sent ? (
        <p className="notice">If that address is the admin, a sign-in link is on its way.</p>
      ) : null}
      {error ? <p className="notice">That link expired or was used. Ask for a new one.</p> : null}
      <form action={requestLoginAction} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Email</span>
          <input className="field" type="email" name="email" required autoComplete="email" />
        </label>
        <div>
          <button type="submit" className="btn">
            Email me a link
          </button>
        </div>
      </form>
    </div>
  );
}
