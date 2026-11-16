# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/stephenzhao2024/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/stephenzhao2024/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet: it ranks every one of them by what a token would be worth if the protocol's record stood still, and it prices that from the sealed DefiLlama snapshot alone. The price is a power law over TVL, fitted to the protocols whose token already trades, then carried by three measured factors — how the protocol's category trades against that curve, its seven-day flow, and how long it has run token-less — and the whole thing is fitted again with each trading token held out in turn, so every row carries a P10-to-P90 range from that blind miss rather than a point estimate. Each row also gets a farm plan costed in dollars and minutes, and a net verdict on a $1,000 ticket after gas and the yield the capital forgoes.

The page shows its own working: the curve and its coefficients, the factor table, the blind-test comparison against five alternatives, the scatter of TVL against implied value, and the net of every plan.

## Run it

```sh
# Node 22.18+; the sealed snapshot comes from the bounty's kit (input/snapshot.json).
mkdir -p out && node main.ts --input path/to/input/snapshot.json --output out
# then open out/dashboard/index.html in a browser, beside the out/data.js it wrote
```

`main.ts` reads the snapshot, ranks every protocol that records no token, writes `out/board.json`,
`out/data.js`, copies `dashboard/` and `screenshots/` beside them, and writes `out/dossier.json`.
It runs the same twice byte for byte: nothing in it depends on the clock, the network or a random seed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=629cdfz6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
