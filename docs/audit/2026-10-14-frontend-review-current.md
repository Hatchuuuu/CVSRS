# Current frontend, accessibility and motion review — 14 October 2026

**Coordinator follow-up:** FE-C01 through FE-C05 below were subsequently fixed and verified; the open statuses and blocking verdict below describe this review's initial snapshot. The coordinator added textarea descriptions, persistent queue announcement regions, instant keyboard tab scrolling and immediately readable service/FAQ text. Focused regressions and actual Chromium reduced-motion/keyboard checks passed. See [the consolidated stabilization report](2026-10-14-system-stabilization.md) and [independent final change review](2026-10-14-final-change-review.md) for final disposition and limits.

Reviewed the current working tree, including pre-existing uncommitted work. This report records source evidence, not a fresh whole-app browser pass. Parent-agent baseline/E2E results belong in the coordinating audit. No registration confirmation email was introduced. The incumbent PRODUCT.md/DESIGN.md and `layout.tsx:120` establish a light-only application; dark-only styles are outside the shipped scope.

## Implementation integrity

Pass at the source level: clinical pages reuse the same fields, notices, buttons and schedule states; capabilities gate sensitive controls; sample landing screens are labelled and hidden from assistive technology; no new animation or redesign is proposed. The remaining issues concern existing interactions. Do not interpret this as full WCAG compliance or production certification.

| Dimension | Provisional score | Evidence and limit |
| --- | --- | --- |
| Accessibility | 3/4 | Visible focus, skip link, labelled forms and nested disclosure recovery; textarea errors remain unassociated with their fields |
| Performance | 3/4 | Static clinical surfaces, bounded polling and observer cleanup; FAQ animates layout, without measured frame evidence |
| Theming | 4/4 within shipped scope | Semantic operational palette, forced light theme; dormant dark variants were excluded |
| Responsive design | 3/4 | 44px shared controls, wrapping layouts, measured header offset, scrollable tables; this pass did not run browser zoom or touch hardware |
| Implementation integrity | 3/4 | Consistent product-specific surfaces; keyboard motion remains in landing controls |
| Total | 16/20, provisional | Source review only; scores must be revisited with current browser evidence |

## Findings and disposition

| ID | Priority | Location | Verified behavior | Smallest correction / reproduction |
| --- | --- | --- | --- | --- |
| FE-C01 | P2, fixed | `src/app/globals.css:248`; callers `src/components/ui.tsx:62,106`, `src/components/public-nav.tsx:45,47,86`, `src/app/children/page.tsx:100`, `src/app/_landing/landing.css:281,367` | Reduced-motion removed transform transitions but only reset button presses. Link presses and SVG hover arrows still changed transform, including landing buttons. | Existing reduced-motion block now resets link press and affected SVG hover transforms with sufficient cascade precedence. Color/opacity feedback and meaningful disclosure rotations remain. Focused regression failed before the fix, then 7/7 tests passed; focused ESLint passed. Browser computed-style check remains pending. |
| FE-C02 | P2, open | `src/app/_landing/service-explorer.tsx:39–60`; `src/app/_landing/landing.css:2735–2740` | Arrow/Home/End tab selection calls the same smooth-scrolling handler as a pointer. The selected icon plays 360ms keyframes and the panel's actual explanatory text fades for 360ms after a 60ms delay on every selection. | Keep keyboard tab navigation and explanatory copy immediate; illustrative demo choreography can remain. Reproduce at phone width with repeated Right/Left/Home/End; assert no smooth scroll and immediately readable panel copy. The source proves the timers; perceived feel was not browser-checked. |
| FE-C03 | P2, open | `src/app/children/[childId]/checkin.tsx:48–49`; `src/app/clinic/[clinicId]/clinical/privacy-form.tsx:27–28`; `src/app/clinic/[clinicId]/content/forms.tsx:68–70` | Raw textareas expose `aria-invalid`, but adjacent inline error text has no ID/`aria-describedby`. The content editor's instructional hint is likewise unassociated. Shared TextField already handles these associations correctly. | Give hint/error paragraphs stable IDs and join them in `aria-describedby`. Reproduce with a mocked validation failure, then focus the textarea and assert its accessible description names the relevant error. Error summaries already announce failures, so this is a field-revisit gap, not an entirely missing error announcement. |
| FE-C04 | P2, open | `src/app/display/[clinicId]/board.tsx:21,40,61–64` | Every successful five-second poll updates a seconds-bearing timestamp inside `role=status`, even when queue numbers do not change. That creates repeated polite announcements unrelated to a newly called ticket. The calling live region is also mounted only when the calling list becomes non-empty. | Keep freshness visible without placing its ticking timestamp in a live region; announce connection-state changes and changed calls in persistent regions. Reproduce using fixed queue data with advancing `asOf`, then change empty calling list to one ticket. Actual screen-reader delivery remains untested. |
| FE-C05 | P3, open / bounded performance risk | `src/app/_landing/landing.css:2361–2366,2957–2959` | FAQ disclosure transitions `block-size` for 320ms and enters answer text for 420ms after a 60ms delay, including keyboard activation. It moves layout rather than just compositing, and the text timer outlasts the disclosure timer. | Prefer immediate FAQ content for repeated keyboard use; removing layout/text entrance motion is smaller than replacing it with new choreography. No dropped-frame claim is made without a profile. |

