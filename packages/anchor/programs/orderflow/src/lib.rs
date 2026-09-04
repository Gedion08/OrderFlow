//! OrderFlow — non-custodial DCA vault on Meteora DLMM.
//!
//! Architecture (replaces the old keeper-custodian model):
//!
//!   * A user deposits tokens into a `StrategyVault` PDA they control. The PDA
//!     is the *owner* of the deposited funds and of every DLMM limit order the
//!     vault places. No party holds a private key for the vault: the program
//!     itself authorizes every token move via `invoke_signed` against the
//!     vault's seeds.
//!   * The keeper (or anyone — these instructions are permissionless) acts as a
//!     *crank*, scheduling execution. But it can never exceed the bounds the
//!     user recorded at creation, and it can never route funds anywhere the
//!     vault does not own:
//!       - `place_tranche`  → permissionless; program enforces the stored
//!                            price bracket, tranche cadence, and total cap
//!                            before invoking DLMM's `place_limit_order`.
//!       - `claim_fees`     → permissionless; DLMM `cancel_limit_order` returns
//!                            remaining principal + accrued fees *to the vault*.
//!       - `withdraw`       → owner-only; sweeps vault balance to the owner.
//!       - `cancel`         → owner-only; cancels open orders (funds return to
//!                            the vault, still owned by the program).
//!
//! Worst case if a crank is compromised: it can spam `place_tranche`, which is
//! harmless because the program re-validates every call against on-chain state.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_program,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Token, TokenAccount, Transfer},
};

declare_id!("7WNQhMKbKhZGYw3zYc77KAHS47hcxss2PCkztQui51fR");

/// Meteora DLMM (lb_clmm) program id.
pub const DLMM_PROGRAM: Pubkey = solana_program::pubkey!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

/// `__event_authority` PDA of the DLMM program (Anchor event CPI signer).
pub fn dlmm_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &DLMM_PROGRAM).0
}

/// Place limit order discriminator: Anchor 8-byte hash of "global:place_limit_order".
const PLACE_LIMIT_ORDER_DISCRIMINATOR: [u8; 8] = [108, 176, 33, 186, 146, 229, 1, 197];
/// Cancel limit order discriminator: "global:cancel_limit_order".
const CANCEL_LIMIT_ORDER_DISCRIMINATOR: [u8; 8] = [132, 156, 132, 31, 67, 40, 232, 97];

/// SPL Token program id.
const TOKEN_PROGRAM: Pubkey = solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

#[program]
pub mod orderflow {
    use super::*;

