"use client";
import { useRouter } from "next/navigation";
import { Button, Notice, ResultRegion } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export function MarkAllRead() {
  const router = useRouter();
  const { state, run } = useMutation("/api/v1/me/messages/read");
  return (
    <div>
      <Button
        variant="secondary"
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run({});
          if (r?.ok) router.refresh();
        }}
      >
        {state.phase === "pending" ? "Marking as read…" : "Mark all as read"}
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Could not mark messages as read"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}
