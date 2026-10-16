import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="prose-plain">
      <h1 className="mb-2 text-[2rem] font-semibold">Privacy</h1>
      <p className="text-muted">Last updated October 16, 2026</p>

      <p>
        These free tools are run by Joe Waltman. This page explains what I collect when you use
        them and what I do with it. Questions go to{" "}
        <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>.
      </p>

      <h2>What I collect</h2>
      <ul>
        <li>What you type in: your email address, and anything else you choose to give, such as your name, company, role and your answers to a tool&apos;s questions.</li>
        <li>What you do with the tools: sign-ups, confirmations, unsubscribes, results viewed and clicks on the &quot;want this built&quot; button.</li>
        <li>Whether emails I send are opened and which links are clicked, as reported by my email provider.</li>
      </ul>

      <h2>What I use it for</h2>
      <ul>
        <li>To send you the results and emails you asked for.</li>
        <li>To reply when you click &quot;want this built&quot; or write to me.</li>
        <li>To see which tools are useful and fix the ones that are not.</li>
      </ul>
      <p>I do not sell your information or share it for advertising.</p>

      <h2>Who else handles it</h2>
      <p>
        The tools run on Railway (hosting and database) and send email through Resend. They
        process your information only to provide those services. If a tool offers to send your
        result to a partner, such as a customs broker, it only does so after you ask it to.
      </p>

      <h2>Public records</h2>
      <p>
        Some tools show public records about businesses, such as license and permit filings. They
        cover businesses, not individuals, and each item links to its public source.
      </p>

      <h2>Cookies</h2>
      <p>
        The public pages set no tracking cookies. The only cookie is the sign-in cookie for my own
        admin pages.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Every email has a one-click unsubscribe link.</li>
        <li>
          To see what I hold about you, or to have it deleted, email{" "}
          <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>.
        </li>
      </ul>
    </article>
  );
}
