# Tupāra

A browser game (formerly "Slurp"; the repo, folder and dev-server name still say slurp): a young rescued tamandua (lesser anteater) is released into the forest and must
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
  layers. No image assets. (The one asset file is the stand-in ambience recording in `audio/`.)
- The **tongue's red is the only colour** in the world. Sting welts use the same red.
  Scent wisps are neutral off-white by default. The `C` key tints them per species, as an option only.
- Every shape helper winds the same way so shared `Path2D`s never punch holes. Anything drawn with
  `limb()` over another shape needs its **own path**, or the overlap cancels out and shows as a pale
  gap (this bit the burrow's roots once).
- **No rim light** on the tamandua, the other tamandua, the rescuer or the cage: they're plain
  silhouettes (the user prefers it). The rim (`R`) is for the ants only.
- The head is a separate shape pivoting at `HEAD_PIVOT`. Its back edge is rounded off low so a
  hanging head (slumped, clawing) doesn't poke a notch above the back line.

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
  A load opens on the title screen (phase `'title'`), then the intro, and every new game opens with the
  intro. `skipIntro()` jumps straight to night 1 from either.
  Welts and `flash` only age inside `render`.
- World generation uses the **seeded** `rnd` (`mulberry32(11)`), so the layout is the same every load,
  but **generation order matters**: adding or reordering anything shifts everything after it.
  To add world content without disturbing the existing layout, generate it inside
  `withSeed(n, fn)`, which draws from a separate stream and then restores the main one. The far
  forest (seed 83) and the river (seed 13) do this. The original generation loops still use
  `OLD_W` (5200), not `WORLD_W`.
  Runtime randomness (species dealing, stings) uses `Math.random`.
- `console.assert`s fire if a shelter or leafcutter nest fails to find room on the crowded floor.
- **Testing keys to remove before release:** `]` skip 30 s, `N` next night, `T` jump to the next
  shelter east (wraps; no energy or time cost, `jumpToNextShelter`), `L` show species labels.

## Controls
← → walk (on a trunk: step onto a branch) · ↑ ↓ climb at a trunk · **X** rip into a nest ·
hold **Space** to eat ants (tongue) · Shift hurry · **Enter** sleep in a shelter at dawn / continue ·
Z close-up camera · C scent tint · R rim light (ants only) · M sound on/off · H hide help.

## main.js layout (top to bottom)
utils → light/palettes → shape helpers → ground → **nests** (tables `NEST_TYPES`, `SPECIES`,
`HOMES`, `HOMES_LATER`, `addNest`) → termite mounds → trees (`makeTree`: branches and dead branches;
`leafyBranch`: a living branch and maybe a hanging carton; `crownAndTrunk`: crown, trunk carton,
loose bark, ant trail) → floor placement + **shelters** (placed first so they always
fit) → leafcutter nests → logs + litter → bee hives, bullet ants, army raid, alate home → **the far
forest** (`withSeed(83)`, walkway bridges) → background → foreground (`fgClump`) → **the river** (`withSeed(13)`:
foreground extension, far bank, ripples, water) → the tamandua (body shapes, input, `updateTamandua`, claw strike, hitting/carving/
snapping nests, tongue, `updateAnts`) → **nights/energy/game flow** (`game`, `eatAnt`, `sting`, nose
memory, `dealSpecies`, `wakeCreatures`, `startNight`, `newGame`, `onEnter`, `updateGame`) →
**sound** (`makeSfx`, `sfx(name)`) → **scenes** (`INTRO_STEPS`, `RESCUE_STEPS`, `FREE_STEPS` + the other tamandua, the scene runner,
rescuer + cage drawing) → termite swarms → **scent** → camera/render/HUD → `frame`.

## Systems
**Sound.** Subtle effects are made in code with Web Audio (no files), as `makeSfx(ac, out)` in
`main.js`. `sfx(name)` plays one: `eat` (soft blip, every ant), `rip` (earthy scrape, every claw
strike into a nest), `sting` (double nip) and `bullet` (a much worse one), `shelter` (a
three-note lullaby on Enter to sleep), `snap` (the branch cracking), `thud` (when the tamandua
hits the ground after falling with a snapped branch, or when the branch lands if it wasn't on
it), and `bees` (a marimba run, the first time a hive gives honey each night, via `n.rang`). The
audio starts on the first key or click. M mutes everything (effects and music), and that's
remembered in localStorage.
**Soundtrack** (`startAmbience`, `AMBIENCE`): for now a field recording, not music. The generated
piece (D on the audition page) was too sad in play, so the user chose to stand in
`audio/borneo-canopy.mp3` (Borneo rainforest canopy, 3 min) until better music is found. It's the
game's only asset file. The recording fades in and out at its ends, so only its steady middle
(7–172 s) loops, each pass crossfading into the next over 5 s (equal power). It's quiet as
recorded, so it gets ×3.75 to sit under the effects (rms ~0.019; ×5 drowned them out). It's fetched and decoded after
the first key or click, and passes are scheduled ahead by a 1 s timer (75 s ahead while the tab is
hidden). It needs the page served over http (it can't load from a file:// page; the game then just
runs without it).
`tools/sounds.html` is the audition page, with three variants of each and the user's picks
(eat A, rip B, sting C, shelter B, snap A, bees C; music D was used, then replaced by the recording). Try new sounds there first.

**Title screen.** Shown once per page load, over the dusk forest with the intro waiting behind it.
It tells the story: the player is **Tupāra**, rescued from a forest fire as a baby and raised at the
rescue center (`STORY`). There's a "how to play" page (`HOW_TO`, `HOW_KEYS`), which explains the
rules and keys but never which smells are good. Play or Enter fades the text away (`title.leaving`) and the intro starts, with no fade to black.
`?` opens the how-to page.
Buttons are drawn on the canvas (`title.btns`, hit-tested in the click handler).

**Scenes.** Both are lists of steps (timed `d`, or `until()`) played by `playScene`/`updateScene`
and shared helpers (`walkIn`, `walkOff`). Captions show and the HUD is hidden during them, and Enter
skips them (`skipIntro` / `endScene`). The rescuer is one person with a cap and a headlamp.

*Intro (the release).* Phase `'intro'`. At dusk a rescuer (one person, with a headlamp whose
beam is a pale cone) walks in carrying the tamandua in a travel cage, kneels, sets it down and
lifts the guillotine door. The tamandua walks out to `START_X`, driven by the `puppet` keys that
`held()` reads outside the night, and then control hands over (`handOver`) and night 1 starts. The
rescuer keeps going on their own: they stand, pick up the cage, give Tupāra a gentle wave with
their free hand (`hand2`), and walk off left. The script is
`INTRO_STEPS`. While `cage.holds`, `holdTamandua()` pins the tamandua inside, and `a.curl` curls
its tail.
The rescuer is built from `limb`/`circ` with a separate path per part. The near arm is drawn
after the cage.

*Rescue (fail).* Energy hits 0 → `startRescue(cause)`, phase `'rescued'`. If it's up a tree, the
tamandua climbs down on its own (puppet keys). Then it slumps (`a.slump`, head hanging), and the
rescuer walks in from the left, kneels, reaches under it and gathers it to their chest
(`rescuer.holds`: the tamandua follows the near hand), stands and walks off left. The camera
stays put, and then the "rescue team found you" card shows (`a.hidden`). Carrying it in the arms
was chosen over the cage because the rescuer can't reach past a cage to the tamandua while
kneeling.

*Free (win).* Enter on the night-3 dawn card → `startFree()`, phase `'free'`. The next dusk, it
wakes at its shelter, climbs down if it slept in a tree hollow, and walks away from the river
(`scene.dir`: left if it's within 900 of it, otherwise right). A grown tamandua (`mate`, drawn
1.15× by lending its pose to `drawTamandua` in `drawMate`) comes the other way. They meet nose to
nose (`greet`). Then the mate leads to the nearest tree and they climb it together, one up each side
of the trunk (`mate.climb`; `updateMate` walks and climbs). The picture fades as they go up, before
the "three nights on your own" card.

**Night clock.** `NIGHT_LEN` 240 s. The sky blends dusk → night → dawn → day along `game.clock`
(0 dusk, 1 sunrise). From `DAWN` (0.8, 3:12) you may sleep. After sunrise you're exposed and lose
`EXPOSED_DRAIN`/s until sheltered. Three nights (`NIGHTS`).

**Energy.** Starts at 80 (`E_START`), max 100, carries over between nights. Drains: 0.34/s always
(0.25/s up a tree, `DRAIN_REST_TREE`), +0.12/s moving, +0.3/s hurrying, 0.35 per claw strike, 3 per
sting (per-species overrides). Below 25 you're weak: you can't hurry (normal speed otherwise).
Trees are meant to pay: climbing is quick (`CLIMB_SPEED` 40), tree nests hold the most, and
carpenters and termites are dealt mostly to tree nests, fire ants mostly to the ground. Gains: per ant by species (see `SPECIES`), larvae double, honey pot 3.
Sleeping gives `SLEEP_BONUS` +5 (it was +20, which wiped out almost any poor night: an 8-year-old
won on ~60 safe ants a night without ever learning a smell).
**Nest odds** (`HOMES`, and `HOMES_LATER` from night 2) are tuned so learning the smells matters:
a nest can hurt you (fire, azteca) ~42% of the time on night 1, and ~51% on nights 2–3 once
acrobats move in and the ground gets more fire ants. Loose bark is always safe. The nightly target (`NIGHT_TARGET` 150) is hidden. The HUD shows the
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
Bee (in your fur: slows you, no stings) and bullet (15 energy per sting, only when licked:
walking over them is safe, so knowing the smell lets you avoid them)
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

**World.** 6500 wide (`WORLD_W`). The original forest runs to 5200 (`OLD_W`). Beyond it is the
**far forest** (x5200–6500): denser trees (4, about 300 apart), 9 more nests (7 of them in trees), a
bee hive and a bullet-ant tree, and a **canopy walkway**. Between each pair of neighbouring trees, a
branch from each rises to meet the other's, and the tips overlap by `BRIDGE_OVERLAP` (the linked
branches have `b.link`). Both of a tree's walkway branches leave its trunk at the same height
(~220–245 up). So holding ← or → walks you along the whole chain: off one branch tip onto the
neighbour's, and straight across each trunk to the branch on its other side (only while not
pressing ↑ ↓, so you can still get on and off the trunk there). The whole walkway takes ~20 s.
The rule lives in `updateTamandua`'s branch mode, and it only applies to branches that line up
across a trunk (within 30), which never happens in the original forest. At the east end
is a **river** (`RIVER_X` ~6490 to `RIVER_FAR`): `groundY` dips into a deep bed, pale water fills
it, and the far bank has reeds and trees. The tamandua stops at x6440 (no walking on the spot) with a
one-time "too wide and fast to cross" message (`game.riverSeen`).

