# Importing your clinic's vaccination schedule

This software ships **no vaccination schedule**. Dates and eligibility only appear after your clinical lead imports an authoritative schedule and approves it. Until then the app still works for registration, booking, queueing, stock and recording vaccinations; it simply shows "No approved schedule is active".

## Steps (Clinical setup page)
1. **Technical administrator** adds the antigens and vaccine products your clinic uses (Clinical setup → Antigens / Vaccine products). Each starts as a draft.
2. A **clinical lead who is a different person** activates each antigen and product.
3. A **clinical staff member (nurse/midwife)** or lead imports the schedule as JSON (below). It is created as a draft.
4. Add test cases (`fixtures`). Submit for review. A **different clinical lead** approves; approval is blocked unless every test case passes.
5. The approver activates it with a start date (today or later). The previous version keeps governing until the new one starts.

## JSON format (structure only — fill in values from your authoritative source)
```json
{
  "programCode": "routine",
  "versionLabel": "<your label, e.g. year/version>",
  "sourceReference": "<authoritative document, version and date>",
  "cohort": { "dobFrom": "<YYYY-MM-DD optional>", "dobTo": "<YYYY-MM-DD optional>" },
  "rules": [
    {
      "sequence": 1,
      "requirement": "<code shown to staff and parents>",
      "antigen": "<antigen code>",
      "series": "<series code>",
      "ordinal": 1,
      "targetOffset": { "value": <number>, "unit": "days|weeks|months" },
      "minimumAge":   { "value": <number>, "unit": "days|weeks|months" },
      "maximumAge":   { "value": <number>, "unit": "days|weeks|months" },
      "dueWindow": { "start": { "value": <n>, "unit": "..." }, "end": { "value": <n>, "unit": "..." } },
      "acceptedProducts": ["<product code>"]
    }
  ],
  "dependencies": [
    { "rule": "<requirement>", "predecessor": "<earlier requirement>", "minimumInterval": { "value": <n>, "unit": "days|weeks|months" } }
  ],
  "fixtures": [
    {
      "name": "<test case name>",
      "dob": "<YYYY-MM-DD>",
      "asOf": "<YYYY-MM-DD>",
      "doses": [ { "id": "d1", "antigens": ["<antigen code>"], "product": "<product code>", "on": "<YYYY-MM-DD>" } ],
      "expected": { "<requirement>": "completed | not_yet_eligible | upcoming | due_today | due_now | overdue | past_recommended_date | staff_review_needed" }
    }
  ]
}
```
Rules for this format:
- Every field except `sequence`, `requirement`, `antigen` is optional; leave out anything your policy does not state (an unstated limit is treated as unknown, never zero).
- `sequence` numbers must increase, and a `predecessor` must have a lower `sequence` than the rule that depends on it.
- Months are calendar months. Rules never assume a month is 30 days.
- A dose given outside a rule's limits is **never credited automatically**; it goes to staff review. The software has no grace periods and no catch-up logic.
- `overdue` only appears when you define a `dueWindow.end`; otherwise a passed target shows "Past recommended date — review with the clinic".
- Write test cases that cover the edge cases your policy cares about (earliest ages, intervals, combination products). They are the gate for approval.

## Who is responsible
The clinical lead is responsible for the correctness of everything imported. Record the source in `sourceReference`. See `docs/implementation/external-validation.md`.
