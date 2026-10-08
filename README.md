# DEMO DAY 🦺💥

A mobile-first demolition puzzle game for the browser. Study the building, work out what has to fail first, place a limited set of charges, get clear, and watch it come down. Then read the demolition report and collect the payout.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for the full-screen app experience.

## The loop

1. **Inspect** – tap any component to see what it rests on, what it carries, its material and any pre-existing damage.
2. **Plan** – pick a charge from a finite loadout and place it on a component. The preview tells you what the blast will break directly, but not what the building does afterwards. That part is your job.
3. **Arm** – lock the plan. Every charge goes live, the site clears, fuses burn down through the countdown.
4. **Demo Day** – detonate and watch the collapse. Each charge has its own blast; members shudder and crack just before they give way, the load they carried lights up, and a quiet running record shows the chain you set off. Then the dust settles.
5. **Report** – structure removed, collateral, charges used, structural efficiency, and a checklist of the requirements.
6. **Payout** – contract value, then bonuses one at a time, then the total. Your best payout, what this run was short by, and which bonuses were left on the table.
7. **Run it again** – your last plan comes back so you can change one charge and try to beat it.

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
pnpm preview && pnpm smoke   # headless iPhone playthrough with screenshots
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
