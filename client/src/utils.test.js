import { describe, expect, it } from "vitest";
import { canBorrow, canManageInventory, csvUrl, equipmentStatusClass } from "./utils";

describe("role-aware UI helpers", () => {
  it("allows student and faculty borrowing only", () => {
    expect(canBorrow("student")).toBe(true);
    expect(canBorrow("faculty")).toBe(true);
    expect(canBorrow("custodian")).toBe(false);
  });

  it("restricts equipment management to staff roles", () => {
    expect(canManageInventory("administrator")).toBe(true);
    expect(canManageInventory("custodian")).toBe(true);
    expect(canManageInventory("student")).toBe(false);
  });

  it("builds report export paths", () => {
    expect(csvUrl("inventory")).toBe("/reports/inventory/csv");
  });

  it("uses distinct colors for equipment availability statuses", () => {
    expect(equipmentStatusClass("Available")).toContain("emerald");
    expect(equipmentStatusClass("Reserved")).toContain("amber");
    expect(equipmentStatusClass("Checked Out")).toContain("blue");
    expect(equipmentStatusClass("Under Maintenance")).toContain("orange");
    expect(equipmentStatusClass("Lost")).toContain("red");
    expect(equipmentStatusClass("Unknown")).toContain("slate");
  });
});
