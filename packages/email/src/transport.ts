import { Resend } from "resend";

export interface OutgoingMessage {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface Transport {
  send(message: OutgoingMessage): Promise<{ id: string }>;
}

export function resendTransport(apiKey: string): Transport {
  const resend = new Resend(apiKey);
  return {
    async send(m) {
      const { data, error } = await resend.emails.send({
        from: m.from,
        to: m.to,
        replyTo: m.replyTo,
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: m.headers,
      });
      if (error || !data) throw new Error(error?.message ?? "Resend returned no id");
      return { id: data.id };
    },
  };
}