**Shelters** (four, fixed): a tree hollow ~x1176 (180 up the trunk), a burrow under a stump
~x2690, a hollow log ~x4570 (enter at its open right end), and a hollow high in a tree ~x5924
(~280 up, in the far forest). They're made by `makeTreeHollow`, `makeBurrow` and `makeHollowLog`.
The tamandua starts at x320. Passing one announces it. Sleeping hides the tamandua, shows the dawn card, and
you wake there next dusk.

## Open items and ideas
- Walk follows the user's clip (`~/Dropbox/Documents/Staging/slurp/tamandua_walk.mov`; side-on at
  1.8–3.2 s and 14–24 s): a low crouch, belly clearance ~30% of body depth (`STAND` −9). Front legs
  are short thick columns bending only at the wrist, and each paw curls back under the forearm while
  in the air. Hind legs are crouched and plantigrade (knee forward inside the body, IK to a raised
  ankle, long flat foot). Waddle: hips dip on hind touchdowns and shoulders on fore touchdowns
  (`DIP`), giving a small pitch about `BODY_PIVOT`. `bodyPose()` and `bodyPt(x, y)` carry the offset
  and pitch, and anything placed on the body must go through `bodyPt`. The head doesn't inherit the
  pitch, and on the ground the snout is kept from sinking below the surface.
  Proposed, not done: tail held out stiffly when walking steadily and dragging when slow.
- Video frames: `swift tools/sheet.swift <video> <out.png> t0 t1 step cols tileW [cropX cropY cropW cropH]`
  makes a labelled contact sheet of exact frames (AVFoundation; crop values are fractions of the
  frame). Write the output outside the repo.
- Rearing up on hind legs and tail (tripod stance) to lick winged termites overhead: proposed, "not yet".
- Step 5 is done: the intro, rescue and free scenes.
- Balance: much more food on nights 2–3 now. The 150 target may need raising after playtests.
  Shelters are far apart.
- The walkway is only in the far forest. It could be extended (for example, a bridge from the
  original forest's last tree), but that tree belongs to the main seed, so a link would have to be
  added without adding draws to it.
- Winged termites could reuse a stronger termite wisp instead of their own (one less smell to learn).
- Remove the testing keys before release.
