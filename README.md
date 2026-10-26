# DEMO DAY

A mobile-first demolition arcade game for the browser. One job, the Halden Exchange: a fifteen-storey framed tower with a brick podium, a concrete core and a wing cantilevered off a steel truss, on a tight lot next to Pellow's Bakery. Bring it down with charges, a wrecking ball, a high-reach excavator and a dozer, clear the lot, and get scored on how you did it.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for the full-screen app experience.

## The job

Objectives: bring the building down (12% or less still standing) and clear 88% of the lot. Bonus: recover the bank vault from inside the core, keep debris off Pellow's, salvage the steel. The clock starts when something first moves; par is 5:00 and the shift ends at 9:00.

The four tools sit in a bar at the bottom of the screen. Each has its own touch controls, camera framing and a one-line prompt the first time you pick it up.

| Tool | Control | What it is for |
| --- | --- | --- |
| **Charges** | Tap a column, core wall, slab or the truss to strap one on; tap again to take it off. **Fire** sets them off in the order you placed them. | 3 cutters (cut the member) and 2 blast charges (weaker on the member, but strip cladding, loosen joints and uncover weak points around them). |
| **Ball** | Drag the ball back and let go; drag the boom tip to move the crane. | Finishing what the charges started, toppling blocks, and setting off charges: a hit on a charged member detonates it. |
| **Excavator** | Touch to place the jaws (the machine drives into reach), hold **Crunch** to bite. | Stumps, sections hung up on the frame, the core's base wall, and slabs too heavy for the dozer. |
| **Dozer** | Touch to drive. Blade first pushes, reversing rides over the rubble. **Turn** swaps which way the blade faces. | Pushing rubble into the haul pit (right) or onto the salvage pad (left). Steel and the vault are only worth money on the pad. |

How the tools feed each other:

- **Charges → ball.** A charge cuts or cracks its member, so the next swing finds the building already overloaded. A swing that hits an unfired charge sets it off (bonus). Falling debris sets off charges too.
- **Ball and blasts → weak points.** Eight members have hidden defects (corroded ties, a cold joint in the core). Damage nearby uncovers them; anything aimed at a weak point does double damage and scores a bonus when it goes.
- **Collapse → excavator.** Heavy core slabs (over 20 t) stop the dozer dead until the excavator breaks them. The vault sits behind the core's base wall: it is safe from falling debris while that wall stands, and only comes out once the wall is crunched or knocked down.
- **Excavator → dozer → score.** Stumps block the dozer; the blade carries about 18 m² of rubble and spills the rest, so big heaps take several passes. Lot clearance, salvage, the vault, time under par and unused charges all score. Debris on Pellow's and machines caught by falling sections cost points.

Every action is recorded. A chain counter follows each one (failures it set off), and the result sheet shows a grade (S to D), a score breakdown, the move that did the most with an exact replay, and eight feats that reward a different approach next time (no charges, no swings, a 30-chain swing, the vault 90% intact, a clean lot, inside par). Best score and feats persist on the device.

The code: `src/wreck/tools.ts` (charges, weak points, excavator, dozer, blocks, site), `src/wreck/job.ts` (objectives and scoring), `src/wreck/autoplay.ts` (an automated crew used by the tests and the smoke run), `src/wreck/render-site.ts` (machines, site and overlays), `src/ui/screens/wreck.ts` (the screen).

### How the building behaves (`src/wreck/`)

- **Structure** (`structure.ts`): about 330 pieces (storey-high column segments, floor slabs, glass, brick, core walls, truss bays, rooftop tank, sign and mast) joined by about 900 joints. Members are sized for the loads they carry when intact (`calibrate` in `solver.ts`), so the building starts at roughly half its capacity everywhere.
- **Load paths** (`solver.ts`): every standing piece passes its weight toward the ground along the cheapest intact paths, split by joint strength. Sideways transfer through slabs builds a moment arm, so a floor bridging a lost column, or a wing hanging off its truss, loads its joints harder.
- **Damage is local**: the ball's energy goes into the piece it strikes and whatever it is touching, and loosens their joints. Damaged pieces lose capacity.
- **Failure creeps**: anything over capacity builds strain and gives way after a delay that depends on how overloaded it is. That is why a column can crack, hold for a few seconds, then buckle. Strain shows as sag, glowing joints and cracks.
- **Falling sections** (`sim.ts`): whatever loses its path to the ground becomes one rigid body that keeps its shape until impacts and hard landings break it apart along its joints. It damages what it lands on, which is how collapse travels down through floors.
- **Overturning**: a block whose centre of mass passes its last footing goes over as one piece.
- **Cause tracking**: every failure is blamed on the action that set it off (a swing, a volley, a crunch), so the game can point at the exact move. A machine nibbling at a collapse someone else started does not take the credit.
- **Rubble** is a heightmap the dozer pushes; heavy concrete and steel come to rest as blocks it has to push (or the excavator has to break).
- Fine debris, glass and dust (`fx.ts`) are cosmetic and driven by simulation events. The simulation is fixed-step and deterministic, and every player command is logged with its tick, which is what makes the replay exact.

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
pnpm preview && pnpm smoke   # headless iPhone playthrough of the whole job (every tool by touch, then the crew finishes) with screenshots
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
