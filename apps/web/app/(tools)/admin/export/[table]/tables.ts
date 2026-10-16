import {
  emailSends,
  events,
  handRaises,
  jobRuns,
  partners,
  prerunNotes,
  questionnaireResponses,
  subscribers,
  subscriptions,
  suppressions,
} from "@jw/db";

export const EXPORTS = {
  subscribers,
  subscriptions,
  partners,
  hand_raises: handRaises,
  questionnaire_responses: questionnaireResponses,
  events,
  email_sends: emailSends,
  suppressions,
  job_runs: jobRuns,
  prerun_notes: prerunNotes,
} as const;

export type ExportTable = keyof typeof EXPORTS;
export const EXPORT_TABLES = Object.keys(EXPORTS) as ExportTable[];