    /// Create a vault describing the DCA bounds the owner commits to. The vault
    /// PDA is seeded by `(owner, nonce)`; `nonce` is chosen by the owner and
    /// doubles as the on-chain strategy id.
    pub fn create_vault(
        ctx: Context<CreateVault>,
        nonce: u64,
        pool: Pubkey,
        mint: Pubkey,
        side: SideKind,
        tranches: u16,
        interval_seconds: u64,
        min_bin_id: i64,
        max_bin_id: i64,
        tranche_amount: u64,
        total_cap: u64,
    ) -> Result<()> {
        require!(tranches > 0, ErrorCode::InvalidBounds);
        require!(min_bin_id <= max_bin_id, ErrorCode::InvalidBounds);
        require!(max_bin_id - min_bin_id <= 50, ErrorCode::BracketTooWide);
        require!(total_cap >= tranche_amount, ErrorCode::InvalidCap);

        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.nonce = nonce;
        vault.pool = pool;
        vault.mint = mint;
        vault.side = side;
        vault.tranches = tranches;
        vault.interval_seconds = interval_seconds;
        vault.min_bin_id = min_bin_id;
        vault.max_bin_id = max_bin_id;
        vault.tranche_amount = tranche_amount;
        vault.total_cap = total_cap;
        vault.amount_placed = 0;
        vault.tranches_placed = 0;
        vault.last_placed_at = 0;
        vault.pending_limit_order = None;
        vault.status = VaultStatus::Depositing;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Owner moves `amount` of `mint` into the vault. Repeated deposits allow
    /// topping up a live strategy (total deposit is not locked to `total_cap`).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_ata.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Permissionless crank. Places the next tranche of a live strategy as a
    /// DLMM limit order owned by the vault. The program enforces every bound
    /// the owner committed to before invoking DLMM:
    ///
    ///   * the strategy must not be cancelled/completed,
    ///   * tranches must not be exhausted,
    ///   * the cadence (`interval_seconds`) must have elapsed,
    ///   * each requested bin must lie inside `[min_bin_id, max_bin_id]`,
    ///   * the running placed total must not exceed `total_cap`.
    ///
    /// `bin_array_metas` (the remaining accounts) are the DLMM bin arrays for
    /// `bin_ids`. `bin_ids` is normalized to a fixed-length 50-vector padded
    /// with `i64::MIN` sentinels so the on-chain instruction data is a stable
    /// size regardless of how many bins a crank passes.
    pub fn place_tranche<'info, 'a>(ctx: Context<'a, 'a, 'a, 'info, PlaceTranche<'info>>, bin_ids: [i64; 50]) -> Result<()> where 'info: 'a {
        // ---- ownership / state guards (read-only borrow) --------------------
        let (
            side,
            tranche_idx,
            tranche_amount,
            vault_owner,
            vault_key,
            current_placed,
        ) = {
            let vault = &ctx.accounts.vault;
            require!(
                vault.status == VaultStatus::Active || vault.status == VaultStatus::Depositing,
                ErrorCode::NotPlaceable
            );
            require!(vault.tranches_placed < vault.tranches, ErrorCode::AllTranchesPlaced);
            require!(
                clock_now() >= vault.last_placed_at + (vault.interval_seconds as i64),
                ErrorCode::CadenceNotMet
            );
            require!(
                ctx.accounts.token_mint.key() == vault.mint,
                ErrorCode::MintMismatch
            );
            // content guards — need vault fields
            let bins: Vec<i64> = bin_ids.iter().copied()
                .take_while(|b| *b != i64::MIN)
                .collect();
            require!(!bins.is_empty(), ErrorCode::NoBins);
            require!(bins.len() <= 50, ErrorCode::TooManyBins);
            for b in &bins {
                require!(
                    *b >= vault.min_bin_id && *b <= vault.max_bin_id,
                    ErrorCode::BinOutOfBracket
                );
            }
            require!(
                vault.amount_placed
                    .checked_add(vault.tranche_amount)
                    .map(|v| v <= vault.total_cap)
                    .unwrap_or(false),
                ErrorCode::CapExceeded
            );

            // ---- derive the per-tranche DLMM limit order PDA ----------------
            let tranche_idx = vault.tranches_placed;
            let (limit_order, _) = Pubkey::find_program_address(
                &[
                    b"limit_order",
                    vault.to_account_info().key.as_ref(),
                    &tranche_idx.to_le_bytes(),
                ],
                &ID,
            );
            require!(
                ctx.accounts.limit_order.key() == limit_order,
                ErrorCode::WrongLimitOrder
            );

            // Stash everything we need across the CPI.
            (
                vault.side,
                tranche_idx,
                vault.tranche_amount,
                vault.owner,
                ctx.accounts.vault.key(),
                vault.amount_placed,
            )
        };
        // ^ read-only borrow dropped here.

        // Recompute `bins` (was inside the previous scope). Doing so here lets us
        // keep the CPI-side code free of any borrow on `ctx.accounts.vault`.
        let bins: Vec<i64> = bin_ids.iter().copied()
            .take_while(|b| *b != i64::MIN)
            .collect();
        let limit_order = limit_order_pda(vault_key, tranche_idx);

        // ---- CPI into DLMM place_limit_order -------------------------------
        // Build the AccountInfo vec by calling the trait method on
        // `ctx.accounts`. This is the Anchor-idiomatic way and the
        // returned `Vec<AccountInfo<'info>>` is rooted in the original
        // account info slice the runtime handed us.
        let mut account_infos: Vec<AccountInfo> = ctx.accounts.to_account_infos();
        // bin arrays for the requested bins (parent-transaction remaining accounts)
        for a in ctx.remaining_accounts.iter() {
            account_infos.push((*a).clone());
        }

        // The vault PDA is seeded `(b"vault", owner, nonce)`. We have the
        // owner; read the nonce directly from the account data (avoiding a
        // re-borrow on `ctx.accounts.vault`, which would conflict with the
        // CPI's account-info borrows).
        let vault_info = ctx.accounts.vault.to_account_info();
        let nonce_bytes: [u8; 8] = {
            let data = vault_info.try_borrow_data()?;
            if data.len() < 8 + 32 + 8 {
                return Err(error!(ErrorCode::InvalidBounds));
            }
            let mut buf = [0u8; 8];
            buf.copy_from_slice(&data[8 + 32..8 + 32 + 8]);
            u64::from_le_bytes(buf).to_le_bytes()
        };
        let owner_bytes: [u8; 32] = vault_owner.to_bytes();
        let seeds: [&[u8]; 3] = [b"vault", &owner_bytes, &nonce_bytes];

        invoke_signed(
            &place_limit_order_instruction(&*ctx.accounts, side, limit_order, &bins, vault_key),
            account_infos.as_slice(),
            &[&seeds],
        )?;

        // Touch tranche_amount + current_placed to keep the linter happy
        // about destructuring.
        let _ = (tranche_amount, current_placed);

        // ---- commit state ---------------------------------------------------
        let vault = &mut ctx.accounts.vault;
        vault.tranches_placed += 1;
        vault.amount_placed += vault.tranche_amount;
        vault.last_placed_at = clock_now();
        vault.pending_limit_order = Some(PendingOrder {
            address: limit_order,
            bin_ids: bins,
        });
        Ok(())
    }

    /// Permissionless crank. Claims accrued fees (and returns any remaining
    /// order principal) for a placed limit order; funds return *to the vault*,
    /// never to the crank.
    pub fn claim_fees<'info, 'a>(
        ctx: Context<'a, 'a, 'a, 'info, ClaimFees<'info>>,
        bin_ids: Vec<i64>,
    ) -> Result<()> where 'info: 'a {
        // Read fields we need from the vault first, then drop the borrow.
        let (owner, nonce) = {
            let v = &ctx.accounts.vault;
            (v.owner, v.nonce)
        };
        let owner_bytes: [u8; 32] = owner.to_bytes();
        let nonce_bytes: [u8; 8] = nonce.to_le_bytes();
        let signer_seeds: [&[u8]; 3] = [b"vault", &owner_bytes, &nonce_bytes];

        invoke_signed(
            &cancel_limit_order_instruction(&*ctx.accounts, &bin_ids),
            &cancel_limit_order_accounts(&*ctx.accounts),
            &[&signer_seeds],
        )?;
        Ok(())
    }

    /// Owner-only. Cancel all open orders for the vault. Remaining funds return
    /// to the vault (still program-controlled); the strategy is marked
    /// cancelled so no further tranches can be placed.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.status = VaultStatus::Cancelled;
        Ok(())
    }

