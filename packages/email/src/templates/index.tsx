import { Link, Text } from "@react-email/components";
import type { ReactElement } from "react";
import { linkStyle, textStyle } from "./layout";

export interface Template {
  name: string;
  subject: string;
  preview: string;
  body: ReactElement;
}

export function confirmSubscription(input: { toolName: string; confirmUrl: string }): Template {
  return {
    name: "confirm-subscription",
    subject: `Confirm your ${input.toolName} subscription`,
    preview: "One click to confirm, or ignore this email.",
    body: (
      <>
        <Text style={textStyle}>
          Someone, hopefully you, asked to get {input.toolName} emails from Joe Waltman at this
          address.
        </Text>
        <Text style={textStyle}>
          <Link href={input.confirmUrl} style={linkStyle}>
            Confirm your subscription
          </Link>
        </Text>
        <Text style={textStyle}>
          If you did not ask for this, ignore this email and you will not hear from me again.
        </Text>
      </>
    ),
  };
}

export function magicLink(input: { url: string }): Template {
  return {
    name: "magic-link",
    subject: "Your sign-in link for joewaltman.com",
    preview: "This link works once and expires in 15 minutes.",
    body: (
      <>
        <Text style={textStyle}>
          <Link href={input.url} style={linkStyle}>
            Sign in to joewaltman.com
          </Link>
        </Text>
        <Text style={textStyle}>
          This link works once and expires in 15 minutes. If you did not ask for it, ignore this
          email.
        </Text>
      </>
    ),
  };
}

export function handRaiseNotice(input: {
  tool: string;
  email: string | null;
  context: Record<string, unknown>;
  adminUrl: string;
}): Template {
  const who = input.email ?? "an anonymous visitor";
  return {
    name: "hand-raise-notice",
    subject: `Hand-raise on ${input.tool} from ${who}`,
    preview: `${who} clicked the hand-raise on ${input.tool}.`,
    body: (
      <>
        <Text style={textStyle}>
          {who} clicked the hand-raise on {input.tool}.
        </Text>
        <Text style={{ ...textStyle, fontFamily: "Menlo, monospace", fontSize: "13px", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(input.context, null, 2)}
        </Text>
        <Text style={textStyle}>
          <Link href={input.adminUrl} style={linkStyle}>
            Open the hand-raises inbox
          </Link>
        </Text>
      </>
    ),
  };
}
