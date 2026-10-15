"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, X } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { parseCardText, type CardCandidate } from "@/lib/card-ocr/parse";
import type { Worker } from "tesseract.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function CardScanner({ onRows, onScanningChange, disabled = false }: { onRows: (rows: CardCandidate[]) => void; onScanningChange?: (scanning: boolean) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<"idle" | "scanning" | "error" | "done">("idle");
  const [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);
  const activeWorker = useRef<Worker | null>(null);
  const cancel = () => { abort.current?.abort(); void activeWorker.current?.terminate(); activeWorker.current = null; onScanningChange?.(false); };
  useEffect(() => () => { abort.current?.abort(); void activeWorker.current?.terminate(); }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
      setStatus("error");
      setMessage("Choose a JPG, PNG, or other image up to 8 MB.");
      return;
    }
    cancel();
    const controller = new AbortController();
    abort.current = controller;
    setStatus("scanning");
    onScanningChange?.(true);
    setMessage("Reading the card on this device…");
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Scan canceled")), { once: true }));
    void aborted.catch(() => undefined);
    const deadline = setTimeout(() => controller.abort("timeout"), 90_000);
    try {
      const { createWorker } = await import("tesseract.js");
      if (controller.signal.aborted) throw new Error("Scan canceled");
      const creation = createWorker("eng", 1, { workerPath: "/ocr/worker.min.js", workerBlobURL: false, corePath: "/ocr", langPath: "/ocr", logger: (event) => {
        if (!controller.signal.aborted && event.status === "recognizing text") setMessage(`Reading the card on this device… ${Math.round(event.progress * 100)}%`);
      } });
      void creation.then(worker => { if (controller.signal.aborted) return worker.terminate(); }).catch(() => undefined);
      const worker = await Promise.race([creation, aborted]);
      activeWorker.current = worker;
      const result = await Promise.race([worker.recognize(file), aborted]);
      await worker.terminate();
      activeWorker.current = null;
      if (controller.signal.aborted) return;
      const rows = parseCardText(result.data.text);
      if (!rows.length) throw new Error("No vaccine rows were recognized. Try a clearer photo or enter the details manually.");
      if (rows.length > 20) throw new Error("More than 20 entries were found. Photograph one part of the card at a time so every entry can be reviewed.");
      onRows(rows);
      setStatus("done");
      setMessage(`${rows.length} possible ${rows.length === 1 ? "entry" : "entries"} found. Check every field against the paper card.`);
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      setStatus("error");
      setMessage(controller.signal.reason === "timeout" ? "Scanning took too long. Try a smaller, clearer image or enter the card manually." : error instanceof Error ? error.message : "The card could not be read. Enter the details manually.");
    } finally {
      clearTimeout(deadline);
      if (abort.current === controller) { await activeWorker.current?.terminate(); activeWorker.current = null; onScanningChange?.(false); }
    }
  }

  return (
    <section aria-labelledby="scan-card-heading" className="mb-6 border-b border-line pb-6">
      <h3 id="scan-card-heading" className="mb-2 text-lg font-bold">Scan the vaccination card</h3>
      <p className="mb-3 max-w-prose text-sm text-ink-soft">The photo is processed only in this browser and is not uploaded or saved. You can always enter the card manually.</p>
      <label className="mr-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2 font-semibold hover:bg-sunken focus-within:ring-2 focus-within:ring-primary">
        <Camera aria-hidden className="size-4" /> Take photo
        <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={choose} disabled={disabled || status === "scanning"} />
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2 font-semibold hover:bg-sunken focus-within:ring-2 focus-within:ring-primary">
        Upload image
        <input className="sr-only" type="file" accept="image/*" onChange={choose} disabled={disabled || status === "scanning"} />
      </label>
      {status === "scanning" ? <Button className="ml-3" variant="secondary" type="button" onClick={() => { cancel(); setStatus("idle"); setMessage(""); }}><X aria-hidden className="size-4" /> Cancel</Button> : null}
      {message ? <Notice tone={status === "error" ? "attention" : status === "done" ? "success" : "info"} role="status" title={status === "error" ? "Card not read" : status === "done" ? "Draft ready to review" : "Reading card"}>{message}</Notice> : null}
    </section>
  );
}