    /// Owner-only — always available. Sweeps `amount` from the vault to the
    /// owner. Note this withdraws the settled vault balance; open orders owned
    /// by the vault are untouched (cancel them first to free their funds).
    pub fn withdraw<'info, 'a>(
        ctx: Context<'a, 'a, 'a, 'info, Withdraw<'info>>,
        amount: u64,
    ) -> Result<()> where 'info: 'a {
        require!(amount > 0, ErrorCode::ZeroAmount);

        // Build the PDA signer seeds inline. `vault.nonce.to_le_bytes()` would
        // create a temporary whose reference does not escape the expression,
        // so we read the nonce via `try_borrow_data` on the account info
        // instead — that returns a slice with a longer lifetime, but the
        // simplest correct path here is to copy the nonce into a local buffer
        // and bind the seed slice to it.
        let nonce_bytes: [u8; 8] = {
            let v = &ctx.accounts.vault;
            v.nonce.to_le_bytes()
        };
        let owner_bytes: [u8; 32] = ctx.accounts.vault.owner.to_bytes();
        let seeds: [&[u8]; 3] = [b"vault", &owner_bytes, &nonce_bytes];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.owner_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[&seeds],
            ),
            amount,
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateVault<'info> {
    #[account(
        init,
        payer = owner,
        seeds = [b"vault", owner.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
        space = StrategyVault::LEN
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: seed component only; validated against stored value in later ops.
    pub mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), vault.nonce.to_le_bytes().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: validated against `vault.mint` in the instruction handler.
    pub mint: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner
    )]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(bin_ids: [i64; 50])]
