import { describe, expect, it } from "vitest";
import { computeHomeGridPlan } from "@/src/lib/home-grid";

describe("computeHomeGridPlan", () => {
  it("returns two full rows when items are enough", () => {
    const plan = computeHomeGridPlan(900, 20, 180, 12);
    expect(plan.columns).toBe(4);
    expect(plan.count).toBe(8);
  });

  it("falls back to one full row when items are insufficient for two rows", () => {
    const plan = computeHomeGridPlan(900, 5, 180, 12);
    expect(plan.columns).toBe(4);
    expect(plan.count).toBe(4);
  });

  it("shrinks columns to item count when less than one row", () => {
    const plan = computeHomeGridPlan(900, 3, 180, 12);
    expect(plan.columns).toBe(3);
    expect(plan.count).toBe(3);
  });

  it("caps columns on ultra-wide containers so cards stay large", () => {
    const plan = computeHomeGridPlan(2400, 40, 196, 20, 6);
    expect(plan.columns).toBe(6);
    expect(plan.count).toBe(12);
  });
});
