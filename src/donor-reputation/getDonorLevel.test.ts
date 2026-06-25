import { describe, expect, it } from "vitest";
import { getDonorLevel } from "./getDonorLevel";

describe("getDonorLevel", () => {
  it("returns Bronze below 100", () => {
    expect(getDonorLevel(0)).toBe("Bronze");
    expect(getDonorLevel(99)).toBe("Bronze");
  });

  it("returns Silver from 100 to 249", () => {
    expect(getDonorLevel(100)).toBe("Silver");
    expect(getDonorLevel(249)).toBe("Silver");
  });

  it("returns Gold from 250 to 499", () => {
    expect(getDonorLevel(250)).toBe("Gold");
    expect(getDonorLevel(499)).toBe("Gold");
  });

  it("returns Genesis from 500", () => {
    expect(getDonorLevel(500)).toBe("Genesis");
    expect(getDonorLevel(999)).toBe("Genesis");
  });
});
