# DEMO DAY

A casual demolition puzzle for the phone browser. A street of little brick houses, a tee, and a bag of golf balls. Every brick, pane, floor, beam and roof tile is its own piece: find the weak spot, take it out, and watch the rest come down. Damage stays put, so you can take a few shots, close the app, and pick up the same half-wrecked house later.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for full-screen play. Progress is saved on the device.

## How it plays

- **Shoot** with one thumb: touch the spot you want to hit, then pull back. The pull sets power; the flight bends to reach your spot, so a full pull at a low brick is a flat drive and a soft pull is a lob. The guide shows the flight to the first thing it touches. Let go to shoot, or let go before the ring fills to only move your aim. On a keyboard, arrows move the aim, W and S set power, Space shoots.
- **Weak points** pulse yellow while you aim: the standing parts whose loss would bring the most down.
- **Shot quality**: one headline per shot, the best thing it did: CLEAN HIT, PERFECT AIM, WINDOW ENTRY, MULTI HIT, SEAM SHOT, BANK SHOT, CHAIN REACTION, SUPPORT DOWN, HOUSE DOWN. Small hits tick, critical supports slow time, big collapses shake the lot.
- **Special balls are hidden in the bricks.** Standard balls are unlimited. Each house hides a few special balls inside its bricks, always in the same bricks; break one and the ball pops out into your bag. A row of slots shows how many are still hidden, but not what they are.

| Ball | What it does |
| --- | --- |
| Standard | Unlimited, predictable. Breaks brick and glass; the seam-shot ball |
| Power | Faster and heavier, punches through brick and reinforced courses |
| Superball | Keeps its bounce off every surface. Made for windows, rooms and bank shots |
| Multiball | Five balls in a fan, each with its own flight and hits |
| Heavy | Three times the mass on a dropping flight; shoves supports out |
| Charge | Goes off on the first hard contact |

## Modes

- **Play**: ten houses on a street, each bigger than the last, from a one-storey cottage to a three-storey house 14 m wide. Each has a destruction goal (15 to 22%) that opens the next one. There is no shot limit; the record to beat is how few shots it took. Damage stays between visits, and any house can be rebuilt to try for fewer shots (balls already found stay found).
- **Daily Demo**: one house per date, the same on every device. Eight shots, scored on damage and skill, with your recent days kept on this device.
- **Sandbox**: every special ball, unlimited.
- **Challenges**: the original ten trick-shot levels, the precision shots and Score Attack, with shot limits, stars and medals.
- **Crew Contracts**: the original machine-and-moves Demo Day, kept whole under Settings with its own save.

## How it is built

- **Game layer** (`src/golf/game/`): pull-back controls, shot quality, the reward economy and the campaign houses, all pure and tested. See `docs/PUZZLE_PLAN.md`.
- **Simulation** (`src/golf/sim/`): deterministic and fixed-step (120 Hz). A settled world snapshots to a compact list of what changed (`World.snapshot()` / `restore()`), which is how houses keep their damage. `house.ts` lays out the house brick by brick on a 0.3 m grid with openings, lintels, floors, partitions, stairs, roof decks and tiles, chimney, porch, furniture and garden, and links what rests on what. `world.ts` flies the balls (sub-stepped sphere-vs-box, so nothing tunnels), resolves damage and seam shots, solves support and load, and drops loose parts as tumbling debris that lands on rubble. `session.ts` is the shot budget, ammo, power-ups, scoring and objectives, read only from simulation events. `levels.ts` holds every level as data.
- **Rendering** (`src/golf/render/`): three.js. Bricks and other box parts are instanced (one draw call per size and material), furniture and garden pieces are merged single meshes, effects are pooled. Nothing in the renderer writes to the simulation.
- **UI** (`src/golf/ui/`): plain DOM over the canvas, touch first, safe-area aware.
- **Save**: progress is stored under its own key (`demo-day:golf`, version 2, migrated in place from version 1) and each house's damage under `demo-day:golf:house:<id>`; the Crew Contracts save (`demo-day:save`) is never read, changed or reset by the golf game.
- Procedural Web Audio sound. PWA manifest and service worker.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # vitest: physics, structure, controls, rewards, saves, every house finished with the real controls, every challenge at par
pnpm typecheck    # tsc --noEmit
pnpm build        # production build to dist/
pnpm check        # all three
pnpm preview && pnpm smoke   # headless iPhone runs of the golf game and Crew Contracts
pnpm tune         # slow local searches (level solutions, medal thresholds)
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