## Motion review (Emil / review-animations format)

| Before | After | Why |
| --- | --- | --- |
| Reduced-motion link presses and arrow hovers retained transforms | Shared reduced-motion transform reset (implemented) | Honors the user's movement preference without removing color/opacity state feedback |
| Keyboard tab movement smooth-scrolls and replays a 360ms icon/text entrance | Instant keyboard selection and explanatory copy; keep approved sample choreography | Repeated keyboard navigation should not wait for decorative motion |
| FAQ uses a 320ms layout transition and delayed 420ms text entrance | Immediate FAQ content, particularly on keyboard activation | Removes layout animation risk and delayed reading without adding features |

Verdict: **Block motion approval** while FE-C02 remains, using review-animations' keyboard-frequency criterion. This is a craft verdict rather than a claim that every landing illustration is defective. The incumbent authorizes slow illustrative landing motion; durations above 300ms on those demos, finite clinical called-ticket pulses, and centered modal origins were not counted as regressions. No optional motion opportunities were added because the requested scope excludes new animation/features.

## Coverage inspected

Inspected current source for global tokens/CSS, landing CSS/motion/tabs/demos, root chrome/public and signed-in navigation, theme provider, shared UI/disclosure/confirmation components, legal frame/footer, family registry/check-in/booking/edit/records, profile/password/MFA, staff workspace/queue/record/actions, content/privacy editors, reports/audit, inventory/cold-chain/transfers, and queue display. Read current request/notice/focus helper contracts and scanned remaining form/control sites. Existing module inventories are contextual cross-references, not newly rerun runtime evidence.

The existing E2E suite checks axe WCAG 2.0–2.2 A/AA tags at 375/1280px in public legal and signed-in family/staff pages (`05-accessibility`), reflow at 320/768/1440px (`10-responsive`), and opened menus/forms/confirmations with real keyboard traversal (`13-interaction-accessibility`). These are useful checks, but axe resting-state scans do not prove screen-reader announcements, reduced-motion computed styles, rapid service tabs, hardware camera scanning or physical touch behavior. Source-regex motion tests protect declared policy; they do not measure animation feel.

Recommended small missing browser regressions: reduced-motion link press/SVG hover computed transforms; rapid landing keyboard tabs; mocked textarea field errors plus accessible descriptions; queue display unchanged-data polling and empty-to-called announcements; keyboard focus visibility under sticky child identity. Treat the latter as a verification task, not a confirmed defect without a rendered reproduction.

## Checks and limits

- Read relevant installed Next.js accessibility/CSS guides before the CSS edit.
- Regression red: `npx vitest run tests/unit/shell-motion.test.ts` failed on missing reduced-motion link protection.
- Regression green: the same command passed 7/7 tests after the shared CSS change.
- `npx eslint tests/unit/shell-motion.test.ts` exited 0.
- Parent owns full type/lint/unit/build/E2E checks and current rendered evidence.

No live-browser slow-motion, frame-by-frame, cross-engine, screen-reader, camera or physical-device feel check was completed by this reviewer. No claims about dropped frames or full WCAG conformance are warranted from source alone. No new dependencies, optional animations, redesign, account confirmation flow or unrelated source changes were introduced.
