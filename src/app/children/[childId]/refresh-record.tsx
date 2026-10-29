"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
export function RefreshRecord() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button variant="secondary" pending={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden className="size-4" />{pending ? "Checking status..." : "Check verification status"}</Button>;
}
