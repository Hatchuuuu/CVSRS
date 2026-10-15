# Graph Report - src  (2026-10-14)

## Corpus Check
- 334 files · ~108,082 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1390 nodes · 3487 edges · 95 communities (55 shown, 40 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Auth modules
- Components modules
- Security modules
- _Landing modules
- Components modules
- [Childid] modules
- Today modules
- Inventory modules
- Validation modules
- Validation modules
- Review modules
- [Childid] modules
- Sms modules
- [Childid] modules
- Certificates modules
- Validation modules
- Reports modules
- [Clinicid] modules
- Children modules
- Api modules
- Validation modules
- Validation modules
- Cold Chain modules
- [Childid] modules
- Validation modules
- [Childid] modules
- Access modules
- Accessibility modules
- Validation modules
- Validation modules
- Validation modules
- Clinic modules
- Access modules
- Api modules
- Transfers modules
- Settings modules
- Catchup Plan modules
- Api modules
- Clinical modules
- Content modules
- Validation modules
- Validation modules
- Fonts modules
- Help modules
- Db modules
- Sms modules
- Children modules
- _Landing modules
- Children modules
- [Childid] modules
- Profile modules
- Edit Requests modules
- Qr modules
- Qr modules
- Record Status modules
- Contact Invalid modules
- Merges modules
- Paper Tallies modules
- Resolve modules
- Status modules
- Verify modules
- Resolve Link modules
- Resolve modules
- Guardian Links modules
- App modules
- Certificates modules
- History modules
- Queue Status modules
- Schedule modules
- Submit modules
- Catchup Reviews modules
- Appointments modules
- History modules
- Submit modules
- Refresh modules
- Verify Contact modules
- Display modules
- Accept modules
- Release modules
- Discard modules
- Impact modules
- [Versionid] modules
- Submit modules
- Roster modules
- Staff Applications modules
- Ledger modules
- Stock modules
- Clinics modules
- Care Content modules
- Withdraw modules

## God Nodes (most connected - your core abstractions)
1. `api()` - 148 edges
2. `useMutation()` - 131 edges
3. `Notice()` - 69 edges
4. `formatDate()` - 62 edges
5. `Button()` - 51 edges
6. `requireClinicStaff()` - 45 edges
7. `ResultRegion()` - 44 edges
8. `TextField()` - 38 edges
9. `StatusChip()` - 32 edges
10. `EmptyState()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `abortableSleep()` --indirect_call--> `done()`  [INFERRED]
  lib/worker/loop.ts → app/auth/sign-up/route.ts
- `Account()` --calls--> `requireViewer()`  [EXTRACTED]
  app/account/page.tsx → lib/server/viewer.ts
- `Cancel()` --calls--> `useMutation()`  [EXTRACTED]
  app/children/[childId]/move-record.tsx → lib/client/api.ts
- `One()` --calls--> `useMutation()`  [EXTRACTED]
  app/children/privacy-notice.tsx → lib/client/api.ts
- `RevokeForm()` --calls--> `useMutation()`  [EXTRACTED]
  app/clinic/[clinicId]/children/[childId]/certificates.tsx → lib/client/api.ts

## Import Cycles
- None detected.

## Communities (95 total, 40 thin omitted)

### Community 0 - "Auth modules"
Cohesion: 0.08
Nodes (55): AccountSecurity(), GET(), GET(), POST(), Jar, POST(), revokeRemoteSessions(), signedOut() (+47 more)

### Community 1 - "Components modules"
Cohesion: 0.05
Nodes (44): size, ClinicLayout(), ICONS, NavItem, StaffNav(), HeaderLink, metadata, RootLayout() (+36 more)

### Community 2 - "Security modules"
Cohesion: 0.07
Nodes (47): GET(), GET, GET, range, asOf, GET, GET, date (+39 more)

### Community 3 - "_Landing modules"
Cohesion: 0.06
Nodes (46): metadata, ResetPassword(), DisplayBoard(), DisplayData, noSubscription(), Display(), metadata, metadata (+38 more)

### Community 4 - "Components modules"
Cohesion: 0.08
Nodes (31): PasswordForm(), ProfileForm(), ForgotPassword(), metadata, RecoveryRequestForm(), Account(), metadata, ResetPasswordForm() (+23 more)

### Community 5 - "[Childid] modules"
Cohesion: 0.07
Nodes (40): StaffApplicationForm(), WithdrawApplicationButton(), ConfirmIdentity(), EditIdentity(), GuardianActions(), StaffQr(), CatchupPanel(), CatchupPlan (+32 more)

### Community 6 - "Today modules"
Cohesion: 0.07
Nodes (38): canOpenChildRecord(), childRecordHref(), AppointmentRow(), AutoRefresh(), CheckInAnnounce, CheckInRegion(), CreateSessionForm(), Hit (+30 more)

### Community 7 - "Inventory modules"
Cohesion: 0.07
Nodes (35): CountForm(), LedgerRow, LocationForm(), LotActions(), LotTraceList(), Option, opts(), ReceiveForm() (+27 more)

### Community 8 - "Validation modules"
Cohesion: 0.06
Nodes (27): POST, POST, GET, POST, POST, POST, POST, POST (+19 more)

### Community 9 - "Validation modules"
Cohesion: 0.07
Nodes (24): POST, POST, POST, POST, POST, POST, POST, POST (+16 more)

### Community 10 - "Review modules"
Cohesion: 0.09
Nodes (29): caseRenderer, caseTitle(), classifyStockCase(), present(), quantity(), REVIEW_CASE_KINDS, ReviewCaseKind, StockCaseShape (+21 more)

### Community 11 - "[Childid] modules"
Cohesion: 0.09
Nodes (28): CertificatesPanel(), noticeKey(), RetryButton(), RevokeForm(), StaffCertificate, Hold, HoldsPanel(), noticeKey() (+20 more)

### Community 12 - "Sms modules"
Cohesion: 0.11
Nodes (21): body, GET, POST, register(), DispatchResult, dispatchSms(), getSmsProvider(), SmsProvider (+13 more)

### Community 13 - "[Childid] modules"
Cohesion: 0.09
Nodes (28): AskTheClinic(), CATEGORY, CheckinView, EditRequestForm(), Cancel(), LABEL, MoveRecord(), MyTransfers (+20 more)

### Community 14 - "Certificates modules"
Cohesion: 0.11
Nodes (20): POST, POST, GET, POST, POST, GET, CertificateSnapshot, fmtDate() (+12 more)

### Community 15 - "Validation modules"
Cohesion: 0.09
Nodes (18): GET, POST, POST, POST, POST, GET, POST, POST (+10 more)

### Community 16 - "Reports modules"
Cohesion: 0.13
Nodes (20): Backlog, cell(), isDate(), metadata, ReportData, Reports(), STATUS_TEXT, DownloadButton() (+12 more)

### Community 17 - "[Clinicid] modules"
Cohesion: 0.11
Nodes (21): GuardianChild(), MyChildren(), ChildPage(), Age, metadata, ScheduleVersion(), Version, ScheduleActions() (+13 more)

### Community 18 - "Children modules"
Cohesion: 0.13
Nodes (21): AddChildForm(), Clinic, LinkRequestForm(), QrPanel(), REL, Clinic, metadata, MyChild (+13 more)

### Community 19 - "Api modules"
Cohesion: 0.15
Nodes (21): FILTERS, Followup(), Item, metadata, OUTCOME, STATUS, Worklist, metadata (+13 more)

### Community 20 - "Validation modules"
Cohesion: 0.10
Nodes (17): POST, POST, POST, POST, GET, POST, GET, POST (+9 more)

### Community 21 - "Validation modules"
Cohesion: 0.11
Nodes (16): POST, POST, POST, POST, POST, POST, POST, adjustmentBody (+8 more)

### Community 22 - "Cold Chain modules"
Cohesion: 0.11
Nodes (19): Audit(), metadata, Result, Row, ReadingForm(), ACTION, ColdChain(), metadata (+11 more)

### Community 23 - "[Childid] modules"
Cohesion: 0.15
Nodes (17): AdministerPanel(), clinicNow(), CorrectionForm(), ExceptionForm(), Hit, StockLocationOption, StockLotOption, toIso() (+9 more)

### Community 24 - "Validation modules"
Cohesion: 0.11
Nodes (16): POST, POST, GET, POST, POST, POST, POST, cancelTransferBody (+8 more)

### Community 25 - "[Childid] modules"
Cohesion: 0.15
Nodes (21): announceVisitChange(), AppointmentItem(), BookVisit(), clearVisitNotice(), emit(), familyVisitError(), fmtDay(), getVisitNotice() (+13 more)

### Community 26 - "Access modules"
Cohesion: 0.13
Nodes (17): metadata, Row, StaffAccess(), StaffRowActions(), membershipStatusChip(), Tone, AdminConsole(), Application (+9 more)

### Community 27 - "Accessibility modules"
Cohesion: 0.15
Nodes (9): metadata, SECTIONS, metadata, SECTIONS, metadata, SECTIONS, LegalPage(), LegalSection (+1 more)

### Community 28 - "Validation modules"
Cohesion: 0.13
Nodes (12): POST, POST, POST, POST, POST, POST, administrationBody, approveCorrectionBody (+4 more)

### Community 29 - "Validation modules"
Cohesion: 0.13
Nodes (13): GET, POST, POST, POST, GET, POST, GET, POST (+5 more)

### Community 30 - "Validation modules"
Cohesion: 0.13
Nodes (12): POST, GET, POST, POST, POST, GET, POST, attemptBody (+4 more)

### Community 31 - "Clinic modules"
Cohesion: 0.18
Nodes (14): ClinicHome(), metadata, StaffApplication, STEP_ICON, STEP_STATUS, StepState, activeClinicAccess(), ClinicAccess (+6 more)

### Community 32 - "Access modules"
Cohesion: 0.14
Nodes (11): EXTRA, RequestStaffForm(), ApplicationDecision(), CLINICAL_ROLES, AccountType, AlternateLink, COPY, COPY (+3 more)

### Community 33 - "Api modules"
Cohesion: 0.16
Nodes (11): GET, GET, GET, statusSchema, GET, POST, GET, auditSearchArgs() (+3 more)

### Community 34 - "Transfers modules"
Cohesion: 0.15
Nodes (13): metadata, OutageForms(), PrintButton(), FindOrRegister(), metadata, In, metadata, Out (+5 more)

### Community 35 - "Settings modules"
Cohesion: 0.21
Nodes (10): OpsCheckForm(), Profile, ProfileForm(), ProfileValues, ZONES, Check, KIND, metadata (+2 more)

### Community 36 - "Catchup Plan modules"
Cohesion: 0.17
Nodes (7): GET, POST, GET, GET, GET, api(), reply()

### Community 37 - "Api modules"
Cohesion: 0.18
Nodes (7): GET, POST, GET, DEFAULT_RATE, Opts, uuid, StoreFailurePolicy

### Community 38 - "Clinical modules"
Cohesion: 0.24
Nodes (9): AddAntigenForm(), AddProductForm(), ImportScheduleForm(), MasterStatusButton(), ClinicalConfig(), Master, metadata, tone() (+1 more)

### Community 39 - "Content modules"
Cohesion: 0.27
Nodes (8): Act(), ContentForm(), Version, WithReason(), NewContent(), Content(), metadata, STATUS

### Community 40 - "Validation modules"
Cohesion: 0.24
Nodes (7): GET, POST, POST, POST, declineTransferBody, initiateTransferBody, requestTransferBody

### Community 41 - "Validation modules"
Cohesion: 0.22
Nodes (7): POST, childFields, ChildInput, childPatchFields, confirmIdentityBody, relationshipEnum, verificationMethodEnum

### Community 42 - "Fonts modules"
Cohesion: 0.22
Nodes (9): Adobe copyright 2014â€“2021, SIL Open Font License 1.1, Source reserved font name, Certificate font, fontkit 2, FontTools 4.63.0, Google Fonts Noto Sans SC, NotoSansSC.ttf (+1 more)

### Community 43 - "Help modules"
Cohesion: 0.32
Nodes (6): GuardianLayout(), Help(), Item, metadata, PageTitle(), requireViewer()

### Community 44 - "Db modules"
Cohesion: 0.32
Nodes (6): ApiCtx, RPC_ALLOWLIST, RpcClient, RpcName, SessionInfo, Viewer

### Community 45 - "Sms modules"
Cohesion: 0.38
Nodes (6): eventSchema, handleSmsWebhook(), SmsEvent, validateSmsWebhook(), verifySignature(), WebhookOutcome

### Community 46 - "Children modules"
Cohesion: 0.40
Nodes (4): GET, POST, searchQuery, staffRegisterBody

### Community 48 - "Children modules"
Cohesion: 0.50
Nodes (3): GET, POST, createProvisionalBody

### Community 49 - "[Childid] modules"
Cohesion: 0.50
Nodes (3): GET, PATCH, updateChildBody

### Community 64 - "App modules"
Cohesion: 0.67
Nodes (3): Blue rounded square, Application SVG icon, White and light-blue stroked paths

## Knowledge Gaps
- **409 isolated node(s):** `Dose`, `ROWS`, `STOPS`, `SESSIONS`, `ServiceId` (+404 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api()` connect `Catchup Plan modules` to `Auth modules`, `Security modules`, `Db modules`, `Certificates modules`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Why does `getRpcClient()` connect `Security modules` to `Auth modules`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `createSupabaseClient()` connect `Security modules` to `Auth modules`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `api()` (e.g. with `.rpc()` and `.session()`) actually correct?**
  _`api()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Dose`, `ROWS`, `STOPS` to the rest of the system?**
  _409 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Auth modules` be split into smaller, more focused modules?**
  _Cohesion score 0.07981220657276995 - nodes in this community are weakly interconnected._
- **Should `Components modules` be split into smaller, more focused modules?**
  _Cohesion score 0.050203527815468114 - nodes in this community are weakly interconnected._