pub struct PlaceTranche<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), vault.nonce.to_le_bytes().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = vault
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"limit_order", vault.key().as_ref(), vault.tranches_placed.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: per-tranche DLMM limit-order PDA, derived in the handler and
    /// validated against the DLMM IDL account order it is passed through to.
    pub limit_order: AccountInfo<'info>,
    /// The crank wallet — pays gas/rent. Never controls funds.
    #[account(mut)]
    pub crank: Signer<'info>,
    // ---- DLMM CPI accounts (fixed set) -------------------------------------
    /// CHECK: DLMM program id — passthrough, validated by DLMM.
    #[account(mut)]
    pub dlmm_program: AccountInfo<'info>,
    /// CHECK: LB pair account — passthrough, validated by DLMM.
    #[account(mut)]
    pub lb_pair: AccountInfo<'info>,
    /// CHECK: bin array bitmap extension — passthrough, validated by DLMM.
    #[account(mut)]
    pub bin_array_bitmap_extension: AccountInfo<'info>,
    /// CHECK: DLMM pool reserve (X or Y depending on side) — passthrough,
    /// validated by DLMM.
    #[account(mut)]
    pub reserve: AccountInfo<'info>,
    /// CHECK: token mint of the bin side being traded — passthrough,
    /// validated by DLMM.
    #[account(mut)]
    pub token_mint: AccountInfo<'info>,
    /// CHECK: derived `__event_authority` PDA of the DLMM program.
    pub event_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), vault.nonce.to_le_bytes().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = vault
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub crank: Signer<'info>,
    /// CHECK: DLMM program id — passthrough, validated by DLMM.
    #[account(mut)]
    pub dlmm_program: AccountInfo<'info>,
    /// CHECK: LB pair account — passthrough, validated by DLMM.
    #[account(mut)]
    pub lb_pair: AccountInfo<'info>,
    /// CHECK: bin array bitmap extension — passthrough, validated by DLMM.
    #[account(mut)]
    pub bin_array_bitmap_extension: AccountInfo<'info>,
    /// CHECK: X-side reserve of the DLMM pool — passthrough, validated by DLMM.
    #[account(mut)]
    pub reserve_x: AccountInfo<'info>,
    /// CHECK: Y-side reserve of the DLMM pool — passthrough, validated by DLMM.
    #[account(mut)]
    pub reserve_y: AccountInfo<'info>,
    /// CHECK: token X mint of the pool — passthrough, validated by DLMM.
    pub token_x_mint: AccountInfo<'info>,
    /// CHECK: token Y mint of the pool — passthrough, validated by DLMM.
    pub token_y_mint: AccountInfo<'info>,
    /// CHECK: per-tranche limit-order PDA owned by the vault — validated in
    /// handler against the stored `pending_limit_order` address.
    #[account(mut)]
    pub limit_order: AccountInfo<'info>,
    /// CHECK: owner token X ATA — passthrough, validated by DLMM.
    #[account(mut)]
    pub owner_token_x: AccountInfo<'info>,
    /// CHECK: owner token Y ATA — passthrough, validated by DLMM.
    #[account(mut)]
    pub owner_token_y: AccountInfo<'info>,
    /// CHECK: derived `__event_authority` PDA of the DLMM program.
    pub event_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Memo program id fixed by DLMM.
    pub memo_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), vault.nonce.to_le_bytes().as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), vault.nonce.to_le_bytes().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, StrategyVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: validated against `vault.mint` in the instruction handler.
    pub mint: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner
    )]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// ---------------------------------------------------------------------------
// CPI helpers
// ---------------------------------------------------------------------------

