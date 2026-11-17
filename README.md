# Token Radar — a launch radar for pre-token protocols

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/madinzgod/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/madinzgod/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry in make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty: build the
best token launch radar.

A protocol's launch is the token it may issue one day. This program reads one frozen DefiLlama
snapshot of the protocol universe (758 protocols at or above $5M TVL) and answers two questions
for every protocol that records no token yet: what might a launch be worth, and what should a
reader do to farm it before it happens?

## What it does

- **Ranks the whole pre-token universe, not a hand-kept list.** Every protocol that records no
  token is scored by the same stated formula — 232 protocols on the current snapshot, including
  all 40 on the snapshot's watchlist and the long tail below its $50M floor. Exchanges, versioned
  pools of a parent protocol, and (at or above the floor) products of an asset that already
  trades are set aside; protocols already trading are shown apart, at the market's own values.
- **The accrued launch value model.** `implied value = TVL × category multiple × momentum ×
  tokenless tenure × reach` — seven-day TVL momentum, how long the protocol has run with no
  token, and how many chains it runs on, all from the snapshot's own figures. The dashboard shows
  the full breakdown behind every rank.
- **A farm plan per protocol, generated from its own record.** Its category picks the playbook,
  its first chain the funding route, its TVL band the position size, its tokenless age the
  campaign length. Every step states what it costs and how long it takes.
- **A dashboard a reader can use.** A sortable, filterable board (chain, category, watchlist,
  search), a signal strip for the hottest protocols, a detail view per protocol, the
  already-trading set kept apart, and a methodology page that states the model in full. Static
  files only: it renders with no network.

Run the same program on a fresh snapshot and the board re-derives itself — nothing about today's
protocols is written into the code.

## Run it

Node 22, standard library only; nothing to install.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <dir holding snapshot.json>
```

The program writes `board.json` (the ranked board), `radar-data.js` (the dashboard's dataset),
copies of `dashboard/` and `screenshots/`, and `dossier.json` into the output directory. It is
deterministic: two runs over the same snapshot write the same bytes. To look at the dashboard,
serve the output directory with any static file server and open `dashboard/index.html`.

## Layout

- `main.ts` — the program: snapshot in, handover out.
- `lib/model.ts` — the classification, the value model, the signal score, the farm-plan
  generator, and a self-check that refuses a board the gate would refuse.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. No framework, no network.
- `screenshots/` — three renders of the dashboard, taken in a headless browser.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte as shipped (not my code).

## License

MIT — see `LICENSE`.
