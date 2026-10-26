# DEMO DAY

A mobile-first demolition strategy game for the browser. Take a contract, pick your crew, bring the building down, clear the lot, recover what is worth money, get paid, and upgrade your fleet for the next, bigger job.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for full-screen play. Progress is saved on the device.

## How it plays

Every machine brings a limited number of **moves** to a job. One token is one move.

1. **Pick a machine** from the bar at the bottom (its counter shows the moves left).
2. **Tap a target.** The site shows a preview: where the ball lands, what a charge's shock reaches, where the excavator will stand, the arrow of a dozer run, where the loader will take its bucket. The panel says what it will do and what it costs.
3. **Confirm.** The move is spent once (a second tap cannot spend it again), the machine does it, and the simulation plays out. The next move is ready when the dust settles; **Speed up** fast-forwards.

Previewing, selecting and cancelling are free. Invalid moves explain why and cost nothing.

| Machine | One move | Good at |
| --- | --- | --- |
| **Crane & wrecking ball** | One swing at the point you tap (or a drop from above, with the upgrade) | Heavy hits on the frame; starting collapses |
| **Charges** | One charge strapped to a column, wall or slab (shaped charges cost two). Firing is free; a charge you take off before firing is refunded | Cutting supports anywhere, at any height; toppling tall things the way you choose |
| **Excavator** | Drives into reach and takes three bites | Precision: stumps, hung-up sections, core walls, slabs too heavy to push |
| **Bulldozer** | One run: gets behind the rubble you tap and pushes it toward the pit or the pad | Clearing the most rubble per move |
| **Wheel loader** | One scoop: a bucket of rubble, or one block lifted, carried to the pad or the pit | Recovering salvage and prizes, cleaning up corners |

The tools feed each other: charges and the ball bring it down, the excavator breaks what is too heavy, the dozer clears, the loader recovers what pays. Most jobs can be finished more than one way.

## Contracts

| Job | Building | The problem |
| --- | --- | --- |
| 01 | Corner Store | Training job: one good swing, then clear it |
| 02 | Halsey Auto | Steel frame; the truss steel pays on the salvage pad |
| 03 | No. 12 Maple Street | A floor safe to recover from a timber house next to No. 14 |
| 04 | Holloway Silo | 27 m of concrete, the farmhouse 10 m away: it must fall the other way |
| 05 | Ironworks Stack | A 36 m chimney the boom cannot reach the top of, beside a pump house that must not be touched |
| 06 | Riverside Stores | A stair core that holds the middle up, and a ship's bell inside it |
| 07 | Market Street Parkade | Five decks of heavy slabs the dozer cannot push until they are broken |
| 08 | The Halden Exchange | Fifteen storeys, a core, a cantilevered wing and a vault, next to Pellow's Bakery |

Each job has primary objectives (bring it down, clear the lot, and on some jobs keep debris off the neighbour) and bonus objectives. The payout sheet lists every line: the contract fee and each bonus are **paid once**; replays pay for salvage, prizes, recycled rubble and moves to spare, minus damage next door and machine repairs. Stars: finish, meet every bonus, come in at or under the move par.

## Garage and upgrades

Start with the crane and the dozer; buy the excavator, charges licence and loader. Every machine has a **Power**, an **Efficiency** and a **Capability** track (heavier ball, longer boom, drop strikes; stronger breaker, longer reach, shears; bigger blade, heavier push, ram plate; high-yield and shaped charges, the structural scanner; bigger bucket, heavy-lift arms, scrap sorter). Each upgrade changes a number the simulation reads (`src/wreck/kit.ts`), and several show on the machine itself.

## How it is built

- **Simulation** (`src/wreck/`): a deterministic, fixed-step structural simulation. Buildings are column, slab and infill pieces joined by joints (`buildings.ts`, `structure.ts`); a load solver routes weight to the ground and sizes members for their intact loads (`solver.ts`); overloaded parts creep and fail, unsupported groups fall as rigid sections, break up on impact, and come to rest as a rubble heightmap and blocks (`sim.ts`). Machines, charges, the pit and the pad live in `tools.ts`. The same inputs at the same ticks always give the same collapse.
- **Moves** (`src/game/moves.ts`): budgets, previews, a commit that cannot double-spend, and the settle phase. `crew.ts` is an automated crew that plays through the same API; the tests use it to prove every contract can be finished.
- **Game** (`src/game/`, `src/data/`): contracts, fleet and upgrades as data; payout, progression and the save (versioned, validated, migrates the first-generation save).
- **Rendering** (`src/render/`): a lit 3/4 diorama on Canvas 2D. The simulation is 2D; every piece, heap and machine is extruded in depth with an oblique projection, with directional light, cast shadows, damage and strain feedback, dust and debris (`src/wreck/fx.ts`).
- **UI** (`src/ui/`): plain DOM screens (title, contracts, job sheet and crew, play, results, garage, records, settings), safe-area aware, touch first.
- No runtime dependencies. Procedural Web Audio sound. PWA manifest and service worker.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # production build to dist/
pnpm check        # all three
pnpm preview && pnpm smoke   # headless iPhone run: training job by touch, results, a garage purchase, reload
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
