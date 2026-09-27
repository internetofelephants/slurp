# Slurp

A browser game: a young rescued tamandua (lesser anteater) is released into the forest and must
survive **three nights** on its own. Each night it forages from dusk to dawn, learning which ants
and termites are good to eat by their **smell**, and at dawn it must reach a shelter to sleep
through the day. Run out of energy and the rescue team takes it back to rehab; survive three
nights and it's free.

The name "Snoutrageous" belongs to a different game. Don't use it here.

## Working with the user
- Build slowly, one step at a time, and check in before big additions.
- Learning the smells by trial and error, and **memorising** them, is part of the challenge.
  Don't add aids that give the answers away (a permanent notebook was deliberately removed).
- Species are grounded in real tamandua biology, and the user shares research to build from.

## Look and feel (rules)
- Everything is procedural on one canvas: dark silhouettes against a light, hazy sky, with parallax
  layers. No image assets.
- The **tongue's red is the only colour** in the world. Sting welts use the same red.
  Scent wisps are neutral off-white by default. The `C` key tints them per species, as an option only.
- Every shape helper winds the same way so shared `Path2D`s never punch holes. Anything drawn with
  `limb()` over another shape needs its **own path**, or the overlap cancels out and shows as a pale
  gap (this bit the burrow's roots once).

## Running and testing
- `index.html` + `main.js`, no build step. Dev server: `.claude/launch.json` → `slurp-dev`
  (`python3 -m http.server 8321`).
- `index.html` loads `main.js?v=<timestamp>` because the dev server lets the browser cache stale code.
  If behaviour doesn't match the source, check `updateScent.toString()` etc. in the page.
- The browser pane throttles `requestAnimationFrame` when hidden, so real-time tests are unreliable. To
  test, stop the loop (`window.requestAnimationFrame = () => {}`) and step the game manually:
  call `updateGame, stepPalette, updateAnts, updateTamandua, updateNests, updateScent` with
  `dt = 1/60` and advance `last` by 1000/60 each step, setting `keys.ArrowRight = true` etc. for input.
  Call `render(time, dt)` for a picture. `startNight(n)` jumps nights.
  Welts and `flash` only age inside `render`.
- World generation uses the **seeded** `rnd` (`mulberry32(11)`), so the layout is the same every load,
  but **generation order matters**: adding or reordering anything shifts everything after it.
  Runtime randomness (species dealing, stings) uses `Math.random`.
- `console.assert`s fire if a shelter or leafcutter nest fails to find room on the crowded floor.
- **Testing keys to remove before release:** `]` skip 30 s, `N` next night, `L` show species labels.

## Controls
← → walk (on a trunk: step onto a branch) · ↑ ↓ climb at a trunk · **X** rip into a nest ·
hold **Space** to eat ants (tongue) · Shift hurry · **Enter** sleep in a shelter at dawn / continue ·
Z close-up camera · C scent tint · R rim light · H hide help.

## main.js layout (top to bottom)
utils → light/palettes → shape helpers → ground → **nests** (tables `NEST_TYPES`, `SPECIES`,
`HOMES`, `HOMES_LATER`, `addNest`) → termite mounds → trees (branches, dead branches, hanging cartons,
trunk cartons, loose bark, ant trails) → floor placement + **shelters** (placed first so they always
fit) → leafcutter nests → logs + litter → bee hives, bullet ants, army raid, alate home → background
→ foreground → the tamandua (body shapes, input, `updateTamandua`, claw strike, hitting/carving/
snapping nests, tongue, `updateAnts`) → **nights/energy/game flow** (`game`, `eatAnt`, `sting`, nose
memory, `dealSpecies`, `wakeCreatures`, `startNight`, `newGame`, `onEnter`, `updateGame`) → termite
swarms → **scent** → camera/render/HUD → `frame`.

## Systems
**Night clock.** `NIGHT_LEN` 240 s. The sky blends dusk → night → dawn → day along `game.clock`
(0 dusk, 1 sunrise). From `DAWN` (0.8, 3:12) you may sleep. After sunrise you're exposed and lose
`EXPOSED_DRAIN`/s until sheltered. Three nights (`NIGHTS`).

**Energy.** Starts at 80 (`E_START`), max 100, carries over between nights. Drains: 0.34/s always,
+0.12/s moving, +0.3/s hurrying, 0.35 per claw strike, 3 per sting (per-species overrides). Below 25
you're weak: slower, no hurry. Gains: per ant by species (see `SPECIES`), larvae double, honey pot 3.
Sleeping gives `SLEEP_BONUS` +20. The nightly target (`NIGHT_TARGET` 150) is hidden. The HUD shows the
plain count, and the dawn card says "well fed" or "still hungry".

**Nests** (`NEST_TYPES`: crust, bite, burst, stock, brood):
- litter, hanging carton, trunk carton, fallen log, termite mound (night 1)
- loose bark (peels in plates) and dead branch (snaps at `SNAP_AT` dug out, drops you,
  lands flat and spills its ants and larvae)
- leafcutter antmound (night 2+) and stingless-bee hive (night 3+, honey pots instead of brood)

Each rip carves toward the nearest intact sample under the snout. The first `crust` rips only chip.
After that, each rip releases a burst of ants that scurry about for 3.5–6 s, then run back in (back
into stock). Brood chambers can open from the 3rd breach (`BROOD_CHANCE` 0.4). A nest left alone for
`REGROW` 40 s while off-screen rebuilds. Everything refills and species are re-dealt each night.

**Species** (11): termite, carpenter, azteca (alarm: safe ~3 s, then licks sting and lingering near
gets you stung), fire, woodtermite (night 1). Acrobat (nips), leafcutter (trail workers safe, nest
soldiers bite), army (a raid column marching along the floor that stings anyone standing in it),
alate (winged termites from a 20 s mound swarm; one swarm on night 2, two on night 3) (night 2).
Bee (in your fur: slows you, no stings) and bullet (15 energy per sting, underfoot or licked)
(night 3). Newcomers are dormant, meaning not drawn, smelled or edible, before their night
(`fromNight`, `wakeCreatures`). Trail ants don't respawn within a night.

**Stings.** `sting(where, species)` applies the species' `hurt`/`flinch`/`word`: head jerk, screen shake,
and a small red welt on the snout (lick) or body.

**Scent.** Nests and ants emit wisps carried on a slowly shifting wind. A full or broken-open nest
smells stronger, and a nearly empty one barely at all. Each species has its own wisp shape and motion
(`scentGlyph`). Scent shows **only while walking** (`SCENT_WALK`), fades when you stop, and is always
hidden while holding Space (eating). It's banded by distance from the snout (`SCENT_BANDS`). Walking
nose-first into a nest gives a strong puff. Symbols of what's at the snout float over the head.

**Learning.** Eating from a new nest shows the species name briefly (no notebook). Species tasted on
nights 1 and 2 are committed to the **nose memory** when you sleep (`commitMemory`,
`JOURNAL_NIGHTS`). It's opened by clicking the button under the stats panel, and verdicts come from
the player's own experience. It resets on a new game.

**Shelters** (one of each, fixed): a tree hollow ~x1176 (180 up the trunk), a burrow under a stump
~x2690, and a hollow log ~x4570 (enter at its open right end). The tamandua starts at x320, and the
world runs to ~5140. Passing one announces it. Sleeping hides the tamandua, shows the dawn card, and
you wake there next dusk.

## Open items and ideas
- Walk follows the user's clip (`~/Dropbox/Documents/Staging/slurp/tamandua_walk.mov`; side-on at
  1.8–3.2 s and 14–24 s): a low crouch, belly clearance ~30% of body depth (`STAND` −9 in `bodyBob`,
  which moves everything but the feet; anything placed on the body must include it). Front legs are
  short thick columns bending only at the wrist; hind legs are crouched and plantigrade (knee forward
  inside the body, IK to a raised ankle, long flat foot). Proposed next, not done: a sharp wrist
  curl as the front paw lifts, alternating shoulder/hip dips (waddle), tail held out when walking.
- Video frames: `swift tools/sheet.swift <video> <out.png> t0 t1 step cols tileW [cropX cropY cropW cropH]`
  makes a labelled contact sheet of exact frames (AVFoundation; crop values are fractions of the
  frame). Write the output outside the repo.
- Rearing up on hind legs and tail (tripod stance) to lick winged termites overhead: proposed, "not yet".
- Step 5: intro scene (a rescuer opens a cage) and outro scenes (rescue team / free life).
- Balance: much more food on nights 2–3 now. The 150 target may need raising after playtests.
  Shelters are far apart (the hollow log is near the far end).
- Winged termites could reuse a stronger termite wisp instead of their own (one less smell to learn).
- Remove the testing keys before release.
