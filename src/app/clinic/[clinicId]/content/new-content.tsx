"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { ContentForm } from "./forms";

export function NewContent({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Write new care information
      </Button>
      {open ? (
        <div className="mt-3">
          <ContentForm clinicId={clinicId} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
