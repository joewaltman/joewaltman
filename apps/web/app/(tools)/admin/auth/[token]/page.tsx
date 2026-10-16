import type { Metadata } from "next";
import { signInAction } from "../../actions";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Signing in takes a POST, so a link scanner opening the email cannot use up the token.
export default async function AdminAuthPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div>
      <h1 className="mb-4 text-[1.75rem] font-semibold">Sign in to admin</h1>
      <form action={signInAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn">
          Sign in
        </button>
      </form>
    </div>
  );
}
