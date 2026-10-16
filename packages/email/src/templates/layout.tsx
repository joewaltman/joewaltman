import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export interface FooterProps {
  // The "why you got this" line.
  reason: string;
  postalAddress: string;
  unsubscribeUrl?: string;
  showForward?: boolean;
}

const body = {
  backgroundColor: "#ffffff",
  color: "#1a1a1a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: "16px",
  lineHeight: "1.55",
};
const container = { maxWidth: "580px", padding: "24px 16px" };
const footerText = { color: "#555555", fontSize: "13px", lineHeight: "1.5", margin: "4px 0" };

export function Layout({
  preview,
  footer,
  children,
}: {
  preview: string;
  footer: FooterProps;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {children}
          <Hr style={{ borderColor: "#e5e3df", margin: "28px 0 16px" }} />
          <Text style={footerText}>{footer.reason}</Text>
          {footer.showForward ? (
            <Text style={footerText}>Know someone who would use this? Forward it to them.</Text>
          ) : null}
          {footer.unsubscribeUrl ? (
            <Text style={footerText}>
              <Link href={footer.unsubscribeUrl} style={{ color: "#1f4a6b" }}>
                Unsubscribe
              </Link>{" "}
              from these emails.
            </Text>
          ) : null}
          <Text style={footerText}>Joe Waltman, {footer.postalAddress}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const textStyle = { margin: "0 0 14px" };
export const linkStyle = { color: "#1f4a6b" };
