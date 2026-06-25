import type { DonorLevel } from "./types";

export function getDonorLevel(score: number): DonorLevel {
  if (score >= 500) return "Genesis";
  if (score >= 250) return "Gold";
  if (score >= 100) return "Silver";
  return "Bronze";
}
