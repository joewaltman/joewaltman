import { getDb } from "@jw/db";
import { type Digest, buildDigest, digestWindow } from "@jw/radar";

export const CLIENT_BANDS: Array<[string, string]> = [
  ["1-10", "1 to 10"],
  ["11-50", "11 to 50"],
  ["51-200", "51 to 200"],
  ["201-1000", "201 to 1,000"],
  ["1000+", "More than 1,000"],
];

// Last week's digest for one or more areas, as the public pages show it.
export async function lastWeek(clusters: string[], now = new Date()): Promise<Digest> {
  return buildDigest(getDb(), { ...digestWindow(now), clusters });
}
