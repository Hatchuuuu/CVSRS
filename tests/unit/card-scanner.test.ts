import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardScanner } from "@/app/children/[childId]/card-scanner";

describe("vaccination card scanner", () => {
  it("offers camera/upload with a manual fallback and local-processing disclosure", () => {
    const html = renderToStaticMarkup(React.createElement(CardScanner, { onRows: () => undefined }));
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain("processed only in this browser");
    expect(html).toContain("You can always enter the card manually");
  });
});
