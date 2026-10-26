# DEMO DAY

A mobile-first demolition game for the browser. One crane, one wrecking ball, and the Halden Exchange: a fifteen-storey framed tower with a brick podium, a concrete core and a wing cantilevered off a steel truss. Find the hit that brings it down.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for the full-screen app experience.

## The wrecking ball

- **Drag the ball** back and let go to swing. While you hold it, a dotted line shows the arc and brackets the piece it will hit, with what that piece carries, how intact it is, and how fast the ball will be going when it gets there.
- **Drag the boom tip** to move the crane: it drives and luffs to put the hook where you want it. Hits are hardest at the bottom of the arc, so where you park the crane matters as much as how far you pull.
- **Loads** tints the structure by how hard each part is working: amber is loaded, red is failing.
- When it is down, the result card names the swing that started the collapse, what it hit, what gave way next and how many tonnes came down with it. **Watch the hit** replays that swing exactly; **Try another way** stands the building back up.

### How the building behaves (`src/wreck/`)

- **Structure** (`structure.ts`): about 330 pieces (storey-high column segments, floor slabs, glass, brick, core walls, truss bays, rooftop tank, sign and mast) joined by about 900 joints. Members are sized for the loads they carry when intact (`calibrate` in `solver.ts`), so the building starts at roughly half its capacity everywhere.
- **Load paths** (`solver.ts`): every standing piece passes its weight toward the ground along the cheapest intact paths, split by joint strength. Sideways transfer through slabs builds a moment arm, so a floor bridging a lost column, or a wing hanging off its truss, loads its joints harder.
- **Damage is local**: the ball's energy goes into the piece it strikes and whatever it is touching, and loosens their joints. Damaged pieces lose capacity.
- **Failure creeps**: anything over capacity builds strain and gives way after a delay that depends on how overloaded it is. That is why a column can crack, hold for a few seconds, then buckle. Strain shows as sag, glowing joints and cracks.
- **Falling sections** (`sim.ts`): whatever loses its path to the ground becomes one rigid body that keeps its shape until impacts and hard landings break it apart along its joints. It damages what it lands on, which is how collapse travels down through floors.
- **Overturning**: a block whose centre of mass passes its last footing goes over as one piece.
- **Cause tracking**: every failure is blamed on the swing that set it off, so the game can point at the exact hit.
- Fine debris, glass and dust (`fx.ts`) are cosmetic and driven by simulation events. The simulation is fixed-step and deterministic, which is what makes the replay exact.

### The charge contracts

The original charge-placement contracts are still under **Contracts** on the title screen.

## The world

Every job sits on a real lot in a real neighbourhood, built at true scale (a car is 4.4 m, a house 7–9 m, a brick course 75 mm):

**District → blocks → lots → buildings → details.** Each district (Eastgate's suburbs, Holloway Flats farmland, the Ironworks Yard, the Wharf District) is generated deterministically from the job's site (`src/data/sites.ts`, `src/world/world.ts`): blocks split by cross streets, lots with setbacks, driveways, fences, trees, street lights, power lines, parked cars and traffic, a back row of buildings and a skyline. The job lot has its crew, site office, sign, barriers and the taped-off landing zone. Nothing generated ever stands inside the job site, and none of it touches the simulation.

The scene is drawn with depth (`src/render/world.ts`): the further back a layer is, the higher and smaller it sits, so panning gives parallax and the overview reads as a receding plane of lots and converging streets. Detail fades in with zoom: silhouettes and lit windows from the district view, siding, shingles, mullions and porch lights at the lot, and on the target building real-size brick coursing, clapboard laps, formwork tie holes, steel ribs, bolts, nail plates, boarded-up windows, doors, ladders and lettering up close.

**Camera.** Pinch / wheel from the whole district down to the bolts (about 1 to 360 px per metre), drag with momentum, and the view never leaves the world. A minimap strip shows every structure and the camera frame (tap it to travel), a scale bar names the level you are looking at (District, Block, Lot, Detail), ⤢ frames the job lot and ◎ flies out to the district and back. Each job opens on the district and flies down to the lot. On desktop: arrows pan, +/− zoom, 0 frames the lot, O toggles the overview.

**Precise placement.** Tap a component where you want the charge: it snaps to a 10 cm grid along the member, shown on a ruler with its real blast radius. Nudge it with the ▼▲ (or ◀▶) stepper. The strap point moves the blast in the preview and the simulation, so the height of a charge on a chimney decides which floor it takes with it.

## Contracts

| Job | Building | Type | Teaches |
| --- | --- | --- | --- |
| 01 | Garden Shed | Full demolition | What is really holding the roof up |
| 02 | Detached Garage | Clearance | Slabs tip toward the end they lose; blasts weaken neighbours |
| 03 | Grain Silo | Controlled collapse | Lean and directional charges |
| 04 | Two-Storey House | Precision demo | Blast radius and materials |
| 05 | Ironworks Smokestack | Selective demolition | Protecting adjacent structures |
| 06 | Riverside Warehouse | Full demolition | Cores, load limits and pancake collapses |

Every contract stays replayable, with best payout, destruction, collateral, fewest charges and efficiency tracked per job. Money buys equipment that changes what you can plan: a structural scanner, extra charge types, and a higher-yield blend.

## Tech

- TypeScript + Vite, no runtime dependencies.
- Canvas 2D renderer, procedural Web Audio sound, PWA manifest + service worker.
- Charge art (`src/render/charges.ts`) and explosion, debris and stress effects (`src/render/effects.ts`) are purely cosmetic, driven by simulation events.
- When a job is armed the locked plan is simulated once headlessly (`src/game/timeline.ts`) so the presentation knows which members are about to fail; the live run is a separate, identical simulation.
- Deterministic, tick-based collapse simulation (`src/sim/simulation.ts`) built on a support graph (`src/structure/`): unsupported members tip or drop, falling pieces damage what they hit, overloaded members crush, debris is scored by where it lands.
- Buildings, contracts, charges, equipment and job sites are plain data in `src/data/`; the world around each job is generated from its site in `src/world/`.
- Progress persists in `localStorage` with validation and graceful fallback.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # vitest unit tests
pnpm typecheck    # tsc --noEmit
pnpm build        # production build to dist/
pnpm tune         # prints how a set of placements plays out on every building
pnpm icons        # regenerates PWA icons from public/favicon.svg
pnpm preview && pnpm smoke   # headless iPhone wrecking-ball playthrough with screenshots
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
