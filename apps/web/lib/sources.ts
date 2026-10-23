// Link text for source URLs: the site name, numbered when one site appears more than once
// ("cppa.ca.gov", "cppa.ca.gov (2)").
export function sourceLinks(urls: string[]): Array<{ url: string; label: string }> {
  const seen = new Map<string, number>();
  return urls.map((url) => {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const n = (seen.get(host) ?? 0) + 1;
    seen.set(host, n);
    return { url, label: n === 1 ? host : `${host} (${n})` };
  });
}
