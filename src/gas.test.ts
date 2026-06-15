import { describe, expect, it } from "vitest";
import { GANACHE_TRANSACTION_GAS_CAP, WRITE_GAS_LIMITS } from "./contracts";

describe("transaction gas limits", () => {
  it("keeps frontend write gas limits below the Ganache transaction cap", () => {
    expect(WRITE_GAS_LIMITS.contribute).toBeLessThan(GANACHE_TRANSACTION_GAS_CAP);
    expect(WRITE_GAS_LIMITS.createProject).toBeLessThan(
      GANACHE_TRANSACTION_GAS_CAP,
    );
    expect(WRITE_GAS_LIMITS.withdrawContribution).toBeLessThan(
      GANACHE_TRANSACTION_GAS_CAP,
    );
    expect(WRITE_GAS_LIMITS.withdrawRaisedFunds).toBeLessThan(
      GANACHE_TRANSACTION_GAS_CAP,
    );
  });
});
