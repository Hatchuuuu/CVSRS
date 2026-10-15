interface CertificateFact {
  status: string;
  issued_at?: unknown;
  content_hash: string;
  recomputed: string;
  sha256: string | null;
  pdf_actual: string | null;
}

/** Pending certificates need no document; once issued, even a later revocation retains its frozen bytes. */
export function invalidCertificates(rows: CertificateFact[]): number {
  return rows.filter((row) => row.content_hash !== row.recomputed
    || ((row.status === "issued" || row.issued_at != null) && (!row.sha256 || !row.pdf_actual))
    || (row.sha256 != null && row.sha256 !== row.pdf_actual)).length;
}
