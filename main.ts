// Anchorhold: a cbBTC bot for agent-fun/bars-replay/v1 that stays long almost
// all of the window and spends its complexity on not losing, not on timing.
//
// Why this shape. A full-size round trip in this replay costs roughly 35-40
// bps (4 bps fee and 2 bps of slippage a side, plus constant-product impact
// against a pool about $0.9M deep), while one-minute cbBTC closes move about
// 6 bps a bar. Any strategy that trades often pays that toll far more often
// than the market pays it back: on the published dev window the kit's own
// active baselines (EMA cross, ADX momentum, RSI/Bollinger) all lost money
// exactly that way, and every faster variant tried in development did too.
// What the window rewarded was simply being long: Bitcoin's drift over a day
// is the only edge here that is bigger than the toll.
//
// So the bot takes the market's side early and holds it, and reserves its
// trading for the one case where holding is the losing side: a collapse.
// Places are paid by net PnL whatever its sign, but only to entries whose
// race-window drawdown stays within 25%; a plain hold of a -30% day breaks
// that bar and ranks below every entry that meets it. The two exits below
// exist to keep this entry inside the bar on a disaster day, at the price of
// sitting out the rest of that day.
//
// The rules, all decided on a bar's close and filled at the next bar's open:
//   Entry. Once 12 bars have been seen, buy with all the cash the weight cap
//     leaves room for. If the price is already more than 1.5% under the
//     first close seen, the window opened mid-fall: wait until the trailing
//     60-bar return is no longer negative before stepping in. No new
//     position is opened in the last 40 batches of the window, where a
//     round trip cannot pay for itself.
//   Disaster exits (either one sells everything and ends the bot's
//     trading; there is no re-entry, because re-entries are what bled in
//     testing):
//     - the position is worth 7% less than it cost, at a close; or
//     - the trailing 240-bar return is under -3% (a slow bleed the value
//       stop alone would ride much further down).
//     On the dev window neither comes close to firing (its worst 240-bar
//     trailing return was -1.5% and its worst drawdown 2.1%); on a
//     synthetic -30% day they cut the loss from -29.9% (a plain hold,
//     whose 29.8% drawdown also breaks the 25% bar) to -5.8%, and the
//     drawdown to 5.8%. An exit refused at a gap open is sent again on
//     the next bar while its reason still holds.
//   Slippage caps: 200 bps on the entry, 500 bps on an exit, so an order
//     is refused rather than filled across a gap, and the intent is simply
//     re-decided on the next bar that exists.
//
// The bot is a pure function of the bars it has been sent: no clock, no
// environment, no randomness, integer comparisons throughout (ratios are
// cross-multiplied, never divided into floats), so two executions on the
// same window answer byte for byte the same. A batch carrying no CBBTC bar
// changes nothing: the closes below advance only on bars that exist, and
// an order refused for a missing bar is re-decided on the next bar that
// comes.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

/** Bars to watch before the entry: skips the opening minutes' noise, still
 *  long for about 99% of the window. */
const ENTRY_AFTER_BARS = 12;
/** Drift under the first close that counts as "opened mid-fall", in bps. */
const FALL_GATE_BPS = 150n;
/** While gated, the trailing return (bars) that must stop being negative. */
const RELEASE_LOOKBACK = 60;
/** Disaster exit one: position value at or under 93% of its cost. */
const STOP_VALUE_NUM = 93n;
const STOP_VALUE_DEN = 100n;
/** Disaster exit two: trailing return over this many bars under -3%. */
const BLEED_LOOKBACK = 240;
const BLEED_BPS = 300n;
/** No fresh entries once this many batches have gone by (window: 1,440). */
const LAST_ENTRY_SEQ = 1400;
/** Slippage caps named on the orders. */
const ENTRY_MAX_SLIPPAGE_BPS = 200;
const EXIT_MAX_SLIPPAGE_BPS = 500;

/** Every CBBTC close seen, in the order the bars arrived (gaps add none). */
const closes: bigint[] = [];
/** Set once a disaster exit has been sent: the bot never buys again. */
let stopped = false;

/** The close of the CBBTC bar this batch carries, or null when it has none. */
function freshClose(batch: Batch): bigint | null {
  for (const bar of batch.bars) {
    if (bar.symbol === SYMBOL) return BigInt(bar.c);
  }
  return null;
}

/** Whether now is more than bps under then, compared in integers. */
function below(now: bigint, then: bigint, bps: bigint): boolean {
  return now * 10_000n < then * (10_000n - bps);
}

function exitOrders(state: BarsState, qty: bigint): SellInput[] {
  stopped = true;
  return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: EXIT_MAX_SLIPPAGE_BPS }];
}

function entryOrders(state: BarsState): BuyInput[] {
  const room = state.weightRoom(SYMBOL);
  const notional = state.cash < room ? state.cash : room;
  if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: ENTRY_MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state, batch) {
    const close = freshClose(batch);
    if (close === null) return [];
    closes.push(close);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // Disaster exit one: the position is worth 7% less than it cost.
      if (state.value(SYMBOL, held.qty) * STOP_VALUE_DEN <= held.cost * STOP_VALUE_NUM) {
        return exitOrders(state, held.qty);
      }
      // Disaster exit two: a slow bleed, -3% over the trailing 240 bars.
      if (closes.length > BLEED_LOOKBACK && below(close, closes[closes.length - 1 - BLEED_LOOKBACK], BLEED_BPS)) {
        return exitOrders(state, held.qty);
      }
      return [];
    }

    if (stopped || closes.length <= ENTRY_AFTER_BARS || state.seq >= LAST_ENTRY_SEQ) return [];
    if (below(close, closes[0], FALL_GATE_BPS)) {
      // The window opened mid-fall: step in only once the last hour of
      // bars stops falling.
      if (closes.length <= RELEASE_LOOKBACK || close < closes[closes.length - 1 - RELEASE_LOOKBACK]) return [];
    }
    return entryOrders(state);
  },
});
