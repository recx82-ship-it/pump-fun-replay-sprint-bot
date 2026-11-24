// Crowd-launch sniper for the pump.fun replay sprint (agent-fun/replay/v2).
//
// Idea, measured on the dev window (24h of recorded pump.fun activity, 1,222 launches):
// most launches die within seconds, but the rare launch that draws a real crowd in its
// first slots keeps running. A launch is worth a small stake only when, inside its first
// 3 slots, at least 9 distinct non-creator wallets have bought AND the creator bought at
// least 0.75 SOL of their own coin (skin in the game) AND the creator has not sold.
// Everything else is skipped: on the dev window the unfiltered "buy every launch" bot
// loses ~0.5 SOL, while this filter turns the same exits profitable.
//
// Once in, the bot is a scalper, not an investor: take profit at +20%, cut at -8%,
// never hold past 10 slots, and leave at once if the creator sells after our buy
// filled (a sale that already happened by fill time is priced in — no exit on that).
// No adds, no trailing stops, no partials — sweeps showed each of those costs money
// on this data. One 0.15 SOL stake per coin, at most 5 open positions (the house cap),
// never more than 1% of a curve's real SOL per order (the house cap, enforced via
// maxBuyLamports), and only curves holding 1–30 SOL of real SOL at decision time.
//
// Pure function of the batches it is fed: no clock, no randomness, no I/O, no secrets.
// The grader runs `node /bot/main.ts`; the SDK shim is vendored byte for byte in vendor/.

import { runBot, BPS, LAMPORTS_PER_SOL, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

/** Lamports staked on one launch. */
const STAKE = 150_000_000n; // 0.15 SOL
/** A launch may only be bought within this many slots of its creation. */
const MAX_ENTRY_AGE = 3;
/** Distinct non-creator buyers that must have bought before entry. */
const MIN_BUYERS = 9;
/** The creator's own buy in the create slot must be at least this (lamports). */
const MIN_DEV_BUY = 750_000_000n; // 0.75 SOL
/** The curve must hold at least this much real SOL at decision time. */
const MIN_REAL_SOL = 1_000_000_000n; // 1 SOL
/** ...and at most this much: a curve already holding a fortune has run its course. */
const MAX_REAL_SOL = 30_000_000_000n; // 30 SOL
/** Curve fee on a sale (protocol 95 bps + creator 30 bps fallback). */
const FEE_BPS = 125n;
/** Sell everything once the position is worth this much over its cost (bps). */
const TAKE_PROFIT_BPS = 2_000n; // +20%
/** Sell everything once the position is worth this much under its cost (bps). */
const STOP_LOSS_BPS = 800n; // -8%
/** Never hold a position longer than this many slots. */
const MAX_HOLD_SLOTS = 10;

interface Launch {
  mint: Pubkey;
  creator: Pubkey;
  createSlot: number;
  devBuy: bigint;
  buyers: Set<Pubkey>;
  devSold: boolean;
  /** Never buy this coin again (bought, exited, filtered out for good, completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Tx fees paid on this position's fills, so the cost basis is honest. */
  txPaid: bigint;
  /** The creator had already sold by the time our buy filled: don't exit on that. */
  devSoldAtOpen: boolean;
}

/** What selling `tokens` against (vq, vt) pays after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

const launches = new Map<Pubkey, Launch>();
const held = new Map<Pubkey, Held>();
/** Mints with a buy order sent but not yet filled or rejected. */
const buying = new Set<Pubkey>();
/** Mints with a sell order sent but not yet filled. */
const selling = new Set<Pubkey>();

function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
  for (const p of state.pending.values()) {
    if (p.order.mint === mint && p.order.side === side) return true;
  }
  return false;
}

