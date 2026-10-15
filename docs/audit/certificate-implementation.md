# Certificate render and storage review (E06, E13)

Date: 2026-09-30. Scope: `0027_certificate_attestation.sql`, certificate service, DB tests, and operator configuration. Reviewed and tested only against the disposable local PostgreSQL adapter. No live Supabase or provider setup was performed.

## Result

- E06 generation race: `begin_certificate_render` locks the pending certificate before rotating its token. `store_certificate_pdf` locks the same row and requires the current token hash and frozen content hash. If a newer begin wins, a prior renderer receives `CV409`; if storage wins, a later begin sees the issued status and receives `CV409`. The public verifier returns no result for a pending or superseded token.
- E13 direct-RPC trust boundary: the old four-argument `store_certificate_pdf` function is dropped. The new function requires a SHA-256 HMAC over certificate ID, content hash, token hash, and exact PDF checksum using a secret held in a private database table and the server runtime. An authenticated staff RPC client can begin a render but cannot store arbitrary PDF bytes without that secret. An absent or mismatched secret fails closed. The table has no direct grants to API roles, including `service_role`.
- Server path: `renderAndStore` signs the PDF it just rendered, then stores it with current hashes. The server secret is required to be at least 32 characters. A completed request retried after an unknown response reads the already stored document and returns issued. SQL command receipts replay the same committed store operation but reject a reused key with different hashes; receipts and audit contain no plaintext verification token.

## Evidence

- `CVSRS_TEST_DB_NAME=cvsrs_audit_cert npx vitest run --config vitest.db.config.ts tests/db/certificates.test.ts`: 20/20 tests passed. The setup rebuilt only the disposable `cvsrs_audit_cert` database. Cases include simultaneous begins, stale generation, wrong content hash, valid PDF with forged/missing/other-byte HMAC, absent and rotated DB secret, old RPC removal, exact replay and conflicting replay, public token verification, grants, and private table access.
- `npx eslint src/lib/certificates/service.ts tests/db/certificates.test.ts`: passed.
- `git diff --check -- .env.example README.md src/lib/certificates/service.ts tests/db/certificates.test.ts supabase/migrations/0027_certificate_attestation.sql`: passed (Git reported only CRLF normalization warnings).
- `npm run typecheck`: blocked by `tests/unit/auth-redirect.test.ts` importing missing `@/lib/auth/redirect`, outside this certificate scope at review time. Certificate-specific lint and DB tests passed.

## Deployment and residual boundary

The migration deliberately creates no secret row. Before issuing certificates, generate a fresh random 32-byte or longer secret, put it in the server-side `CVSRS_CERTIFICATE_RENDER_SECRET`, and insert the identical value into `private.certificate_render_secrets` through a privileged maintenance connection with a parameterized statement. See `.env.example` and `README.md`. Do not expose the value to a browser, application logs, migration, or SQL console history. Coordinate rotation because in-flight renders may need a retry.

The HMAC proves the bytes were approved by a holder of the server secret; it does not independently prove that the PDF depicts the frozen snapshot or that the QR shown in the PDF is the token returned by `begin_certificate_render`. Trust therefore remains in the server renderer and secret isolation. Renderer compromise, server secret exposure, or a privileged database owner can still issue deceptive content. A separate authoritative PDF reconstruction/inspection policy and live deployment validation are needed before claiming that stronger property. Certificate format and signatory approval remain the G03 quality gate.

## E17 renderer follow-up (2026-09-30)

The renderer now embeds a bundled Noto Sans CJK font from `src/lib/certificates/fonts/` (OFL license included) instead of replacing characters outside Latin-1 with question marks. It checks all snapshot and verification URL text for supported glyphs before producing a PDF and returns a field-specific 422 error for unsupported characters. Wrapping measures the embedded font and splits long unbroken values at glyph boundaries. Rows and continuation headings move to new pages as needed. `next.config.ts` includes the font files in server output tracing; the source OTF is about 16.4 MB, although PDF output embeds a subset. Rendering reads only the bundled local file, with no runtime font download.

Focused verification: `npm run typecheck` and targeted ESLint passed; `npx vitest run tests/unit/certificate-pdf.test.ts` passed 6/6. The tests use extracted PDF text to verify Latin diacritics and Chinese characters, reject an unsupported emoji explicitly, and inspect word bounding boxes for long identifiers using PyMuPDF on this Windows machine (or Poppler `-bbox` where available). These checks do not establish final visual approval of the clinical certificate format or a live deployment build.

**Open workflow limitation:** The issue route catches render failures and leaves a frozen `pending` certificate. A corrected source record cannot change that snapshot, and the current SQL forbids revoking or replacing a pending certificate. Unsupported glyph errors therefore need a pending-certificate void/reissue path and a staff-facing explanation before this route can be considered fully recoverable. This is separate from the renderer's explicit error behavior when called directly.
