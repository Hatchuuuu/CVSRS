"use client";
import { Button, Notice } from "@/components/ui";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return <Notice tone="danger" role="alert" title="Developer Console could not be loaded"><p>Retry to check the current saved state.</p><Button onClick={reset}>Try again</Button></Notice>;
}
