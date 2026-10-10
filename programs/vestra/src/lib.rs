use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod error;
pub mod math;
pub mod state;
use error::VestraError;
use state::*;

declare_id!("8AXvPZN7mSM2twASsL9QqKqLqQBnJLGjDKBmzZktnx7K");

#[cfg(not(feature = "demo-clock"))]
pub const EPOCH_SECONDS: i64 = 86_400;
#[cfg(feature = "demo-clock")]
pub const EPOCH_SECONDS: i64 = 10;

#[program]
pub mod vestra {
    use super::*;

    /// Stage-one registration. Does NOT certify a Meteora pool or stock issuer.
    /// Collector authority and treasury are immutable for this launch.
    pub fn register_launch(ctx: Context<RegisterLaunch>) -> Result<()> {
        require_keys_neq!(
            ctx.accounts.base_mint.key(),
            ctx.accounts.quote_mint.key(),
            VestraError::IdenticalMints
        );
        require!(
            ctx.accounts.base_mint.mint_authority.is_none()
                && ctx.accounts.base_mint.freeze_authority.is_none(),
            VestraError::MutableBaseMint
        );
        let launch = &mut ctx.accounts.launch;
        launch.authority = ctx.accounts.authority.key();
        launch.collector = ctx.accounts.collector.key();
        launch.base_mint = ctx.accounts.base_mint.key();
        launch.quote_mint = ctx.accounts.quote_mint.key();
        launch.treasury = ctx.accounts.treasury.key();
        launch.origin = Clock::get()?.unix_timestamp;
        launch.epoch_seconds = EPOCH_SECONDS;
        launch.current_epoch = 0;
        launch.bump = ctx.bumps.launch;
        let epoch = &mut ctx.accounts.epoch;
        epoch.launch = launch.key();
        epoch.index = 0;
        epoch.bump = ctx.bumps.epoch;
        emit!(LaunchRegistered {
            launch: launch.key(),
            base_mint: launch.base_mint,
            quote_mint: launch.quote_mint,
            collector: launch.collector,
            epoch_seconds: EPOCH_SECONDS
        });
        Ok(())
    }

    /// Permissionless schedule creation: zero weights, bound to the correct PDA.
    /// No init_if_needed; existing schedule contents can never be reset.
    pub fn create_epoch(ctx: Context<CreateEpoch>, index: u64) -> Result<()> {
        let launch = &ctx.accounts.launch;
        require!(
            index > launch.current_epoch
                && index
                    <= launch
                        .current_epoch
                        .checked_add(91)
                        .ok_or(VestraError::Arithmetic)?,
            VestraError::WrongEpoch
        );
        let epoch = &mut ctx.accounts.epoch;
        epoch.launch = launch.key();
        epoch.index = index;
        epoch.bump = ctx.bumps.epoch;
        Ok(())
    }