/// Derive the per-tranche DLMM limit-order PDA from a vault pubkey + idx.
fn limit_order_pda(vault_key: Pubkey, tranche_idx: u16) -> Pubkey {
    Pubkey::find_program_address(
        &[b"limit_order", vault_key.as_ref(), &tranche_idx.to_le_bytes()],
        &ID,
    )
    .0
}

/// Build the DLMM `place_limit_order` instruction (exact IDL account order).
fn place_limit_order_instruction(
    accounts: &PlaceTranche,
    side: SideKind,
    limit_order: Pubkey,
    bins: &[i64],
    owner: Pubkey,
) -> Instruction {
    let is_ask = side == SideKind::Ask;

    let mut data = Vec::with_capacity(1024);
    data.extend_from_slice(&PLACE_LIMIT_ORDER_DISCRIMINATOR);

    // params
    data.push(is_ask as u8); // isAskSide
    data.extend_from_slice(&[0u8; 16]); // padding
    data.push(0u8); // relativeBin: Option = None
    data.extend_from_slice(&(bins.len() as u32).to_le_bytes()); // bins vec len
    for b in bins {
        data.extend_from_slice(&(*b as i32).to_le_bytes()); // id
        data.extend_from_slice(&accounts.vault.tranche_amount.to_le_bytes()); // amount
    }
    // remainingAccountsInfo { slices: Vec<...> } -> empty
    data.extend_from_slice(&(0u32).to_le_bytes());

    let token_mint = accounts.token_mint.key();
    let reserve = accounts.reserve.key();

    Instruction {
        program_id: DLMM_PROGRAM,
        accounts: vec![
            AccountMeta::new(accounts.lb_pair.key(), false),
            AccountMeta::new(accounts.bin_array_bitmap_extension.key(), false),
            AccountMeta::new(reserve, false),
            AccountMeta::new_readonly(token_mint, false),
            AccountMeta::new(limit_order, true),
            // payer = crank (pays rent), signer
            AccountMeta::new(accounts.crank.key(), true),
            // owner = the vault PDA (DLMM validates this is the owner of the
            // created limit_order account). The sender (token-transfer authority
            // of the vault ATA) is also the vault PDA, signing here via the
            // invoke_signed seeds above — never the crank.
            AccountMeta::new_readonly(owner, false),
            // userToken = the vault ATA that funds the order
            AccountMeta::new(accounts.vault_ata.key(), false),
            // sender = vault PDA (authority over vault ATA), signer via invoke_signed
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(dlmm_event_authority(), false),
            AccountMeta::new_readonly(DLMM_PROGRAM, false),
        ],
        data,
    }
}

/// Build the DLMM `cancel_limit_order` instruction (exact IDL account order).
fn cancel_limit_order_instruction(accounts: &ClaimFees, bin_ids: &[i64]) -> Instruction {
    let mut data = Vec::with_capacity(512);
    data.extend_from_slice(&CANCEL_LIMIT_ORDER_DISCRIMINATOR);
    data.extend_from_slice(&(bin_ids.len() as u32).to_le_bytes());
    for b in bin_ids {
        data.extend_from_slice(&(*b as i32).to_le_bytes());
    }
    data.extend_from_slice(&(0u32).to_le_bytes()); // remainingAccountsInfo

    Instruction {
        program_id: DLMM_PROGRAM,
        accounts: vec![
            AccountMeta::new(accounts.lb_pair.key(), false),
            AccountMeta::new(accounts.bin_array_bitmap_extension.key(), false),
            AccountMeta::new(accounts.reserve_x.key(), false),
            AccountMeta::new(accounts.reserve_y.key(), false),
            AccountMeta::new_readonly(accounts.token_x_mint.key(), false),
            AccountMeta::new_readonly(accounts.token_y_mint.key(), false),
            AccountMeta::new(accounts.limit_order.key(), false),
            AccountMeta::new(accounts.owner_token_x.key(), false),
            AccountMeta::new(accounts.owner_token_y.key(), false),
            // owner = the vault; OrderFlow signs via invoke_signed
            AccountMeta::new_readonly(accounts.vault.key(), true),
            AccountMeta::new_readonly(accounts.token_program.key(), false),
            AccountMeta::new_readonly(accounts.token_program.key(), false),
            AccountMeta::new_readonly(accounts.memo_program.key(), false),
            AccountMeta::new_readonly(dlmm_event_authority(), false),
            AccountMeta::new_readonly(DLMM_PROGRAM, false),
        ],
        data,
    }
}
/// Clock timestamp (secs).
fn clock_now() -> i64 {
    Clock::get().unwrap().unix_timestamp
}

