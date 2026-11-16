# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/stephenzhao2024/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/stephenzhao2024/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet: it ranks every one of them by what a token would be worth if the protocol's record stood still, deriving the number from the sealed DefiLlama snapshot alone — the protocol's TVL, the median market-cap-to-TVL multiple of the protocols in its own category that already trade, its seven-day flow and how long it has run token-less — and gives each one a farm plan costed in dollars and minutes.

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
