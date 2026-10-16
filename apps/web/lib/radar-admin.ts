import { zipClusters } from "@jw/content";
import { radarDigest, sendEmail, type SendDeps, type SendResult } from "@jw/email";
import { areasLabel, buildDigest, digestEmailSections, digestWindow, weekLabel } from "@jw/radar";

// Areas from a query string or form: known cluster ids only, North County coastal when none.
export function pickAreas(values: string[]): string[] {
  const known = values.filter((v) => Object.hasOwn(zipClusters.clusters, v));
  return known.length > 0 ? known : ["north-county-coastal"];
}

export const adminCsvPath = (clusters: string[]) =>
  `/admin/radar/csv?${clusters.map((c) => `areas=${encodeURIComponent(c)}`).join("&")}`;

// Last week's digest for the chosen areas, sent to Joe only, the way a subscriber would get it.
// The CSV link goes to the admin export, since Joe may not be a subscriber himself.
export async function sendTestDigest(deps: SendDeps, clusters: string[], now = new Date()): Promise<SendResult> {
  const window = digestWindow(now);
  const digest = await buildDigest(deps.db, { ...window, clusters });
  const site = deps.config.siteUrl;
  return sendEmail(deps, {
    to: deps.config.adminEmail,
    template: radarDigest({
      areas: areasLabel(clusters),
      weekLabel: weekLabel(window.start, window.end),
      sections: digestEmailSections(digest),
      csvUrl: `${site}${adminCsvPath(clusters)}`,
      wantThisUrl: `${site}/newbizradar/crm`,
    }),
    reason: "You got this because you asked for a test digest in the joewaltman.com admin.",
    showForward: true,
  });
}