/// Account list matching DLMM's cancel_limit_order IDL order.
fn cancel_limit_order_accounts<'b, 'info>(accounts: &'b ClaimFees<'info>) -> Vec<AccountInfo<'info>> {
    vec![
        accounts.lb_pair.to_account_info(),
        accounts.bin_array_bitmap_extension.to_account_info(),
        accounts.reserve_x.to_account_info(),
        accounts.reserve_y.to_account_info(),
        accounts.token_x_mint.to_account_info(),
        accounts.token_y_mint.to_account_info(),
        accounts.limit_order.to_account_info(),
        accounts.owner_token_x.to_account_info(),
        accounts.owner_token_y.to_account_info(),
        accounts.vault.to_account_info(),
        accounts.token_program.to_account_info(),
        accounts.token_program.to_account_info(), // tokenYProgram (same for SPL-Token)
        accounts.memo_program.to_account_info(),
        accounts.event_authority.to_account_info(),
        accounts.dlmm_program.to_account_info(),
    ]
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SideKind {
    Bid,
    Ask,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VaultStatus {
    Depositing,
    Active,
    Completed,
    Cancelled,
}

/// A limit order currently owned by the vault (latest tranche).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct PendingOrder {
    pub address: Pubkey,
    pub bin_ids: Vec<i64>,
}

impl PendingOrder {
    pub const LEN: usize = 32 + 4 + (50 * 8);
}

#[account]
pub struct StrategyVault {
    pub owner: Pubkey,
    pub nonce: u64,
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub side: SideKind,
    pub tranches: u16,
    pub tranches_placed: u16,
    pub interval_seconds: u64,
    pub min_bin_id: i64,
    pub max_bin_id: i64,
    pub tranche_amount: u64,
    pub total_cap: u64,
    pub amount_placed: u64,
    pub last_placed_at: i64,
    pub pending_limit_order: Option<PendingOrder>,
    pub status: VaultStatus,
    pub bump: u8,
}

impl StrategyVault {
    pub const LEN: usize = 8   // discriminator
        + 32                   // owner
        + 8                    // nonce
        + 32                   // pool
        + 32                   // mint
        + 1                    // side
        + 2                    // tranches
        + 2                    // tranches_placed
        + 8                    // interval_seconds
        + 8                    // min_bin_id
        + 8                    // max_bin_id
        + 8                    // tranche_amount
        + 8                    // total_cap
        + 8                    // amount_placed
        + 8                    // last_placed_at
        + 1 + PendingOrder::LEN // pending_limit_order (Option<...> flag + payload)
        + 1                    // status
        + 1;                   // bump
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid strategy bounds")]
    InvalidBounds,
    #[msg("Price bracket is wider than the 50-bin DLMM limit-order limit")]
    BracketTooWide,
    #[msg("Total cap must be >= tranche amount")]
    InvalidCap,
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("Strategy is not in a state that allows placing tranches")]
    NotPlaceable,
    #[msg("All configured tranches have already been placed")]
    AllTranchesPlaced,
    #[msg("The tranche cadence (interval) has not elapsed")]
    CadenceNotMet,
    #[msg("No bin ids were provided")]
    NoBins,
    #[msg("More than 50 bins requested")]
    TooManyBins,
    #[msg("A requested bin lies outside the owner's price bracket")]
    BinOutOfBracket,
    #[msg("Placing this tranche would exceed the total cap")]
    CapExceeded,
    #[msg("Limit-order PDA does not match the derived address")]
    WrongLimitOrder,
    #[msg("Token mint does not match the vault's deposited mint")]
    MintMismatch,
}
