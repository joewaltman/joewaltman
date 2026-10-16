import { type Tool, handRaises, normalizeEmail } from "@jw/db";
import { type SendDeps, handRaiseNotice, sendEmail } from "@jw/email";
import { logEvent } from "./events";
import { TOOL_INFO } from "./tools";

export async function recordHandRaise(
  deps: SendDeps,
  input: {
    tool: Tool;
    email?: string | null;
    subscriberId?: string | null;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const email = input.email ? normalizeEmail(input.email) : null;
  const context = input.context ?? {};
  await deps.db.insert(handRaises).values({
    tool: input.tool,
    email,
    subscriberId: input.subscriberId ?? null,
    context,
  });
  await logEvent(deps.db, {
    type: "hand_raise",
    tool: input.tool,
    subscriberId: input.subscriberId ?? null,
  });
  // Internal alert to Joe, so it goes out even if his own address was used to test unsubscribe.
  await sendEmail(deps, {
    to: deps.config.adminEmail,
    template: handRaiseNotice({
      tool: TOOL_INFO[input.tool].name,
      email,
      context,
      adminUrl: `${deps.config.siteUrl}/admin/hand-raises`,
    }),
    reason: "You got this because a visitor clicked a hand-raise on one of your tools.",
    bypassSuppression: true,
  });
}
