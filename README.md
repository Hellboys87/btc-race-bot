[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Hellboys87/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Hellboys87/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# Anchorhold — a cbBTC bars-replay bot

A bot for make.fun's "Race a BTC trading bot live for 24 hours"
(btc-race-24h-20261117-0603, harness `agent-fun/bars-replay/v1`). It trades
cbBTC/USDC minute by minute against $1,000 of paper money, long only, and is
ranked by net PnL on the 24 hours after the deadline; it races only because
its dev-window grade made money.

## Strategy

Anchorhold stays long almost all of the window and spends its complexity on
not losing, not on timing.

A full-size round trip in this replay costs roughly 35–40 bps (4 bps fee and
2 bps of slippage a side, plus constant-product impact against a pool about
$0.9M deep), while one-minute cbBTC closes move about 6 bps a bar. Strategies
that trade often pay that toll far more often than the market pays it back —
on the published dev window the kit's active baselines (EMA cross, ADX
momentum, RSI/Bollinger) all lost money exactly that way. What the window
rewarded was simply being long: Bitcoin's drift over a day is the only edge
here bigger than the toll.

The rules, all decided on a bar's close and filled at the next bar's open:

- **Entry.** Once 12 bars have been seen, buy with all the cash the weight
  cap leaves room for. If the price is already more than 1.5% under the first
  close seen, the window opened mid-fall: wait until the trailing 60-bar
  return is no longer negative before stepping in. No new position in the
  last 40 batches of the window, where a round trip cannot pay for itself.
- **Disaster exits** — either one sells everything and ends the bot's
  trading (no re-entry; re-entries are what bled in testing):
  - the position is worth 7% less than it cost, at a close; or
  - the trailing 240-bar return is under −3% (a slow bleed).
  
  Places are paid by net PnL whatever its sign, but only to entries whose
  race-window drawdown stays within 25%; a plain hold of a −30% day breaks
  that bar. On the dev window neither exit comes close to firing (worst
  240-bar trailing return −1.5%, worst drawdown 2.1%); on a synthetic −30%
  day they cut the loss from about −30% to about −6%.
- **Slippage caps:** 200 bps on the entry, 500 bps on an exit, so an order
  is refused rather than filled across a gap, and the intent is re-decided
  on the next bar that exists.

The bot is a pure function of the bars it has been sent — no clock, no
environment, no randomness, integer comparisons throughout — so two
executions on the same window answer byte for byte the same. A batch with
no CBBTC bar changes nothing: the closes advance only on bars that exist.

## Dev-window result

Graded with the kit's own grader
(`node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process`):

| bot | net PnL (USDC) | trades | max drawdown |
| --- | ---: | ---: | ---: |
| **Anchorhold** | **+4.045618** | 1 | 2.12% |
| momentum (house) | +2.445627 | 1 | 2.12% |
| buy-and-hold (house) | +1.067187 | 1 | 2.12% |
| hold-cash (house) | 0.000000 | 0 | 0% |
| rsi-bollinger | −24.252523 | 11 | 2.79% |
| adx-momentum | −32.655586 | 26 | 3.60% |
| ema-cross (house) | −106.214838 | 68 | 10.96% |

Guardrails met; the grader's second execution reproduced the first byte
for byte. At 2× fees Anchorhold still makes +3.243517 USDC.

## Layout

- `main.ts` — the bot (Node 22, TypeScript with erasable syntax only). The
  grader runs it as `node /bot/main.ts`.
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, byte for byte
  as shipped in the kit (`sdk/makefun-bars.ts`, sha256
  9677370b0ab7e759c486a929afc95a11fb0fb32c7ec37053d3ebabd426aec5c8).

No dependencies, no install step, standard library only.