    /// Eligibility starts at the NEXT boundary; commitment is 7/30/90 epochs
    /// from that boundary. The UI must disclose the extra partial epoch.
    pub fn lock_tokens(ctx: Context<LockTokens>, nonce: u64, amount: u64, tier: u8) -> Result<()> {
        require!(amount > 0, VestraError::ZeroAmount);
        let (days, weight) = math::weight(amount, tier).ok_or(VestraError::InvalidTier)?;
        let launch = &mut ctx.accounts.launch;
        let start = launch
            .current_epoch
            .checked_add(1)
            .ok_or(VestraError::Arithmetic)?;
        let end = start.checked_add(days).ok_or(VestraError::Arithmetic)?;
        require!(
            Clock::get()?.unix_timestamp
                < launch.boundary(start).ok_or(VestraError::Arithmetic)?,
            VestraError::EpochBehind
        );
        require!(
            ctx.accounts.start_epoch.index == start && ctx.accounts.end_epoch.index == end,
            VestraError::WrongEpoch
        );
        require!(
            !ctx.accounts.start_epoch.finalized && !ctx.accounts.end_epoch.finalized,
            VestraError::WrongEpoch
        );

        token::transfer_checked(
            CpiContext::new(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.principal_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.base_mint.decimals,
        )?;

        ctx.accounts.start_epoch.starts = ctx
            .accounts
            .start_epoch
            .starts
            .checked_add(weight)
            .ok_or(VestraError::Arithmetic)?;
        ctx.accounts.end_epoch.ends = ctx
            .accounts
            .end_epoch
            .ends
            .checked_add(weight)
            .ok_or(VestraError::Arithmetic)?;
        launch.outstanding_principal = launch
            .outstanding_principal
            .checked_add(amount)
            .ok_or(VestraError::Arithmetic)?;
        let position = &mut ctx.accounts.position;
        position.launch = launch.key();
        position.owner = ctx.accounts.owner.key();
        position.nonce = nonce;
        position.amount = amount;
        position.weight = weight;
        position.start_epoch = start;
        position.end_epoch = end;
        position.next_claim_epoch = start;
        position.bump = ctx.bumps.position;
        emit!(TokensLocked {
            launch: launch.key(),
            position: position.key(),
            owner: position.owner,
            amount,
            weight,
            start_epoch: start,
            end_epoch: end
        });
        Ok(())
    }

    /// Intended for SDK fee-claim + funding in ONE transaction. This instruction
    /// reads the collector token account after the preceding claim instruction.
    /// It is authorized receipt ingestion, not on-chain Meteora provenance proof.
    pub fn fund_collected_balance(ctx: Context<FundEpoch>) -> Result<()> {
        let amount = ctx.accounts.source.amount;
        fund_epoch(ctx, amount)
    }

    /// Authorized receipt ingestion. Provenance is a collector trust assumption.
    pub fn fund_epoch(ctx: Context<FundEpoch>, amount: u64) -> Result<()> {
        require!(amount > 0, VestraError::ZeroAmount);
        let launch = &mut ctx.accounts.launch;
        require!(
            Clock::get()?.unix_timestamp
                < launch
                    .boundary(
                        launch
                            .current_epoch
                            .checked_add(1)
                            .ok_or(VestraError::Arithmetic)?
                    )
                    .ok_or(VestraError::Arithmetic)?,
            VestraError::EpochBehind
        );
        require!(!ctx.accounts.epoch.finalized, VestraError::WrongEpoch);
        token::transfer_checked(
            CpiContext::new(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.collector.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        ctx.accounts.epoch.receipts = ctx
            .accounts
            .epoch
            .receipts
            .checked_add(amount)
            .ok_or(VestraError::Arithmetic)?;
        launch.total_received = launch
            .total_received
            .checked_add(amount)
            .ok_or(VestraError::Arithmetic)?;
        emit!(ReceiptFunded {
            launch: launch.key(),
            epoch: launch.current_epoch,
            source: ctx.accounts.source.key(),
            amount
        });
        Ok(())
    }

    /// Permissionless, strictly sequential settlement. Future receipts cannot
    /// modify finalized epochs; downtime can be caught up without rewriting history.
    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>) -> Result<()> {
        let launch = &mut ctx.accounts.launch;
        let next_index = launch
            .current_epoch
            .checked_add(1)
            .ok_or(VestraError::Arithmetic)?;
        require!(
            Clock::get()?.unix_timestamp
                >= launch
                    .boundary(next_index)
                    .ok_or(VestraError::Arithmetic)?,
            VestraError::EpochOpen
        );
        require!(
            !ctx.accounts.epoch.finalized
                && ctx.accounts.next_epoch.index == next_index
                && !ctx.accounts.next_epoch.finalized,
            VestraError::WrongEpoch
        );
        let (locker, platform) =
            math::split(ctx.accounts.epoch.receipts).ok_or(VestraError::Arithmetic)?;
        let available = launch
            .carry
            .checked_add(locker)
            .ok_or(VestraError::Arithmetic)?;
        if ctx.accounts.epoch.total_weight == 0 {
            launch.carry = available;
            ctx.accounts.epoch.rewards = 0;
        } else {
            ctx.accounts.epoch.rewards = available;
            launch.carry = 0;
        }
        ctx.accounts.epoch.finalized = true;
        ctx.accounts.next_epoch.total_weight = math::next_weight(
            ctx.accounts.epoch.total_weight,
            ctx.accounts.next_epoch.starts,
            ctx.accounts.next_epoch.ends,
        )
        .ok_or(VestraError::Arithmetic)?;
        launch.current_epoch = next_index;
        launch.total_platform_paid = launch
            .total_platform_paid
            .checked_add(platform)
            .ok_or(VestraError::Arithmetic)?;
        if platform > 0 {
            let bump = [launch.bump];
            let seeds: &[&[u8]] = &[
                b"launch",
                launch.base_mint.as_ref(),
                launch.authority.as_ref(),
                &bump,
            ];
            token::transfer_checked(
                CpiContext::new_with_signer(
                    Token::id(),
                    TransferChecked {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: launch.to_account_info(),
                    },
                    &[seeds],
                ),
                platform,
                ctx.accounts.quote_mint.decimals,
            )?;
        }
        emit!(EpochFinalized {
            launch: launch.key(),
            epoch: ctx.accounts.epoch.index,
            receipts: ctx.accounts.epoch.receipts,
            rewards: ctx.accounts.epoch.rewards,
            total_weight: ctx.accounts.epoch.total_weight,
            platform_paid: platform
        });
        Ok(())
    }

    /// One epoch per instruction, oldest first. Client batches several claims.
    /// Historical claims remain possible after principal withdrawal.
    pub fn claim_epoch(ctx: Context<ClaimEpoch>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let epoch = &mut ctx.accounts.epoch;
        require!(epoch.finalized, VestraError::NotFinalized);
        require!(
            epoch.index == position.next_claim_epoch
                && epoch.index >= position.start_epoch
                && epoch.index < position.end_epoch,
            VestraError::WrongEpoch
        );
        let amount = math::share(epoch.rewards, position.weight, epoch.total_weight)
            .ok_or(VestraError::Arithmetic)?;
        epoch.paid = epoch
            .paid
            .checked_add(amount)
            .ok_or(VestraError::Arithmetic)?;
        epoch.claimed_weight = epoch
            .claimed_weight
            .checked_add(position.weight)
            .ok_or(VestraError::Arithmetic)?;
        require!(
            epoch.paid <= epoch.rewards && epoch.claimed_weight <= epoch.total_weight,
            VestraError::Arithmetic
        );
        position.next_claim_epoch = position
            .next_claim_epoch
            .checked_add(1)
            .ok_or(VestraError::Arithmetic)?;
        let launch = &mut ctx.accounts.launch;
        launch.total_locker_paid = launch
            .total_locker_paid
            .checked_add(amount)
            .ok_or(VestraError::Arithmetic)?;
        if epoch.claimed_weight == epoch.total_weight {
            // Each position can claim only once. Recycle integer rounding dust
            // only once ALL eligible weight has been processed.
            launch.carry = launch
                .carry
                .checked_add(
                    epoch
                        .rewards
                        .checked_sub(epoch.paid)
                        .ok_or(VestraError::Arithmetic)?,
                )
                .ok_or(VestraError::Arithmetic)?;
        }
        if amount > 0 {
            let bump = [launch.bump];
            let seeds: &[&[u8]] = &[
                b"launch",
                launch.base_mint.as_ref(),
                launch.authority.as_ref(),
                &bump,
            ];
            token::transfer_checked(
                CpiContext::new_with_signer(
                    Token::id(),
                    TransferChecked {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.destination.to_account_info(),
                        authority: launch.to_account_info(),
                    },
                    &[seeds],
                ),
                amount,
                ctx.accounts.quote_mint.decimals,
            )?;
        }
        emit!(RewardClaimed {
            launch: launch.key(),
            position: position.key(),
            epoch: epoch.index,
            amount
        });
        Ok(())
    }

    pub fn withdraw_unlocked(ctx: Context<WithdrawUnlocked>) -> Result<()> {
        let launch = &mut ctx.accounts.launch;
        let position = &mut ctx.accounts.position;
        require!(!position.withdrawn, VestraError::AlreadyWithdrawn);
        // Principal release is based on time and DOES NOT depend on keeper progress.
        require!(
            Clock::get()?.unix_timestamp
                >= launch
                    .boundary(position.end_epoch)
                    .ok_or(VestraError::Arithmetic)?,
            VestraError::Locked
        );
        let amount = position.amount;
        let bump = [launch.bump];
        let seeds: &[&[u8]] = &[
            b"launch",
            launch.base_mint.as_ref(),
            launch.authority.as_ref(),
            &bump,
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.principal_vault.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: launch.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.base_mint.decimals,
        )?;
        position.withdrawn = true;
        launch.outstanding_principal = launch
            .outstanding_principal
            .checked_sub(amount)
            .ok_or(VestraError::Arithmetic)?;
        emit!(PrincipalWithdrawn {
            launch: launch.key(),
            position: position.key(),
            amount
        });
        Ok(())
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        require!(ctx.accounts.position.withdrawn, VestraError::Locked);
        require!(
            ctx.accounts.position.next_claim_epoch == ctx.accounts.position.end_epoch,
            VestraError::ClaimsRemaining
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterLaunch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: immutable receipt authority; no privileges used at registration.
    pub collector: UncheckedAccount<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(token::mint = quote_mint)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, space = 8 + Launch::INIT_SPACE,
        seeds = [b"launch", base_mint.key().as_ref(), authority.key().as_ref()], bump)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(init, payer = authority, space = 8 + Epoch::INIT_SPACE,
        seeds = [b"epoch", launch.key().as_ref(), &0u64.to_le_bytes()], bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(init, payer = authority, seeds = [b"principal", launch.key().as_ref()], bump,
        token::mint = base_mint, token::authority = launch)]
    pub principal_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [b"rewards", launch.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = launch)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreateEpoch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(init, payer = payer, space = 8 + Epoch::INIT_SPACE,
        seeds = [b"epoch", launch.key().as_ref(), &index.to_le_bytes()], bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64, amount: u64, tier: u8)]
pub struct LockTokens<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump, has_one = base_mint)]
    pub launch: Box<Account<'info, Launch>>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = owner)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"principal", launch.key().as_ref()], bump, token::mint = base_mint, token::authority = launch)]
    pub principal_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = owner, space = 8 + LockPosition::INIT_SPACE,
        seeds = [b"position", launch.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub position: Box<Account<'info, LockPosition>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &start_epoch.index.to_le_bytes()], bump = start_epoch.bump)]
    pub start_epoch: Box<Account<'info, Epoch>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &end_epoch.index.to_le_bytes()], bump = end_epoch.bump)]
    pub end_epoch: Box<Account<'info, Epoch>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEpoch<'info> {
    pub collector: Signer<'info>,
    #[account(mut, seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump, has_one = collector, has_one = quote_mint)]
    pub launch: Box<Account<'info, Launch>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = collector)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"rewards", launch.key().as_ref()], bump, token::mint = quote_mint, token::authority = launch)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &launch.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {
    #[account(mut, seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump, has_one = quote_mint, has_one = treasury)]
    pub launch: Box<Account<'info, Launch>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"rewards", launch.key().as_ref()], bump, token::mint = quote_mint, token::authority = launch)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &launch.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &next_epoch.index.to_le_bytes()], bump = next_epoch.bump)]
    pub next_epoch: Box<Account<'info, Epoch>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimEpoch<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump, has_one = quote_mint)]
    pub launch: Box<Account<'info, Launch>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, has_one = launch, has_one = owner,
        seeds = [b"position", launch.key().as_ref(), owner.key().as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Box<Account<'info, LockPosition>>,
    #[account(mut, has_one = launch, seeds = [b"epoch", launch.key().as_ref(), &epoch.index.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(mut, seeds = [b"rewards", launch.key().as_ref()], bump, token::mint = quote_mint, token::authority = launch)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = owner)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawUnlocked<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"launch", launch.base_mint.as_ref(), launch.authority.as_ref()], bump = launch.bump, has_one = base_mint)]
    pub launch: Box<Account<'info, Launch>>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(mut, has_one = launch, has_one = owner,
        seeds = [b"position", launch.key().as_ref(), owner.key().as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Box<Account<'info, LockPosition>>,
    #[account(mut, seeds = [b"principal", launch.key().as_ref()], bump, token::mint = base_mint, token::authority = launch)]
    pub principal_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint, token::authority = owner)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, close = owner, has_one = owner,
        seeds = [b"position", position.launch.as_ref(), owner.key().as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Box<Account<'info, LockPosition>>,
}

#[event]
pub struct LaunchRegistered {
    pub launch: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub collector: Pubkey,
    pub epoch_seconds: i64,
}
#[event]
pub struct TokensLocked {
    pub launch: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub weight: u64,
    pub start_epoch: u64,
    pub end_epoch: u64,
}
#[event]
pub struct ReceiptFunded {
    pub launch: Pubkey,
    pub epoch: u64,
    pub source: Pubkey,
    pub amount: u64,
}
#[event]
pub struct EpochFinalized {
    pub launch: Pubkey,
    pub epoch: u64,
    pub receipts: u64,
    pub rewards: u64,
    pub total_weight: u64,
    pub platform_paid: u64,
}
#[event]
pub struct RewardClaimed {
    pub launch: Pubkey,
    pub position: Pubkey,
    pub epoch: u64,
    pub amount: u64,
}
#[event]
pub struct PrincipalWithdrawn {
    pub launch: Pubkey,
    pub position: Pubkey,
    pub amount: u64,
}
