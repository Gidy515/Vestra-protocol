use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Launch {
    pub authority: Pubkey,
    pub collector: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub treasury: Pubkey,
    pub origin: i64,
    pub epoch_seconds: i64,
    pub current_epoch: u64,
    pub carry: u64,
    pub total_received: u64,
    pub total_platform_paid: u64,
    pub total_locker_paid: u64,
    pub outstanding_principal: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub launch: Pubkey,
    pub index: u64,
    pub starts: u64,
    pub ends: u64,
    pub total_weight: u64,
    pub receipts: u64,
    pub rewards: u64,
    pub paid: u64,
    pub claimed_weight: u64,
    pub finalized: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LockPosition {
    pub launch: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub amount: u64,
    pub weight: u64,
    pub start_epoch: u64,
    pub end_epoch: u64,
    pub next_claim_epoch: u64,
    pub withdrawn: bool,
    pub bump: u8,
}

impl Launch {
    pub fn boundary(&self, index: u64) -> Option<i64> {
        self.origin
            .checked_add(i64::try_from(index).ok()?.checked_mul(self.epoch_seconds)?)
    }
}
