import { describe, expect, it } from "vitest";
import { parseCardText } from "@/lib/card-ocr/parse";

describe("vaccination card OCR parser", () => {
  it("extracts common vaccine rows without inventing missing values", () => {
    expect(parseCardText("BCG | 1 | 2024-06-16 | LOT-A1\nPenta 1 2024/08/20 LOT-P7")).toEqual([
      { productText: "BCG", doseLabel: "1", administeredOn: "2024-06-16", lotText: "LOT-A1", source: "ocr" },
      { productText: "Penta", doseLabel: "1", administeredOn: "2024-08-20", lotText: "LOT-P7", source: "ocr" },
    ]);
  });

  it("keeps uncertain text editable and rejects impossible dates", () => {
    expect(parseCardText("MMR dose 1 2024-19-99")).toEqual([
      { productText: "MMR", doseLabel: "1", source: "ocr" },
    ]);
  });

  it("returns no rows for text that has no vaccine-like content", () => {
    expect(parseCardText("Republic of the Philippines\nImmunization Card")).toEqual([]);
  });
  it("reads unambiguous day/month/year dates and compact dose labels", () => {
    expect(parseCardText("Penta1 | 16/08/2024")).toEqual([{ productText:"Penta",doseLabel:"1",administeredOn:"2024-08-16",source:"ocr" }]);
  });
  it("keeps ambiguous dates visible for manual review instead of guessing", () => {
    expect(parseCardText("MMR dose 1 03/04/2024")).toEqual([{ productText:"MMR",doseLabel:"1",notes:"Check the date on the card: 03/04/2024",source:"ocr" }]);
  });
});