const bot = {
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    // 1. Read this batch's events into the launch book.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        launches.set(e.mint, {
          mint: e.mint,
          creator: e.creator,
          createSlot: e.slot,
          devBuy: 0n,
          buyers: new Set(),
          devSold: false,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = launches.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        }
      } else {
        const c = launches.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }

    // 2. Reconcile fills: learn what actually landed.
    for (const f of batch.fills) {
      if (f.client_id.startsWith('_')) {
        // House force-close (complete / end-of-window flatten): position is gone.
        held.delete(f.mint);
        selling.delete(f.mint);
        continue;
      }
      if (f.side === 'buy' && f.status === 'filled') {
        buying.delete(f.mint);
        if (!held.has(f.mint)) {
          held.set(f.mint, {
            openedSlot: f.slot,
            txPaid: BigInt(f.tx_fee_lamports),
            devSoldAtOpen: launches.get(f.mint)?.devSold ?? false,
          });
        }
      } else if (f.side === 'buy' && f.status !== 'filled') {
        buying.delete(f.mint);
      } else if (f.side === 'sell' && f.status === 'filled') {
        selling.delete(f.mint);
        held.delete(f.mint);
      } else if (f.side === 'sell' && f.status !== 'filled') {
        selling.delete(f.mint);
      }
      // Add this fill's tx fee to the position's basis — except the buy fill that
      // just created the Held record (its fee is already in txPaid above).
      if (f.status !== 'rejected' && !(f.side === 'buy' && f.status === 'filled')) {
        const h = held.get(f.mint);
        if (h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
      }
    }
    for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) held.delete(mint);
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
    for (const m of batch.marks) {
      marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
    }

    // 3. Exits first: every open position is checked against its rules.
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (selling.has(mint)) continue;
      const c = launches.get(mint);
      let h = held.get(mint);
      if (h === undefined) {
        h = { openedSlot: state.slot, txPaid: tx, devSoldAtOpen: c?.devSold ?? false };
        held.set(mint, h);
      }
      let mk = marks.get(mint);
      if (mk === undefined) {
        const cv = state.curves.get(mint);
        if (cv === undefined) continue;
        mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
      }
      const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
      const basis = pos.cost_lamports + h.txPaid;
      let exit = false;
      if (basis > 0n) {
        if (value * BPS >= basis * (BPS + TAKE_PROFIT_BPS)) exit = true;
        if (value * BPS <= basis * (BPS - STOP_LOSS_BPS)) exit = true;
      }
      if (state.slot - h.openedSlot >= MAX_HOLD_SLOTS) exit = true;
      // Leave at once if the creator sells AFTER we bought (a sale that already
      // happened by the time our buy filled is priced in — don't exit on that).
      if (c !== undefined && c.devSold && !h.devSoldAtOpen) exit = true;
      if (!exit) continue;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      selling.add(mint);
      if (c !== undefined) c.done = true;
    }

    // 4. Entries: one small stake per qualifying launch, in its first 3 slots.
    let free = state.freeCashLamports();
    let open = state.committedPositionCount();
    for (const c of launches.values()) {
      if (orders.length >= cap) break;
      if (c.done || c.complete) continue;
      if (buying.has(c.mint) || held.has(c.mint) || state.positions.has(c.mint)) continue;
      const age = state.slot - c.createSlot;
      if (age > MAX_ENTRY_AGE) {
        c.done = true;
        continue;
      }
      if (age < 0) continue;
      if (open >= state.hello.caps.max_open_positions) continue;
      const curve = state.curves.get(c.mint);
      if (curve === undefined || curve.complete) continue;
      if (c.devSold) {
        c.done = true;
        continue;
      }
      if (c.devBuy < MIN_DEV_BUY) continue;
      if (c.buyers.size < MIN_BUYERS) continue;
      if (curve.real_quote_reserves < MIN_REAL_SOL) continue;
      if (curve.real_quote_reserves > MAX_REAL_SOL) continue;
      const amount = STAKE < state.maxBuyLamports(c.mint) ? STAKE : state.maxBuyLamports(c.mint);
      if (amount < 5_000_000n) continue;
      if (free < amount + tx) continue;
      orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: 10_000 });
      buying.add(c.mint);
      free -= amount + tx;
      open += 1;
    }
    return orders;
  },
};

await runBot(bot);
