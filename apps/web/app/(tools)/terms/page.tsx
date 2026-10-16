import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="prose-plain">
      <h1 className="mb-2 text-[2rem] font-semibold">Terms</h1>
      <p className="text-muted">Last updated October 16, 2026</p>

      <h2>Information, not advice</h2>
      <p>
        These tools give general information. They are not legal, tax, customs or financial
        advice. Before acting on a result, check it with your attorney, accountant or customs
        broker.
      </p>

      <h2>Sources and accuracy</h2>
      <p>
        Results come from public sources and published rules, each shown with its source and an
        as-of date. Sources can be wrong, late or change without notice, so the tools are provided
        as is, without any promise that they are complete or current.
      </p>

      <h2>How you may use them</h2>
      <ul>
        <li>Use the tools and their results for your own business.</li>
        <li>Do not scrape the tools or try to get around their limits.</li>
        <li>
          Do not use anything here to decide whether a person gets credit, insurance, a job or
          housing. The tools cover businesses, not individuals.
        </li>
      </ul>

      <h2>Liability</h2>
      <p>
        The tools are free. To the extent the law allows, Joe Waltman is not liable for losses that
        come from using them or relying on their results.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>
      </p>
    </article>
  );
}
