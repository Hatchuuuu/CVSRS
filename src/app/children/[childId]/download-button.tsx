// Moved to the shared component so staff certificate and report downloads use the same fetch-to-blob pattern.
// Kept as a re-export for existing importers (tests/unit/family-controls.test.ts).
export { DownloadCertificateButton } from "@/components/download-button";
