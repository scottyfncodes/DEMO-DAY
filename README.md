# DEMO DAY 🦺💥

A mobile-first demolition puzzle game for the browser. Study the building, work out what has to fail first, place a limited set of charges, get clear, and watch it come down. Then read the demolition report and collect the payout.

**Play it:** https://scottyfncodes.github.io/DEMO-DAY/

Add it to your iPhone Home Screen (Share → Add to Home Screen) for the full-screen app experience.

## The loop

1. **Inspect** – tap any component to see what it rests on, what it carries, its material and any pre-existing damage.
2. **Plan** – pick a charge from a finite loadout and place it on a component. The preview tells you what the blast will break directly, but not what the building does afterwards. That part is your job.
3. **Arm** – lock the plan and get clear.
4. **Demo Day** – countdown, detonate, and watch the collapse. Tilting slabs, toppling stacks, crushed columns, debris and dust.
5. **Report** – structure removed, collateral, footprint, charges used, structural efficiency, and which requirements you met.
6. **Payout** – contract value, then bonuses one at a time, then the total. Beat it next time.

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
- Deterministic, tick-based collapse simulation (`src/sim/simulation.ts`) built on a support graph (`src/structure/`): unsupported members tip or drop, falling pieces damage what they hit, overloaded members crush, debris is scored by where it lands.
- Buildings, contracts, charges and equipment are plain data in `src/data/`.
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
