"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
export function RefreshStatus() {
  const router = useRouter();
  return <Button variant="quiet" onClick={() => router.refresh()}>Refresh status</Button>;
}
