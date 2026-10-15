/**
 * TEST FIXTURE ONLY: a FICTIONAL schedule used to exercise the scheduling engine in automated tests. Never loaded into a development,
 * staging or production database. "DEMO — NOT FOR CLINICAL USE": the database accepts schedules marked isDemo only while
 * private.settings.demo_mode is on, which verify.sql requires to be off in every real deployment.
 * Antigens are invented (DEMO-ALPHA/BETA/GAMMA) and every number is deliberately arbitrary; nothing here corresponds to a
 * real vaccine, interval or programme.
 */
export const DEMO_ANTIGENS = [
  ["DEMO-ALPHA", "Demo antigen alpha (fictional)"],
  ["DEMO-BETA", "Demo antigen beta (fictional)"],
  ["DEMO-GAMMA", "Demo antigen gamma (fictional)"],
] as const;

export const DEMO_PRODUCTS = [
  { code: "DEMO-P-ALPHA", name: "Demo product alpha (fictional)", presentation: "single-dose demo vial", stockUnit: "vial", dosesPerContainer: 1, administrationUnit: "dose", antigenCodes: ["DEMO-ALPHA"], policyReference: "DEMO" },
  { code: "DEMO-P-COMBO", name: "Demo combination alpha+beta (fictional)", presentation: "single-dose demo vial", stockUnit: "vial", dosesPerContainer: 1, administrationUnit: "dose", antigenCodes: ["DEMO-ALPHA", "DEMO-BETA"], policyReference: "DEMO" },
  { code: "DEMO-P-GAMMA", name: "Demo product gamma (fictional)", presentation: "single-dose demo vial", stockUnit: "vial", dosesPerContainer: 1, administrationUnit: "dose", antigenCodes: ["DEMO-GAMMA"], policyReference: "DEMO" },
] as const;

const d = (value: number, unit: "days" | "weeks" | "months") => ({ value, unit });

export function demoSchedule(label: string, over: { fixtures?: unknown[]; isDemo?: boolean; sourceReference?: string; cohort?: object } = {}) {
  return {
    programCode: "routine",
    versionLabel: label,
    isDemo: over.isDemo ?? true,
    sourceReference: over.sourceReference ?? "",
    cohort: over.cohort ?? {},
    rules: [
      { sequence: 1, requirement: "A1", antigen: "DEMO-ALPHA", series: "A", ordinal: 1, targetOffset: d(10, "days"), minimumAge: d(7, "days"), dueWindow: { start: d(10, "days"), end: d(20, "days") } },
      { sequence: 2, requirement: "A2", antigen: "DEMO-ALPHA", series: "A", ordinal: 2, targetOffset: d(30, "days"), minimumAge: d(21, "days"), dueWindow: { start: d(30, "days"), end: d(50, "days") } },
      { sequence: 3, requirement: "A3", antigen: "DEMO-ALPHA", series: "A", ordinal: 3, targetOffset: d(60, "days"), minimumAge: d(45, "days"), maximumAge: d(6, "months") },
      { sequence: 4, requirement: "B1", antigen: "DEMO-BETA", series: "B", ordinal: 1, targetOffset: d(2, "months"), minimumAge: d(1, "months"), acceptedProducts: ["DEMO-P-COMBO"] },
      { sequence: 5, requirement: "G1", antigen: "DEMO-GAMMA", series: "G", ordinal: 1, targetOffset: d(1, "months"), minimumAge: d(1, "months"), dueWindow: { end: d(2, "months") } },
    ],
    dependencies: [
      { rule: "A2", predecessor: "A1", minimumInterval: d(14, "days") },
      { rule: "A3", predecessor: "A2", minimumInterval: d(2, "weeks") },
    ],
    fixtures: structuredClone(over.fixtures ?? DEMO_FIXTURES), // clone: tests mutate payloads
  };
}

const A = (id: string, on: string) => ({ id, antigens: ["DEMO-ALPHA"], product: "DEMO-P-ALPHA", on });

export const DEMO_FIXTURES = [
  { name: "F01 before minimum age", dob: "2025-01-01", asOf: "2025-01-05", doses: [], expected: { A1: "not_yet_eligible", A2: "not_yet_eligible", A3: "not_yet_eligible", B1: "not_yet_eligible", G1: "not_yet_eligible" } },
  { name: "F02 target day", dob: "2025-01-01", asOf: "2025-01-11", doses: [], expected: { A1: "due_today", A2: "not_yet_eligible" } },
  { name: "F03 inside window", dob: "2025-01-01", asOf: "2025-01-15", doses: [], expected: { A1: "due_now" } },
  { name: "F04 window passed", dob: "2025-01-01", asOf: "2025-01-25", doses: [], expected: { A1: "overdue" } },
  { name: "F05 interval not yet elapsed", dob: "2025-01-01", asOf: "2025-01-20", doses: [A("d1", "2025-01-12")], expected: { A1: "completed", A2: "not_yet_eligible" } },
  { name: "F06 eligible but target in future", dob: "2025-01-01", asOf: "2025-01-26", doses: [A("d1", "2025-01-12")], expected: { A1: "completed", A2: "upcoming" } },
  { name: "F07 dose before minimum age is never credited", dob: "2025-01-01", asOf: "2025-01-20", doses: [A("d1", "2025-01-05")], expected: { A1: "staff_review_needed", A2: "not_yet_eligible" } },
  { name: "F08 past recommended date without overdue threshold", dob: "2025-01-01", asOf: "2025-03-10", doses: [A("d1", "2025-01-12"), A("d2", "2025-02-01")], expected: { A1: "completed", A2: "completed", A3: "past_recommended_date" } },
  { name: "F09 beyond maximum age needs review", dob: "2025-01-01", asOf: "2025-08-01", doses: [A("d1", "2025-01-12"), A("d2", "2025-02-01")], expected: { A3: "staff_review_needed" } },
  { name: "F10a calendar month clamp: eve", dob: "2025-08-31", asOf: "2025-09-29", doses: [], expected: { G1: "not_yet_eligible" } },
  { name: "F10b calendar month clamp: 31 Aug + 1 month = 30 Sep", dob: "2025-08-31", asOf: "2025-09-30", doses: [], expected: { G1: "due_today" } },
  { name: "F11a leap-year month end: eve", dob: "2024-01-31", asOf: "2024-02-28", doses: [], expected: { G1: "not_yet_eligible" } },
  { name: "F11b leap-year month end: 31 Jan + 1 month = 29 Feb", dob: "2024-01-31", asOf: "2024-02-29", doses: [], expected: { G1: "due_today" } },
  {
    name: "F12 combination product credits two antigens with one dose",
    dob: "2025-01-01", asOf: "2025-03-06",
    doses: [{ id: "c1", antigens: ["DEMO-ALPHA", "DEMO-BETA"], product: "DEMO-P-COMBO", on: "2025-03-05" }],
    expected: { A1: "completed", B1: "completed", A2: "not_yet_eligible", G1: "overdue" },
  },
  { name: "F13 product not accepted by the rule earns no credit", dob: "2025-01-01", asOf: "2025-03-06", doses: [{ id: "x1", antigens: ["DEMO-BETA"], product: "DEMO-P-ALPHA", on: "2025-03-05" }], expected: { B1: "past_recommended_date" } },
];
