"use client";

import { Mascot } from "page-mascot";

export function NurseMascot({ size = 120, className = "lp-nurse-mascot" }: { size?: number; className?: string }) {
  return (
    <div className={className}>
      <Mascot
        directions="/mascots/nurse-directions.webp"
        reactions="/mascots/nurse-reactions.webp"
        size={size}
        label="nurse mascot"
      />
    </div>
  );
}
