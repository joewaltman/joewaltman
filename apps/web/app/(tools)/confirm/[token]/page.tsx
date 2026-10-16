import type { Metadata } from "next";
import { confirmAction } from "../../actions";

export const metadata: Metadata = { title: "Confirm your subscription", robots: { index: false } };

// The click confirms through a POST, so link scanners that open emails cannot confirm for someone.
export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div>
      <h1 className="mb-4 text-[1.75rem] font-semibold">Confirm your subscription</h1>
      <form action={confirmAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn">
          Confirm
        </button>
      </form>
    </div>
  );
}
