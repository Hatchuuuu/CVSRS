"use client";

import { Mascot } from "page-mascot";

export function FamilyMascot() {
  return (
    <Mascot
      directions="/mascots/family-head-directions.png"
      reactions="/mascots/family-reactions.png"
      size={88}
      label="family mascot"
      className="shrink-0 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    />
  );
}

