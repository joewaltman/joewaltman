import type { Tool } from "@jw/db";

export const TOOL_INFO: Record<Tool, { name: string; path: string }> = {
  radar: { name: "New Business Radar", path: "/newbizradar" },
  tariff: { name: "Tariff Refund Tool", path: "/tariffrefund" },
  watchlist: { name: "Customer Watchlist", path: "/watchlist" },
  aiwork: { name: "California AI-at-Work Checker", path: "/aiwork" },
};
