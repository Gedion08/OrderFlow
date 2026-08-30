use anchor_lang::prelude::*;

declare_id!("AnChOrFlow11111111111111111111111111111111");

/// Meteora DLMM (lb_clmm) program id.
pub const METRORA_DLMM: Pubkey = Pubkey::from_str_const("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

#[program]
pub mod orderflow {
    use super::*;

    /// Create a DCA strategy account describing the schedule.
    pub fn create_strategy(
        ctx: Context<CreateStrategy>,
        pool: Pubkey,
        side: SideKind,
        total_amount: u64,
        tranches: u8,
        interval_seconds: u64,
        min_price: u64,
        max_price: u64,
    ) -> Result<()> {
        let s = &mut ctx.accounts.strategy;
        s.owner = ctx.accounts.owner.key();
        s.pool = pool;
        s.side = side;
        s.total_amount = total_amount;
        s.tranches = tranches;
        s.interval_seconds = interval_seconds;
        s.min_price = min_price;
        s.max_price = max_price;
        s.tranches_placed = 0;
        s.status = StrategyStatus::Scheduled;
        s.bump = ctx.bumps.strategy;
        Ok(())
    }

    /// Store that a tranche was placed on-chain (execution happens via Meteora
    /// DLMM; this ledger tracks which tranches have been booked).
    pub fn record_tranche(ctx: Context<RecordTranche>, bin_ids: Vec<i64>) -> Result<()> {
        let s = &mut ctx.accounts.strategy;
        require!(s.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        require!(s.tranches_placed < s.tranches, ErrorCode::AllTranchesPlaced);
        s.tranches_placed += 1;
        s.last_bins = bin_ids;
        if s.tranches_placed >= s.tranches {
            s.status = StrategyStatus::Active;
        }
        Ok(())
    }

    /// Mark a strategy as cancelled (no further tranches are placed).
    pub fn cancel_strategy(ctx: Context<CancelStrategy>) -> Result<()> {
        let s = &mut ctx.accounts.strategy;
        require!(s.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        s.status = StrategyStatus::Cancelled;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateStrategy<'info> {
    #[account(init, payer = owner, seeds = [b"strategy", owner.key().as_ref(), pool.as_ref()], bump,
              space = Strategy::LEN)]
    pub strategy: Account<'info, Strategy>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: derived from args, only used as a seed.
    pub pool: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RecordTranche<'info> {
    #[account(mut, seeds = [b"strategy", owner.key().as_ref(), strategy.pool.as_ref()], bump = strategy.bump)]
    pub strategy: Account<'info, Strategy>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelStrategy<'info> {
    #[account(mut, has_one = owner)]
    pub strategy: Account<'info, Strategy>,
    pub owner: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SideKind {
    Bid,
    Ask,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StrategyStatus {
    Scheduled,
    Active,
    Completed,
    Cancelled,
}

#[account]
pub struct Strategy {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub side: SideKind,
    pub total_amount: u64,
    pub tranches: u8,
    pub interval_seconds: u64,
    pub min_price: u64,
    pub max_price: u64,
    pub tranches_placed: u8,
    pub status: StrategyStatus,
    pub last_bins: Vec<i64>,
    pub bump: u8,
}

impl Strategy {
    pub const LEN: usize = 8                       // discriminator
        + 32                                       // owner
        + 32                                       // pool
        + 1                                        // side
        + 8                                        // total_amount
        + 1                                        // tranches
        + 8                                        // interval_seconds
        + 8                                        // min_price
        + 8                                        // max_price
        + 1                                        // tranches_placed
        + 1                                        // status
        + 4 + (50 * 8)                             // last_bins (Vec<i64> load, up to 50)
        + 1;                                       // bump
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the strategy owner may perform this action")]
    Unauthorized,
    #[msg("All configured tranches have already been placed")]
    AllTranchesPlaced,
}
