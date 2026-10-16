import { FORM_HANDLERS } from "@/lib/form-handlers";
import { sameOrigin } from "@/lib/same-origin";

// One endpoint for every form on the site; see lib/form-handlers.ts.
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const handler = Object.hasOwn(FORM_HANDLERS, name) ? FORM_HANDLERS[name] : undefined;
  if (!handler) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Expected a form submission", { status: 400 });
  }
  const location = await handler(form);
  // 303 turns the POST into a GET of the next page. A relative Location keeps the proxy's
  // internal host out of the redirect.
  return new Response(null, { status: 303, headers: { Location: location } });
}
