import {
  type Db,
  emailSends,
  eq,
  events,
  handRaises,
  subscribers,
  subscriptions,
  suppressions,
} from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { EmailConfig, OutgoingMessage, SendDeps, Transport } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  consumeLoginToken,
  createSessionValue,
  requestLoginLink,
  verifySessionValue,
} from "./admin-auth";
import { recordHandRaise } from "./hand-raise";
import { confirmByToken, subscribe, unsubscribeByToken } from "./subscriptions";

const ADMIN = "joe@joewaltman.com";

let db: Db;
let sent: OutgoingMessage[];
let deps: SendDeps;

function makeDeps(mode: EmailConfig["mode"]): SendDeps {
  const transport: Transport = {
    async send(m) {
      sent.push(m);
      return { id: `fake-${sent.length}` };
    },
  };
  return {
    db,
    transport,
    config: {
      mode,
      adminEmail: ADMIN,
      from: "Joe Waltman <joe@mail.joewaltman.com>",
      replyTo: ADMIN,
      siteUrl: "https://joewaltman.com",
      postalAddress: "PO Box 1, Encinitas, CA 92024",
      resendApiKey: null,
      dryRunDir: "/tmp/unused",
    },
  };
}

function lastLink(prefix: string): string {
  const text = sent.at(-1)!.text;
  const match = text.match(new RegExp(`https://joewaltman\\.com${prefix}([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${prefix} link in: ${text}`);
  return match[1]!;
}

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  deps = makeDeps("live");
});

describe("double opt-in", () => {
  it("creates an inactive subscription and activates it on confirm", async () => {
    const outcome = await subscribe(deps, { email: "Owner@Example.com", tool: "tariff", role: "owner" });
    expect(outcome).toBe("check-email");
    expect(sent[0]!.to).toBe("owner@example.com");
    expect(sent[0]!.subject).toBe("Confirm your Tariff Refund Tool subscription");

    let [sub] = await db.select().from(subscriptions);
    expect(sub!.active).toBe(false);

    const token = lastLink("/confirm/");
    expect(await confirmByToken(db, token)).toEqual({ email: "owner@example.com", tool: "tariff" });
    [sub] = await db.select().from(subscriptions);
    expect(sub!.active).toBe(true);
    const [s] = await db.select().from(subscribers);
    expect(s!.confirmedAt).not.toBeNull();

    // Tokens work once.
    expect(await confirmByToken(db, token)).toBeNull();
    // A second signup for the same tool sends nothing.
    expect(await subscribe(deps, { email: "owner@example.com", tool: "tariff" })).toBe("already-subscribed");
    expect(sent).toHaveLength(1);
  });

  it("rejects a bad confirm token", async () => {
    expect(await confirmByToken(db, "nope")).toBeNull();
  });

  it("saves nothing for non-admin signups in joe-only mode", async () => {
    deps = makeDeps("joe-only");
    expect(await subscribe(deps, { email: "owner@example.com", tool: "tariff" })).toBe("not-open");
    expect(await db.select().from(subscribers)).toHaveLength(0);
    expect(await subscribe(deps, { email: ADMIN, tool: "tariff" })).toBe("check-email");
  });
});

describe("unsubscribe", () => {
  it("deactivates every subscription and suppresses future sends", async () => {
    await subscribe(deps, { email: "owner@example.com", tool: "tariff" });
    await confirmByToken(db, lastLink("/confirm/"));
    const [s] = await db.select().from(subscribers);

    expect(await unsubscribeByToken(db, s!.unsubscribeToken)).toBe("owner@example.com");
    const [sub] = await db.select().from(subscriptions);
    expect(sub!.active).toBe(false);
    expect(await db.select().from(suppressions)).toHaveLength(1);

    // Clicking twice is harmless and logs one event.
    await unsubscribeByToken(db, s!.unsubscribeToken);
    const unsubEvents = await db.select().from(events).where(eq(events.type, "unsubscribe"));
    expect(unsubEvents).toHaveLength(1);

    // Signing up again sends nothing.
    expect(await subscribe(deps, { email: "owner@example.com", tool: "radar" })).toBe("suppressed");
    expect(sent).toHaveLength(1);
  });

  it("returns null for an unknown token", async () => {
    expect(await unsubscribeByToken(db, "nope")).toBeNull();
  });
});

describe("admin sign-in", () => {
  it("emails a one-time link to the admin only", async () => {
    await requestLoginLink(deps, "someone@example.com");
    expect(sent).toHaveLength(0);

    await requestLoginLink(deps, " Joe@JoeWaltman.com ");
    expect(sent).toHaveLength(1);
    const token = lastLink("/admin/auth/");
    expect(await consumeLoginToken(db, token, ADMIN)).toBe(ADMIN);
    expect(await consumeLoginToken(db, token, ADMIN)).toBeNull();
  });

  it("signs and verifies session cookies", () => {
    const now = Date.now();
    const value = createSessionValue(ADMIN, "secret", now);
    expect(verifySessionValue(value, "secret", now)).toBe(ADMIN);
    expect(verifySessionValue(value, "other-secret", now)).toBeNull();
    expect(verifySessionValue(value, "secret", now + SESSION_TTL_MS + 1)).toBeNull();
    const tampered = value.replace(/^[^.]+/, Buffer.from("x@example.com").toString("base64url"));
    expect(verifySessionValue(tampered, "secret", now)).toBeNull();
    expect(verifySessionValue(undefined, "secret", now)).toBeNull();
  });
});

describe("hand-raise", () => {
  it("records the click and emails Joe", async () => {
    await recordHandRaise(deps, { tool: "tariff", email: "Owner@Example.com", context: { path: "x" } });
    const [row] = await db.select().from(handRaises);
    expect(row!.email).toBe("owner@example.com");
    expect(sent[0]!.to).toBe(ADMIN);
    expect(sent[0]!.subject).toBe("Hand-raise on Tariff Refund Tool from owner@example.com");
    const logged = await db.select().from(emailSends);
    expect(logged[0]!.status).toBe("sent");
  });
});
