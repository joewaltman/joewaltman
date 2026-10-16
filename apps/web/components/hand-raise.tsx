import type { Tool } from "@jw/db";

// One low-pressure ask at the bottom of each tool. A click logs a hand-raise and emails Joe.
export function HandRaise({
  tool,
  prompt,
  returnTo,
  email,
  raised,
}: {
  tool: Tool;
  prompt: string;
  returnTo: string;
  email?: string | null;
  raised?: boolean;
}) {
  return (
    <section id="hand-raise" className="mt-12 border-t border-rule pt-6">
      {raised ? (
        <p className="notice">Thanks. Joe will be in touch by email, usually within a day.</p>
      ) : (
        <form method="post" action="/api/forms/hand-raise" className="grid max-w-md gap-3">
          <p className="m-0">{prompt}</p>
          <input type="hidden" name="tool" value={tool} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {email ? (
            <input type="hidden" name="email" value={email} />
          ) : (
            <label className="grid gap-1">
              <span className="text-[0.95rem] font-semibold">Your email</span>
              <input className="field" type="email" name="email" required autoComplete="email" />
            </label>
          )}
          <div>
            <button type="submit" className="btn">
              Yes, I want this
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
