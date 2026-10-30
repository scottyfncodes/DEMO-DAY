# DEMO DAY: casual demolition puzzle plan

Audit of the golf game as it stood (commit 07ba311) and the changes that turn it into a
persistent, drag-to-shoot demolition puzzle. The simulation stays the foundation.

## What is there and stays

| Area | File | Kept as is |
| --- | --- | --- |
| House builder | `src/golf/sim/house.ts` | Brick-by-brick shell on a 0.3 m grid, openings, lintels, floors, partitions, stairs, roof decks and tiles, chimney, porch, furniture, garden. Support graph from contact. |
| Simulation | `src/golf/sim/world.ts` | Fixed 120 Hz step, sub-stepped sphere-vs-box, seam shots, material damage, support cost solve, load and overload creaks, debris with rest and wake, rubble heightfield. Deterministic (Mulberry32 only). |
| Balls | `src/golf/sim/balls.ts` | Standard, Power, Superball, Multiball, Heavy, Charge with their numbers. |
| Prediction | `src/golf/sim/aim.ts` | Same forces and step as the world; stops at the first contact, knows seams. |
| Renderer | `src/golf/render/*` | Instanced parts, pooled fx, ghosted front wall, camera. Reads the sim only. |
| Audio | `src/audio/audio.ts` | Procedural Web Audio cues. |

## What changes

1. **Shooting** (`src/golf/game/controls.ts`, `src/golf/ui/play.ts`). The 0.6 s hold-to-wind-up swing
   goes. Press anywhere, pull back: the vertical pull sets power, the sideways pull turns the
   aim (relative to the last aim, slower when the thumb moves slowly), release fires. Loft
   follows power, so a short pull lands low and a long pull reaches the roof. A release with
   no pull cancels and keeps the aim. Full trajectory to the first contact, seam glint,
   power ring at the thumb.
2. **Shot quality** (`src/golf/game/quality.ts`). Pure function over one shot's sim events:
   CLEAN HIT, PERFECT AIM, WINDOW ENTRY, MULTI HIT, SEAM SHOT, BANK SHOT, CHAIN REACTION,
   SUPPORT DOWN, HOUSE DOWN. One headline per shot, the most impressive.
3. **Reward economy** (`src/golf/game/rewards.ts`). One config table for meter values,
   fatigue on repeats, the meter size and inventory caps. The skill that fills the meter
   picks the ball it pays out (seam pays Power, bank pays Superball, support pays Heavy,
   multi hit pays Multiball, chain pays Charge), limited to balls the campaign has unlocked.
   Standard balls are unlimited.
4. **Persistent houses** (`World.snapshot()` / `World.restore()`, `src/golf/save.ts` v2). A
   settled world is stored part by part (state, hp, rubble pose, heightfield, RNG) under its
   own key per house. Saved after every settled shot and on page hide.
5. **Campaign** (`src/golf/game/houses.ts`). Ten houses with one structural idea each and a
   clear objective; no shot budget. Completing unlocks the next house and pays specials;
   a finished house can still be played.
6. **Weak points** (`World.fallIfRemoved()`). After each shot the game finds the standing
   supports whose loss would drop the most, and the renderer gives the top few a slow pulse.
7. **Modes.** PLAY (campaign), DAILY DEMO (one shared house per date, eight shots, score,
   local history), SANDBOX (every ball, unlimited), CHALLENGES (the old campaign levels,
   precision shots and Score Attack, with stars and medals). Crew Contracts stays reachable
   from Settings.
8. **Feel.** Hit-stop and slow motion scaled to the shot tier, camera shake on supports and
   collapses, damage darkening before a break, new cues for support snaps, meter fill,
   special earned, special launch and house down, and a per-frame sound budget.
9. **Look.** Bright toybox HUD: cream paper chips with ink type, safety yellow for action,
   brick red for destruction. The house fills the screen.

## Save model (v2)

```
demo-day:golf          { version: 2, levels, daily, dailyHistory, coached,
                         campaign: { current, houses: { [id]: { shots, done, best } } },
                         inventory: { power, super, multi, heavy, blast },
                         meter, fatigue }
demo-day:golf:house:ID { WorldSnapshot }
```

v1 saves migrate in place: level records become challenge records, finished old campaign
levels open the matching number of houses, and nothing in the crew save is touched.
