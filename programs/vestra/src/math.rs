//! Checked integer accounting; no floating point or unchecked economic arithmetic.
pub const BPS: u128 = 10_000;
pub const LOCKER_BPS: u128 = 7_500;

pub fn weight(amount: u64, tier: u8) -> Option<(u64, u64)> {
    let (days, multiplier) = match tier {
        0 => (7, 10_000),
        1 => (30, 15_000),
        2 => (90, 20_000),
        _ => return None,
    };
    // Amount is doubled before dividing at worst, so u128 is sufficient.
    let w = (amount as u128).checked_mul(multiplier)? / BPS;
    Some((days, u64::try_from(w).ok()?))
}

pub fn split(receipts: u64) -> Option<(u64, u64)> {
    let lockers = u64::try_from((receipts as u128).checked_mul(LOCKER_BPS)? / BPS).ok()?;
    Some((lockers, receipts.checked_sub(lockers)?))
}

pub fn share(rewards: u64, position_weight: u64, total_weight: u64) -> Option<u64> {
    if total_weight == 0 || position_weight > total_weight {
        return None;
    }
    u64::try_from((rewards as u128).checked_mul(position_weight as u128)? / total_weight as u128)
        .ok()
}

pub fn next_weight(current: u64, starts: u64, ends: u64) -> Option<u64> {
    current.checked_sub(ends)?.checked_add(starts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_are_bounded_and_checked() {
        assert_eq!(weight(1_000, 0), Some((7, 1_000)));
        assert_eq!(weight(1_000, 1), Some((30, 1_500)));
        assert_eq!(weight(1_000, 2), Some((90, 2_000)));
        assert_eq!(weight(u64::MAX, 2), None);
        assert_eq!(weight(1_000, 3), None);
    }

    #[test]
    fn splitting_conserves_even_small_receipts() {
        for value in [0, 1, 2, 3, 4, 100, u64::MAX] {
            let (locker, platform) = split(value).unwrap();
            assert_eq!(locker as u128 + platform as u128, value as u128);
        }
        assert_eq!(split(100), Some((75, 25)));
    }

    #[test]
    fn claims_cannot_exceed_funding() {
        let weights = [1_000u64, 1_500, 2_000];
        let total = weights.iter().sum();
        for reward in [0, 1, 2, 10_001, u64::MAX] {
            let paid: u128 = weights
                .iter()
                .map(|w| share(reward, *w, total).unwrap() as u128)
                .sum();
            assert!(paid <= reward as u128);
            assert!((reward as u128 - paid) < weights.len() as u128);
        }
        assert_eq!(share(100, 0, 0), None);
        assert_eq!(share(100, 11, 10), None);
    }

    #[test]
    fn expiry_is_applied_before_new_weight() {
        assert_eq!(next_weight(1_000, 500, 1_000), Some(500));
        assert_eq!(next_weight(100, 1_000, 101), None);
        assert_eq!(next_weight(u64::MAX, 1, 0), None);
    }
}
