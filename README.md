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
