"use client";
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button, Notice } from "@/components/ui";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

/** A QR pass code is a long random token, so anything that is not a plain token-looking string is ignored (a QR that holds a web address, for example). */
const looksLikeToken = (s: string) => /^[A-Za-z0-9_\-.~]{16,200}$/.test(s);

/**
 * Camera scan for the QR pass. Uses the browser's built-in barcode detector where it exists; otherwise says so and the typed code
 * keeps working. The camera stream is stopped as soon as a code is read or the panel is closed. Nothing is uploaded: decoding is local.
 */
export function QrScanner({ onCode }: { onCode: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const scanSequence = useRef(0);
  const [state, setState] = useState<"idle" | "starting" | "scanning" | "unsupported" | "denied" | "error">("idle");

  function stop() {
    scanSequence.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => stop, []);

  async function start() {
    if (typeof window === "undefined" || !window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    setState("starting");
    const sequence = ++scanSequence.current;
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      // Stop may have been pressed (or this panel unmounted) while permission was pending.
      if (sequence !== scanSequence.current || !video.current) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = acquired;
      const v = video.current;
      v.srcObject = acquired;
      await v.play();
      if (sequence !== scanSequence.current) return;
      setState("scanning");
      const tick = async () => {
        if (sequence !== scanSequence.current || !stream.current) return;
        try {
          const codes = await detector.detect(v);
          if (sequence !== scanSequence.current) return;
          const hit = codes.map((c) => c.rawValue.trim()).find(looksLikeToken);
          if (hit) {
            stop();
            setState("idle");
            onCode(hit);
            return;
          }
        } catch {
          /* a frame that cannot be read is skipped */
        }
        if (sequence === scanSequence.current) setTimeout(tick, 250);
      };
      void tick();
    } catch (e) {
      if (sequence !== scanSequence.current) return;
      stop();
      setState((e as { name?: string }).name === "NotAllowedError" ? "denied" : "error");
    }
  }

  return (
    <div className="mb-4">
      {state === "scanning" || state === "starting" ? (
        <div>
          <video ref={video} muted playsInline aria-label="Camera view for scanning a QR pass" className="mb-2 aspect-video w-full max-w-sm rounded-control border border-line bg-black" />
          <Button
            variant="secondary"
            onClick={() => {
              stop();
              setState("idle");
            }}
          >
            Stop camera
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={start}>
          <Camera aria-hidden className="size-4" /> Scan with camera
        </Button>
      )}
      <div role="status" aria-live="polite">
        {state === "unsupported" ? (
          <Notice tone="info" title="This browser cannot scan QR codes">
            Type or paste the pass code below instead, or search by name.
          </Notice>
        ) : null}
        {state === "denied" ? (
          <Notice tone="attention" title="Camera access is off">
            Allow the camera for this site in the browser, or type the pass code below.
          </Notice>
        ) : null}
        {state === "error" ? (
          <Notice tone="attention" title="The camera could not start">
            Type the pass code below instead.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
