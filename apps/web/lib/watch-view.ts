// Choices on the Watchlist signup form. Stored as preferences, except revenue, which has a column.
export const WATCH_ROLES: Array<[string, string]> = [
  ["owner", "Owner or president"],
  ["controller", "Controller or CFO"],
  ["credit", "Credit manager"],
  ["ar", "Accounts receivable or bookkeeping"],
  ["other", "Something else"],
];

export const INDUSTRIES: Array<[string, string]> = [
  ["distribution", "Distribution or wholesale"],
  ["manufacturing", "Manufacturing"],
  ["subcontractor", "Construction subcontractor or supplier"],
  ["staffing", "Staffing"],
  ["services", "Business services"],
  ["other", "Something else"],
];

export const REVENUE_BANDS: Array<[string, string]> = [
  ["under-1m", "Under $1 million"],
  ["1m-5m", "$1 million to $5 million"],
  ["5m-20m", "$5 million to $20 million"],
  ["20m-100m", "$20 million to $100 million"],
  ["100m+", "Over $100 million"],
];

export const AR_BANDS: Array<[string, string]> = [
  ["under-250k", "Under $250,000"],
  ["250k-1m", "$250,000 to $1 million"],
  ["1m-5m", "$1 million to $5 million"],
  ["5m+", "Over $5 million"],
];

export const pick = (options: Array<[string, string]>, value: string | null) =>
  value && options.some(([v]) => v === value) ? value : null;
