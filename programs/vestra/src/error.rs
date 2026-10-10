use anchor_lang::prelude::*;

#[error_code]
pub enum VestraError {
    #[msg("Checked arithmetic failed")]
    Arithmetic,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Lock tier must be 0, 1, or 2")]
    InvalidTier,
    #[msg("Base and quote mints must differ")]
    IdenticalMints,
    #[msg("Community mint must have mint and freeze authorities revoked")]
    MutableBaseMint,
    #[msg("Current epoch ended; advance epochs before locking or funding")]
    EpochBehind,
    #[msg("Epoch has not ended")]
    EpochOpen,
    #[msg("Wrong epoch or epoch outside allowed range")]
    WrongEpoch,
    #[msg("Epoch has not been finalized")]
    NotFinalized,
    #[msg("Lock has not expired")]
    Locked,
    #[msg("Principal already withdrawn")]
    AlreadyWithdrawn,
    #[msg("All lock rewards must be processed before closing")]
    ClaimsRemaining,
}
