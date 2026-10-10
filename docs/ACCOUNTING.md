# State and invariants

All PDA integer seeds are unsigned little-endian u64.

| Account | Seeds |
| --- | --- |
| Launch | `launch`, base mint, registering authority |
| Epoch | `epoch`, launch, epoch index |
| Position | `position`, launch, owner, nonce |
| Principal token account | `principal`, launch |
| Reward token account | `rewards`, launch |

Launch signs vault transfers. Token-program ownership, mint, authority, and PDA
constraints are enforced in every relevant instruction. Position withdrawals
and claims require the recorded owner. No position account closes until its
principal has been withdrawn AND its complete reward range has been processed.

For position [start,end), epochs start through end-1 are eligible. Weight enters
the schedule at start and leaves at end. An epoch's denominator is frozen when
the previous epoch finalizes. No new position can start in an already open epoch.
Schedules are initialized separately and cannot be reset (`init`, not
`init_if_needed`). Anyone can create missing schedules up to current+91.

Transitions are sequential:

1. Current epoch receives funded quote tokens from the collector.
2. After its boundary, any caller finalizes it and transfers its treasury share.
3. Next epoch weight = previous weight - next.ends + next.starts.
4. Claims process finalized epochs from a position's next_claim_epoch cursor.

Every successful authorized funding transfer increases total_received. Every
treasury transfer increases total_platform_paid. Every holder payout increases
total_locker_paid. Absent unsolicited vault transfers:

`total_received = total_platform_paid + total_locker_paid + reward_vault.amount`

Principal custody is independent:

`principal_vault.amount = sum(amount for positions not withdrawn)`

Unsolicited transfers can increase vault balances but not accounting liabilities.
No administrator can make a claim or withdraw on behalf of a different owner.

Keeper catch-up must finalize old epochs before attempting new locks or funding.
Past rewards and denominators cannot be rewritten. Matured principal can leave
even if epochs remain behind; the historical position and schedule still exist.

Claim batching: build up to 3-4 `claim_epoch` instructions in a transaction,
starting at the cursor. Submit more transactions until caught up. A 90-day lock
requires at most 90 epoch claims over its lifetime, not a scan of all holders.
This transaction/rent cost is an MVP tradeoff; optimize later with verified
checkpoint accounting if real usage warrants it.
