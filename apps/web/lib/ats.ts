// Applicant tracking systems by the hosts their job pages and embeds use. For the AI-at-Work
// pre-run helper: a careers page URL in, the vendor out, so outreach can name it.
const VENDORS: Array<[string, RegExp]> = [
  ["Greenhouse", /greenhouse\.io|grnh\.se/i],
  ["Lever", /lever\.co\b/i],
  ["Workable", /workable\.com/i],
  ["iCIMS", /icims\.com/i],
  ["BambooHR", /bamboohr\.com/i],
  ["Workday", /myworkdayjobs\.com|myworkday(site)?\.com/i],
  ["ADP", /workforcenow\.adp\.com|recruiting\.adp\.com|myjobs\.adp\.com/i],
  ["Paycor", /recruitingbypaycor\.com|paycor\.com\/(careers|ats)/i],
  ["Paylocity", /recruiting\.paylocity\.com/i],
  ["Gusto", /jobs\.gusto\.com/i],
  ["Indeed", /indeed\.com/i],
  ["JazzHR", /applytojob\.com|jazzhr\.com/i],
  ["SmartRecruiters", /smartrecruiters\.com/i],
  ["Ashby", /ashbyhq\.com/i],
  ["Rippling", /ats\.rippling\.com/i],
  ["UKG", /ultipro\.com|ukg\.net/i],
  ["Jobvite", /jobvite\.com/i],
  ["Breezy HR", /breezy\.hr/i],
  ["SAP SuccessFactors", /successfactors\.(com|eu)|sapsf\.com/i],
  ["Oracle Taleo", /taleo\.net/i],
  ["Dayforce", /dayforcehcm\.com/i],
  ["Paychex", /paychex(flex)?\.com\/.*(career|recruit)|recruiting\.paychex/i],
];

export interface AtsMatch {
  vendor: string;
  from: "url" | "page";
}

export function detectAts(url: string, html = ""): AtsMatch[] {
  const out: AtsMatch[] = [];
  for (const [vendor, re] of VENDORS) {
    if (re.test(url)) out.push({ vendor, from: "url" });
    else if (html && re.test(html)) out.push({ vendor, from: "page" });
  }
  return out;
}

// Only ordinary public web addresses; never this network's internal hosts.
export function fetchableUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".internal") || host.endsWith(".local") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    return u;
  } catch {
    return null;
  }
}

// The first 2 MB of a careers page, or "" when it cannot be read in ten seconds.
export async function readCareersPage(url: URL): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "joewaltman.com careers page check (joe@joewaltman.com)" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < 2_000_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return `${res.url}\n${html}`;
  } catch {
    return "";
  }
}
