export class EpochBacklogError extends Error {
  constructor(readonly remaining: number) {
    super(`Epoch reconciliation in progress: ${remaining} epochs remaining`);
    this.name = 'EpochBacklogError';
  }
}
export function pendingEpochs(origin: number, seconds: number, current: number, now: number): number {
  return Math.max(0, Math.floor((now - origin) / seconds) - current);
}
export async function reconcileEpochs(
  state: () => Promise<{origin:number; seconds:number; current:number}>,
  time: () => Promise<number>,
  finalize: (current:number) => Promise<void>,
  budget: number,
): Promise<number> {
  for (let attempt = 0; attempt < budget; attempt++) {
    const s = await state();
    if (!pendingEpochs(s.origin, s.seconds, s.current, await time())) return s.current;
    await finalize(s.current);
  }
  const s = await state();
  const remaining = pendingEpochs(s.origin, s.seconds, s.current, await time());
  if (remaining) throw new EpochBacklogError(remaining);
  return s.current;
}
