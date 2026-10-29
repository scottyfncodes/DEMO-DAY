# DEMO DAY

Golf-powered house demolition for the phone browser. You stand on a tee in front of a brick house with a bag of golf balls. Every brick, pane, floor, beam and roof tile is its own piece: knock bricks out one at a time, split two at once with a seam shot, send a ball in through a window to rattle round the rooms, and undercut a wall until the roof above it comes down.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for full-screen play. Progress is saved on the device.

## How it plays

- **Swing** with one thumb: press anywhere on the lawn, slide to aim (sideways turns the shot, up and down sets the loft), let go to hit it. Every shot is full power, so the aim is the whole game. Let go on the strip along the bottom edge to call a swing off; a quick brush of the screen does nothing. **Zoom** halves the aim speed for fine work. On a keyboard, the arrows aim and Space swings.
- A yellow dot marks where the ball will land first; the guide shows the start of the flight (the whole flight, and a landing ring that turns white on a seam, with Precision Mode and on the teaching levels).
- **Bricks**: a square, hard hit breaks the brick it lands on. Land on the mortar joint between two bricks (within 4 cm, within 38° of square, hard enough for both) and both go: a **seam shot**. Old brick breaks easier; reinforced courses need the Power or Heavy ball.
- **Windows** break at any speed and the ball carries on inside. The front of the house turns see-through while a ball is in a room, so you can follow it off the furniture, through the doorways and out the back.
- **Structure**: bricks rest on the course below in running bond and hang sideways from their neighbours for a couple of bricks, so a small hole arches over and a wide undercut drops the wall above it. Lintels carry the wall over openings, floors bear on the front and back walls, roof sections need half the wall top under them and a ridge beam carried by the gables, the porch roof sits on a beam on two columns, and the chimney stands on its own footing. Overloaded pieces creak, then give way. Falling pieces land on, and break, what is under them.

| Ball | What it does |
| --- | --- |
| Standard | Predictable. Breaks brick and glass; the seam-shot ball |
| Power | Faster and heavier, punches through brick and reinforced courses. Hooks right at full power, shorter guide |
| Superball | Keeps its bounce off every surface. Weak on brick, made for windows, rooms and bank shots |
| Multiball | Five balls in a fan, each with its own flight and hits |
| Heavy | Three times the mass on a slow, dropping flight; shoves the parts around its hit. No good for seams or ricochets |
| Charge | A golf ball packed like a demolition charge: goes off on the first hard contact |

Power-ups: **Power Drive** (faster, harder), **Ricochet Boost** (keeps more bounce for eight contacts), **Precision Mode** (three shots with the full flight path and a seam-aware landing ring), **Multi-Golfer** (three golfers fire your shot together from three tees). Consecutive scoring shots build a **streak** multiplier; a miss resets it.

Birds, a squirrel and the cat get out of the way as soon as you swing. They are never targets.

## Modes

- **Campaign**: ten handcrafted levels, one new idea each (bricks, seams, windows, the interior, a load-bearing porch, ricochet chains, the garden, the chimney, the roof, and the whole house). Stars for finishing at or under par.
- **Score Attack**: eight shots, bronze, silver and gold.
- **Precision Challenges**: in one side and out the other, the trophy upstairs, the grandfather clock.
- **Daily Challenge**: one layout per calendar day, built from the date, scored on this device.
- **Sandbox**: every ball and power-up you have met, no budget.
- **Crew Contracts**: the original machine-and-moves Demo Day (crane, charges, excavator, dozer, loader), kept whole under Levels with its own save.

## How it is built

- **Simulation** (`src/golf/sim/`): deterministic and fixed-step (120 Hz). `house.ts` lays out the house brick by brick on a 0.3 m grid with openings, lintels, floors, partitions, stairs, roof decks and tiles, chimney, porch, furniture and garden, and links what rests on what. `world.ts` flies the balls (sub-stepped sphere-vs-box, so nothing tunnels), resolves damage and seam shots, solves support and load, and drops loose parts as tumbling debris that lands on rubble. `session.ts` is the shot budget, ammo, power-ups, scoring and objectives, read only from simulation events. `levels.ts` holds every level as data.
- **Rendering** (`src/golf/render/`): three.js. Bricks and other box parts are instanced (one draw call per size and material), furniture and garden pieces are merged single meshes, effects are pooled. Nothing in the renderer writes to the simulation.
- **UI** (`src/golf/ui/`): plain DOM over the canvas, touch first, safe-area aware.
- **Save**: golf progress is stored under its own key (`demo-day:golf`); the Crew Contracts save (`demo-day:save`) is never read, changed or reset by the golf game.
- Procedural Web Audio sound. PWA manifest and service worker.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # vitest: physics, seams, structure, scoring, saves, and every level replayed to its par
pnpm typecheck    # tsc --noEmit
pnpm build        # production build to dist/
pnpm check        # all three
pnpm preview && pnpm smoke   # headless iPhone runs of the golf game and Crew Contracts
pnpm tune         # slow local searches (level solutions, medal thresholds)
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
