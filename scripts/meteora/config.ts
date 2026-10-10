import {
  buildCurve, ActivationType, BaseFeeMode, CollectFeeMode,
  DammV2DynamicFeeMode, MigratedCollectFeeMode, MigrationFeeOption,
  MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

export function buildLaunchConfig(quoteDecimals: number, threshold = 100) {
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 9) throw new Error('Unsupported quote decimals');
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1_000_000) throw new Error('Invalid quote-unit graduation threshold');
  return buildCurve({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quoteDecimals, tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 20, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 100 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 80,
      partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 20,
      creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20, migrationQuoteThreshold: threshold,
  });
}

export function rawAmount(input: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(input)) throw new Error('Amount must be a positive decimal string');
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > decimals) throw new Error('Amount exceeds mint precision');
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (value <= 0n || value > 18_446_744_073_709_551_615n) throw new Error('Amount outside u64 range');
  return value;
}
