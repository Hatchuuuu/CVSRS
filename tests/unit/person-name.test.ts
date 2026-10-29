import { expect, it } from "vitest";
import { personName } from "@/lib/person-name";

it.each([
  ["RIC DARRYL Z. CIELO", "Ric Darryl Z. Cielo"],
  ["RIC DARRYL ZERNA CIELO", "Ric Darryl Zerna Cielo"],
  ["  maria   santos  ", "Maria Santos"],
  ["MARÍA ANNE-MARIE O'NEILL", "María Anne-Marie O'Neill"],
  ["John McDonald III", "John McDonald III"],
  ["", ""],
])("formats %s as %s", (input, expected) => expect(personName(input)).toBe(expected));
