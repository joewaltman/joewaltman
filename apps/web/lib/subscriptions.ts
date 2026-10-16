import {
  type Db,
  type Role,
  type Tool,
  and,
  authTokens,
  eq,
  gt,
  isNull,
  normalizeEmail,
  partners,
  subscribers,
  subscriptions,
  suppressions,
} from "@jw/db";
import { type SendDeps, confirmSubscription, isSuppressed, sendEmail } from "@jw/email";
import { logEvent } from "./events";
import { hashToken, newToken } from "./tokens";
import { TOOL_INFO } from "./tools";

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SubscribeInput {
  email: string;
  tool: Tool;
  name?: string | null;
  company?: string | null;
  role?: Role | null;
  revenueBand?: string | null;
  headcountBand?: string | null;
  partnerSlug?: string | null;
  preferences?: Record<string, unknown>;
}

export type SubscribeOutcome =
  // A confirmation email is on its way.
  | "check-email"
  // Already confirmed and active for this tool. Nothing sent.
  | "already-subscribed"
  // The address unsubscribed before. Nothing sent; they can write to Joe to come back.
  | "suppressed"
  // EMAIL_MODE is joe-only and this is not Joe. Nothing saved, nothing sent.
  | "not-open"
  | "send-failed";

export async function subscribe(deps: SendDeps, input: SubscribeInput): Promise<SubscribeOutcome> {
  const { db, config } = deps;
  const email = normalizeEmail(input.email);

  if (config.mode === "joe-only" && email !== config.adminEmail) return "not-open";
  if (await isSuppressed(db, email)) return "suppressed";

  const subscriber = await upsertContact(db, { ...input, email });

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriberId, subscriber.id), eq(subscriptions.tool, input.tool)))
    .limit(1);
  if (sub?.active && subscriber.confirmedAt) {
    // Signing up again with new choices (other areas, say) updates them without another confirmation.
    if (input.preferences) {
      await db.update(subscriptions).set({ preferences: input.preferences }).where(eq(subscriptions.id, sub.id));
    }
    return "already-subscribed";
  }
  const token = await createPendingSubscription(db, {
    subscriberId: subscriber.id,
    email,
    tool: input.tool,
    preferences: input.preferences,
  });

  const info = TOOL_INFO[input.tool];
  const result = await sendEmail(deps, {
    to: email,
    template: confirmSubscription({
      toolName: info.name,
      confirmUrl: `${config.siteUrl}/confirm/${token}`,
    }),
    reason: `You got this because someone entered this address at joewaltman.com${info.path}.`,
  });

  await logEvent(db, {
    type: "signup",
    tool: input.tool,
    subscriberId: subscriber.id,
    meta: { partnerSlug: input.partnerSlug ?? null, emailStatus: result.status },
  });

  return result.status === "sent" || result.status === "dryrun" ? "check-email" : "send-failed";
}

export type ContactInput = Omit<SubscribeInput, "tool" | "preferences">;

// Finds or creates the person's row. Fills in blanks without overwriting what we already know.
export async function upsertContact(db: Db, input: ContactInput) {
  const email = normalizeEmail(input.email);
  let partnerId: string | null = null;
  if (input.partnerSlug) {
    const [p] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.slug, input.partnerSlug))
      .limit(1);
    partnerId = p?.id ?? null;
  }

  const [existing] = await db.select().from(subscribers).where(eq(subscribers.email, email)).limit(1);
  const [row] = existing
    ? await db
        .update(subscribers)
        .set({
          name: existing.name ?? input.name ?? null,
          company: existing.company ?? input.company ?? null,
          role: existing.role ?? input.role ?? null,
          revenueBand: existing.revenueBand ?? input.revenueBand ?? null,
          headcountBand: existing.headcountBand ?? input.headcountBand ?? null,
          partnerId: existing.partnerId ?? partnerId,
        })
        .where(eq(subscribers.id, existing.id))
        .returning()
    : await db
        .insert(subscribers)
        .values({
          email,
          name: input.name ?? null,
          company: input.company ?? null,
          role: input.role ?? null,
          revenueBand: input.revenueBand ?? null,
          headcountBand: input.headcountBand ?? null,
          partnerId,
        })
        .returning();
  if (!row) throw new Error("subscriber upsert returned no row");
  return row;
}

// Makes sure an inactive subscription exists and returns a fresh confirm token for it.
export async function createPendingSubscription(
  db: Db,
  input: { subscriberId: string; email: string; tool: Tool; preferences?: Record<string, unknown> },
): Promise<string> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriberId, input.subscriberId), eq(subscriptions.tool, input.tool)))
    .limit(1);
  if (!sub) {
    await db.insert(subscriptions).values({
      subscriberId: input.subscriberId,
      tool: input.tool,
      preferences: input.preferences ?? {},
      active: false,
    });
  } else if (input.preferences) {
    await db
      .update(subscriptions)
      .set({ preferences: input.preferences })
      .where(eq(subscriptions.id, sub.id));
  }
  const token = newToken();
  await db.insert(authTokens).values({
    email: normalizeEmail(input.email),
    tokenHash: hashToken(token),
    purpose: "confirm",
    tool: input.tool,
    expiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
  });
  return token;
}

export async function confirmByToken(
  db: Db,
  token: string,
): Promise<{ email: string; tool: Tool } | null> {
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, "confirm"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row?.tool) return null;

  const [subscriber] = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.email, row.email))
    .limit(1);
  if (!subscriber) return null;

  await db
    .update(subscribers)
    .set({
      confirmedAt: subscriber.confirmedAt ?? now,
      consentAt: now,
      unsubscribedAt: null,
    })
    .where(eq(subscribers.id, subscriber.id));
  await db
    .update(subscriptions)
    .set({ active: true })
    .where(and(eq(subscriptions.subscriberId, subscriber.id), eq(subscriptions.tool, row.tool)));
  await logEvent(db, { type: "confirm", tool: row.tool, subscriberId: subscriber.id });
  return { email: row.email, tool: row.tool };
}

export async function findByUnsubscribeToken(db: Db, token: string) {
  const [row] = await db
    .select({ id: subscribers.id, email: subscribers.email, unsubscribedAt: subscribers.unsubscribedAt })
    .from(subscribers)
    .where(eq(subscribers.unsubscribeToken, token))
    .limit(1);
  return row ?? null;
}

// Unsubscribes from everything and adds the address to the suppression list.
export async function unsubscribeByToken(db: Db, token: string): Promise<string | null> {
  const subscriber = await findByUnsubscribeToken(db, token);
  if (!subscriber) return null;
  const now = new Date();
  await db
    .update(subscribers)
    .set({ unsubscribedAt: subscriber.unsubscribedAt ?? now })
    .where(eq(subscribers.id, subscriber.id));
  await db
    .update(subscriptions)
    .set({ active: false })
    .where(eq(subscriptions.subscriberId, subscriber.id));
  await db
    .insert(suppressions)
    .values({ email: subscriber.email, reason: "unsubscribe" })
    .onConflictDoNothing();
  if (!subscriber.unsubscribedAt) {
    await logEvent(db, { type: "unsubscribe", subscriberId: subscriber.id });
  }
  return subscriber.email;
}
