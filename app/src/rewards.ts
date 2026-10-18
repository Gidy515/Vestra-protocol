/** Read-only estimates use the same integer floor as the on-chain claim. */
export function rewardForEpoch(
  rewards: string,
  weight: string,
  totalWeight: string,
  finalized: boolean,
): bigint {
  const total = BigInt(totalWeight);
  if (!finalized || total === 0n) return 0n;
  return (BigInt(rewards) * BigInt(weight)) / total;
}
export function claimWindow(
  cursor: number,
  currentEpoch: number,
  endEpoch: number,
  max = 10,
): number[] {
  const end = Math.min(currentEpoch, endEpoch, cursor + max);
  return Array.from(
    { length: Math.max(0, end - cursor) },
    (_, i) => cursor + i,
  );
}

/** Five claims share one approval; preserve oldest-first settlement order. */
export function claimBatches(indices: number[]): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < indices.length; i += 5) batches.push(indices.slice(i, i + 5));
  return batches;
}
