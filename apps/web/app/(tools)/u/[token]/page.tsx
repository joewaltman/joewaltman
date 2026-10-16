import { getDb } from "@jw/db";
import type { Metadata } from "next";
import { findByUnsubscribeToken } from "@/lib/subscriptions";
import { unsubscribeAction } from "../../actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const subscriber = await findByUnsubscribeToken(getDb(), token);

  if (!subscriber) {
    return (
      <div>
        <h1 className="mb-4 text-[1.75rem] font-semibold">That link did not work</h1>
        <p>
          Email <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a> and you will be removed
          by hand.
        </p>
      </div>
    );
  }

  if (subscriber.unsubscribedAt) {
    return (
      <div>
        <h1 className="mb-4 text-[1.75rem] font-semibold">You are unsubscribed</h1>
        <p>{subscriber.email} will not get any more emails from these tools.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-[1.75rem] font-semibold">Unsubscribe</h1>
      <p>Stop all emails from these tools to {subscriber.email}?</p>
      <form action={unsubscribeAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn">
          Unsubscribe
        </button>
      </form>
    </div>
  );
}
