# pump-fun-replay-sprint-bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/recx82-ship-it/pump-fun-replay-sprint-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/recx82-ship-it/pump-fun-replay-sprint-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A crowd-launch sniper for the pump.fun replay sprint: a paper-trading bot that trades 10 SOL of paper money over 24 hours of recorded pump.fun bonding-curve activity. It buys only the rare launch that draws a real crowd in its first 3 slots — at least 9 distinct non-creator buyers plus a creator who bought at least 0.75 SOL of their own coin — then scalps it: take profit at +20%, cut at -8%, never hold past 10 slots, and leave at once if the creator sells after our buy filled. One 0.15 SOL stake per coin, at most 5 open positions, no adds, no trailing stops, no partials. Deterministic (no clock, no randomness, no I/O). Dev-window result: +0.219 SOL net PnL, 34 coins round-tripped, 0.65% max drawdown, fully compliant with the minimum bar.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=17s3abg9&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
