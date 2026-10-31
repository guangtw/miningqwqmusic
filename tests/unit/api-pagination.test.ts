import { describe, expect, it } from "vitest";
import { boundedInteger } from "@/src/lib/api-pagination";

describe("API pagination boundary", () => {
  it.each([null, "", " ", "Infinity", "-Infinity", "NaN", "oops"])("defaults invalid number %s", (value) => {
    expect(boundedInteger(value, 20, 50)).toBe(20);
  });
  it.each([["1.7", 1], ["-5", 1], ["100", 50]])("normalizes %s to %s", (value, expected) => {
    expect(boundedInteger(value as string, 20, 50)).toBe(expected);
  });
});
