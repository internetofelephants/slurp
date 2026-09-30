// Tupāra — a young tamandua's first three nights in the wild.
// Everything is drawn procedurally on one canvas: dark shapes against a light sky.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const VIEW_H = 600;      // world units visible vertically
const OLD_W = 5200;      // the original forest, still generated exactly as it always was
const WORLD_W = 6500;    // playable width: the far quarter beyond OLD_W ends at the river
const HORIZON = 0.62;    // screen fraction where world y = camera y sits
const S = 0.72;          // tamandua scale
const TAU = Math.PI * 2;

// ---------- utils ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// World generation draws from one seeded stream, so the layout is the same every load. The far
// forest (and anything else added later) runs on a stream of its own via withSeed, so it can't shift
// the rest.
let rndStream = mulberry32(11);
const rnd = () => rndStream();
function withSeed(seed, fn) {
  const keep = rndStream;
  rndStream = mulberry32(seed);
  fn();
  rndStream = keep;
}
const rand = (a = 0, b = 1) => a + (b - a) * rnd();
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;

const TONGUE = '#8f3b36'; // the only colour in the world
const REACH = 48;         // how far the tongue can reach from the snout tip
const ants = [];          // every ant, whatever it's crawling on: trunk, ground trail, or nest

// ---------- light / palettes (blended along the night clock) ----------
const PALETTES = [
  { name: 'dusk',  top: '#d49a8b', bottom: '#f3c68f', sun: '#fde8c4', ink: '#1a110d', mote: '#fff4dc', sunX: 0.7,  sunY: 0.5,  sunR: 64, glow: 0 },
  { name: 'night', top: '#6d7a93', bottom: '#b3bcc7', sun: '#f4f3ec', ink: '#0d0f14', mote: '#f8f09c', sunX: 0.28, sunY: 0.22, sunR: 40, glow: 1 },
  { name: 'dawn',  top: '#c6d1d8', bottom: '#f2d8b8', sun: '#fff3e2', ink: '#16130f', mote: '#ffffff', sunX: 0.22, sunY: 0.56, sunR: 60, glow: 0 },
  { name: 'mono',  top: '#cbcbc8', bottom: '#ecebe8', sun: '#fbfbf9', ink: '#141414', mote: '#ffffff', sunX: 0.66, sunY: 0.32, sunR: 56, glow: 0 },
  { name: 'day',   top: '#d3e0de', bottom: '#f1ecdd', sun: '#fffdf7', ink: '#15130f', mote: '#ffffff', sunX: 0.6,  sunY: 0.16, sunR: 50, glow: 0 },
];
const toNum = (p) => ({
  top: hex(p.top), bottom: hex(p.bottom), sun: hex(p.sun), ink: hex(p.ink), mote: hex(p.mote),
  sunX: p.sunX, sunY: p.sunY, sunR: p.sunR, glow: p.glow,
});
const PAL = Object.fromEntries(PALETTES.map((p) => [p.name, toNum(p)]));
// light through one night, by clock (0 = dusk, 1 = dawn)
const SKY = [[0, 'dusk'], [0.2, 'night'], [0.8, 'night'], [1, 'dawn'], [1.2, 'day']];
function skyAt(t) {
  let i = 0;
  while (i < SKY.length - 2 && t > SKY[i + 1][0]) i++;
  const [t0, n0] = SKY[i], [t1, n1] = SKY[i + 1], k = clamp((t - t0) / (t1 - t0), 0, 1);
  const A = PAL[n0], B = PAL[n1], out = {};
  for (const key in A) out[key] = Array.isArray(A[key]) ? mix(A[key], B[key], k) : lerp(A[key], B[key], k);
  return out;
}
const pal = skyAt(0);
function stepPalette(dt) {
  const t = skyAt(game.clock);
  const k = 1 - Math.exp(-dt * 2);
  for (const key in t) pal[key] = Array.isArray(t[key]) ? mix(pal[key], t[key], k) : lerp(pal[key], t[key], k);
}

// ---------- shape helpers (every primitive winds the same way, so shared paths never punch holes) ----------
function circ(p, x, y, r) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU, true); }
function limb(p, x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L, d = Math.atan2(dy, dx);
  p.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2);
  p.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  p.arc(x1, y1, Math.max(w1 / 2, 0.01), d + Math.PI / 2, d - Math.PI / 2, true);
  p.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2);
  p.closePath();
}
function blob(p, cx, cy, rx, ry) {
  p.moveTo(cx + rx * 0.8, cy);
  p.ellipse(cx, cy, rx * 0.8, ry * 0.72, 0, 0, TAU, true);
  const n = Math.round(5 + rx / 14);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), rr = Math.sqrt(rnd());
    circ(p, cx + Math.cos(a) * rx * 0.6 * rr, cy + Math.sin(a) * ry * 0.55 * rr, rand(0.35, 0.55) * ry);
  }
  // leafy fringe: small overlapping clumps hugging the edge, a few tiny leaves just beyond it
  const m = Math.round(rx / 2.5);
  const lr = Math.min(1, rx / 60 + 0.4);
  for (let j = 0; j < m; j++) {
    const a = (j / m) * TAU + rand(-0.1, 0.1);
    const k = rand(0.72, 0.9);
    circ(p, cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, rand(5, 9) * lr);
    if (rnd() < 0.35) {
      const k2 = k + rand(0.08, 0.16);
      p.moveTo(cx + Math.cos(a) * rx * k2 + 3 * lr, cy + Math.sin(a) * ry * k2);
      p.ellipse(cx + Math.cos(a) * rx * k2, cy + Math.sin(a) * ry * k2, 3.2 * lr, 1.6 * lr, a, 0, TAU, true);
    }
  }
}

// ---------- ground ----------
// At the east end the ground drops into a riverbed: a river too wide to cross ends the world.
const groundBase = (x) => 10 * Math.sin(x * 0.0037) + 6 * Math.sin(x * 0.0112 + 1.3) + 3 * Math.sin(x * 0.027 + 0.4);
const RIVER_X = WORLD_W - 10, RIVER_FAR = RIVER_X + 470;   // near bank … far bank
const RIVER_Y = groundBase(RIVER_X) + 20;                    // the water line
const groundY = (x) => {
  const b = groundBase(x);
  if (x <= RIVER_X || x >= RIVER_FAR) return b;
  let s = Math.min((x - RIVER_X) / 90, (RIVER_FAR - x) / 100, 1);
  s = s * s * (3 - 2 * s);
  return lerp(b, RIVER_Y + 110, s);   // the banks slope down to a deep bed
};
const groundSlope = (x) => (groundY(x + 1) - groundY(x - 1)) / 2;

const groundPath = new Path2D();
groundPath.moveTo(-2000, 3000);
groundPath.lineTo(OLD_W + 2000, 3000);
for (let x = OLD_W + 2000; x >= -2000; x -= 16) groundPath.lineTo(x, groundY(x));
groundPath.closePath();
for (let x = -2000; x < OLD_W + 2000; x += rand(5, 15)) {
  const gy = groundY(x);
  for (let b = randInt(1, 3); b > 0; b--) limb(groundPath, x, gy + 2, x + rand(-6, 6), gy - rand(3, 13), 2.2, 0.3);
}

// ---------- nests: the things a tamandua rips open ----------
// Every nest is a silhouette plus a cloud of sample points inside it. A claw strike carves a
// ragged hole around the nearest intact sample, so repeated strikes dig progressively inward,
// and each strike past the crust lets a burst of ants out to scurry around the breach. Ants
// that aren't eaten in time go back inside, so the rhythm is: rip, lick, lick, rip.
const NEST_TYPES = {
  //       crust: strikes that only chip before the first breach · bite: hole size
  //       burst: ants let out per breaching strike · stock: ants inside
  //       brood: larvae in the brood chambers, found by digging deep (worth double)
  carton:     { crust: 0, bite: 11, burst: [4, 6], stock: 40, brood: 8 },   // papery nest hanging under a branch
  trunk:      { crust: 1, bite: 10, burst: [4, 6], stock: 40, brood: 8 },   // carton plastered onto a trunk
  mound:      { crust: 3, bite: 8,  burst: [6, 9], stock: 60, brood: 10 },  // sun-baked clay: hard but rich
  log:        { crust: 1, bite: 9,  burst: [3, 5], stock: 30, brood: 6 },   // soft, rotten fallen wood
  litter:     { crust: 0, bite: 13, burst: [2, 4], stock: 12, brood: 0 },   // leaf pile: easy, a small snack
  bark:       { crust: 0, bite: 10, burst: [3, 5], stock: 32, brood: 0 },   // loose bark down a trunk: peels off in plates
  deadbranch: { crust: 1, bite: 8,  burst: [3, 5], stock: 32, brood: 6 },   // bare dead branch: snaps if you dig too much
  antmound:   { crust: 1, bite: 12, burst: [6, 9], stock: 50, brood: 0 },   // leafcutters' low sprawling soil mound
  beehive:    { crust: 2, bite: 9,  burst: [5, 7], stock: 30, brood: 8 },   // stingless bees in a hollow trunk: brood = honey pots
};
// Brood chambers: once a nest has been breached BROOD_AFTER times, each further breach may open one
const BROOD_AFTER = 2, BROOD_CHANCE = 0.4;
// A dead branch gives way once this much of its wood has been dug out
const SNAP_AT = 0.22;
// Every nest (and every ant trail) holds one species, re-dealt each night. The ants all look
// alike: the only way to find out what's inside is to eat some (and, later, to smell them).
// energy: per ant eaten · sting: chance a lick stings · hurt/flinch/word: what a sting costs and says
// (defaults: STING_COST, 0.6 s, 'ouch — stung!')
const SPECIES = {
  termite:     { energy: 0.7, sting: 0 },    // nasute termites: safe, everyday food
  carpenter:   { energy: 1.1, sting: 0 },    // carpenter ants: safe and rich
  azteca:      { energy: 1.0, sting: 0 },    // tasty, but stings build up the longer you stay (see alarm)
  fire:        { energy: 0.3, sting: 0.6 },  // fire ants: barely worth eating, and most licks sting
  woodtermite: { energy: 1.0, sting: 0 },    // wood termites in dead and rotting wood: safe and rich
  // from night 2
  acrobat:     { energy: 0.8, sting: 0.25, hurt: 0.5, flinch: 0.25, word: 'nip!' },  // mild nips, nearly always worth it
  leafcutter:  { energy: 0.5, sting: 0, soldiers: 0.5, hurt: 2, word: 'bitten by a soldier!' },  // trail workers safe, nest soldiers bite
  army:        { energy: 0.2, sting: 0.8 },  // a raiding column on the move: stay out of its way
  alate:       { energy: 1.2, sting: 0 },    // winged termites pouring out of a mound: a short-lived feast
  // from night 3
  bee:         { energy: 0.4, sting: 0 },    // stingless bees: they only get in your fur; the prize is the honey
  bullet:      { energy: 0.5, sting: 1, hurt: 15, flinch: 1.6, word: 'BULLET ANT — agony!' },  // never again
};
const HONEY_ENERGY = 3;   // each honey pot in a bee hive
// which species tend to live where
const HOMES = {
  litter: { fire: 0.8, termite: 0.15, carpenter: 0.05 },
  log:    { fire: 0.4, woodtermite: 0.3, termite: 0.15, carpenter: 0.15 },
  bark:   { woodtermite: 0.6, carpenter: 0.3, termite: 0.1 },   // the one reliably safe find
  deadbranch: { woodtermite: 0.45, carpenter: 0.35, azteca: 0.2 },
  antmound: { leafcutter: 1 },
  beehive:  { bee: 1 },
  mound:  { termite: 0.6, fire: 0.4 },
  carton: { termite: 0.5, azteca: 0.5 },
  trunk:  { carpenter: 0.45, azteca: 0.35, termite: 0.2 },
};
// from night 2 the forest gets meaner: more fire ants on the ground, and acrobat ants move into the
// tree nests (nest types not listed keep their night-1 odds)
const HOMES_LATER = {
  litter: { fire: 0.85, termite: 0.1, carpenter: 0.05 },
  log:    { fire: 0.45, woodtermite: 0.3, termite: 0.1, carpenter: 0.15 },
  mound:  { termite: 0.5, fire: 0.5 },
  carton: { termite: 0.3, azteca: 0.35, acrobat: 0.35 },
  trunk:  { carpenter: 0.35, azteca: 0.3, acrobat: 0.2, termite: 0.15 },
};
// Azteca soldiers: once a nest is breached they take ALARM_DELAY s to rally, then over ALARM_RISE s
// every lick risks a sting and anyone lingering nearby gets stung, so the trick is to eat fast and go.
const ALARM_DELAY = 3, ALARM_RISE = 3, ALARM_CALM = 10;
const STING_COST = 3;
const trails = [];   // ant trails on trunks with no nest of their own: they still need a species
const nests = [];
const debris = [];
const CLAW_AIM = [58, -8];   // strikes land on the nearest intact bit of nest around here (under the snout)
const CLAW_REACH = 30;       // …within this distance
const CLAW_DUR = 0.42, WIND = 0.45, STRIKE = 0.15;  // strike lands at WIND + STRIKE of the swing
const CLAW_UP = [46, -56], CLAW_HIT = [48, -3];     // paw hooked up over the snout → slammed down ahead
const REAR_PIVOT = -47;      // the body rocks back onto the hind feet to wind up a strike
// body pitch through a strike: rock back while winding up, lunge into the blow, settle
function clawRear(t) {
  if (t < 0) return 0;
  if (t < WIND) { const e = t / WIND; return 0.2 * e * e * (3 - 2 * e); }
  if (t < WIND + STRIKE) return lerp(0.2, -0.05, (t - WIND) / STRIKE);
  return -0.05 * (1 - (t - WIND - STRIKE) / (1 - WIND - STRIKE));
}
const REGROW = 40;           // seconds a damaged nest must be left alone (and off screen) to rebuild
let shake = 0;

// opts: ground (sits on the forest floor: ants can spill onto the ground around it),
//       keep(x, y) (which interior points can be dug), leaves (a leaf-litter pile),
//       fromNight (doesn't exist before that night)
function addNest(type, path, x, box, opts = {}) {
  const T = NEST_TYPES[type];
  const n = {
    type, T, x, path, box, ground: !!opts.ground, leaves: opts.leaves || null,
    samples: [], holes: new Path2D(), tunnels: new Path2D(),
    crust: T.crust, stock: T.stock, damaged: false, quiet: 0,
    species: null, stir: -1, alarm: 0, breaches: 0, brood: T.brood, snap: null,
    fromNight: opts.fromNight || 1, dormant: false,
  };
  if (n.leaves) {
    for (const l of n.leaves) { l.s = { x: l.x, y: l.y, cut: false }; n.samples.push(l.s); }
    buildLitter(n);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = box.y0; y <= box.y1; y += 4) {
      for (let x = box.x0; x <= box.x1; x += 4) {
        if (n.ground && y > groundY(x) - 1) continue;
        if (opts.keep && !opts.keep(x, y)) continue;
        if (ctx.isPointInPath(path, x, y)) n.samples.push({ x, y, cut: false });
      }
    }
  }
  // the ground around a floor nest is somewhere for released ants to run, never something to dig
  if (n.ground) {
    for (let x = box.x0 - 30; x <= box.x1 + 30; x += 5) n.samples.push({ x, y: groundY(x) - 1.5, cut: true, spill: true });
  }
  nests.push(n);
  return n;
}
function buildLitter(n) {
  n.path = new Path2D();
  for (const l of n.leaves) {
    if (l.gone) continue;
    n.path.moveTo(l.x + Math.cos(l.rot) * l.rx, l.y + Math.sin(l.rot) * l.rx);
    n.path.ellipse(l.x, l.y, l.rx, l.ry, l.rot, 0, TAU, true);
  }
}
function restoreNest(n) {
  n.holes = new Path2D(); n.tunnels = new Path2D();
  n.crust = n.T.crust; n.stock = n.T.stock; n.damaged = false; n.stir = -1; n.alarm = 0;
  n.breaches = 0; n.brood = n.T.brood; n.rang = false;
  if (n.snap) { n.snap = null; n.branch.broken = false; }
  for (const s of n.samples) if (!s.spill) s.cut = false;
  if (n.leaves) { for (const l of n.leaves) l.gone = false; buildLitter(n); }
  for (let i = ants.length - 1; i >= 0; i--) if ((ants[i].kind === 'brood' || ants[i].kind === 'honey') && ants[i].nest === n) ants.splice(i, 1);
}

// ---------- termite mounds ----------
const mounds = [];
function moundShape(p, x, h, w, flare) {
  const gy = groundY(x), N = 12;
  p.moveTo(x - w / 2 - flare, gy + 10);
  p.lineTo(x + w / 2 + flare, gy + 10);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    p.lineTo(x + (w / 2) * Math.pow(1 - t * 0.9, 0.75) + rand(-3, 3), gy - h * t);
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    p.lineTo(x - (w / 2) * Math.pow(1 - t * 0.9, 0.75) + rand(-3, 3), gy - h * t);
  }
  p.closePath();
}
for (const mx of [980, 2420, 3960]) {
  const p = new Path2D();
  const h = rand(100, 150), w = rand(60, 85);
  moundShape(p, mx, h, w, 14);
  for (let k = 0; k < 2; k++) moundShape(p, mx + rand(-w * 0.35, w * 0.35), h * rand(0.45, 0.7), w * rand(0.3, 0.45), 4);
  mounds.push({ x: mx });
  const gy = groundY(mx);
  const home = addNest('mound', p, mx, { x0: mx - w / 2 - 20, x1: mx + w / 2 + 20, y0: gy - h - 8, y1: gy + 4 }, { ground: true });
  for (let i = 0; i < 14; i++) {
    ants.push({ kind: 'ground', home, m: mx, x: mx + rand(-190, -30), v: rand(6, 11) * (rnd() < 0.5 ? -1 : 1), state: 'live' });
  }
}

// ---------- climbable trees ----------
const trees = [];
// bridges (the far forest's canopy walkway): extra branches [{ y, dir, a, len }] reaching across to
// a neighbouring tree's; the regular branches keep clear of them
function makeTree(x, bridges = []) {
  const gy = groundY(x);
  const hw = rand(11, 16);
  const top = gy - rand(390, 540);
  const t = { x, gy, hw, top, branches: [], path: new Path2D() };
  const p = t.path;

  // trunk with root flare
  p.moveTo(x - hw - 16, gy + 8);
  p.lineTo(x + hw + 16, gy + 8);
  p.quadraticCurveTo(x + hw + 2, gy - 4, x + hw, gy - 40);
  p.lineTo(x + hw * 0.85, top);
  p.lineTo(x - hw * 0.85, top);
  p.lineTo(x - hw, gy - 40);
  p.quadraticCurveTo(x - hw - 2, gy - 4, x - hw - 16, gy + 8);
  p.closePath();

  // branches
  const ys = [];
  for (let tries = 0; ys.length < randInt(2, 3) && tries < 60; tries++) {
    const y = rand(top + 90, gy - 150);
    if (ys.every((o) => Math.abs(o - y) > 80) && bridges.every((q) => Math.abs(q.y - y) > 70)) ys.push(y);
  }
  ys.sort((a, b) => b - a);
  let dir = rnd() < 0.5 ? -1 : 1;
  for (const y of ys) {
    const a = rand(0.12, 0.38), len = rand(120, 185), t0 = rand(10, 13);
    const b = { tree: t, y, dir, a, len, t0, c: Math.cos(a), sn: Math.sin(a) };
    t.branches.push(b);
    const e = branchPoint(b, len);
    if (!t.dead && rnd() < 0.3) {
      // a bare dead branch: no leaves, a splintered end, rotten wood full of termites or ants —
      // drawn apart from the tree so it can snap off and fall
      t.dead = b;
      b.t0 = t0 * 0.85;
      const d = new Path2D();
      limb(d, x, y, e.x, e.y, b.t0, b.t0 * 0.4);
      for (let k = 0; k < 3; k++) limb(d, e.x, e.y, e.x + dir * rand(3, 9), e.y + rand(-5, 5), 2.5, 0.6);
      const st = branchPoint(b, len * rand(0.45, 0.6));
      limb(d, st.x, st.y, st.x + dir * rand(4, 10), st.y - rand(10, 18), 4, 1.5);  // a broken-off side twig
      const hx = x;
      b.deadNest = addNest('deadbranch', d, x,
        { x0: Math.min(x, e.x) - 10, x1: Math.max(x, e.x) + 12, y0: Math.min(y, e.y) - 22, y1: Math.max(y, e.y) + 10 },
        { keep: (px) => Math.abs(px - hx) > hw + 10 });  // not where it joins the trunk
      b.deadNest.branch = b;
      dir = rnd() < 0.8 ? -dir : dir;
      continue;
    }
    leafyBranch(t, b);
    dir = rnd() < 0.8 ? -dir : dir;
  }
  for (const q of bridges) {
    const b = { tree: t, y: q.y, dir: q.dir, a: q.a, len: q.len, t0: rand(10, 13), c: Math.cos(q.a), sn: Math.sin(q.a), link: null };
    t.branches.push(b);
    q.b = b;
    leafyBranch(t, b);
  }
  crownAndTrunk(t);
  return t;
}
// a living branch: the limb, a twig with leaves, a leafy tip, and maybe a carton nest hanging off it
function leafyBranch(t, b) {
  const p = t.path, x = t.x, { y, dir, a, len, t0 } = b, e = branchPoint(b, len);
  limb(p, x, y, e.x, e.y, t0, t0 * 0.4);
  // a twig and leaf clusters
  const tw = branchPoint(b, len * 0.62);
  const ta = a + rand(0.5, 0.8), tl = rand(35, 55);
  const tx = tw.x + dir * Math.cos(ta) * tl, ty = tw.y - Math.sin(ta) * tl;
  limb(p, tw.x, tw.y, tx, ty, 4, 1.5);
  blob(p, tx, ty - 6, rand(20, 30), rand(13, 18));
  blob(p, e.x + dir * 10, e.y - 12, rand(30, 42), rand(17, 24));
  // hanging carton nest on some branches
  if (rnd() < 0.4) {
    const np = branchPoint(b, len * rand(0.4, 0.55));
    const rx = rand(14, 19), ry = rand(20, 27);
    const q = new Path2D();
    q.moveTo(np.x + rx, np.y + ry * 0.7);
    q.ellipse(np.x, np.y + ry * 0.7, rx, ry, 0, 0, TAU, true);
    for (let k = 0; k < 5; k++) circ(q, np.x + rand(-rx, rx) * 0.8, np.y + ry * 0.7 + rand(-ry, ry) * 0.8, rand(5, 8));
    const by = np.y;
    const home = addNest('carton', q, np.x, { x0: np.x - rx - 10, x1: np.x + rx + 10, y0: np.y - 10, y1: np.y + ry * 1.7 + 10 },
      { keep: (x, y) => y > by + 3 });  // leave the branch itself alone
    b.nest = true;
    for (let k = 0; k < 7; k++) {
      ants.push({ kind: 'nest', home, cx: np.x, cy: np.y + ry * 0.7, rx: rx + 4, ry: ry + 4, ang: rand(0, TAU), v: rand(0.3, 0.7) * (rnd() < 0.5 ? -1 : 1), state: 'live' });
    }
  }
}
// the crown, and the trunk's own nests and trails
function crownAndTrunk(t) {
  const p = t.path, { x, gy, hw, top } = t;
  // crown
  blob(p, x + rand(-20, 20), top - 20, rand(115, 150), rand(55, 75));
  blob(p, x + rand(-80, 80), top - rand(40, 70), rand(60, 80), rand(35, 45));

  // carton nest plastered onto one face of the trunk
  if (rnd() < 0.55) {
    const side = rnd() < 0.5 ? -1 : 1, y = rand(top + 120, gy - 120);
    if (!t.branches.some((b) => b.dir === side && Math.abs(b.y - y) < 60)) {
      const rx = rand(12, 16), ry = rand(26, 36), fx = trunkFaceX(t, y, side), cx = fx + side * rx * 0.3;
      const q = new Path2D();
      q.moveTo(cx + rx, y);
      q.ellipse(cx, y, rx, ry, 0, 0, TAU, true);
      for (let k = 0; k < 6; k++) circ(q, cx + rand(-rx, rx) * 0.7, y + rand(-ry, ry) * 0.8, rand(5, 8));
      limb(q, cx, y + ry * 0.7, fx + side * 2, y + ry + rand(10, 18), rx * 0.9, 2);   // tapering drips
      limb(q, cx, y - ry * 0.7, fx + side * 2, y - ry - rand(6, 12), rx * 0.9, 2);
      t.nest = addNest('trunk', q, t.x, { x0: cx - rx - 10, x1: cx + rx + 10, y0: y - ry - 20, y1: y + ry + 22 },
        { keep: (x) => side * (x - fx) > -2 });  // don't dig into the tree
    }
  }

  // a strip of loose bark down one face, rotting wood behind it
  for (let tries = rnd() < 0.6 ? 8 : 0; tries > 0 && !t.bark; tries--) {
    const side = rnd() < 0.5 ? -1 : 1, h = rand(60, 100), y = rand(top + 140, gy - 110);
    const clear = !t.branches.some((b) => b.dir === side && Math.abs(b.y - y) < h / 2 + 20) &&
      (!t.nest || y + h / 2 < t.nest.box.y0 - 10 || y - h / 2 > t.nest.box.y1 + 10);
    if (clear) {
      const plates = [], fx = trunkFaceX(t, y, side);
      for (let yy = y - h / 2; yy <= y + h / 2; yy += rand(4, 6)) {
        for (let col = 0; col < 2; col++) {
          const px = trunkFaceX(t, yy, side) + side * (1.5 + col * 3.5 + rand(-0.8, 0.8));
          plates.push({ x: px, y: yy + rand(-1.5, 1.5), rx: rand(5, 8), ry: rand(2.5, 3.5), rot: Math.PI / 2 + rand(-0.15, 0.15), gone: false });
        }
      }
      const n = addNest('bark', null, t.x, { x0: fx - 10, x1: fx + 10, y0: y - h / 2 - 10, y1: y + h / 2 + 10 }, { leaves: plates });
      // exposed rotten wood and galleries, hidden until the plates come off
      n.under = new Path2D();
      n.under.moveTo(fx + side * 2.5 + 3.5, y); n.under.ellipse(fx + side * 2.5, y, 3.5, h / 2 - 2, 0, 0, TAU, true);
      n.underTunnels = new Path2D();
      for (let yy = y - h / 2 + 6; yy < y + h / 2 - 6; yy += rand(8, 14)) {
        limb(n.underTunnels, fx + side * rand(1, 4), yy, fx + side * rand(1, 4), yy + rand(5, 9), 1.4, 1.2);
      }
      t.bark = n;
    }
  }

  // ants trailing up one face
  if (rnd() < 0.55) {
    const side = rnd() < 0.5 ? -1 : 1;
    let home = t.nest;
    if (!home) { home = { type: 'trunk', species: null }; trails.push(home); }
    for (let i = 0; i < 9; i++) ants.push({ kind: 'trunk', home, tree: t, side, u: rnd(), v: rand(0.018, 0.03) * (rnd() < 0.5 ? -1 : 1), state: 'live' });
  }
}
function branchPoint(b, s) {
  return { x: b.tree.x + b.dir * b.c * s, y: b.y - b.sn * s };
}
const branchThick = (b, s) => lerp(b.t0, b.t0 * 0.4, s / b.len);
function trunkFaceX(t, y, side) {
  const f = clamp((t.gy - y) / (t.gy - t.top), 0, 1);
  return t.x + side * t.hw * (1 - 0.15 * f);
}
for (let x = 560; x < OLD_W - 300; x += rand(380, 620)) {
  if (mounds.some((m) => Math.abs(m.x - x) < 170)) x += 200;
  trees.push(makeTree(x));
}

// things on the forest floor keep clear of trees, each other, and the shelters; placeFloor tries
// x, then steps along until it finds room
let floorEnd = OLD_W - 100;   // how far east floor things may go (the far forest extends it)
const floorClear = (x, r) =>
  x - r > 100 && x + r < floorEnd &&
  trees.every((t) => Math.abs(t.x - x) > r + 50) &&
  nests.every((n) => !n.ground || n.box.x1 + 20 < x - r || n.box.x0 - 20 > x + r) &&
  shelters.every((s) => s.kind === 'tree' || Math.abs(s.x - x) > r + s.r + 20);
function placeFloor(x, r, make) {
  for (let tries = 0; tries < 40; tries++, x += 23) if (floorClear(x, r)) { make(x); return true; }
  return false;
}

// ---------- shelters: somewhere to sleep through the day ----------
// Only four in the whole forest — a hollow in a tree, a burrow under an old stump, a hollow log,
// and (in the far forest) a hollow high in a tree — always in the same places, so part of each
// night is remembering where they are.
const shelters = [];
// a knot hole on a trunk, somewhere between `lo` and `hi` above the ground: reached by climbing
function makeTreeHollow(t, lo, hi, name) {
  let y = t.gy - (lo + hi) / 2;
  for (let k = 0; k < 60; k++) {
    const c = rand(t.gy - hi, t.gy - lo);
    const clearOfNest = [t.nest, t.bark].every((n) => !n || c < n.box.y0 - 30 || c > n.box.y1 + 30);
    if (clearOfNest && t.branches.every((b) => Math.abs(b.y - c) > 40)) { y = c; break; }
  }
  const rim = new Path2D(), hole = new Path2D();
  rim.moveTo(t.x + 10, y); rim.ellipse(t.x, y, 10, 15, 0, 0, TAU, true);
  hole.moveTo(t.x + 7, y + 1.5); hole.ellipse(t.x, y + 1.5, 7, 11.5, 0, 0, TAU, true);
  shelters.push({ kind: 'tree', name, tree: t, x: t.x, y, rim, hole, found: false });
}
makeTreeHollow(trees.reduce((b, t) => (Math.abs(t.x - 1250) < Math.abs(b.x - 1250) ? t : b)), 120, 240, 'a hollow in a tree');
function makeBurrow(x) {
  const gy = groundY(x), p = new Path2D(), q = new Path2D(), rim = new Path2D(), hole = new Path2D(), ex = x - 10;
  // a low earth bank under an old broken stump, roots arching over the way in
  p.moveTo(x - 62, gy + 8);
  p.quadraticCurveTo(x - 34, gy - 30, x + 8, gy - 30);
  p.quadraticCurveTo(x + 52, gy - 28, x + 72, gy + 8);
  p.closePath();
  // stump and roots in their own path: their winding would cut holes in the bank's
  limb(q, x + 16, gy - 26, x + 19, gy - 66, 18, 14);
  for (let k = 0; k < 4; k++) limb(q, x + 11 + k * 5, gy - 64, x + 9 + k * 5 + rand(-2, 2), gy - 72 - rand(0, 9), 4, 1);
  limb(q, x + 8, gy - 30, x - 30, gy - 4, 6, 2);
  limb(q, x + 24, gy - 30, x + 52, gy - 2, 6, 2);
  // the entrance: an arch at ground level
  rim.moveTo(ex - 16, gy + 1); rim.ellipse(ex, gy + 1, 16, 17, 0, Math.PI, 0);
  hole.moveTo(ex - 12, gy + 1); hole.ellipse(ex, gy + 1, 12, 13, 0, Math.PI, 0);
  shelters.push({ kind: 'burrow', name: 'a burrow under an old stump', x, ex, r: 75, y: gy, paths: [p, q], rim, hole, found: false });
}
function makeHollowLog(x) {
  const L = 180, r = 19, x0 = x - L / 2, x1 = x + L / 2;
  const y0 = groundY(x0) - r + 4, y1 = groundY(x1) - r + 4;
  const p = new Path2D(), rim = new Path2D(), hole = new Path2D();
  limb(p, x1, y1, x0, y0, r * 2, r * 1.8);   // flat at x1: the open end
  for (let k = randInt(2, 3); k > 0; k--) {
    const u = rand(0.2, 0.7), bx = lerp(x0, x1, u), by = lerp(y0, y1, u) - r * 0.85;
    limb(p, bx, by, bx + rand(-14, 14), by - rand(12, 24), 7, 3);
  }
  rim.moveTo(x1 + r * 0.45, y1); rim.ellipse(x1, y1, r * 0.45, r, 0, 0, TAU, true);
  hole.moveTo(x1 + r * 0.3, y1 + 1); hole.ellipse(x1, y1 + 1, r * 0.3, r * 0.74, 0, 0, TAU, true);
  shelters.push({ kind: 'log', name: 'a hollow log', x, ex: x1 + 4, r: 110, y: y1, paths: [p], rim, hole, found: false });
}
// placed before anything else on the floor, so there's always room; a few areas to try just in case
[2700, 3300, 2200, 3800, 1700].some((x) => placeFloor(x, 75, makeBurrow));
[4200, 4700, 3600, 5000, 3100].some((x) => placeFloor(x, 110, makeHollowLog));
console.assert(shelters.length === 3, 'a shelter found no room');

// big things on the floor go down first; logs and litter fill in around them
for (const x of [1900, 3700, 2900, 4600, 1200, 2400, 4100, 3300, 1500, 4900]) {
  if (nests.filter((n) => n.type === 'antmound').length < 2) placeFloor(x, 95, makeLeafNest);
}
console.assert(nests.filter((n) => n.type === 'antmound').length === 2, 'leafcutter nests missing');

// ---------- fallen logs + leaf litter ----------
function makeLog(x) {
  const L = rand(110, 160), r = rand(11, 15);
  const x0 = x - L / 2, x1 = x + L / 2, y0 = groundY(x0) - r + 3, y1 = groundY(x1) - r + 3;
  const p = new Path2D();
  limb(p, x0, y0, x1, y1, r * 2, r * 1.8);          // flat at x0: the broken end
  for (let k = 0; k < 4; k++) circ(p, x0 + rand(0, 6), y0 + rand(-r, r) * 0.8, rand(3, 6));
  for (let k = randInt(1, 2); k > 0; k--) {
    const u = rand(0.3, 0.8), bx = lerp(x0, x1, u), by = lerp(y0, y1, u) - r * 0.8;
    limb(p, bx, by, bx + rand(-12, 12), by - rand(10, 22), 6, 2.5);
  }
  addNest('log', p, x, { x0: x0 - 8, x1: x1 + 14, y0: Math.min(y0, y1) - r - 26, y1: Math.max(y0, y1) + r }, { ground: true });
}
function makeLitter(x) {
  const W = rand(60, 90), H = rand(13, 20), leaves = [];
  for (let i = W * 0.7; i > 0; i--) {
    const u = rand(-1, 1), lx = x + (u * W) / 2;
    const twig = rnd() < 0.08, rx = twig ? rand(9, 13) : rand(4, 7);
    leaves.push({ x: lx, y: groundY(lx) + 2 - rand(0, H * (1 - u * u)), rx, ry: twig ? 1.2 : rx * 0.45, rot: rand(-0.7, 0.7), gone: false });
  }
  addNest('litter', null, x, { x0: x - W / 2 - 8, x1: x + W / 2 + 8, y0: groundY(x) - H - 8, y1: groundY(x) + 4 }, { ground: true, leaves });
}
for (let x = 1300; x < OLD_W - 200; x += rand(900, 1300)) placeFloor(x, 90, makeLog);
placeFloor(440, 50, makeLitter);  // one right by the start
for (let x = 800; x < OLD_W - 200; x += rand(450, 750)) placeFloor(x, 50, makeLitter);

// leafcutter nests (from night 2): a low sprawling soil mound pocked with entrance craters, and a
// trail of workers — those heading home carry a piece of leaf, the one ant you can spot by sight
function makeLeafNest(x) {
  const gy = groundY(x), W = rand(130, 160), H = rand(22, 30), p = new Path2D();
  p.moveTo(x - W / 2 - 10, gy + 8);
  p.bezierCurveTo(x - W / 3, gy - H * 1.3, x + W / 3, gy - H * 1.3, x + W / 2 + 10, gy + 8);
  p.closePath();
  for (let k = 0; k < 4; k++) {
    const u = rand(-0.6, 0.6), cx = x + (u * W) / 2, cy = gy - H * (1 - u * u) + 1;
    circ(p, cx - 4.5, cy, 4); circ(p, cx + 4.5, cy, 4);   // crater rim either side of the hole
  }
  const n = addNest('antmound', p, x, { x0: x - W / 2 - 14, x1: x + W / 2 + 14, y0: gy - H - 12, y1: gy + 4 }, { ground: true, fromNight: 2 });
  const m = x - W / 2 + 20;
  for (let i = 0; i < 16; i++) ants.push({ kind: 'ground', home: n, m, x: m - rand(25, 190), v: rand(6, 10) * (rnd() < 0.5 ? -1 : 1), leaf: true, state: 'live' });
}

// stingless bee hives (from night 3): the colony fills a hollow inside a trunk; outside, all you see
// is a waxy entrance tube. Ripping into the trunk around it reaches the honey pots.
function makeHive(t) {
  for (let tries = 0; tries < 40; tries++) {
    const side = rnd() < 0.5 ? -1 : 1, y = rand(t.gy - 210, t.gy - 100);
    const clear = t.branches.every((b) => Math.abs(b.y - y) > 45) &&
      [t.nest, t.bark].every((n) => !n || y < n.box.y0 - 30 || y > n.box.y1 + 30);
    if (!clear) continue;
    const fx = trunkFaceX(t, y, side), p = new Path2D(), tube = new Path2D();
    p.moveTo(t.x + side * 2 + 13, y); p.ellipse(t.x + side * 2, y, 13, 24, 0, 0, TAU, true);
    limb(tube, fx - side * 2, y - 3, fx + side * 13, y - 9, 5, 7);
    circ(tube, fx + side * 13, y - 9, 4.5);
    const n = addNest('beehive', p, t.x, { x0: t.x - 30, x1: t.x + 30, y0: y - 30, y1: y + 30 }, { fromNight: 3 });
    n.extra = tube;
    n.hive = { x: fx + side * 14, y: y - 9, side };
    t.hive = n;
    return;
  }
}
// bullet ants (from night 3): a few big lone foragers around the foot of a couple of trees
const BULLET_HOME = { type: 'bullet', species: 'bullet', fromNight: 3 };
// the army-ant raid (from night 2): a column marching across the forest floor through the night
const RAID = { type: 'army', species: 'army', fromNight: 2, x: 0, dir: 1, half: 75, speed: 7 };
for (let i = 0; i < 60; i++) ants.push({ kind: 'army', home: RAID, off: rand(-1, 1), v: rand(0.8, 1.2), ph: rand(0, TAU), state: 'live' });
// winged termites (alates) that pour out of a mound during a swarm (nights 2 and 3)
const ALATE_HOME = { type: 'alate', species: 'alate' };
{
  const busy = new Set([shelters[0].tree, trees[0]]);
  const near = (x) => trees.filter((t) => !busy.has(t)).reduce((b, t) => (Math.abs(t.x - x) < Math.abs(b.x - x) ? t : b));
  for (const x of [2100, 4000]) { const t = near(x); busy.add(t); makeHive(t); }
  for (const x of [1650, 3300, 4500]) {
    const t = near(x); busy.add(t);
    for (let k = 0; k < 3; k++) ants.push({ kind: 'bullet', home: BULLET_HOME, cx: t.x, x: t.x + rand(-40, 40), v: rand(4, 7) * (rnd() < 0.5 ? -1 : 1), state: 'live' });
  }
}

// ---------- the far forest ----------
const BRIDGE_OVERLAP = 6;   // walkway branch tips reach this far past the middle of the gap
// The quarter east of OLD_W, up to the river, was added later and comes from its own seed. It's
// thicker forest: trees closer together, most of its food up in them, and the fourth shelter, a
// hollow high in a tree. About a quarter more of everything: nests, trails, bullet ants, a hive.
withSeed(83, () => {   // seed picked for a good mix: 4 trees, 3 walkway bridges, 9 nests, the hive
  const xs = [];
  for (let x = OLD_W + rand(80, 160); x < WORLD_W - 260; x += rand(260, 330)) xs.push(x);
  // The canopy walkway: between each pair of neighbours a branch from each tree rises to meet the
  // other's, tips overlapping above the gap. Both of a tree's walkway branches leave its trunk at
  // the same height, so you can walk straight across it from one to the other.
  const hy = xs.map((x) => groundY(x) - rand(215, 245));
  const bridges = xs.map(() => []);
  for (let i = 0; i + 1 < xs.length; i++) {
    const half = (xs[i + 1] - xs[i]) / 2, top = Math.min(hy[i], hy[i + 1]) - rand(16, 26);
    for (const [j, dir] of [[i, 1], [i + 1, -1]]) {
      const rise = hy[j] - top;
      bridges[j].push({ y: hy[j], dir, a: Math.atan2(rise, half), len: Math.hypot(half, rise) + BRIDGE_OVERLAP });
    }
  }
  const far = xs.map((x, i) => makeTree(x, bridges[i]));
  trees.push(...far);
  for (let i = 0; i + 1 < xs.length; i++) {
    const p = bridges[i].find((q) => q.dir === 1).b, q = bridges[i + 1].find((q) => q.dir === -1).b;
    p.link = q; q.link = p;
  }
  const home = far[Math.floor(far.length / 2)];
  makeTreeHollow(home, 270, 330, 'a hollow high in a tree');
  floorEnd = WORLD_W - 150;
  placeFloor(OLD_W + rand(150, 350), 90, makeLog);
  for (const x of [OLD_W + 500, WORLD_W - 450]) placeFloor(x + rand(-80, 80), 50, makeLitter);
  const others = far.filter((t) => t !== home);
  makeHive(others[0]);
  const b = others[others.length - 1];
  for (let k = 0; k < 3; k++) ants.push({ kind: 'bullet', home: BULLET_HOME, cx: b.x, x: b.x + rand(-40, 40), v: rand(4, 7) * (rnd() < 0.5 ? -1 : 1), state: 'live' });
});
console.assert(shelters.length === 4, 'the far forest found no room for its shelter');

// the shelter the tamandua is at right now, if any
function shelterHere() {
  return shelters.find((s) => s.kind === 'tree'
    ? a.mode === 'trunk' && a.tree === s.tree && Math.abs(a.y - s.y) < 30
    : a.mode === 'ground' && Math.abs(a.x - s.ex) < 30);
}

// ---------- background layers ----------
function bgTree(p, x, gy, h, k) {
  const tx = x + rand(-12, 12) * k, ty = gy - h;
  limb(p, x, gy + 12, tx, ty, 16 * k, 8 * k);
  for (let i = randInt(1, 3); i > 0; i--) {
    const t = rand(0.45, 0.8), bx = lerp(x, tx, t), by = lerp(gy + 12, ty, t);
    const d = rnd() < 0.5 ? -1 : 1, L = rand(50, 110) * k, a = rand(0.3, 0.8);
    const ex = bx + d * Math.cos(a) * L, ey = by - Math.sin(a) * L;
    limb(p, bx, by, ex, ey, 7 * k, 3 * k);
    blob(p, ex, ey - 8 * k, rand(30, 55) * k, rand(20, 32) * k);
  }
  blob(p, tx, ty - 10 * k, rand(60, 110) * k, rand(38, 60) * k);
}
function bgPalm(p, x, gy, h, k) {
  const bend = rand(-40, 40) * k;
  const mx = x + bend * 0.35, my = gy - h * 0.5, tx = x + bend, ty = gy - h;
  limb(p, x, gy + 10, mx, my, 10 * k, 8 * k);
  limb(p, mx, my, tx, ty, 8 * k, 6 * k);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.4 + rand(-0.1, 0.1), L = rand(60, 90) * k;
    const x1 = tx + Math.cos(a) * L * 0.55, y1 = ty + Math.sin(a) * L * 0.55;
    const a2 = a + (Math.cos(a) >= 0 ? 0.75 : -0.75);
    limb(p, tx, ty, x1, y1, 7 * k, 5 * k);
    limb(p, x1, y1, x1 + Math.cos(a2) * L * 0.5, y1 + Math.sin(a2) * L * 0.5, 5 * k, 0.5);
  }
  circ(p, tx, ty, 7 * k);
}
function ridge(p, x0, x1, fn) {
  p.moveTo(x0, 3000);
  p.lineTo(x1, 3000);
  for (let x = x1; x >= x0; x -= 20) p.lineTo(x, fn(x));
  p.closePath();
}
const layers = [];
function makeLayer(par, f, base, fn, fill) {
  const p = new Path2D(), x0 = -1800, x1 = OLD_W * par + 1800;
  ridge(p, x0, x1, fn);
  if (fill) fill(p, x0, x1, fn);
  layers.push({ par, f, base, path: p });
}
makeLayer(0.12, 0.12, -70, (x) => -70 - (70 + 55 * Math.sin(x * 0.0028 + 1) + 35 * Math.sin(x * 0.0067) + 14 * Math.sin(x * 0.019 + 2)));
makeLayer(0.3, 0.25, -45, (x) => -45 - 8 * Math.sin(x * 0.004), (p, x0, x1, fn) => {
  for (let x = x0; x < x1; x += rand(40, 100)) {
    if (rnd() < 0.15) bgPalm(p, x, fn(x), rand(150, 230), 0.5);
    else bgTree(p, x, fn(x), rand(120, 230), 0.45);
  }
});
makeLayer(0.58, 0.44, -25, (x) => -25 - 6 * Math.sin(x * 0.006 + 2), (p, x0, x1, fn) => {
  for (let x = x0; x < x1; x += rand(160, 360)) {
    if (rnd() < 0.12) bgPalm(p, x, fn(x), rand(260, 360), 0.8);
    else bgTree(p, x, fn(x), rand(230, 400), 0.75);
  }
});

// ---------- foreground (in front of the tamandua) ----------
const FG_PAR = 1.35, FG_BASE = 90;
const fgPath = new Path2D();
function fgClump(x) {
  if (rnd() < 0.6) {
    for (let i = randInt(10, 16); i > 0; i--) {
      limb(fgPath, x + rand(-12, 12), FG_BASE + 30, x + rand(-70, 70), FG_BASE - rand(90, 200), 6, 0.4);
    }
  } else {
    const h = rand(110, 190);
    limb(fgPath, x, FG_BASE + 30, x + rand(-10, 10), FG_BASE - h, 4, 2);
    for (let i = randInt(4, 6); i > 0; i--) {
      const y = FG_BASE - rand(10, h), d = rnd() < 0.5 ? -1 : 1, r = rand(14, 26);
      fgPath.moveTo(x + d * r + r, y);
      fgPath.ellipse(x + d * r, y, r, r * 0.38, d * rand(0.2, 0.6), 0, TAU, true);
    }
  }
}
let fgEnd = -1800;
for (; fgEnd < OLD_W * FG_PAR + 1800; fgEnd += rand(200, 460)) fgClump(fgEnd);

// ---------- the river ----------
// Pale water between the banks, a few ripples that glint and fade, and the far bank with its reeds
// and trees, unreachable. (Its own seed, like the far forest.)
const farBank = new Path2D(), ripples = [], water = new Path2D();
// the water fills the channel down to the bed, so the banks show as slopes under it
water.moveTo(RIVER_X, RIVER_Y);
water.lineTo(RIVER_FAR, RIVER_Y);
for (let x = RIVER_FAR; x >= RIVER_X; x -= 6) water.lineTo(x, Math.max(RIVER_Y, groundY(x)));
water.closePath();
withSeed(13, () => {
  for (; fgEnd < WORLD_W * FG_PAR + 1800; fgEnd += rand(200, 460)) fgClump(fgEnd);
  const x0 = RIVER_FAR - 70, x1 = RIVER_FAR + 2600;
  farBank.moveTo(x0, 3000);
  farBank.lineTo(x1, 3000);
  for (let x = x1; x >= x0; x -= 16) farBank.lineTo(x, groundY(x));
  farBank.closePath();
  for (let x = RIVER_FAR - 50; x < x1; x += rand(6, 14)) {
    const gy = groundY(x), reed = x < RIVER_FAR + 90;
    for (let b = randInt(1, 3); b > 0; b--) limb(farBank, x, gy + 2, x + rand(-6, 6), gy - (reed ? rand(12, 34) : rand(3, 13)), 2.2, 0.3);
  }
  for (let x = RIVER_FAR + rand(60, 140); x < x1; x += rand(260, 420)) bgTree(farBank, x, groundY(x), rand(300, 420), 0.85);
  for (let i = 0; i < 26; i++) {
    ripples.push({ x: rand(RIVER_X + 50, RIVER_FAR - 60), d: rand(4, 60) ** 1.2 / 2, len: rand(10, 34), f: rand(0.6, 1.4), ph: rand(0, TAU) });
  }
});

// ---------- motes / fireflies ----------
const motes = Array.from({ length: 55 }, () => ({
  x: rnd(), y: rnd(), r: rand(0.6, 1.8), vx: rand(-0.006, 0.006), vy: rand(-0.01, -0.002), ph: rand(0, TAU),
}));

// ---------- the tamandua ----------
// Proportions follow a reference photo: long, deep body with the hindquarters carried
// high and the back sloping down to the shoulders; no neck, a deep conical head
// tapering into the snout; small rounded ears; thick forearms; a heavy furred tail
// base blending into the rump. Local frame: facing +x, feet on y = 0.
const BODY = new Path2D();
BODY.moveTo(-70, -36);
BODY.bezierCurveTo(-68, -52, -52, -60, -36, -59);   // rump rising to the high hindquarters
BODY.bezierCurveTo(-18, -58, 0, -54, 12, -50);      // back sloping down to the withers
BODY.bezierCurveTo(22, -47, 30, -44, 36, -38);      // neck top, runs straight into the head
BODY.bezierCurveTo(40, -32, 36, -24, 26, -22);      // throat and chest
BODY.bezierCurveTo(12, -18, 0, -19, -14, -21);      // belly
BODY.bezierCurveTo(-26, -23, -36, -28, -44, -30);   // flank tucks up toward the hind leg
BODY.bezierCurveTo(-56, -30, -70, -29, -70, -36);   // back of the thigh
BODY.closePath();

const HEAD_PIVOT = [26, -40];
const HEAD = new Path2D();   // drawn around HEAD_PIVOT
// The crown sits on the continuation of the back line, so at rest back, neck and
// forehead read as one unbroken curve; a dip only appears when the head lifts.
// The back of the head is rounded off low, so when the head hangs down it stays tucked under
// the back instead of its corner swinging up above it.
HEAD.moveTo(-14, -2);
HEAD.quadraticCurveTo(-4, -7, 16, -3.5);    // crown, continuing the slope of the back
HEAD.quadraticCurveTo(30, -1, 40, 2.5);     // forehead easing into the snout
HEAD.lineTo(61, 15);                        // snout top
HEAD.quadraticCurveTo(64, 17.5, 60, 19);    // small blunt tip
HEAD.quadraticCurveTo(40, 14, 26, 15.5);    // underside of the snout
HEAD.quadraticCurveTo(12, 19, 2, 19);       // deep jaw and throat
HEAD.quadraticCurveTo(-12, 16, -14, 4);
HEAD.closePath();
const SNOUT_BASE = [38, 8.5], SNOUT_TIP = [61, 16.5];
const EAR = new Path2D();
EAR.ellipse(6, -10, 3.4, 5.2, -0.25, 0, TAU);

const a = {
  mode: 'ground', x: 320, y: 0, tree: null, side: 0, branch: null, s: 0,
  vel: 0, facing: 1, gait: 0, diag: 0.15, moveAmt: 0, sniff: 0, head: 0, trans: 0,
  tongue: { t: -1, dur: 0.4, target: null, caught: false, aim: null }, tongueCd: 0,
  claw: { t: -1, leg: 1, hit: false }, clawTarget: null, flinch: 0, welts: [],
  rx: 320, ry: groundY(320), rt: 0, rf: 1,
};

const keys = {};
let rimOn = true, helpOn = false, closeUp = false, showSpecies = false, flash = { text: '', t: 0 };
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (guide.open) {   // the guide takes over the keyboard (and the game waits) until it's closed
    if (e.code === 'Escape' || e.key === '?') { e.preventDefault(); closeGuide(); }
    return;
  }
  keys[e.code] = true;
  wakeAudio();
  if (e.repeat) return;
  if (e.key === '?') openGuide();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter') onEnter();
  if (e.code === 'BracketRight' && game.phase === 'night') { game.clock = Math.min(1, game.clock + 30 / NIGHT_LEN); flash = { text: '+30 s', t: 0.8 }; }  // testing aid
  if (e.code === 'KeyR') { rimOn = !rimOn; flash = { text: rimOn ? 'rim light on' : 'rim light off', t: 1.2 }; }
  if (e.code === 'KeyH') helpOn = !helpOn;
  if (e.code === 'KeyZ') closeUp = !closeUp;
  if (e.code === 'KeyL') showSpecies = !showSpecies;
  if (e.code === 'KeyN' && game.phase === 'night' && game.night < NIGHTS) startNight(game.night + 1);  // testing aid
  if (e.code === 'KeyT' && game.phase === 'night' && !fade.action) jumpToNextShelter();                 // testing aid
  if (e.code === 'KeyC') { tintOn = !tintOn; flash = { text: tintOn ? 'scent tint on' : 'scent tint off', t: 1.2 }; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// the tamandua only takes orders while a night is under way (in a scene, the scene steers it)
const held = (...codes) => codes.some((c) => (game.phase === 'night' && !fade.action ? keys : puppet)[c]);

function approach(v, target, dt) {
  const rate = Math.abs(target) > Math.abs(v) ? 90 : 150;
  return v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
}

function setMode(mode) { a.mode = mode; a.vel = 0; a.trans = 0.5; }

function updateTamandua(dt, time) {
  const h = (held('ArrowRight', 'KeyD') ? 1 : 0) - (held('ArrowLeft', 'KeyA') ? 1 : 0);
  const v = (held('ArrowUp', 'KeyW') ? 1 : 0) - (held('ArrowDown', 'KeyS') ? 1 : 0);
  const clawKey = held('KeyX', 'KeyF');
  const sniffing = held('Space', 'KeyE') && !clawKey;
  // ripping and licking both need the tamandua planted
  const still = sniffing || clawKey || a.claw.t >= 0;
  // running low on energy: too tired to hurry
  const weak = game.energy < WEAK;
  const hurry = (held('ShiftLeft', 'ShiftRight') && !weak ? 1.8 : 1) * (a.buzz ? 0.7 : 1);

  if (a.mode === 'ground') {
    a.vel = approach(a.vel, still ? 0 : h * 48 * hurry, dt);
    a.x = clamp(a.x + a.vel * dt, 60, WORLD_W - 60);
    // at the river (or the far west edge) it stops rather than walking on the spot
    if ((a.x >= WORLD_W - 60 && a.vel > 0) || (a.x <= 60 && a.vel < 0)) a.vel = 0;
    if (h && !still) a.facing = h;
    if (v > 0 && !still) {
      const t = trees.find((t) => Math.abs(a.x - t.x) < t.hw + 30);
      if (t) {
        setMode('trunk');
        a.tree = t; a.side = a.x < t.x ? -1 : 1; a.facing = -a.side;
        a.y = t.gy - 58;
      }
    }
  } else if (a.mode === 'trunk') {
    const t = a.tree;
    // tamanduas climb down head first: face whichever way we're climbing
    if (v && !still) a.facing = v > 0 ? -a.side : a.side;
    const headDown = a.facing === a.side;
    a.vel = approach(a.vel, still ? 0 : v * CLIMB_SPEED * hurry, dt);
    a.y -= a.vel * dt;
    const maxY = t.gy - (headDown ? 70 : 58), minY = t.top + 80;
    if (a.y >= maxY) {
      a.y = maxY; a.vel = Math.max(a.vel, 0);
      if (v < 0 && !still) {
        setMode('ground');
        a.x = t.x + a.side * (t.hw + 34); a.facing = a.side;
      }
    }
    if (a.y <= minY) { a.y = minY; a.vel = Math.min(a.vel, 0); }
    if (a.mode === 'trunk' && h && !still) {
      const b = t.branches.find((b) => b.dir === h && !b.broken && Math.abs(b.y - a.y) < 22);
      if (b) { setMode('branch'); a.branch = b; a.s = t.hw + 6; a.facing = h; }
    }
  } else if (a.mode === 'branch') {
    const b = a.branch, sMin = b.tree.hw + 6, sMax = b.link ? b.len - BRIDGE_OVERLAP - 4 : b.len - 22;
    a.vel = approach(a.vel, still ? 0 : h * b.dir * 36 * hurry, dt);
    a.s += a.vel * dt;
    // the canopy walkway: out past the tip onto the neighbour's branch, or straight across the
    // trunk onto the walkway branch on its other side (unless you're pressing up or down to climb)
    const across = a.s <= sMin && a.vel < 0 && !v &&
      b.tree.branches.find((o) => o !== b && o.dir === -b.dir && !o.broken && Math.abs(o.y - b.y) < 30);
    if (b.link && a.s >= sMax && a.vel > 0) {
      a.branch = b.link; a.s = b.link.len - BRIDGE_OVERLAP - 4.5; a.vel = -a.vel;
    } else if (across) {
      a.branch = across; a.s = sMin + 0.5; a.vel = -a.vel;
    } else {
      if (a.s <= sMin) { a.s = sMin; a.vel = Math.max(a.vel, 0); }
      if (a.s >= sMax) { a.s = sMax; a.vel = Math.min(a.vel, 0); }
    }
    if (h && !still) a.facing = h;
    if (v && !still && a.s < sMin + 14) {
      setMode('trunk');
      a.tree = b.tree; a.side = b.dir; a.facing = v > 0 ? -a.side : a.side;
      a.y = b.y - v * 4;
    }
  }

  // gait + expression
  const speed = Math.abs(a.vel);
  // a.gait counts strides. Stance covers 2·STRIDE_A (local units) in DUTY of a stride.
  a.gait += (dt * speed * DUTY) / (2 * STRIDE_A * S);
  a.diag = lerp(a.diag, a.mode === 'trunk' ? DIAG_CLIMB : DIAG_LEVEL, 1 - Math.exp(-dt * 3));
  a.moveAmt = lerp(a.moveAmt, clamp(speed / 28, 0, 1), 1 - Math.exp(-dt * 8));
  a.sniff = lerp(a.sniff, sniffing ? 1 : 0, 1 - Math.exp(-dt * 6));
  // From footage: walking on the ground the head hangs low, snout skimming the ground;
  // on a branch it's held forward, nearly in line with the body.
  const walkHead = a.mode === 'ground' ? 0.14 : 0.12;
  a.flinch = Math.max(0, a.flinch - dt);
  const headTarget = a.slump
    ? 0.45 + 0.03 * Math.sin(time * 1.5)   // spent: head hanging
    : a.greet
    ? 0.08 + 0.06 * Math.sin(time * 9 + 1)   // nosing at the other tamandua
    : a.flinch > 0
    ? -0.45 + 0.08 * Math.sin(time * 40)   // stung: head jerks up and shakes
    : a.claw.t >= 0
    ? 0.35   // head tucked down toward the target, out of the paw's way
    : sniffing
    ? 0.15 + 0.04 * Math.sin(time * 10)
    : a.moveAmt > 0.2
      ? walkHead + 0.03 * Math.sin(a.gait * TAU * 2)
      : -0.05 + 0.05 * Math.sin(time * 1.3) + 0.03 * Math.sin(time * 3.1 + 1);
  a.head = lerp(a.head, headTarget, 1 - Math.exp(-dt * 7));

  // logical pose → smoothed render pose
  let px, py, pt;
  if (a.mode === 'ground') {
    px = a.x; py = groundY(a.x); pt = Math.atan(groundSlope(a.x));
  } else if (a.mode === 'trunk') {
    px = trunkFaceX(a.tree, a.y, a.side); py = a.y; pt = a.side * Math.PI / 2;
  } else {
    const b = a.branch, p = branchPoint(b, a.s), hw = branchThick(b, a.s) / 2;
    px = p.x - b.dir * b.sn * hw; py = p.y - b.c * hw; pt = -b.dir * b.a;
  }
  a.trans = Math.max(0, a.trans - dt);
  const kp = 1 - Math.exp(-dt * (a.trans > 0 ? 6 : 18));
  a.rx += (px - a.rx) * kp;
  a.ry += (py - a.ry) * kp;
  a.rt += angDiff(a.rt, pt) * (1 - Math.exp(-dt * (a.trans > 0 ? 6 : 12)));
  a.rf += clamp(a.facing - a.rf, -dt * 5, dt * 5);

  updateClaw(dt, clawKey);
  // on the ground the nose follows the surface: if the snout tip would sink into the soil
  // (slopes, the waddle), lift the head just enough to keep it resting on top
  if (a.mode === 'ground') {
    const tip = snoutPoint(1), under = tip.y - groundY(tip.x) + 1.5;
    if (under > 0) a.head -= under / S / 63;
  }
  updateTongue(dt, time, sniffing);
  holdTamandua();
  // dropped with a snapping branch: thump as it hits the ground
  if (a.falling && (a.mode !== 'ground' || a.ry > groundY(a.rx) - 4)) {
    a.falling = false;
    if (a.mode === 'ground') sfx('thud');
  }
}

function updateClaw(dt, clawKey) {
  const c = a.claw;
  if (c.t < 0 && clawKey) { c.t = 0; c.hit = false; c.leg = c.leg === 3 ? 1 : 3; spend(STRIKE_COST); }  // alternate forepaws
  // what the paw would hit right now
  const P = toWorld(CLAW_AIM[0], CLAW_AIM[1]);
  a.clawTarget = findClawTarget(P.x, P.y);
  if (c.t < 0) return;
  c.t += dt / CLAW_DUR;
  if (!c.hit && c.t >= WIND + STRIKE) {
    c.hit = true;
    if (a.clawTarget) hitNest(a.clawTarget.n, a.clawTarget.s, Math.sign(a.clawTarget.s.x - a.rx) || a.facing);
  }
  if (c.t >= 1) c.t = -1;
}

function findClawTarget(px, py) {
  let best = null, bd = CLAW_REACH;
  for (const n of nests) {
    const b = n.box;
    if (n.snap || n.dormant) continue;
    if (px < b.x0 - bd || px > b.x1 + bd || py < b.y0 - bd || py > b.y1 + bd) continue;
    for (const s of n.samples) {
      if (s.cut) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bd) { bd = d; best = { n, s }; }
    }
  }
  return best;
}

function hitNest(n, s, dir) {
  n.damaged = true; n.quiet = 0;
  sfx('rip');
  if (n.crust > 0) {
    // still chipping through the hard outer wall: a dent and some grit, no ants yet
    n.crust--;
    carve(n, s.x, s.y, 4);
    spawnDebris(s.x, s.y, dir, 6, 'grit');
    shake = 3;
    return;
  }
  carve(n, s.x, s.y, n.T.bite);
  if (n.stir < 0) n.stir = 0;  // the colony knows it's under attack
  if (!n.leaves) spawnDebris(s.x, s.y, dir, 9, 'chunk');
  shake = 2;
  const pool = n.samples.filter((p) => Math.hypot(p.x - s.x, p.y - s.y) < 34);
  releaseAnts(n, s.x, s.y, randInt(...n.T.burst), pool, [3.5, 6]);
  // dig deep enough and you break into a brood chamber: fat, helpless larvae, worth double
  n.breaches++;
  if (n.type === 'beehive' && n.brood > 0) {
    // every breach into a hive uncovers a few honey pots
    const k = Math.min(n.brood, randInt(2, 3));
    n.brood -= k;
    for (let i = 0; i < k; i++) ants.push({ kind: 'honey', nest: n, home: n, wx: s.x + rand(-5, 5), wy: s.y + rand(-5, 5), state: 'live' });
    if (!n.rang) { n.rang = true; sfx('bees'); }   // the first honey from this hive tonight
  } else if (n.breaches > BROOD_AFTER && n.brood > 0 && Math.random() < BROOD_CHANCE) {
    const k = Math.min(n.brood, randInt(3, 5));
    n.brood -= k;
    for (let i = 0; i < k; i++) {
      ants.push({ kind: 'brood', nest: n, home: n, wx: s.x + rand(-5, 5), wy: s.y + rand(-5, 5), ang: rand(0, TAU), state: 'live' });
    }
    flash = { text: 'a brood chamber!', t: 1.6 };
  }
  // dig too much out of a dead branch and it gives way
  if (n.type === 'deadbranch') {
    const wood = n.samples.filter((p) => !p.spill);
    if (wood.filter((p) => p.cut).length / wood.length > SNAP_AT) snapBranch(n);
  }
}

function releaseAnts(n, x, y, count, pool, life) {
  const fly = n.type === 'beehive';
  if (fly) {
    // bees buzz about in the air around the hive (and whoever's raiding it)
    pool = [];
    for (let k = 0; k < 24; k++) {
      const ang = rand(0, TAU), r = rand(12, 50);
      pool.push({ x: n.hive.x + n.hive.side * 12 + Math.cos(ang) * r, y: n.hive.y + Math.sin(ang) * r * 0.8 });
    }
  }
  for (let k = count; k > 0 && n.stock > 0; k--) {
    n.stock--;
    ants.push({
      kind: 'swarm', nest: n, home: n, pool, ex: x, ey: y, wx: x + rand(-2, 2), wy: y + rand(-2, 2),
      tx: x, ty: y, ang: rand(0, TAU), life: fly ? rand(8, 12) : rand(...life), pause: rand(0, 0.25),
      sp: fly ? rand(45, 65) : rand(26, 42), fly, ph: rand(0, TAU), state: 'live',
    });
  }
}

function snapBranch(n) {
  const b = n.branch, mid = branchPoint(b, b.len / 2);
  b.broken = true;
  n.snap = { cx: mid.x, cy: mid.y, dy: 0, vy: 0, rot: 0, vr: b.dir * rand(0.5, 0.9), landed: false, fade: 1, brood: 0 };
  // ants and brood still in the branch go down with it
  for (let i = ants.length - 1; i >= 0; i--) {
    const t = ants[i];
    if (t.nest !== n || t.state !== 'live') continue;
    if (t.kind === 'brood') n.snap.brood++;
    else n.stock++;
    ants.splice(i, 1);
  }
  shake = 5;
  flash = { text: 'crack — the branch snapped!', t: 2 };
  sfx('snap');
  if (a.mode === 'branch' && a.branch === b) {
    // and the tamandua goes down with it (the thud is when it lands, not the branch)
    n.snap.quiet = true;
    a.falling = true;
    setMode('ground');
    a.x = clamp(a.rx, 60, WORLD_W - 60);
    a.flinch = 0.6;
    spend(4);
  }
}

function updateSnap(n, dt) {
  const sn = n.snap;
  if (!sn.landed) {
    sn.vy += 520 * dt;
    sn.dy += sn.vy * dt;
    sn.rot += sn.vr * dt;
    if (sn.cy + sn.dy >= groundY(sn.cx) - 6) {
      sn.landed = true;
      sn.dy = groundY(sn.cx) - 6 - sn.cy;
      shake = 4;
      if (!sn.quiet) sfx('thud');
      spawnDebris(sn.cx, sn.cy + sn.dy, 1, 8, 'chunk');
      spawnDebris(sn.cx, sn.cy + sn.dy, -1, 8, 'chunk');
      // it splits open where it lands: everything left inside pours out onto the ground
      const pool = [];
      for (let x = sn.cx - 50; x <= sn.cx + 50; x += 5) pool.push({ x, y: groundY(x) - 1.5 });
      releaseAnts(n, sn.cx, groundY(sn.cx) - 2, 16, pool, [6, 9]);
      n.stock = 0;
      for (let i = 0; i < sn.brood; i++) {
        const x = sn.cx + rand(-25, 25);
        ants.push({ kind: 'brood', nest: n, home: n, wx: x, wy: groundY(x) - 1.5, ang: rand(-0.3, 0.3), state: 'live' });
      }
    }
  } else {
    // settle flat on the ground, then slowly fade into the litter
    const b = n.branch, flat = b.dir * b.a + Math.round((sn.rot - b.dir * b.a) / Math.PI) * Math.PI;
    sn.rot = lerp(sn.rot, flat, 1 - Math.exp(-dt * 10));
    sn.fade = Math.max(0, sn.fade - dt / 10);
  }
}

// a ragged hole with dark galleries showing inside; or, for leaf litter and bark, strip off pieces
function carve(n, x, y, r) {
  if (n.leaves) {
    for (const l of n.leaves) {
      if (l.gone || Math.hypot(l.x - x, l.y - y) > r) continue;
      l.gone = true; l.s.cut = true;
      debris.push({ kind: n.type === 'bark' ? 'bark' : 'leaf', x: l.x, y: l.y, vx: rand(-70, 70), vy: rand(-150, -60), rot: l.rot, vr: rand(-6, 6), rx: l.rx, ry: l.ry, life: rand(2, 3) });
    }
    buildLitter(n);
    return;
  }
  circ(n.holes, x, y, r * 0.8);
  for (let k = 0; k < 3; k++) circ(n.holes, x + rand(-0.5, 0.5) * r, y + rand(-0.5, 0.5) * r, r * rand(0.45, 0.7));
  if (r > 5) {
    for (let k = 0; k < 2; k++) {
      const ang = rand(0, TAU), L = rand(0.4, 1) * r;
      limb(n.tunnels, x + rand(-2, 2), y + rand(-2, 2), x + Math.cos(ang) * L, y + Math.sin(ang) * L, rand(2, 3), 1.5);
    }
    circ(n.tunnels, x + rand(-0.3, 0.3) * r, y + rand(-0.3, 0.3) * r, rand(1.8, 3));
  }
  for (const s of n.samples) if (!s.cut && Math.hypot(s.x - x, s.y - y) < r * 0.85) s.cut = true;
}

function spawnDebris(x, y, dir, count, kind) {
  for (let i = 0; i < count; i++) {
    const r = kind === 'grit' ? rand(1, 2.2) : rand(1.6, 4);
    debris.push({ kind, x: x + rand(-3, 3), y: y + rand(-3, 3), vx: dir * rand(20, 100) + rand(-30, 30), vy: rand(-160, -40), rot: rand(0, TAU), vr: rand(-10, 10), rx: r, ry: r * rand(0.6, 0.9), life: rand(1.2, 2.2) });
  }
}

function updateNests(dt, time) {
  const viewHalf = cw / sc / 2 + 250;
  for (const n of nests) {
    if (n.dormant) continue;
    if (n.stir >= 0) {
      n.stir += dt;
      if (n.quiet > ALARM_CALM) n.stir = -1;
    }
    const alarmed = n.species === 'azteca' && n.stir >= 0;
    n.alarm = alarmed ? clamp((n.stir - ALARM_DELAY) / ALARM_RISE, 0, 1) : Math.max(0, n.alarm - dt / 3);
    if (n.snap) { updateSnap(n, dt); continue; }  // a fallen branch stays fallen till tomorrow
    if (!n.damaged) continue;
    n.quiet += dt;
    // a nest left alone long enough rebuilds and refills, out of sight
    if (n.quiet > REGROW && (n.box.x1 < cam.x - viewHalf || n.box.x0 > cam.x + viewHalf)) restoreNest(n);
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    if (d.life <= 0) { debris.splice(i, 1); continue; }
    if (d.rest) continue;
    if (d.kind === 'leaf') {
      // leaves flutter down
      d.vy = Math.min(d.vy + 260 * dt, 45);
      d.vx *= Math.exp(-dt * 1.5);
      d.x += (d.vx + 30 * Math.sin(time * 5 + d.rot * 3)) * dt;
    } else {
      d.vy += 560 * dt;
      d.x += d.vx * dt;
    }
    d.y += d.vy * dt;
    d.rot += d.vr * dt;
    const floor = groundY(d.x) - d.ry * 0.6;
    if (d.y > floor && d.vy > 0) { d.y = floor; d.rest = true; }
  }
}

// tamandua-local point → world, using the smoothed render pose
function toWorld(lx, ly) {
  const r = clawRear(a.claw.t);
  if (r) {
    const cr = Math.cos(-r), sr = Math.sin(-r), dx = lx - REAR_PIVOT;
    [lx, ly] = [REAR_PIVOT + dx * cr - ly * sr, dx * sr + ly * cr];
  }
  const x = lx * a.rf * S, y = ly * S, c = Math.cos(a.rt), s = Math.sin(a.rt);
  return { x: a.rx + x * c - y * s, y: a.ry + x * s + y * c };
}
// Gait constants from X-ray/video analysis of walking tamanduas (J. Exp. Biol. 225(12), 2022):
// lateral-sequence walks throughout; lateral couplets (fore follows same-side hind closely,
// diagonality ~0.1–0.25) on level ground and branches, shifting to diagonal couplets (~0.3–0.5)
// on steep inclines and declines. Duty factor never fell below 0.54, higher at slow speeds.
const DUTY = 0.7;          // share of a stride each foot is on the ground (slow walk)
const DIAG_LEVEL = 0.18;   // fore touches down this fraction of a stride after same-side hind
const DIAG_CLIMB = 0.38;   // on a vertical trunk
const STRIDE_A = 18;       // half the foot sweep, local units (footage: ~0.7–0.8 s per stride at a slow walk)

// STAND raises (+) or lowers (−) everything but the feet. Footage: the tamandua walks in a low
// crouch, with belly clearance only ~30% of the body's depth.
const STAND = -9;
// Waddle (footage): as a foot takes weight just after touchdown, that end of the body dips.
// Hips dip on hind touchdowns, shoulders on fore touchdowns (a little later, by the
// diagonality), so the body rocks gently fore and aft. The pose is a vertical offset plus a
// pitch about mid-body; everything attached to the body goes through bodyPt.
const DIP = 3, BODY_PIVOT = [-17, -40], BODY_SPAN = 70;
const dipAt = (ph) => { ph = ((ph % 1) + 1) % 1; return ph < 0.4 ? Math.sin(Math.PI * ph / 0.4) ** 2 : 0; };
function bodyPose() {
  const m = a.moveAmt, g = a.gait, D = a.diag;
  const hip = DIP * m * (dipAt(g) + dipAt(g - 0.5));
  const sh = DIP * m * (dipAt(g - D) + dipAt(g - 0.5 - D));
  return { bob: -STAND + (hip + sh) / 2, pitch: Math.atan2(sh - hip, BODY_SPAN) };
}
// a body-local point, moved with the body's current offset and pitch
function bodyPt(x, y, pose = bodyPose()) {
  const [px, py] = BODY_PIVOT, c = Math.cos(pose.pitch), s = Math.sin(pose.pitch);
  return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c + pose.bob];
}
// a point along the snout's centre line (t = 0 at its base, 1 at the tip)
function snoutPoint(t) {
  const hx = lerp(SNOUT_BASE[0], SNOUT_TIP[0], t), hy = lerp(SNOUT_BASE[1], SNOUT_TIP[1], t);
  const pose = bodyPose(), [px, py] = bodyPt(HEAD_PIVOT[0], HEAD_PIVOT[1], pose);
  // the head rides on the body but doesn't tip with the waddle, keeping the nose steady
  const c = Math.cos(a.head), s = Math.sin(a.head);
  return toWorld(px + hx * c - hy * s, py + hx * s + hy * c);
}

const EXTEND = 0.45; // fraction of a flick spent reaching out
function tongueReach(t) {
  return t < EXTEND ? 1 - Math.pow(1 - t / EXTEND, 2) : 1 - (t - EXTEND) / (1 - EXTEND);
}

function updateTongue(dt, time, sniffing) {
  const tg = a.tongue;
  a.tongueCd -= dt;
  const tip = snoutPoint(1);

  if (tg.t < 0 && sniffing && a.claw.t < 0 && a.flinch <= 0 && a.sniff > 0.6 && a.tongueCd <= 0) {
    let best = null, bd = REACH;
    for (const ant of ants) {
      if (ant.state !== 'live') continue;
      const d = Math.hypot(ant.wx - tip.x, ant.wy - tip.y);
      if (d < bd) { bd = d; best = ant; }
    }
    tg.t = 0; tg.target = best; tg.caught = false;
    if (best) {
      tg.dur = 0.32;
    } else {
      // nothing in reach: an exploratory flick straight out of the snout
      const back = snoutPoint(0.3), dx = tip.x - back.x, dy = tip.y - back.y, L = Math.hypot(dx, dy) || 1;
      tg.aim = { x: tip.x + (dx / L) * 22, y: tip.y + (dy / L) * 22 + 4 };
      tg.dur = 0.3;
    }
  }
  if (tg.t < 0) return;

  tg.t += dt / tg.dur;
  const target = tg.target;
  if (target && !tg.caught && tg.t >= EXTEND) {
    if (target.state === 'live' && Math.hypot(target.wx - tip.x, target.wy - tip.y) < REACH + 12) {
      tg.caught = true;
      target.state = 'caught';
    } else {
      tg.target = null; // it wandered off
      tg.aim = { x: target.wx, y: target.wy };
    }
  }
  if (tg.t >= 1) {
    if (tg.caught) {
      target.state = 'gone';
      eatAnt(target);
    }
    tg.t = -1; tg.target = null; tg.caught = false;
    a.tongueCd = rand(0.06, 0.16) + (a.buzz ? 0.3 : 0);
  }
}

function updateAnts(dt, time) {
  if (!RAID.dormant && game.phase === 'night') {
    RAID.x += RAID.dir * RAID.speed * dt;
    if (RAID.x < 300 || RAID.x > WORLD_W - 300) RAID.dir = -RAID.dir;
  }
  for (const ant of ants) {
    // an eaten trail ant stays gone until the next night (refreshForest brings the trails back)
    if (ant.state !== 'live' || ant.kind === 'brood' || ant.kind === 'honey') continue;
    if (ant.kind === 'trunk') {
      const t = ant.tree;
      ant.u = (ant.u + ant.v * dt + 1) % 1;
      ant.wy = lerp(t.gy - 14, t.top + 60, ant.u);
      ant.wx = trunkFaceX(t, ant.wy, ant.side) + ant.side * 1.8;
    } else if (ant.kind === 'ground') {
      ant.x += ant.v * dt;
      if (ant.x > ant.m - 25) ant.x = ant.m - 190;
      if (ant.x < ant.m - 190) ant.x = ant.m - 25;
      ant.wx = ant.x; ant.wy = groundY(ant.x) - 2.2;
    } else if (ant.kind === 'army') {
      // a dense column streaming along with the raid front
      ant.off += dt * 0.15 * ant.v * RAID.dir;
      if (ant.off > 1) ant.off -= 2;
      if (ant.off < -1) ant.off += 2;
      ant.wx = RAID.x + ant.off * RAID.half + 2 * Math.sin(ant.ph + ant.off * 9);
      ant.wy = groundY(ant.wx) - 2;
    } else if (ant.kind === 'bullet') {
      // big, slow, wandering about the foot of their tree
      ant.x += ant.v * dt;
      if (Math.abs(ant.x - ant.cx) > 45 || Math.random() < dt * 0.3) ant.v = -ant.v;
      ant.wx = ant.x; ant.wy = groundY(ant.x) - 2.6;
    } else if (ant.kind === 'alate') {
      ant.life -= dt;
      if (ant.life <= 0) { ant.state = 'home'; continue; }   // flown off
      ant.ph += dt * 30;
      if (ant.landed) {
        ant.wx += ant.vx * dt;
        ant.wy = groundY(ant.wx) - 1.8;
      } else {
        ant.vx += (windNow * 0.5 - ant.vx) * (1 - Math.exp(-dt));
        ant.vy = lerp(ant.vy, ant.weak ? 16 : -14, 1 - Math.exp(-dt * 0.8));
        ant.wx += (ant.vx + 8 * Math.sin(ant.ph * 0.1)) * dt;
        ant.wy += (ant.vy + 6 * Math.sin(ant.ph * 0.07)) * dt;
        if (ant.weak && ant.wy >= groundY(ant.wx) - 2) { ant.landed = true; ant.vx = rand(-6, 6); ant.life += 6; }
      }
    } else if (ant.kind === 'swarm') {
      // scurry between points around the breach; when time's up, run back in
      ant.life -= dt;
      if (ant.life <= 0) { ant.tx = ant.ex; ant.ty = ant.ey; }
      const dx = ant.tx - ant.wx, dy = ant.ty - ant.wy, d = Math.hypot(dx, dy);
      if (d < 1.5) {
        if (ant.life <= 0) { ant.state = 'home'; if (!ant.nest.snap) ant.nest.stock++; continue; }
        ant.pause -= dt;
        if (ant.pause <= 0 && ant.pool.length) {
          const p = ant.pool[randInt(0, ant.pool.length - 1)];
          ant.tx = p.x + rand(-1.5, 1.5); ant.ty = p.y; ant.pause = rand(0.05, 0.4);
        }
      } else {
        const st = Math.min(d, ant.sp * (ant.life <= 0 ? 1.4 : 1) * (1 + ant.nest.alarm) * dt);
        ant.wx += (dx / d) * st; ant.wy += (dy / d) * st;
        ant.ang = Math.atan2(dy, dx);
      }
    } else {
      ant.ang += ant.v * dt;
      ant.wx = ant.cx + Math.cos(ant.ang) * ant.rx;
      ant.wy = ant.cy + Math.sin(ant.ang) * ant.ry;
    }
  }
  for (let i = ants.length - 1; i >= 0; i--) {
    const t = ants[i];
    if (TRANSIENT.has(t.kind) && (t.state === 'gone' || t.state === 'home')) ants.splice(i, 1);
  }
}

function drawWelts(dt) {
  for (let i = a.welts.length - 1; i >= 0; i--) {
    const w = a.welts[i];
    w.t += dt;
    if (w.t > 1.6) { a.welts.splice(i, 1); continue; }
    if (game.phase === 'dawn') continue;
    const p = w.snout ? snoutPoint(w.snout) : toWorld(...bodyPt(w.lx, w.ly));
    const al = w.t < 0.08 ? w.t / 0.08 : 1 - (w.t - 0.08) / 1.52;
    ctx.fillStyle = css(hex(TONGUE), 0.95 * al);  // same red as the tongue: the only colour around
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4 + 0.6 * Math.min(1, w.t * 4), 0, TAU);
    ctx.fill();
  }
}

function drawTongue() {
  const tg = a.tongue;
  if (tg.t < 0) return;
  const tip = snoutPoint(1);
  const aim = tg.target ? { x: tg.target.wx, y: tg.target.wy } : tg.aim;
  const e = tongueReach(tg.t);
  const ex = lerp(tip.x, aim.x, e), ey = lerp(tip.y, aim.y, e);
  ctx.strokeStyle = TONGUE;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.quadraticCurveTo((tip.x + ex) / 2, (tip.y + ey) / 2 + 5 * e, ex, ey);
  ctx.stroke();
  if (tg.caught) {
    ctx.fillStyle = css(pal.ink);
    ctx.beginPath();
    ctx.ellipse(ex, ey, 2, 1.5, 0, 0, TAU);
    ctx.fill();
  }
}

// Tail as one smooth tapered outline: thick furred base, thin prehensile tip.
// Where it would pass through the surface underfoot (ground or trunk), it drags along it.
function tailShape(base, time) {
  let ang, c1, c2, drag;
  if (a.mode === 'trunk') { ang = Math.PI - 0.35; c1 = 0.25; c2 = -1.6; drag = true; }
  // footage: on a vine the tail lies back along it, the tip drooping over;
  // on the ground it slopes down from the rump, trails, and the naked tip lifts a little
  else if (a.mode === 'branch') { ang = Math.PI - 0.3; c1 = 0.15; c2 = -1.2; drag = true; }
  else { ang = Math.PI - 0.7; c1 = 0.5; c2 = 0.5; drag = true; }
  // in the travel cage it's curled round against the back
  const cu = a.curl || 0;
  if (cu > 0) { ang = lerp(ang, Math.PI - 0.9, cu); c1 = lerp(c1, 1.2, cu); c2 = lerp(c2, 3.4, cu); }
  const sway = 0.08 * Math.sin(time * 1.1) + 0.05 * a.moveAmt * Math.sin(a.gait * TAU);
  const N = 28, seg = 3.6, pts = [];
  let [x, y] = base;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const r = 1.3 + 9.2 * Math.pow(1 - u, 1.4);
    if (drag) y = Math.min(y, -r * 0.9);
    pts.push({ x, y, r });
    const s = clamp(u / 0.5, 0, 1);
    const ai = ang + c1 * s * s * (3 - 2 * s) + c2 * u * u * u + sway * u;
    x += Math.cos(ai) * seg; y += Math.sin(ai) * seg;
  }
  const L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(N, i + 1)];
    const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, p = pts[i];
    L.push([p.x + nx * p.r, p.y + ny * p.r]);
    R.push([p.x - nx * p.r, p.y - ny * p.r]);
  }
  const path = new Path2D();
  path.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i <= N; i++) path.lineTo(L[i][0], L[i][1]);
  const tip = pts[N], pre = pts[N - 1], d = Math.atan2(tip.y - pre.y, tip.x - pre.x);
  path.arc(tip.x, tip.y, tip.r, d + Math.PI / 2, d - Math.PI / 2, true);
  for (let i = N; i >= 0; i--) path.lineTo(R[i][0], R[i][1]);
  path.closePath();
  return path;
}

function drawTamandua(time) {
  ctx.save();
  ctx.translate(a.rx, a.ry);
  ctx.rotate(a.rt);
  ctx.scale(a.rf * S * (a.size || 1), S * (a.size || 1));
  const rear = clawRear(a.claw.t);
  if (rear) { ctx.translate(REAR_PIVOT, 0); ctx.rotate(-rear); ctx.translate(-REAR_PIVOT, 0); }
  ctx.fillStyle = css(pal.ink);
  const shape = (p) => ctx.fill(p);

  const pose = bodyPose();
  const breathe = 1 + 0.012 * Math.sin(time * 2.2);

  shape(tailShape(bodyPt(-57, -42.5, pose), time));

  // legs (two-bone IK) as tapered limbs: heavy thighs, thick forearms; far pair first
  // Footfall timing (fraction of a stride): lateral sequence, hind then same-side fore.
  // Near side is the "left" pair, far side half a stride later.
  const D = a.diag;
  // `fwd` shifts a foot's centre of swing forward while walking. Footage: each fore paw lifts
  // to chest height and reaches far forward, landing below the snout, which hangs low.
  // Reference silhouette: each leg is a thick, nearly straight column (`a`) with the only
  // visible bend low down at the wrist/ankle (`b` is short), the foot turned forward. Both
  // bend so that joint sits just above and behind the foot.
  const legs = [
    // hind: short thigh + shin, knee forward inside the body (bend −1), down to a raised ankle
    { jx: -46, jy: -38, home: -44, fwd: 2,  off: 0.5,     a: 17, b: 20, w: [16, 11, 7.5], bend: -1, front: false },
    { jx: 22,  jy: -34, home: 26,  fwd: 10, off: 0.5 + D, a: 21, b: 7,  w: [12, 9.5, 7],  bend: 1,  front: true },
    { jx: -52, jy: -38, home: -50, fwd: 2,  off: 0,       a: 17, b: 20, w: [18, 12, 8],   bend: -1, front: false },
    { jx: 16,  jy: -34, home: 20,  fwd: 10, off: D,       a: 21, b: 7,  w: [14, 11, 8],   bend: 1,  front: true },
  ];
  const drawLeg = (L, i) => {
    // ph = 0 at touchdown. Stance (ph < DUTY): foot planted, sliding back relative to the body.
    // Swing: foot lifts, eases forward, sets down.
    const ph = (((a.gait - L.off) % 1) + 1) % 1;
    let sx, lift = 0;
    if (ph < DUTY) {
      sx = 1 - 2 * (ph / DUTY);
    } else {
      const s = (ph - DUTY) / (1 - DUTY), e = s * s * (3 - 2 * s);
      sx = -1 + 2 * e;
      lift = Math.sin(Math.PI * s);
    }
    const reach = STRIDE_A * a.moveAmt;
    let fx = L.home + L.fwd * a.moveAmt + sx * reach;
    let fy = -(L.front ? 12 : 7) * lift * a.moveAmt;
    const c = a.claw.t;
    if (c >= 0 && a.claw.leg === i) {
      // strike: paw raised high over the shoulder, slammed down ahead, then raked back
      const ease = (t) => t * t * (3 - 2 * t);
      let p0, p1, e;
      if (c < WIND) { p0 = [fx, fy]; p1 = CLAW_UP; e = ease(c / WIND); }
      else if (c < WIND + STRIKE) { p0 = CLAW_UP; p1 = CLAW_HIT; e = ((c - WIND) / STRIKE) ** 2; }
      else { p0 = CLAW_HIT; p1 = [fx, fy]; e = ease((c - WIND - STRIKE) / (1 - WIND - STRIKE)); }
      fx = lerp(p0[0], p1[0], e); fy = lerp(p0[1], p1[1], e);
    }
    // the shoulder blade swings with the foreleg (the study: ~half the step length),
    // and the chest drops a little into the reach
    const [jx, jy] = bodyPt(L.front ? L.jx + sx * reach * 0.6 : L.jx, L.jy + (L.front ? 3 * a.moveAmt : 0), pose);
    L = { ...L, jx };
    // Hind legs are plantigrade: the long foot lies flat, so the IK reaches for the ankle,
    // which sits just above the heel, and the foot is drawn from there.
    const tx = L.front ? fx : fx - 6, ty = L.front ? fy : fy - 7;
    const dx = tx - L.jx, dy = ty - jy, d = Math.min(Math.hypot(dx, dy), L.a + L.b - 0.01);
    const A = Math.acos(clamp((L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d), -1, 1));
    const k = Math.atan2(dy, dx) + L.bend * A;
    const kx = L.jx + Math.cos(k) * L.a, ky = jy + Math.sin(k) * L.a;
    // Footage: as a fore paw lifts, the wrist folds sharply so the paw curls back under the
    // forearm; it opens again just before it lands. Rotate everything below the wrist.
    let curl = 0;
    if (L.front && ph >= DUTY && !(c >= 0 && a.claw.leg === i)) {
      const s = (ph - DUTY) / (1 - DUTY), sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
      curl = sm(s / 0.3) * sm((0.95 - s) / 0.3) * a.moveAmt;
    }
    const phi = curl * 1.9, cph = Math.cos(phi), sph = Math.sin(phi);
    const rp = (x, y) => [kx + (x - kx) * cph - (y - ky) * sph, ky + (x - kx) * sph + (y - ky) * cph];
    const p = new Path2D();
    circ(p, L.jx, jy, L.w[0] / 2);
    limb(p, L.jx, jy, kx, ky, L.w[0], L.w[1]);
    if (L.front) {
      const [ex, ey] = rp(tx, ty - L.w[2] / 2);
      limb(p, kx, ky, ex, ey, L.w[1], L.w[2]);
      // hand rolled onto its outer edge, big claws curled under
      const [hx, hy] = rp(fx + 2, fy - 3), [c0x, c0y] = rp(fx + 5, fy - 3), [c1x, c1y] = rp(fx + 9, fy - 0.5);
      p.moveTo(hx + 5 * cph, hy + 5 * sph); p.ellipse(hx, hy, 5, 3, phi, 0, TAU, true);
      limb(p, c0x, c0y, c1x, c1y, 3, 1.2);
    } else {
      limb(p, kx, ky, tx, ty, L.w[1], L.w[2]);
      // ankle to heel, then the long flat sole; the toes droop a little in the air
      limb(p, tx, ty, fx - 8, fy - 2.5, L.w[2], 5);
      limb(p, fx - 8, fy - 2.5, fx + 7, fy - 1.5 + 2 * lift * a.moveAmt, 5, 3.2);
    }
    shape(p);
  };
  drawLeg(legs[0], 0); drawLeg(legs[1], 1);

  // body and head share the body pose (offset + waddle pitch about BODY_PIVOT)
  ctx.save();
  ctx.translate(0, pose.bob);
  ctx.translate(BODY_PIVOT[0], BODY_PIVOT[1]); ctx.rotate(pose.pitch); ctx.translate(-BODY_PIVOT[0], -BODY_PIVOT[1]);
  ctx.save();
  ctx.scale(1, breathe);
  shape(BODY);
  ctx.restore();
  if (a.baby) drawBaby(time);   // riding on her back, in the body's frame so it rocks with the waddle
  // head + ear (the tongue is drawn separately, in world space, in colour); the head
  // cancels the waddle pitch so the nose stays steady
  ctx.translate(HEAD_PIVOT[0], HEAD_PIVOT[1]);
  ctx.rotate(a.head - pose.pitch);
  shape(HEAD);
  shape(EAR);
  ctx.restore();

  drawLeg(legs[2], 2); drawLeg(legs[3], 3);
  ctx.restore();
}

// ---------- nights, energy, and the three-night run ----------
// Each night runs dusk → dawn in NIGHT_LEN seconds. Energy drains all the time (faster when
// moving, hurrying or ripping nests) and every ant eaten tops it up; eating the nightly target
// roughly breaks even. Energy carries over from night to night. Hit zero and the rescue team
// comes for you; see out the third dawn and you're free.
const NIGHT_LEN = 240, NIGHTS = 3, NIGHT_TARGET = 150;
const E_MAX = 100, E_START = 80, WEAK = 25;
const DRAIN_REST = 0.34, DRAIN_MOVE = 0.12, DRAIN_HURRY = 0.3;  // energy per second
const DRAIN_REST_TREE = 0.25;   // up a tree it's safe and can relax: resting costs less
const CLIMB_SPEED = 40;
const STRIKE_COST = 0.35;
const SLEEP_BONUS = 5;    // a night survived and a day's sleep (small: a poor night isn't wiped clean)
// clock: dawn light starts at DAWN (you can bed down from then on); at 1 the sun is up and a
// tamandua still out in the open is exposed and loses energy fast until it finds shelter
const DAWN = 0.8, DAY_END = 1.25, EXPOSED_DRAIN = 1.0;
const START_X = 320;

// phase: 'title' (story, how to play) · 'intro' (the release) · 'night' (playing) · 'dawn' (night survived, summary up) · 'rescued' (out of energy) · 'free' (won)
const game = {
  phase: 'night', night: 1, clock: 0, time: 0, energy: E_START, tonight: 0, total: 0, stings: 0,
  warned: false, dawnWarned: false, exposedWarned: false, shelter: null, cause: '',
};
// fade to dark, run `action`, fade back in
const fade = { k: 0, action: null };

function spend(e) { if (game.phase === 'night') game.energy = Math.max(0, game.energy - e); }
function eatAnt(ant) {
  const home = ant.home, sp = SPECIES[home.species];
  game.tonight++; game.total++;
  sfx('eat');
  const gain = ant.kind === 'honey' ? HONEY_ENERGY : sp.energy * (ant.kind === 'brood' ? 2 : 1);
  game.energy = Math.min(E_MAX, game.energy + gain);
  if (ant.kind === 'honey') flash = { text: 'honey!', t: 1.2 };
  // leafcutter workers on the trail are harmless; the soldiers that boil out of the nest bite
  const own = ant.kind === 'swarm' && sp.soldiers ? sp.soldiers : sp.sting;
  const risk = Math.max(own, home.alarm ? 0.7 * home.alarm : 0);
  // say what these are when you start on a new nest or trail (or come back to one after a while)
  if (home !== found.home || game.time - found.at > 15) found.t = 2.2;
  Object.assign(found, { home, species: home.species, at: game.time });
  tasted(home.species).eaten++;
  if (Math.random() < risk) sting('snout', home.species);
}
const found = { home: null, species: null, at: -99, t: 0 };
// where: 'snout' (stung while licking) or 'body' (soldiers swarming over you); species sets how bad
function sting(where, species) {
  const sp = SPECIES[species] || {};
  if (species) tasted(species).stings++;
  game.stings++;
  sfx(species === 'bullet' ? 'bullet' : 'sting');
  spend(sp.hurt || STING_COST);
  a.flinch = sp.flinch || 0.6; a.tongueCd = Math.max(a.tongueCd, (sp.flinch || 0.6) + 0.2);
  shake = sp.hurt > 5 ? 9 : sp.hurt < 1 ? 1 : 3;
  flash = { text: sp.word || 'ouch — stung!', t: sp.hurt > 5 ? 2.2 : 1.2 };
  // a small red welt that flares up and fades
  const spots = [[-30, -48], [-10, -44], [8, -40], [24, -30], [-48, -40], [-4, -24], [18, -12]];
  const [lx, ly] = spots[randInt(0, spots.length - 1)];
  a.welts.push(where === 'snout' ? { snout: rand(0.45, 0.95), t: 0 } : { lx: lx + rand(-4, 4), ly: ly + rand(-3, 3), t: 0 });
}
// Nose memory. Everything tasted tonight is noted (tonight); sleeping safely through the day after
// night 1 or night 2 commits it to the nose memory (journal), which the player can open from the
// button under the stats. It's a reward for surviving: nothing is written down until then.
const tonight = {}, journal = {};
const JOURNAL_NIGHTS = 2;   // what's learned on nights up to this one gets remembered
let memOpen = false;
function tasted(sp) { return tonight[sp] || (tonight[sp] = { eaten: 0, stings: 0 }); }
function commitMemory() {
  const learned = [];
  if (game.night <= JOURNAL_NIGHTS) {
    for (const [sp, m] of Object.entries(tonight)) {
      if (!journal[sp]) { journal[sp] = { eaten: 0, stings: 0 }; learned.push(SCENTS[sp].name); }
      journal[sp].eaten += m.eaten; journal[sp].stings += m.stings;
    }
  }
  for (const k in tonight) delete tonight[k];
  return learned;
}
function verdict(sp) {
  const m = journal[sp];
  if (m.stings > 0 && m.stings >= m.eaten * 0.3) return 'stings — avoid';
  if (m.stings > 0) return 'sometimes stings';
  return SPECIES[sp].energy >= 1 ? 'safe, rich' : 'safe';
}

// soldiers of an alarmed Azteca nest go for anyone who stays close
let stingIn = 0;
function updateStings(dt) {
  stingIn -= dt;
  const d = 25;
  const near = nests.find((n) => n.alarm > 0.5 &&
    a.rx > n.box.x0 - d && a.rx < n.box.x1 + d && a.ry > n.box.y0 - d && a.ry < n.box.y1 + d);
  if (near && stingIn <= 0) { sting('body', near.species); stingIn = rand(1, 2); }
  if (!near) stingIn = Math.max(stingIn, 0.8);  // a moment's grace on arrival

  // walking into the army-ant column: they swarm up your legs
  armyIn -= dt;
  const inRaid = !RAID.dormant && a.mode === 'ground' && Math.abs(a.rx - RAID.x) < RAID.half + 8;
  if (inRaid && armyIn <= 0) { sting('body', 'army'); armyIn = rand(0.7, 1.2); }
  if (!inRaid) armyIn = Math.max(armyIn, 0.4);

  // stingless bees don't sting, but a cloud of them in your fur slows everything down
  let bees = 0;
  for (const t of ants) if (t.fly && t.state === 'live' && Math.hypot(t.wx - a.rx, t.wy - (a.ry - 18)) < 45) bees++;
  a.buzz = bees >= 2;
  if (a.buzz && game.time - buzzAt > 8) flash = { text: 'bees in your fur!', t: 1.6 };
  if (a.buzz) buzzAt = game.time;
}
let armyIn = 0, buzzAt = -99;
function dealSpecies() {
  for (const h of [...nests, ...trails]) {
    const odds = (game.night >= 2 && HOMES_LATER[h.type]) || HOMES[h.type];
    let r = Math.random();
    for (const [sp, p] of Object.entries(odds)) { h.species = sp; if ((r -= p) < 0) break; }
  }
}
// newcomers only turn up from their night on; until then they're not there at all
function wakeCreatures() {
  for (const n of nests) n.dormant = game.night < n.fromNight;
  for (const h of [RAID, BULLET_HOME]) h.dormant = game.night < h.fromNight;
  for (const t of ants) {
    const asleep = game.night < (t.home.fromNight || 1);
    if (asleep) t.state = 'dormant';
    else if (t.state === 'dormant') t.state = 'live';
  }
}
dealSpecies();
wakeCreatures();

function refreshForest() {
  for (const n of nests) restoreNest(n);
  for (let i = ants.length - 1; i >= 0; i--) if (TRANSIENT.has(ants[i].kind)) ants.splice(i, 1);
  for (const t of ants) if (t.state === 'gone') t.state = 'live';
  debris.length = 0;
  scent.length = 0;
  dealSpecies();
  wakeCreatures();
  // the raid sets off somewhere well away from where you wake
  let x = 0;
  for (let k = 0; k < 30; k++) { x = rand(700, WORLD_W - 700); if (Math.abs(x - a.x) > 900) break; }
  RAID.x = x; RAID.dir = Math.random() < 0.5 ? -1 : 1;
  for (const t of ants) if (t.kind === 'bullet') t.x = t.cx + rand(-40, 40);
  // termite swarms: one on night 2, two on night 3, at random moments
  game.swarms = game.night === 2 ? [rand(0.25, 0.45)] : game.night >= 3 ? [rand(0.2, 0.35), rand(0.5, 0.65)] : [];
  swarm.t = 0;
}
// ants that only exist for a while (released, brood, honey, alates) — cleared each night
const TRANSIENT = new Set(['swarm', 'brood', 'honey', 'alate']);
function startNight(n) {
  Object.assign(game, { phase: 'night', night: n, clock: 0, tonight: 0, stings: 0, warned: false, dawnWarned: false, exposedWarned: false });
  refreshForest();
  found.t = 0;
  flash = { text: `night ${n}`, t: 2.5 };
}
function newGame() {
  Object.assign(a, {
    mode: 'ground', x: START_X, tree: null, branch: null, vel: 0, facing: 1, trans: 0,
    rx: START_X, ry: groundY(START_X), rt: 0, rf: 1,
  });
  a.claw.t = -1; a.tongue.t = -1; a.tongue.target = null; a.flinch = 0;
  a.slump = a.hidden = a.greet = a.falling = a.baby = false;
  cam.x = START_X + 90;
  Object.assign(game, { energy: E_START, total: 0, riverSeen: false });
  for (const k in journal) delete journal[k];     // a fresh start: the nose memory is earned again
  for (const k in tonight) delete tonight[k];
  memOpen = false;
  for (const s of shelters) s.found = false;
  startIntro();
}
// wake up where you slept
function wakeAt(s) {
  Object.assign(a, { branch: null, vel: 0, trans: 0, facing: 1, rf: 1 });
  if (s.kind === 'tree') {
    Object.assign(a, { mode: 'trunk', tree: s.tree, side: -1, y: s.y + 6 });
    Object.assign(a, { rx: trunkFaceX(s.tree, a.y, -1), ry: a.y, rt: -Math.PI / 2 });
  } else {
    Object.assign(a, { mode: 'ground', tree: null, x: s.ex, rx: s.ex, ry: groundY(s.ex), rt: 0 });
  }
  a.claw.t = -1; a.tongue.t = -1; a.tongue.target = null; a.flinch = 0;
  cam.x = a.rx + 90;
}
// testing aid (T): hop to the next shelter east (wrapping round), placed as if waking there.
// Instant, so it costs no energy and leaves the clock alone.
function jumpToNextShelter() {
  const byX = [...shelters].sort((p, q) => p.x - q.x);
  const s = byX.find((s) => s.x > a.rx + 60) || byX[0];
  wakeAt(s);
  s.found = true;
  flash = { text: `(testing) ${s.name}`, t: 2 };
}
function onEnter() {
  if (fade.action) return;
  if (game.phase === 'title') {
    playFromTitle();
  } else if (game.phase === 'intro') {
    fade.action = skipIntro;
  } else if (game.phase === 'night') {
    const s = shelterHere();
    if (!s) return;
    if (game.clock < DAWN) { flash = { text: 'too early — keep feeding until it gets light', t: 2.2 }; return; }
    sfx('shelter');
    fade.action = () => { game.phase = 'dawn'; game.shelter = s; game.learned = commitMemory(); };
  } else if (game.phase === 'dawn') {
    fade.action = game.night >= NIGHTS ? startFree : () => {
      game.energy = Math.min(E_MAX, game.energy + SLEEP_BONUS);
      wakeAt(game.shelter);
      startNight(game.night + 1);
    };
  } else if ((game.phase === 'rescued' || game.phase === 'free') && !scene.done) {
    fade.action = endScene;
  } else if (game.phase === 'rescued' || game.phase === 'free') {
    fade.action = newGame;
  }
}

function updateGame(dt) {
  if (fade.action) {
    fade.k = Math.min(1, fade.k + dt / 0.8);
    if (fade.k >= 1) { const f = fade.action; fade.action = null; f(); }
  } else {
    fade.k = Math.max(0, fade.k - dt / 0.8);
  }
  game.time += dt;
  if (game.phase === 'title') { updateTitle(dt); return; }   // the intro waits behind the title screen
  updateScene(dt);
  if (game.phase !== 'night') return;
  game.clock = Math.min(DAY_END, game.clock + dt / NIGHT_LEN);
  if (game.clock >= DAWN && !game.dawnWarned) { game.dawnWarned = true; flash = { text: "it's getting light — find somewhere to sleep", t: 3 }; }
  if (game.clock >= 1) {
    spend(EXPOSED_DRAIN * dt);
    if (!game.exposedWarned) { game.exposedWarned = true; flash = { text: "daylight — you're exposed! get to shelter", t: 3 }; }
  }
  if (game.swarms && game.swarms.length && game.clock >= game.swarms[0]) { game.swarms.shift(); startSwarm(); }
  updateSwarm(dt);
  if (!game.riverSeen && a.mode === 'ground' && a.x > WORLD_W - 90) {
    game.riverSeen = true;
    flash = { text: 'the river — too wide and fast to cross', t: 3 };
  }
  for (const s of shelters) {
    if (!s.found && Math.hypot(s.x - a.rx, s.y - a.ry) < 110) {
      s.found = true;
      flash = { text: `${s.name} — somewhere to sleep`, t: 2.8 };
    }
  }
  const moving = Math.abs(a.vel) > 3;
  const hurrying = moving && held('ShiftLeft', 'ShiftRight') && game.energy >= WEAK;
  const rest = a.mode === 'ground' ? DRAIN_REST : DRAIN_REST_TREE;
  spend((rest + (moving ? DRAIN_MOVE : 0) + (hurrying ? DRAIN_HURRY : 0)) * dt);
  updateStings(dt);
  if (game.energy < WEAK && !game.warned) { game.warned = true; flash = { text: 'getting weak — find ants', t: 2.5 }; }
  if (game.energy >= WEAK + 5) game.warned = false;
  if (game.energy <= 0) startRescue(game.clock >= 1 ? 'daylight' : 'energy');
}

// ---------- sound ----------
// Subtle effects and a quiet soundtrack, all made in code (Web Audio), with no files. They were
// chosen on tools/sounds.html, which has the other variants. The audio starts on the first key or
// click (browsers won't play before one), and M mutes everything.
const SOUND_VOL = 0.7;
const sound = { ac: null, out: null, kit: null, muted: false };
try { sound.muted = localStorage.getItem('tupara-muted') === '1'; } catch (e) {}
function wakeAudio() {
  if (!sound.ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    sound.ac = new AC();
    sound.out = sound.ac.createGain();
    sound.out.gain.value = sound.muted ? 0 : SOUND_VOL;
    const comp = sound.ac.createDynamicsCompressor();   // a safety net against sudden peaks
    sound.out.connect(comp); comp.connect(sound.ac.destination);
    sound.kit = makeSfx(sound.ac, sound.out);
    startAmbience(sound.ac, sound.out);
  }
  if (sound.ac.state === 'suspended') sound.ac.resume();
}
function sfx(name) {
  if (sound.muted || !sound.kit || sound.ac.state !== 'running') return;
  sound.kit[name](sound.ac.currentTime + 0.01);
}
function toggleMute() {
  sound.muted = !sound.muted;
  try { localStorage.setItem('tupara-muted', sound.muted ? '1' : '0'); } catch (e) {}
  if (sound.out) sound.out.gain.setTargetAtTime(sound.muted ? 0 : SOUND_VOL, sound.ac.currentTime, 0.1);   // music too
  flash = { text: sound.muted ? 'sound off' : 'sound on', t: 1.2 };
  showSound();
}
// the sound button beside the ? (from the intro on): its icon shows whether sound is on
const soundBtn = document.getElementById('sound-btn');
function showSound() {
  soundBtn.classList.toggle('muted', sound.muted);
  soundBtn.setAttribute('aria-pressed', !sound.muted);
}
showSound();
soundBtn.addEventListener('click', (e) => { e.currentTarget.blur(); wakeAudio(); toggleMute(); });
// The soundtrack, for now: a field recording of a Borneo rainforest canopy
// (audio/borneo-canopy.mp3, 3 min), standing in until better music is found (the generated piece
// was too sad; it's still on tools/sounds.html as D). The recording fades in and out at its ends, so
// only its steady middle (a…b s) loops, each pass crossfading into the next over `xfade` s
// (equal-power), and it never cuts. It's quiet as recorded, so `gain` lifts it to sit just under the
// effects. Passes are scheduled ahead by a 1 s timer (further ahead while the tab is hidden).
const AMBIENCE = { src: 'audio/borneo-canopy.mp3', a: 7, b: 172, xfade: 5, gain: 3.75 };
function startAmbience(ac, out) {
  const bus = ac.createGain();
  bus.gain.value = AMBIENCE.gain;
  bus.connect(out);
  fetch(AMBIENCE.src).then((res) => res.arrayBuffer()).then((ab) => ac.decodeAudioData(ab)).then((buf) => {
    const { a, b, xfade } = AMBIENCE, len = b - a, N = 64;
    const up = new Float32Array(N), down = new Float32Array(N);
    for (let i = 0; i < N; i++) { up[i] = Math.sin((i / (N - 1)) * Math.PI / 2); down[i] = Math.cos((i / (N - 1)) * Math.PI / 2); }
    let next = ac.currentTime + 0.1, first = true;
    function pass(t) {
      const s = ac.createBufferSource(), g = ac.createGain();
      s.buffer = buf; s.connect(g); g.connect(bus);
      if (first) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 4); first = false; }
      else g.gain.setValueCurveAtTime(up, t, xfade);
      g.gain.setValueCurveAtTime(down, t + len - xfade, xfade);
      s.start(t, a, len);
    }
    function tick() {
      while (next < ac.currentTime + (document.hidden ? 75 : 10)) { pass(next); next += len - xfade; }
    }
    tick();
    setInterval(tick, 1000);
  }).catch(() => {});   // no soundtrack if it can't load (e.g. the page was opened as a file)
}
function makeSfx(ac, out) {
  const r = (a, b) => a + (b - a) * Math.random();
  const noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  // a gain envelope: silent → peak over `a` s → fades out over `d` s
  function env(t, a, d, peak, dest = out) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest);
    return g;
  }
  // an oscillator gliding f0 → f1
  function tone(t, type, f0, f1, a, d, peak, dest = out) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    o.connect(env(t, a, d, peak, dest)); o.start(t); o.stop(t + a + d + 0.05);
  }
  // filtered noise, the filter sweeping f0 → f1
  function noise(t, type, f0, f1, q, a, d, peak) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    s.connect(f); f.connect(env(t, a, d, peak));
    s.start(t, r(0, 0.9)); s.stop(t + a + d + 0.05);
  }
  // a crackle: tiny noise grains scattered over `span` s
  function grains(t, n, span, type, lo, hi, q, peak, len = [0.008, 0.03]) {
    for (let i = 0; i < n; i++) noise(t + span * Math.random() ** 1.3, type, r(lo, hi), r(lo, hi), q, 0.002, r(...len), peak * r(0.4, 1));
  }
  function warm(freq) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq; f.connect(out);
    return f;
  }
  return {
    // an ant or termite eaten: a soft blip
    eat: (t) => tone(t, 'sine', r(1100, 1500), r(850, 1000), 0.004, 0.05, 0.07),
    // a claw strike into a nest: an earthy scrape
    rip: (t) => { noise(t, 'bandpass', 400, 1300, 1.2, 0.02, 0.22, 0.12); grains(t, 11, 0.28, 'lowpass', 500, 1100, 1, 0.3, [0.01, 0.04]); },
    // stung: a double nip, and a bullet ant much worse
    sting: (t) => { tone(t, 'triangle', 950, 700, 0.002, 0.05, 0.12); tone(t + 0.06, 'triangle', 720, 520, 0.002, 0.07, 0.1); },
    bullet: (t) => { tone(t, 'sawtooth', 340, 110, 0.004, 0.32, 0.16, warm(2200)); noise(t, 'bandpass', 1800, 700, 1.5, 0.002, 0.18, 0.14); },
    // settling into a shelter: a three-note lullaby
    shelter: (t) => [659.3, 554.4, 440].forEach((f, i) => {
      tone(t + i * 0.38, 'sine', f, f, 0.02, 1.3, 0.06);
      tone(t + i * 0.38, 'sine', f * 2, f * 2, 0.02, 0.5, 0.012);
    }),
    // a branch snapping (crack, splinters, leaves) … and the thud when something hits the ground
    snap: (t) => {
      noise(t, 'highpass', 2200, 1500, 0.7, 0.001, 0.04, 0.3);
      grains(t + 0.02, 10, 0.25, 'bandpass', 1200, 3200, 2, 0.18);
      noise(t + 0.05, 'highpass', 3000, 5000, 0.5, 0.05, 0.4, 0.05);
    },
    thud: (t) => { tone(t, 'sine', 95, 42, 0.004, 0.38, 0.3); grains(t + 0.01, 6, 0.12, 'lowpass', 300, 700, 1, 0.2); },
    // finding the stingless bees' honey: a marimba run
    bees: (t) => [784, 1046.5, 1318.5, 1568].forEach((f, i) => tone(t + i * 0.09, 'triangle', f, f, 0.003, 0.28, 0.08)),
  };
}

// ---------- scenes: the release (intro) and the rescue ----------
// A new game opens at dusk: a rescuer walks in with the tamandua in a travel cage, kneels, sets it
// down and lifts the door. The tamandua walks out and the night begins, while the rescuer packs up
// and leaves. Run out of energy and the same rescuer comes back: the tamandua slumps (climbing down
// first if it's up a tree), and the rescuer kneels, gathers it up in their arms and carries it off.
// Enter skips either. The rescuer is drawn like everything else: a dark silhouette, with a pale
// headlamp beam.
const puppet = {};   // keys the scene holds down for the tamandua while you can't (see `held`)
const INTRO_CAM = 250, R_START = -340, R_KNEEL = 150, R_SPEED = 105;
const CAGE_W = 136, CAGE_H = 64, CAGE_IN = 6;   // the tamandua sits CAGE_IN ahead of the cage's middle
// cage: bottom-centre x/y, tilt, door (0 shut … 1 up); holds = the tamandua rides along inside
const cage = { on: false, x: 0, y: 0, tilt: 0, door: 0, holds: false };
const R_THIGH = 60, R_SHIN = 60, R_UPPER = 52, R_FORE = 50, R_TORSO = 82, R_HIP = 122;
// k: 0 standing … 1 kneeling on one knee · lean: torso tipped forward · hand, hand2: world points
// for the near and far hands (null hangs free) · look: world point the head and headlamp turn to ·
// holds: the tamandua is in their near hand
const rescuer = { on: false, x: 0, facing: 1, walk: 0, moving: 0, k: 0, lean: 0, hand: null, hand2: null, look: null, holds: false };
// the scene playing: its steps, time in it, the current step and time in that step. x0 → kx is the
// rescuer's walk in (kx is where they kneel), taking walkDur. camX pins the camera once set.
const scene = { steps: [], t: 0, step: 0, st: 0, done: true, from: null, x0: 0, kx: 0, walkDur: 0, camX: null };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerpPt = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

// where the cage hangs from the rescuer's hand, or sits on the ground in front of them
function carryPose(dx = 30) {
  const R = rescuer, bob = 2.5 * Math.abs(Math.sin(R.walk * TAU)) * R.moving;
  return { x: R.x + dx * R.facing, y: groundY(R.x) - 42 + bob, tilt: 0.03 * Math.sin(R.walk * TAU) * R.moving };
}
const groundPose = () => ({ x: scene.kx + 40, y: groundY(scene.kx + 40), tilt: 0 });
const setCage = (p) => Object.assign(cage, { x: p.x, y: p.y, tilt: p.tilt });
const lerpPose = (p, q, t) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), tilt: lerp(p.tilt, q.tilt, t) });
function cagePt(lx, ly) {
  const c = Math.cos(cage.tilt), s = Math.sin(cage.tilt);
  return [cage.x + lx * c - ly * s, cage.y + lx * s + ly * c];
}
const handle = () => cagePt(0, -CAGE_H - 9);
const doorGrip = () => cagePt(CAGE_W / 2, -CAGE_H - 4 - cage.door * (CAGE_H - 6));
const kneeRest = () => [rescuer.x + 30 * rescuer.facing, groundY(rescuer.x) - 62];
const snout = () => [a.rx + 40 * a.rf, a.ry - 12];
// the tamandua's middle, from underneath (where a hand goes to lift it) and on top of its back
const belly = () => [a.rx - 7 * a.rf, a.ry - 16];
const back = () => [a.rx - 2 * a.rf, a.ry - 40];
// in front of the rescuer's chest: where they cradle the tamandua
function chest() {
  const { sh } = rescuerTrunk();
  return [rescuer.x + (sh[0] + 30) * rescuer.facing, groundY(rescuer.x) + sh[1] + 62];
}
const ahead = (d) => [rescuer.x + d * rescuer.facing, groundY(rescuer.x + d * rescuer.facing)];

// Steps run for `d` seconds, or until `until()` holds; `run(u, dt)` poses things (u runs 0 → 1
// over a timed step). `enter` runs once as the step starts. These are shared by both scenes.
const walkIn = (carrying, look) => ({ get d() { return scene.walkDur; }, run(u) {
  const s = u < 0.8 ? u / 0.9 : 1 - (1 - u) ** 2 / 0.36;
  const x = lerp(scene.x0, scene.kx, s);
  rescuer.walk += (x - rescuer.x) / 96;
  Object.assign(rescuer, { x, moving: u < 0.9 ? 1 : (1 - u) / 0.1, look: look() });
  if (carrying) { setCage(carryPose()); rescuer.hand = handle(); }
} });
const walkOff = (carrying) => ({ until: () => !rescuer.on, enter() { scene.camX = cam.x; }, run(u, dt) {
  rescuer.x += R_SPEED * dt * rescuer.facing; rescuer.walk += (R_SPEED * dt) / 96;
  Object.assign(rescuer, { moving: 1, look: ahead(220) });
  if (carrying) { setCage(carryPose()); rescuer.hand = handle(); }
  else { rescuer.hand = chest(); rescuer.hand2 = back(); }
  if (Math.abs(rescuer.x - cam.x) > cw / sc / 2 + 200) rescuer.on = cage.on = false;
} });

const INTRO_STEPS = [
  walkIn(true, () => ahead(220)),
  { d: 1.3, enter() { scene.from = carryPose(); }, run(u) {   // kneel and set it down
    const e = ease(u);
    Object.assign(rescuer, { k: e, lean: 0.8 * e, moving: 0, look: cagePt(CAGE_W / 2, -20) });
    setCage(lerpPose(scene.from, groundPose(), e)); rescuer.hand = handle();
  } },
  { d: 0.5, run(u) { rescuer.hand = lerpPt(handle(), doorGrip(), ease(u)); } },   // reach for the door
  { d: 1.0, run(u) { cage.door = ease(u); rescuer.hand = doorGrip(); } },          // lift it
  { d: 0.8, run() { rescuer.hand = doorGrip(); rescuer.look = snout(); } },
  { d: 0.8, enter() { cage.holds = false; puppet.ArrowRight = true; }, run(u) {    // let go, sit back
    rescuer.hand = lerpPt(doorGrip(), kneeRest(), ease(u));
    rescuer.lean = lerp(0.8, 0.35, ease(u)); rescuer.look = snout();
  } },
  { until: () => a.x >= START_X, run() { rescuer.hand = kneeRest(); rescuer.look = snout(); } },
  { d: 0.8, enter() { puppet.ArrowRight = false; handOver(); }, run() { rescuer.hand = kneeRest(); rescuer.look = snout(); } },
  { d: 0.5, run(u) { rescuer.hand = lerpPt(kneeRest(), handle(), ease(u)); } },    // take the handle
  { d: 1.2, run(u) {                                                               // stand up with it
    const e = ease(u);
    Object.assign(rescuer, { k: 1 - e, lean: 0.35 * (1 - e), look: snout() });
    setCage(lerpPose(groundPose(), carryPose(), e)); rescuer.hand = handle();
  } },
  { d: 2.4, run(u) {   // a gentle wave goodbye with the free hand
    const { sh } = rescuerTrunk();
    const up = ease(Math.min(u, 1 - u) / 0.18);   // raise it, wave, lower it
    const hang = [sh[0] + 6, sh[1] + 90], wave = [sh[0] + 44 + 10 * Math.sin(scene.st * 8), sh[1] - 46];
    const [lx, ly] = lerpPt(hang, wave, up);
    rescuer.hand2 = [rescuer.x + lx * rescuer.facing, groundY(rescuer.x) + ly];
    rescuer.look = snout();
  } },
  { d: 0.5, run(u) {   // turn for home
    rescuer.hand2 = null;
    if (u >= 0.5) rescuer.facing = -1;
    const p = carryPose(); p.x = rescuer.x + lerp(30, -30, ease(u));
    setCage(p); rescuer.hand = handle();
  } },
  walkOff(true),
];

const climbDown = { until: () => a.mode === 'ground' || scene.st > 20, run() {   // down out of a tree
  for (const k in puppet) puppet[k] = false;
  if (a.mode === 'branch') { puppet[a.branch.dir > 0 ? 'ArrowLeft' : 'ArrowRight'] = true; puppet.ArrowDown = true; }
  else if (a.mode === 'trunk') puppet.ArrowDown = true;
} };
function landed() {   // in case it got stuck climbing down
  for (const k in puppet) puppet[k] = false;
  if (a.mode !== 'ground') Object.assign(a, { mode: 'ground', tree: null, branch: null, x: a.rx, vel: 0 });
}

const RESCUE_STEPS = [
  climbDown,   // too weak to stay up a tree
  { d: 1.6, enter() {   // it slumps; the rescuer sets off towards it from out of sight on the left
    landed();
    a.slump = true;
    scene.kx = belly()[0] - 73;
    scene.x0 = a.rx - 60 - cw / sc / 2 - 150;
    scene.walkDur = (scene.kx - scene.x0) / R_SPEED;
    Object.assign(rescuer, { on: true, x: scene.x0, facing: 1, walk: 0, moving: 1, k: 0, lean: 0, hand: null, hand2: null, holds: false });
  } },
  walkIn(false, () => back()),
  { d: 1.3, run(u) {   // kneel beside it
    const e = ease(u);
    Object.assign(rescuer, { k: e, lean: 0.6 * e, moving: 0, look: back() });
  } },
  { d: 0.8 },
  { d: 0.8, run(u) {   // reach underneath it
    const e = ease(u);
    rescuer.lean = lerp(0.6, 1, e);
    rescuer.hand = lerpPt(kneeRest(), belly(), e);
  } },
  { d: 1.4, enter() { rescuer.holds = true; scene.from = rescuer.hand; }, run(u) {   // gather it up
    const e = ease(u);
    rescuer.lean = lerp(1, 0.3, e);
    rescuer.hand = lerpPt(scene.from, chest(), e);
    rescuer.hand2 = u > 0.3 ? back() : null;
    a.curl = e;
  } },
  { d: 1.4, run(u) {   // stand up with it
    const e = ease(u);
    Object.assign(rescuer, { k: 1 - e, lean: 0.3 * (1 - e) });
    rescuer.hand = chest(); rescuer.hand2 = back();
  } },
  { d: 0.6, run(u) {   // turn for home
    if (u >= 0.5) rescuer.facing = a.facing = -1;
    rescuer.hand = chest(); rescuer.hand2 = back(); rescuer.look = ahead(220);
  } },
  walkOff(false),
];

// Free: the evening after the last day. It climbs down or comes out of its shelter and heads into
// the forest (away from the river), where another tamandua (a grown one) comes the other way. They
// meet nose to nose, then the grown one leads to the nearest tree and they climb it together, one
// up each side of the trunk, while the picture fades.
const mate = { on: false, x: 0, y: 0, vel: 0, go: 0, facing: -1, greet: false, climb: null,
  rx: 0, ry: 0, rt: 0, rf: -1, gait: 0, diag: DIAG_LEVEL, head: 0, moveAmt: 0, sniff: 0, mode: 'ground',
  curl: 0, claw: { t: -1, leg: 1 }, flinch: 0, size: 1.15 };
const FREE_STEPS = [
  climbDown,
  { until: () => (mate.x - a.x) * scene.dir < 114, enter() {   // head off; the other one comes into view
    landed();
    scene.dir = a.x > WORLD_W - 900 ? -1 : 1;
    puppet[scene.dir > 0 ? 'ArrowRight' : 'ArrowLeft'] = true;
    const x = cam.x + scene.dir * (cw / sc / 2 + 60);
    Object.assign(mate, { on: true, mode: 'ground', climb: null, x, rx: x, ry: groundY(x), rt: 0, vel: 0, go: 1,
      facing: -scene.dir, rf: -scene.dir, greet: false, diag: DIAG_LEVEL });
  } },
  { d: 3.2, enter() {   // nose to nose
    puppet.ArrowRight = puppet.ArrowLeft = false; mate.go = 0;
    a.greet = mate.greet = true;
    scene.camX = (a.x + mate.x) / 2;
  } },
  { until: () => fade.k >= 1 || scene.st > 25, enter() {   // up the nearest tree together
    a.greet = mate.greet = false;
    const mid = (a.x + mate.x) / 2;
    const t = trees.reduce((b, t) => (Math.abs(t.x - mid) < Math.abs(b.x - mid) ? t : b));
    scene.tree = t; scene.side = a.x < t.x ? -1 : 1; scene.up = 0;
    mate.climb = { tree: t, side: -scene.side, fx: t.x - scene.side * (t.hw + 34) };
  }, run(u, dt) {
    const t = scene.tree;
    for (const k in puppet) puppet[k] = false;
    if (scene.st > 0.8) {   // it follows a moment later
      if (a.mode === 'ground') {
        const d = t.x + scene.side * (t.hw + 20) - a.x;
        if (Math.abs(d) > 6) puppet[d > 0 ? 'ArrowRight' : 'ArrowLeft'] = true;
        else puppet.ArrowUp = true;
      } else puppet.ArrowUp = true;
    }
    if (a.mode === 'trunk' && mate.mode === 'trunk') scene.up += dt;
    fade.k = clamp((scene.up - 1.2) / 2.5, 0, 1);
  } },
  { d: 4.5, enter() {   // five months later (over the dark)
    for (const k in puppet) puppet[k] = false;
    mate.on = false;
    const x = LATER_X;
    Object.assign(a, { mode: 'ground', tree: null, branch: null, x, rx: x, ry: groundY(x), rt: 0, vel: 0,
      facing: 1, rf: 1, curl: 0, baby: true });
    scene.camX = null;
    cam.x = x + 90;
  }, run(u) {
    fade.k = 1;
    scene.later = clamp(Math.min(scene.st - 0.4, 4.1 - scene.st) / 0.8, 0, 1);
  } },
  { d: 2.5, enter() { puppet.ArrowRight = true; }, run() {   // the picture comes up on her walking with the baby
    fade.k = 1 - ease(Math.min(1, scene.st / 2.2));
  } },
  { until: () => a.rx > cam.x + cw / sc / 2 + 120, enter() { scene.camX = cam.x; } },   // on into the forest
  { until: () => fade.k >= 1, run() { fade.k = Math.min(1, scene.st / 1.5); } },
];
const LATER_X = 3250;   // where she's walking, five months on
// the other tamandua moves on its own, much like `updateTamandua`: walking, and climbing a trunk
function updateMate(dt, time) {
  const m = mate;
  if (!m.on) return;
  let px, py, pt;
  if (m.mode === 'ground') {
    let want = m.go * m.facing;
    if (m.climb) {
      const d = m.climb.fx - m.x;
      want = Math.abs(d) > 6 ? Math.sign(d) : 0;
      if (want) m.facing = want;
      else { m.mode = 'trunk'; m.y = m.climb.tree.gy - 58; m.vel = 0; m.facing = -m.climb.side; }
    }
    m.vel = approach(m.vel, want * 44, dt);
    m.x += m.vel * dt;
  }
  if (m.mode === 'ground') {
    px = m.x; py = groundY(m.x); pt = Math.atan(groundSlope(m.x));
  } else {   // head up the trunk
    const t = m.climb.tree;
    m.vel = approach(m.vel, CLIMB_SPEED, dt);
    m.y -= m.vel * dt;
    if (m.y <= t.top + 80) { m.y = t.top + 80; m.vel = 0; }
    px = trunkFaceX(t, m.y, m.climb.side); py = m.y; pt = m.climb.side * Math.PI / 2;
  }
  const speed = Math.abs(m.vel), k = 1 - Math.exp(-dt * 8);
  m.gait += (dt * speed * DUTY) / (2 * STRIDE_A * S * m.size);
  m.moveAmt = lerp(m.moveAmt, clamp(speed / 28, 0, 1), k);
  m.diag = lerp(m.diag, m.mode === 'trunk' ? DIAG_CLIMB : DIAG_LEVEL, 1 - Math.exp(-dt * 3));
  m.rx += (px - m.rx) * k; m.ry += (py - m.ry) * k;
  m.rt += angDiff(m.rt, pt) * k;
  m.rf += clamp(m.facing - m.rf, -dt * 5, dt * 5);
  const target = m.greet ? 0.08 + 0.06 * Math.sin(time * 9) : m.moveAmt > 0.2 ? 0.14 + 0.03 * Math.sin(m.gait * TAU * 2)
    : -0.05 + 0.05 * Math.sin(time * 1.3);
  m.head = lerp(m.head, target, 1 - Math.exp(-dt * 7));
}
// draw another tamandua with the tamandua's own drawing code, by lending it the pose for a moment
function drawAs(p, time) {
  const keep = {};
  for (const k of ['rx', 'ry', 'rt', 'rf', 'gait', 'diag', 'head', 'moveAmt', 'sniff', 'mode', 'curl', 'claw', 'flinch', 'size', 'baby']) {
    keep[k] = a[k]; a[k] = p[k];
  }
  drawTamandua(time);
  Object.assign(a, keep);
}
function drawMate(time) {
  if (mate.on) drawAs(mate, time);
}
// Tupāra's baby, lying along her back (drawn in her body's local frame, so its size is relative
// to hers): belly pressed to her back, nose tipped down toward her shoulders, tail over her rump
const baby = { rx: -20, ry: -51, rt: 0.15, rf: 1, gait: 0, diag: DIAG_LEVEL, head: 0, moveAmt: 0, sniff: 0,
  mode: 'ground', curl: 0.3, claw: { t: -1, leg: 1 }, flinch: 0, size: 0.45 / S };
function drawBaby(time) {
  baby.head = 0.2 + 0.05 * Math.sin(time * 1.1);
  drawAs(baby, time);
}

function playScene(steps) {
  Object.assign(scene, { steps, t: 0, step: 0, st: 0, done: false, camX: null });
  for (const k in puppet) puppet[k] = false;
}
function updateScene(dt) {
  if (scene.done) return;
  scene.t += dt;
  const s = scene.steps[scene.step];
  if (scene.st === 0 && s.enter) s.enter();
  scene.st += dt;
  if (s.run) s.run(s.d ? Math.min(1, scene.st / s.d) : 0, dt);
  if (s.d ? scene.st >= s.d : s.until()) {
    scene.st = 0;
    if (++scene.step >= scene.steps.length) scene.done = true;
  }
  // the tail stays curled round while it's in the cage or being carried
  if (!rescuer.holds) a.curl = lerp(a.curl || 0, cage.on && a.x < cage.x + CAGE_W / 2 ? 1 : 0, 1 - Math.exp(-dt * 3));
  updateMate(dt, game.time);
  if (scene.done && (game.phase === 'rescued' || game.phase === 'free')) { a.hidden = true; mate.on = false; }   // carried away, or gone into the forest
}

function startIntro() {
  startNight(1);          // deals tonight's species and refills the forest
  game.phase = 'intro';
  flash.t = 0;
  playScene(INTRO_STEPS);
  Object.assign(scene, { x0: R_START, kx: R_KNEEL, walkDur: 4.6 });
  Object.assign(rescuer, { on: true, x: R_START, facing: 1, walk: 0, moving: 1, k: 0, lean: 0, hand: null, hand2: null, holds: false });
  Object.assign(cage, { on: true, door: 0, holds: true });
  a.curl = 1;
  INTRO_STEPS[0].run(0);
  holdTamandua();
  cam.x = INTRO_CAM;
  fade.k = 1;             // fade in from dark
}
// the tamandua is out: the night starts and it's yours
function handOver() {
  game.phase = 'night';
  flash = { text: 'night 1', t: 2.5 };
}
function skipIntro() {
  endScene();
  Object.assign(a, { mode: 'ground', x: START_X, vel: 0, facing: 1, rx: START_X, ry: groundY(START_X), rt: 0, rf: 1 });
  cam.x = START_X + 90;
  handOver();
}
// out of energy: the rescuer comes for it
function startRescue(cause) {
  Object.assign(game, { phase: 'rescued', cause });
  flash.t = found.t = 0;
  memOpen = false;
  playScene(RESCUE_STEPS);
}
function endScene() {
  for (const k in puppet) puppet[k] = false;
  scene.done = true;
  rescuer.on = rescuer.holds = cage.on = cage.holds = false;
  a.curl = 0;
  a.greet = a.baby = false;
  if (game.phase === 'rescued' || game.phase === 'free') { a.hidden = true; mate.on = false; }
}
// the last day slept through: the next evening it's free
function startFree() {
  game.phase = 'free';
  game.clock = 0;
  Object.assign(pal, skyAt(0));
  flash.t = found.t = 0;
  memOpen = false;
  wakeAt(game.shelter);
  scene.later = 0;
  playScene(FREE_STEPS);
}
// while the cage is carried or set down with the door still shut, the tamandua rides inside it;
// while the rescuer holds it, it's cradled in their hand, nose tipped up
function holdTamandua() {
  let x, y;
  if (cage.holds) { [x, y] = cagePt(CAGE_IN, -5); a.rt = cage.tilt; }
  else if (rescuer.holds && rescuer.hand) { x = rescuer.hand[0] + 7 * a.rf; y = rescuer.hand[1] + 16; a.rt = -0.3 * a.rf; }
  else return;
  Object.assign(a, { x, rx: x, ry: y, vel: 0 });
}

// two-bone IK: the joint between (x0, y0) and (x1, y1); s = 1 bends it forward (+x), −1 back
function ik(x0, y0, x1, y1, l1, l2, s) {
  const dx = x1 - x0, dy = y1 - y0, d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const b = Math.atan2(dy, dx) - s * Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  return [x0 + l1 * Math.cos(b), y0 + l1 * Math.sin(b)];
}
// the rescuer's joints, in local space: feet at the origin, facing +x
function rescuerTrunk() {
  const R = rescuer, p = R.walk * TAU;
  const hip = lerpPt([0, -R_HIP + 2 * Math.cos(2 * p) * R.moving], [-28, -66], ease(R.k));
  return { hip, sh: [hip[0] + Math.sin(R.lean) * R_TORSO, hip[1] - Math.cos(R.lean) * R_TORSO] };
}
function rescuerPose() {
  const R = rescuer, k = ease(R.k), mv = R.moving, p = R.walk * TAU;
  const toLocal = (w) => [(w[0] - R.x) * R.facing, w[1] - groundY(R.x)];
  const { hip, sh } = rescuerTrunk();
  const foot = (ph, base) => [base + 24 * Math.sin(ph) * mv, -5 - Math.max(0, Math.cos(ph)) * 12 * mv];
  const nearAnkle = lerpPt(foot(p, 4), [30, -5], k), farAnkle = lerpPt(foot(p + Math.PI, -4), [-84, -6], k);
  const look = R.look ? toLocal(R.look) : [sh[0] + 100, sh[1]];
  const neck = [sh[0] + Math.sin(R.lean * 0.6) * 24 + 3, sh[1] - Math.cos(R.lean * 0.6) * 24];
  const head = clamp(Math.atan2(look[1] - neck[1], look[0] - neck[0]), -0.4, 0.9);
  // hands hang and swing when free, rest on the raised knee when kneeling
  const hang = (sw) => lerpPt([sh[0] + 6 + sw * 18 * Math.sin(p) * mv, sh[1] + 90], [30, -62], k);
  return {
    hip, sh, neck, head,
    near: { hip, ankle: nearAnkle, knee: ik(...hip, ...nearAnkle, R_THIGH, R_SHIN, 1), toe: 0 },
    far: { hip, ankle: farAnkle, knee: ik(...hip, ...farAnkle, R_THIGH, R_SHIN, 1), toe: 2.2 * k },
    nearHand: R.hand ? toLocal(R.hand) : hang(-1), farHand: R.hand2 ? toLocal(R.hand2) : hang(1),
  };
}
function drawRescuerParts(P, layer) {
  const parts = [];
  const part = () => { const q = new Path2D(); parts.push(q); return q; };
  const leg = (L) => {
    limb(part(), ...L.hip, ...L.knee, 20, 16);
    limb(part(), ...L.knee, ...L.ankle, 15, 11);
    limb(part(), ...L.ankle, L.ankle[0] + 18 * Math.cos(L.toe), L.ankle[1] + 3 + 18 * Math.sin(L.toe), 12, 9);
  };
  const arm = (hand) => {
    const el = ik(...P.sh, ...hand, R_UPPER, R_FORE, -1);
    limb(part(), ...P.sh, ...el, 14, 11);
    limb(part(), ...el, ...hand, 11, 9);
    circ(part(), ...hand, 5.5);
  };
  if (layer === 'front') { arm(P.nearHand); return parts; }
  arm(P.farHand);
  leg(P.far);
  leg(P.near);
  limb(part(), ...P.hip, ...P.sh, 34, 36);
  circ(part(), P.hip[0] - 4, P.hip[1], 17);
  // backpack
  const bx = -Math.cos(rescuer.lean) * 20, by = -Math.sin(rescuer.lean) * 20;
  const bp = (f) => [lerp(P.hip[0], P.sh[0], f) + bx, lerp(P.hip[1], P.sh[1], f) + by];
  limb(part(), ...bp(0.35), ...bp(0.85), 24, 28);
  limb(part(), ...P.sh, ...P.neck, 13, 12);
  // head, cap brim, headlamp: turned toward where they're looking
  const hc = Math.cos(P.head), hs = Math.sin(P.head);
  const hp = (x, y) => [P.neck[0] + x * hc - y * hs, P.neck[1] + x * hs + y * hc];
  circ(part(), ...hp(3, -14), 18);
  circ(part(), ...hp(20, -9), 3.5);                     // nose
  limb(part(), ...hp(2, -28), ...hp(30, -23), 8, 4);   // cap brim
  circ(part(), ...hp(18, -21), 4.5);                    // headlamp
  return parts;
}
// layer 'back': the beam and everything but the near arm (behind the tamandua and the cage);
// layer 'front': the near arm, which holds the cage
function drawRescuer(layer) {
  if (!rescuer.on) return;
  const P = rescuerPose();
  ctx.save();
  ctx.translate(rescuer.x, groundY(rescuer.x));
  ctx.scale(rescuer.facing, 1);
  if (layer === 'back') {
    // headlamp: a soft pale cone, stronger as it gets dark
    const hc = Math.cos(P.head), hs = Math.sin(P.head);
    const lx = P.neck[0] + 18 * hc + 21 * hs, ly = P.neck[1] + 18 * hs - 21 * hc;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 320);
    const c = mix(pal.bottom, [255, 255, 255], 0.8);
    g.addColorStop(0, css(c, 0.28 + 0.2 * pal.glow));
    g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, 320, P.head - 0.2, P.head + 0.2); ctx.closePath(); ctx.fill();
  }
  const parts = drawRescuerParts(P, layer);
  ctx.fillStyle = css(pal.ink);
  for (const q of parts) ctx.fill(q);
  ctx.restore();
}
// a travel cage seen side-on: tray, roof, handle, bars, and a door at the front end that slides up
// in its rails. Drawn with strokes, so overlapping bars can't cancel out.
function drawCage() {
  if (!cage.on) return;
  const W = CAGE_W / 2, H = CAGE_H, lift = cage.door * (H - 6);
  ctx.save();
  ctx.translate(cage.x, cage.y);
  ctx.rotate(cage.tilt);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = css(pal.ink);
  const line = (w, pts) => {
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(...pts[0]); for (const q of pts.slice(1)) ctx.lineTo(...q); ctx.stroke();
  };
  line(6, [[-W, -3], [W, -3]]);                          // tray
  line(6, [[-W, -H + 3], [W, -H + 3]]);                  // roof
  line(5, [[-W, -3], [-W, -H + 3]]);                     // back end
  line(4, [[-12, -H], [-9, -H - 9], [9, -H - 9], [12, -H]]);   // handle
  for (let x = -W + 11; x < W - 4; x += 11) line(2, [[x, -5], [x, -H + 5]]);
  line(2, [[W - 4, -3], [W - 4, -2 * H + 2]]);           // door rails, up past the roof
  line(2, [[W + 4, -3], [W + 4, -2 * H + 2]]);
  line(3, [[W - 4, -4 - lift], [W + 4, -4 - lift], [W + 4, -H - lift], [W - 4, -H - lift], [W - 4, -4 - lift]]);
  line(4, [[W - 2, -H - 2 - lift], [W + 2, -H - 6 - lift]]);   // the tab you lift it by
  ctx.restore();
}
// captions during a scene, and a way out of it
function drawSceneText(label) {
  const t = scene.t;
  const cap = (text, t0, t1, y) => {
    const al = clamp(Math.min(t - t0, t1 - t), 0, 1);
    if (al <= 0) return;
    ctx.font = '600 20px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(pal.ink, 0.75 * al);
    label(text, cw / 2, y);
  };
  if (game.phase === 'intro') {
    cap('survive three nights on your own', 6, 10.5, 70);
  } else if (game.phase === 'rescued') {
    cap(game.cause === 'daylight' ? 'caught out in the daylight' : 'too weak to go on', 0.3, 5, 70);
  } else {
    cap('the next evening', 0.5, 4.5, 70);
  }
  if (scene.done) return;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = css(pal.ink, 0.5);
  label('Enter  skip', cw - 20, ch - 20);
  ctx.textAlign = 'left';
}

// ---------- termite swarms ----------
// For 20 s a termite mound pours out winged termites. Strong flyers rise and drift off on the wind;
// weak ones flutter down and crawl about on the ground. There's no warning but the smell.
const swarm = { t: 0, n: null, acc: 0 };
function startSwarm() {
  const cands = nests.filter((n) => n.type === 'mound' && n.species === 'termite' && !n.dormant);
  if (!cands.length) return;
  Object.assign(swarm, { t: 20, n: cands[randInt(0, cands.length - 1)], acc: 0 });
}
function updateSwarm(dt) {
  if (swarm.t <= 0) return;
  swarm.t -= dt;
  swarm.acc += dt * 5;
  const wall = swarm.n.samples.filter((p) => !p.spill);
  while (swarm.acc >= 1) {
    swarm.acc--;
    const p = wall[randInt(0, wall.length - 1)];
    ants.push({
      kind: 'alate', home: ALATE_HOME, wx: p.x, wy: p.y, vx: rand(-10, 10), vy: rand(-25, -10),
      weak: Math.random() < 0.5, landed: false, life: rand(8, 14), ph: rand(0, TAU), ang: 0, state: 'live',
    });
  }
}

// ---------- scent ----------
// Every nest, and every ant out on a trail, gives off scent: little wisps carried off on a slowly
// shifting wind, so each nest trails a plume you can follow upwind back to it. Breached nests reek.
// The tamandua smells as it walks: wisps show while it's on the move and fade when it stops or
// eats (holding Space never shows them). Each
// species has its own wisp — its shape and the way it moves. Eating from a nest tells you what
// you've found, briefly; linking that back to the smell is up to the player's own memory.
const SCENTS = {
  termite:   { name: 'termites',       tint: '#e8b75c' },  // soft rolling curls
  carpenter: { name: 'carpenter ants', tint: '#97d38f' },  // long lazy ribbons
  azteca:    { name: 'Azteca ants',    tint: '#bea0ee' },  // throbbing rings
  fire:      { name: 'fire ants',      tint: '#ff7d52' },  // sharp jittering zigzags
  woodtermite: { name: 'wood termites', tint: '#c9a27a' },  // stacked grain lines, sliding
  acrobat:    { name: 'acrobat ants',    tint: '#e6d36a' },  // a little chevron tipping back and forth
  leafcutter: { name: 'leafcutter ants', tint: '#7fbf5f' },  // tumbling leaf flecks
  army:       { name: 'army ants',       tint: '#d65a5a' },  // dots marching in file
  alate:      { name: 'winged termites', tint: '#f1e3a8' },  // flapping wings
  bee:        { name: 'stingless bees',  tint: '#f0b640' },  // slowly turning hexagons
  bullet:     { name: 'bullet ants',     tint: '#ff4040' },  // a spiky star, pulsing
};
const scent = [];
const SCENT_MAX = 1400;
const NOSE_R = 40;          // how close to the snout a wisp must be to count as smelled
const SCENT_WALK = 0.6;     // scent visibility while walking
// scent fades with distance from the snout: [distance, visibility] bands
const SCENT_BANDS = [[90, 1], [180, 0.5], [320, 0.24], [Infinity, 0.1]];
let tintOn = false, windNow = 0;
const windAt = (t) => 10 * Math.sin(t * 0.029 + 0.7) + 6 * Math.sin(t * 0.077 + 2) + 4;
const smelled = {};         // species → strength 0..1 at the snout, while walking

function puff(x, y, species, life, vx = 0, vy = 0, low = false) {
  if (scent.length >= SCENT_MAX) return;
  scent.push({ x, y, vx: vx + windNow * 0.5, vy, age: 0, life, species, low, ph: rand(0, TAU), seed: rand(0, TAU) });
}

function updateScent(dt, time) {
  windNow = windAt(time);
  // scent shows while walking and fades once it stops; holding Space (eating, or head down
  // waiting for ants) always clears it, as does a lick still in flight
  const eating = a.sniff > 0.2 || a.tongue.t >= 0;
  const target = !eating && a.moveAmt > 0.3 ? SCENT_WALK : 0;
  a.scentVis = lerp(a.scentVis || 0, target, 1 - Math.exp(-dt * (target > (a.scentVis || 0) ? 3 : 1.5)));
  const smelling = a.scentVis > 0.25;
  const tip = snoutPoint(1);
  for (const n of nests) {
    if (!n.stock || n.snap || n.dormant) continue;
    // stronger from a full nest, much stronger once it's been broken open; a nest that's been
    // mostly eaten out has little left to smell of
    const full = n.stock / n.T.stock;
    let rate = 1.3 * Math.pow(full, 1.5) * (n.damaged ? 2.5 : 1);
    // walking with the nose right up against a nest: a strong puff of it, drawn straight in
    const nearNose = smelling && tip.x > n.box.x0 - NOSE_R && tip.x < n.box.x1 + NOSE_R && tip.y > n.box.y0 - NOSE_R && tip.y < n.box.y1 + NOSE_R;
    if (nearNose) rate += 7 * full;
    n.emit = (n.emit || 0) + dt * rate;
    while (n.emit >= 1) {
      n.emit--;
      const src = n.samples[randInt(0, n.samples.length - 1)];
      if (nearNose && Math.random() < 0.7) {
        const dx = tip.x - src.x, dy = tip.y - src.y, L = Math.hypot(dx, dy) || 1;
        puff(src.x, src.y, n.species, 2.5, (dx / L) * 22 - windNow * 0.5, (dy / L) * 22, n.ground);
      } else {
        puff(src.x, src.y, n.species, rand(8, 13), 0, rand(-4, 1), n.ground);
      }
    }
  }
  // ants out in the open leave a fainter, shorter-lived trail
  for (const t of ants) {
    if (t.state !== 'live' || !t.home.species || t.kind === 'brood' || t.kind === 'honey') continue;
    const rate = t.kind === 'alate' ? 0.5 : t.kind === 'army' ? 0.35 : t.kind === 'swarm' ? 0.4 : 0.12;
    const low = !(t.kind === 'trunk' || t.kind === 'nest' || t.kind === 'alate' || t.fly);
    if (Math.random() < dt * rate) puff(t.wx, t.wy, t.home.species, rand(4, 6), 0, rand(-2, 0), low);
  }
  for (const k in SCENTS) smelled[k] = 0;
  for (let i = scent.length - 1; i >= 0; i--) {
    const p = scent[i];
    p.age += dt;
    if (p.age >= p.life) { scent.splice(i, 1); continue; }
    // drift with the wind, a little slow turbulence, spreading out as it ages
    p.vx += (windNow - p.vx) * (1 - Math.exp(-dt * 0.8));
    p.x += (p.vx + 4 * Math.sin(time * 0.9 + p.seed)) * dt;
    p.y += (p.vy + 3 * Math.sin(time * 1.3 + p.seed * 2)) * dt;
    p.vy *= Math.exp(-dt * 0.5);
    if (p.low) p.y = Math.min(p.y, groundY(p.x) - 3);
    p.ph += dt * (p.species === 'fire' ? 9 : 2);
    if (smelling) {
      const d = Math.hypot(p.x - tip.x, p.y - tip.y);
      if (d < NOSE_R) smelled[p.species] += (1 - d / NOSE_R) * (1 - p.age / p.life) * 0.35;
    }
  }
  for (const k in smelled) smelled[k] = Math.min(1, smelled[k]);
}

// the wisp for each species, added to path `p` at (x, y), size r
function scentGlyph(p, species, x, y, r, ph) {
  if (species === 'termite') {
    // curl
    p.moveTo(x + Math.cos(ph) * r, y + Math.sin(ph) * r);
    p.arc(x, y, r, ph, ph + 4.4);
    p.moveTo(x + Math.cos(ph + 4.4) * r * 0.45, y + Math.sin(ph + 4.4) * r * 0.45);
    p.arc(x, y, r * 0.45, ph + 4.4, ph + 7);
  } else if (species === 'carpenter') {
    // ribbon
    const w = (0.7 + 0.35 * Math.sin(ph)) * r;
    p.moveTo(x - 2 * r, y);
    p.bezierCurveTo(x - r, y - w, x + r, y + w, x + 2 * r, y);
  } else if (species === 'azteca') {
    // pulsing ring around a dot
    const rr = r * (0.6 + 0.35 * Math.sin(ph * 2.5));
    p.moveTo(x + rr, y); p.arc(x, y, rr, 0, TAU);
    p.moveTo(x + r * 0.15, y); p.arc(x, y, r * 0.15, 0, TAU);
  } else if (species === 'acrobat') {
    // chevron tipping back and forth, like the ant flipping its abdomen up
    const t = 0.5 * Math.sin(ph), c = Math.cos(t), sn = Math.sin(t);
    const pt = (px, py) => [x + px * c - py * sn, y + px * sn + py * c];
    p.moveTo(...pt(-r, r * 0.5)); p.lineTo(...pt(0, -r * 0.5)); p.lineTo(...pt(r, r * 0.5));
  } else if (species === 'leafcutter') {
    // a tumbling fleck of leaf with its midrib
    const c = Math.cos(ph * 0.6), sn = Math.sin(ph * 0.6);
    p.moveTo(x + c * r, y + sn * r); p.ellipse(x, y, r, r * 0.5, ph * 0.6, 0, TAU);
    p.moveTo(x - c * r, y - sn * r); p.lineTo(x + c * r, y + sn * r);
  } else if (species === 'army') {
    // three dots marching in file
    for (let k = 0; k < 3; k++) {
      const u = ((k + ph * 0.4) % 3) - 1;
      p.moveTo(x + u * r * 0.9 + r * 0.2, y); p.arc(x + u * r * 0.9, y, r * 0.2, 0, TAU);
    }
  } else if (species === 'alate') {
    // a pair of flapping wings
    const w = r * 0.7 * Math.sin(ph * 3);
    p.moveTo(x - r, y - w); p.quadraticCurveTo(x - r * 0.4, y, x, y); p.quadraticCurveTo(x + r * 0.4, y, x + r, y - w);
  } else if (species === 'bee') {
    // a slowly turning hexagon
    for (let k = 0; k <= 6; k++) {
      const t = ph * 0.3 + (k * TAU) / 6;
      (k ? p.lineTo : p.moveTo).call(p, x + Math.cos(t) * r * 0.8, y + Math.sin(t) * r * 0.8);
    }
  } else if (species === 'bullet') {
    // a spiky star that throbs
    const rr = r * (0.9 + 0.35 * Math.sin(ph * 1.5));
    for (let k = 0; k < 6; k++) {
      const t = (k * TAU) / 6 + 0.3;
      p.moveTo(x, y); p.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
    }
  } else if (species === 'woodtermite') {
    // wood grain: three short stacked strokes, slowly sliding past each other
    for (let k = -1; k <= 1; k++) {
      const off = Math.sin(ph + k * 1.3) * r * 0.4;
      p.moveTo(x - r * 0.9 + off, y + k * r * 0.55);
      p.lineTo(x + r * 0.9 + off, y + k * r * 0.55);
    }
  } else {
    // zigzag, jittering
    const j = () => (Math.random() - 0.5) * r * 0.5;
    p.moveTo(x - 1.6 * r, y + j());
    p.lineTo(x - 0.8 * r, y - r + j());
    p.lineTo(x, y + r * 0.6 + j());
    p.lineTo(x + 0.8 * r, y - r + j());
    p.lineTo(x + 1.6 * r, y + j());
  }
}
const WISP = [236, 233, 226];  // a fixed neutral off-white, whatever the sky is doing
const scentColor = (species, al) => css(tintOn ? hex(SCENTS[species].tint) : WISP, al);

// in world space, while sniffing
function drawScent(viewHalf) {
  const vis = a.scentVis || 0;
  if (vis < 0.02) return;
  // one path per species per distance band, so nearby scent stands out from the far-off drift
  const tip = snoutPoint(1);
  const paths = SCENT_BANDS.map(() => Object.fromEntries(Object.keys(SCENTS).map((k) => [k, new Path2D()])));
  for (const p of scent) {
    if (Math.abs(p.x - cam.x) > viewHalf) continue;
    const d = Math.hypot(p.x - tip.x, p.y - tip.y);
    const b = SCENT_BANDS.findIndex(([r]) => d < r);
    scentGlyph(paths[b][p.species], p.species, p.x, p.y, 2.4 + 2.4 * (p.age / p.life), p.ph);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 1.1;
  paths.forEach((band, b) => {
    for (const k in band) {
      ctx.strokeStyle = scentColor(k, 0.6 * vis * SCENT_BANDS[b][1]);
      ctx.stroke(band[k]);
    }
  });
  // what the nose is picking up right now, floating over the snout
  const top = Object.entries(smelled).filter(([, v]) => v > 0.05).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const at = snoutPoint(0.6);
  top.forEach(([k, v], i) => {
    const g = new Path2D();
    scentGlyph(g, k, at.x + (i - (top.length - 1) / 2) * 14, at.y - 24, 2.5 + 2.5 * v, performance.now() / 500);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = scentColor(k, vis * (0.35 + 0.65 * v));
    ctx.stroke(g);
  });
}

// ---------- camera + render ----------
let cw = 0, ch = 0, dpr = 1, sc = 1, zoom = 1;
const cam = { x: a.x + 90, y: -120 };
let prevCamX = cam.x;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  cw = innerWidth; ch = innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  sc = (ch / VIEW_H) * zoom;
}
addEventListener('resize', resize);
resize();

let shx = 0, shy = 0;
function setT(par) {
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (cw / 2 - (cam.x + shx) * par * sc) * dpr, (ch * HORIZON - (cam.y + shy) * par * sc) * dpr);
}
function screenT() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

function haze(par, base, alpha) {
  const y = ch * HORIZON + (base - cam.y * par) * sc;
  const g = ctx.createLinearGradient(0, y - 240 * sc, 0, y + 30 * sc);
  g.addColorStop(0, css(pal.bottom, 0));
  g.addColorStop(1, css(pal.bottom, alpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, y - 240 * sc, cw, ch);
}

function drawRiver(time, viewHalf) {
  if (cam.x + viewHalf < RIVER_X) return;
  const g = ctx.createLinearGradient(0, RIVER_Y, 0, RIVER_Y + 110);
  g.addColorStop(0, css(mix(pal.bottom, [255, 255, 255], 0.2)));   // the sky, reflected
  g.addColorStop(1, css(mix(pal.bottom, pal.ink, 0.7)));
  ctx.fillStyle = g;
  ctx.fill(water);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.4;
  for (const r of ripples) {
    const al = 0.35 * Math.max(0, Math.sin(time * r.f + r.ph));
    if (al < 0.02) continue;
    ctx.strokeStyle = css(mix(pal.bottom, [255, 255, 255], 0.6), al);
    ctx.beginPath(); ctx.moveTo(r.x, RIVER_Y + 2 + r.d); ctx.lineTo(r.x + r.len, RIVER_Y + 2 + r.d); ctx.stroke();
  }
  ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.97));
  ctx.fill(farBank);
}
function drawShelters(viewHalf) {
  for (const s of shelters) {
    if (Math.abs(s.x - cam.x) > viewHalf) continue;
    ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.93));
    for (const p of s.paths || []) ctx.fill(p);
    ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.7));   // worn lip catching the light
    ctx.fill(s.rim);
    ctx.fillStyle = css(pal.ink);
    ctx.fill(s.hole);
  }
}
// hint over the shelter you're at, in screen space so it stays a readable size at any zoom
function drawShelterHint(label) {
  const s = game.phase === 'night' && !fade.action ? shelterHere() : null;
  if (!s) return;
  const wx = s.kind === 'tree' ? s.x : s.ex, wy = s.kind === 'tree' ? s.y - 24 : s.y - 40;
  const x = cw / 2 + (wx - cam.x) * sc, y = ch * HORIZON + (wy - cam.y) * sc;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = css(pal.ink, 0.85);
  label(game.clock >= DAWN ? 'Enter  sleep here' : 'a place to sleep, once it gets light', x, y);
  ctx.textAlign = 'left';
}

function drawNests(time, viewHalf) {
  const fill = css(mix(pal.bottom, pal.ink, 0.93));
  for (const n of nests) {
    if (n.box.x1 < cam.x - viewHalf || n.box.x0 > cam.x + viewHalf) continue;
    if (n.dormant || (n.snap && n.snap.fade <= 0)) continue;
    ctx.save();
    if (n.snap) {
      // falling (or lying where it fell, fading into the leaf litter)
      const sn = n.snap;
      ctx.globalAlpha = sn.fade;
      ctx.translate(sn.cx, sn.cy + sn.dy); ctx.rotate(sn.rot); ctx.translate(-sn.cx, -sn.cy);
    }
    if (n.under) {
      // rotten wood behind the bark, showing wherever plates have come off
      ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.55));
      ctx.fill(n.under);
      ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.85));
      ctx.fill(n.underTunnels);
    }
    ctx.fillStyle = fill;
    ctx.fill(n.path);
    if (n.extra) ctx.fill(n.extra);
    if (n.damaged && !n.leaves) {
      // the breach: paler hollow with dark galleries running through it
      ctx.save();
      ctx.clip(n.path);
      ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.55));
      ctx.fill(n.holes);
      ctx.clip(n.holes);
      ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.85));
      ctx.fill(n.tunnels);
      ctx.restore();
    }
    ctx.restore();
    if (showSpecies) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = css(pal.ink, 0.9);
      ctx.fillText(n.species + (n.alarm > 0 ? ` ! ${n.alarm.toFixed(1)}` : ''), (n.box.x0 + n.box.x1) / 2, n.box.y0 - 6);
      ctx.textAlign = 'left';
    }
  }
}

function render(time, dt) {
  shake *= Math.exp(-dt * 14);
  shx = (Math.random() - 0.5) * 2 * shake;
  shy = (Math.random() - 0.5) * 2 * shake;
  screenT();
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, ch * 0.85);
  sky.addColorStop(0, css(pal.top));
  sky.addColorStop(1, css(pal.bottom));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);

  // the sun sets, the moon crosses the sky, the sun comes back up (hills hide them when low)
  const t = game.clock, bodies = [];
  if (t < 0.22) bodies.push({ x: 0.72, y: lerp(0.5, 0.98, t / 0.22), r: 64, c: pal.sun, al: 0.75 });
  if (t > 0.06 && t < 0.94) {
    const u = (t - 0.06) / 0.88;
    bodies.push({ x: lerp(0.88, 0.12, u), y: 0.66 - 0.48 * Math.sin(Math.PI * u), r: 38, c: PAL.night.sun, al: 0.5 * clamp(Math.min(u, 1 - u) * 8, 0, 1) });
  }
  if (t > 0.84) bodies.push({ x: 0.24, y: t < 1 ? lerp(0.98, 0.56, (t - 0.84) / 0.16) : lerp(0.56, 0.3, (t - 1) / 0.25), r: 60, c: pal.sun, al: 0.75 });
  for (const b of bodies) {
    const sx = cw * b.x - cam.x * 0.02 * sc, sy = ch * b.y - (cam.y + 120) * 0.05 * sc;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, b.r * 4.5 * sc);
    glow.addColorStop(0, css(b.c, b.al));
    glow.addColorStop(1, css(b.c, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = css(b.c, Math.min(1, b.al * 1.6));
    ctx.beginPath(); ctx.arc(sx, sy, b.r * sc, 0, TAU); ctx.fill();
  }

  // distant layers, each washed with haze
  for (const L of layers) {
    setT(L.par);
    ctx.fillStyle = css(mix(pal.bottom, pal.ink, L.f));
    ctx.fill(L.path);
    screenT();
    haze(L.par, L.base, 0.35);
  }

  // play layer
  setT(1);
  const viewHalf = cw / sc / 2 + 250;
  ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.93));
  for (const t of trees) if (Math.abs(t.x - cam.x) < viewHalf) ctx.fill(t.path);
  drawNests(time, viewHalf);
  ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.97));
  ctx.fill(groundPath);
  drawRiver(time, viewHalf);
  drawShelters(viewHalf);

  // ants
  ctx.fillStyle = css(pal.ink);
  const antPath = new Path2D();
  for (const ant of ants) {
    if (ant.state !== 'live' || ant.kind === 'brood' || Math.abs(ant.wx - cam.x) > viewHalf) continue;
    if (ant.kind === 'honey') continue;
    const [rx, ry, rot] = ant.kind === 'trunk' ? [1.5, 2.6, 0]
      : ant.kind === 'ground' ? [2.7, 1.5, 0]
      : ant.kind === 'army' ? [2.6, 1.4, 0]
      : ant.kind === 'bullet' ? [4.4, 2.2, 0]
      : ant.kind === 'alate' ? [2, 1.1, 0]
      : ant.fly ? [2, 1.4, 0]
      : ant.kind === 'swarm' ? [2.5, 1.5, ant.ang]
      : [2.5, 1.5, ant.ang + Math.PI / 2];
    antPath.moveTo(ant.wx + Math.cos(rot) * rx, ant.wy + Math.sin(rot) * rx);
    antPath.ellipse(ant.wx, ant.wy, rx, ry, rot, 0, TAU);
    if (ant.leaf && ant.v > 0) {
      // a leafcutter hauling its piece of leaf home, held up over its back
      antPath.moveTo(ant.wx + 1, ant.wy - 2); antPath.lineTo(ant.wx + 1.6, ant.wy - 4.5);
      antPath.moveTo(ant.wx + 1.6 + 3.6 * Math.cos(-0.5), ant.wy - 6.5 + 3.6 * Math.sin(-0.5));
      antPath.ellipse(ant.wx + 1.6, ant.wy - 6.5, 3.6, 2.4, -0.5, 0, TAU);
    }
    if (ant.kind === 'bullet') {
      // chunky head and long legs, so it reads as something different
      const hx = ant.wx + 5 * Math.sign(ant.v || 1);
      antPath.moveTo(hx + 1.8, ant.wy - 0.5); antPath.ellipse(hx, ant.wy - 0.5, 1.8, 1.6, 0, 0, TAU);
      for (let k = -1; k <= 1; k++) { antPath.moveTo(ant.wx + k * 2, ant.wy); antPath.lineTo(ant.wx + k * 3.2, ant.wy + 2.8); }
    }
  }
  if (rimOn) {
    ctx.strokeStyle = css(mix(pal.bottom, [255, 255, 255], 0.35), 0.8);
    ctx.lineWidth = 1.6;
    ctx.stroke(antPath);
  }
  ctx.fillStyle = css(pal.ink);
  ctx.fill(antPath);
  ctx.strokeStyle = css(pal.ink);
  ctx.lineWidth = 0.7;
  ctx.stroke(antPath);   // gives the bullet ants' legs and the leaf stalks some body

  // wings: winged termites and bees, a pale flicker
  const wings = new Path2D();
  for (const ant of ants) {
    if (ant.state !== 'live' || !(ant.kind === 'alate' || ant.fly) || Math.abs(ant.wx - cam.x) > viewHalf) continue;
    if (ant.landed) continue;
    const ph = ant.kind === 'alate' ? ant.ph : game.time * 60 + ant.ph;
    const lift = ant.kind === 'alate' ? 3.4 : 2.2, flap = 0.4 + 0.6 * Math.abs(Math.sin(ph));
    for (const s of [-1, 1]) {
      const wx = ant.wx + s * lift * 0.5, wy = ant.wy - lift * 0.5 * flap;
      wings.moveTo(wx + lift, wy);
      wings.ellipse(wx, wy, lift, lift * 0.35, s * (0.5 - 0.4 * flap), 0, TAU);
    }
  }
  ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.6), 0.55);
  ctx.fill(wings);

  // brood: pale, plump grubs lying in the broken chamber
  const brood = new Path2D();
  for (const ant of ants) {
    if ((ant.kind !== 'brood' && ant.kind !== 'honey') || ant.state !== 'live' || Math.abs(ant.wx - cam.x) > viewHalf) continue;
    if (ant.kind === 'honey') {
      // honey pots: round waxy cells
      brood.moveTo(ant.wx + 3, ant.wy); brood.arc(ant.wx, ant.wy, 3, 0, TAU);
      continue;
    }
    brood.moveTo(ant.wx + Math.cos(ant.ang) * 3.2, ant.wy + Math.sin(ant.ang) * 3.2);
    brood.ellipse(ant.wx, ant.wy, 3.2, 2, ant.ang, 0, TAU);
  }
  ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.7));
  ctx.fill(brood);
  ctx.strokeStyle = css(pal.ink, 0.8);
  ctx.lineWidth = 0.8;
  ctx.stroke(brood);

  // flying grit, bark and leaves
  const bits = new Path2D();
  for (const d of debris) {
    bits.moveTo(d.x + Math.cos(d.rot) * d.rx, d.y + Math.sin(d.rot) * d.rx);
    bits.ellipse(d.x, d.y, d.rx, d.ry, d.rot, 0, TAU);
  }
  ctx.fillStyle = css(mix(pal.bottom, pal.ink, 0.93));
  ctx.fill(bits);

  drawScent(viewHalf);

  drawRescuer('back');
  if (game.phase !== 'dawn' && !a.hidden) drawTamandua(time);  // tucked away asleep, or carried off
  drawMate(time);
  drawCage();
  drawRescuer('front');
  drawTongue();
  drawWelts(dt);

  // foreground
  setT(FG_PAR);
  ctx.fillStyle = css(pal.ink);
  ctx.fill(fgPath);

  // motes / fireflies
  screenT();
  const dx = ((cam.x - prevCamX) * sc * 0.9) / cw;
  prevCamX = cam.x;
  ctx.save();
  if (pal.glow > 0.05) { ctx.shadowColor = css(pal.mote); ctx.shadowBlur = 10 * pal.glow; }
  for (const m of motes) {
    m.x = (((m.x + m.vx * dt - dx) % 1) + 1) % 1;
    m.y = (((m.y + m.vy * dt) % 1) + 1) % 1;
    const al = (0.25 + 0.5 * pal.glow) * (0.5 + 0.5 * Math.sin(time * (1.2 + pal.glow * 2) + m.ph));
    ctx.fillStyle = css(pal.mote, al);
    ctx.beginPath(); ctx.arc(m.x * cw, m.y * ch, m.r * sc * (1 + pal.glow * 0.4), 0, TAU); ctx.fill();
  }
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(cw / 2, ch * 0.55, Math.min(cw, ch) * 0.35, cw / 2, ch * 0.55, Math.max(cw, ch) * 0.8);
  vg.addColorStop(0, css(pal.ink, 0));
  vg.addColorStop(1, css(pal.ink, 0.22));
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cw, ch);

  // HUD (light outline keeps it legible over dark canopy)
  const label = (s, x, y) => { ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = css(mix(pal.bottom, [255, 255, 255], 0.3), 0.55);
  ctx.fillStyle = css(pal.ink, 0.75);
  if (game.phase === 'title') drawTitle(label);
  else if (game.phase === 'intro' || game.phase === 'rescued' || game.phase === 'free') drawSceneText(label);
  else drawHUD(time, dt, label);
  drawCard(label);
  if (fade.k > 0) {
    ctx.fillStyle = css(pal.ink, fade.k);
    ctx.fillRect(0, 0, cw, ch);
  }
  if (game.phase === 'free' && scene.later > 0 && !scene.done) {   // a title card over the dark
    ctx.font = '600 26px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.5), 0.9 * scene.later);
    ctx.fillText('5 months later', cw / 2, ch * 0.48);
    ctx.textAlign = 'left';
  }
}

// title, stats, help and messages while you play
function drawHUD(time, dt, label) {
  ctx.font = '600 18px ui-rounded, system-ui, sans-serif';
  label('Tupāra', 20, 34);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = css(pal.ink, 0.6);
  label(`night ${game.night} of ${NIGHTS}`, 20, 53);
  drawStats(time, label);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = css(pal.ink, 0.6);
  if (helpOn) {
    const lines = [
      '← →  walk     ↑ ↓  climb at a trunk',
      '← →  on a trunk: step onto a branch',
      'X  rip into a nest     hold Space  eat ants',
      'Shift  hurry     Enter  sleep in a shelter, once it gets light',
      'Z  close-up     C  scent tint     M  sound on/off     ?  guide',
      `R  rim: ${rimOn ? 'on' : 'off'}     H  hide     testing:  ]  skip 30 s   N  next night   T  next shelter   L  label species`,
    ];
    lines.forEach((l, i) => label(l, 20, 82 + i * 18));
  }
  if (flash.t > 0) {
    flash.t -= dt;
    ctx.font = '600 22px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(pal.ink, Math.min(1, flash.t) * 0.7);
    label(flash.text, cw / 2, 60);
    ctx.textAlign = 'left';
  }
  drawShelterHint(label);
  if (found.t > 0) {
    // what you've just started eating, just above the tamandua (over the highest of its back and
    // snout, so it clears the head on a trunk too), where the player is already looking
    found.t -= dt;
    const sn = snoutPoint(0);
    const wx = (a.rx + sn.x) / 2, wy = Math.min(a.ry - 70, sn.y - 45);
    const x = clamp(cw / 2 + (wx - cam.x - shx) * sc, 90, cw - 90);
    const y = clamp(ch * HORIZON + (wy - cam.y - shy) * sc, 130, ch - 20);
    ctx.font = '600 19px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(pal.ink, Math.min(1, found.t * 1.5) * 0.85);
    label(SCENTS[found.species].name, x, y);
    ctx.textAlign = 'left';
  }
}

// top right: time till dawn, energy, tonight's ants
function drawStats(time, label) {
  const W = 170, x1 = cw - 112, x0 = x1 - W;   // clear of the sound and ? buttons in the corner
  // soft light backing so it reads over dark canopy
  ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.3), 0.55);
  ctx.beginPath(); ctx.roundRect(x0 - 12, 10, W + 24, game.stings ? 112 : 94, 10); ctx.fill();
  const bar = (y, f, al) => {
    ctx.fillStyle = css(pal.ink, 0.18);
    ctx.fillRect(x0, y, W, 6);
    ctx.fillStyle = css(pal.ink, al);
    ctx.fillRect(x0, y, W * clamp(f, 0, 1), 6);
  };
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = css(pal.ink, 0.7);
  const mmss = (f) => { const s = Math.ceil(f * NIGHT_LEN); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const c = game.clock;
  label('dusk', x0, 26);
  ctx.textAlign = 'right';
  if (c >= 1) ctx.fillStyle = css(pal.ink, 0.5 + 0.4 * Math.sin(time * 7));
  label(c < DAWN ? `dawn in ${mmss(DAWN - c)}` : c < 1 ? `sunrise in ${mmss(1 - c)}` : 'daylight — find shelter', x1, 26);
  ctx.textAlign = 'left';
  bar(32, c, 0.55);
  ctx.fillStyle = css(pal.ink, 0.6);
  ctx.fillRect(x0 + W * DAWN - 0.5, 30, 1.5, 10);  // when you can bed down

  const weak = game.energy < WEAK;
  const pulse = weak ? 0.5 + 0.4 * Math.sin(time * 7) : 0.75;
  ctx.fillStyle = css(pal.ink, weak ? pulse : 0.7);
  label(weak ? 'energy — weak' : 'energy', x0, 58);
  bar(64, game.energy / E_MAX, pulse);

  ctx.font = '600 15px ui-rounded, system-ui, sans-serif';
  ctx.fillStyle = css(pal.ink, 0.75);
  ctx.textAlign = 'right';
  label(`ants tonight  ${game.tonight}`, x1, 94);
  if (game.stings) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = css(pal.ink, 0.7);
    label(`stung  ×${game.stings}`, x1, 112);
  }
  ctx.textAlign = 'left';
  drawMemoryButton(x0 - 12, (game.stings ? 112 : 94) + 18, W + 24, label);
}

// the nose memory: a button under the stats (once there's anything in it) that opens a list
const memBtn = { x: 0, y: 0, w: 0, h: 0, on: false };
function drawMemoryButton(x, y, w, label) {
  const known = Object.keys(SCENTS).filter((k) => journal[k]);
  memBtn.on = known.length > 0 && game.phase === 'night';
  if (!memBtn.on) return;
  Object.assign(memBtn, { x, y, w, h: 26 });
  ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.3), memOpen ? 0.75 : 0.55);
  ctx.beginPath(); ctx.roundRect(x, y, w, 26, 8); ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = css(pal.ink, 0.75);
  label(`nose memory (${known.length})  ${memOpen ? '▴' : '▾'}`, x + 12, y + 17);
  if (!memOpen) return;
  // the list is wider than the stats panel, so it grows leftwards from the same right edge
  const top = y + 32, rowH = 22, h = known.length * rowH + 14, px = Math.max(8, x - 80);
  ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.3), 0.75);
  ctx.beginPath(); ctx.roundRect(px, top, x + w - px, h, 8); ctx.fill();
  known.forEach((k, i) => {
    const ry = top + 18 + i * rowH;
    const g = new Path2D();
    scentGlyph(g, k, px + 18, ry - 4, 5, performance.now() / 500);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tintOn ? scentColor(k, 1) : css(pal.ink, 0.8);
    ctx.stroke(g);
    ctx.restore();
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = css(pal.ink, 0.8);
    label(`${SCENTS[k].name} — ${verdict(k)}`, px + 36, ry);
  });
}
canvas.addEventListener('click', (e) => {
  wakeAudio();
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const tb = titleBtnAt(mx, my);
  if (tb) { tb.act(); return; }
  if (againAt(mx, my)) { onEnter(); return; }
  if (memBtn.on && mx >= memBtn.x && mx <= memBtn.x + memBtn.w && my >= memBtn.y && my <= memBtn.y + memBtn.h) memOpen = !memOpen;
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const over = (memBtn.on && mx >= memBtn.x && mx <= memBtn.x + memBtn.w && my >= memBtn.y && my <= memBtn.y + memBtn.h) || titleBtnAt(mx, my) || againAt(mx, my);
  canvas.style.cursor = over ? 'pointer' : '';
});

// ---------- title screen: the story, and how to play ----------
// Shown once, when the page loads, over the empty dusk forest. The intro is set up behind it and
// waits (`updateScene` doesn't run in the 'title' phase). Play (or Enter) starts it.
const STORY = [
  "You are Tupāra, a tamandua that was rescued from a wildfire when you were young. You have been " +
    "raised by the rescuers, but today is a big day. You are being released back into the wild.",
  "If you can use your powerful snout to sniff out the tastiest ants and termites and avoid the " +
    "nasty ones for 3 straight nights, you have a great chance of surviving in the wild. If not, " +
    "you'll need to be brought back to the rescue center.",
];
const TITLE_FADE = 0.8;
const title = { btns: [], leaving: 0 };   // leaving: seconds left of the fade-out after Play
function wrapText(text, maxW) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function playFromTitle() {
  if (fade.action || game.phase !== 'title' || title.leaving > 0) return;
  title.leaving = TITLE_FADE;
}
function updateTitle(dt) {
  if (title.leaving <= 0) return;
  title.leaving -= dt;
  if (title.leaving <= 0) game.phase = 'intro';
}
function drawTitle(label) {
  ctx.save();
  ctx.globalAlpha = title.leaving > 0 ? title.leaving / TITLE_FADE : 1;
  ctx.fillStyle = css(pal.ink, 0.5);
  ctx.fillRect(0, 0, cw, ch);
  const light = mix(pal.bottom, [255, 255, 255], 0.5);
  const W = Math.min(600, cw - 48), x0 = (cw - W) / 2;
  ctx.textAlign = 'center';
  ctx.strokeStyle = css(pal.ink, 0.4);
  // lay the text out first, to centre the block vertically
  const rows = [];   // [font, text, x, gap before, colour alpha]
  const para = (font, text, gap, al = 0.92) => {
    ctx.font = font;
    wrapText(text, W).forEach((l, i) => rows.push([font, l, gap * (i === 0), al]));
  };
  rows.push(['600 46px ui-rounded, system-ui, sans-serif', 'Tupāra', 0, 1]);
  STORY.forEach((p, i) => para('17px system-ui, sans-serif', p, i === 0 ? 34 : 14));
  const lh = (f) => parseInt(f.match(/(\d+)px/)[1], 10) * 1.55;
  const textH = rows.reduce((h, r) => h + r[2] + lh(r[0]), 0);
  let y = Math.max(24, (ch - textH - 80) / 2);
  for (const [font, text, gap, al] of rows) {
    y += gap + lh(font);
    ctx.font = font;
    ctx.fillStyle = css(light, al);
    label(text, cw / 2, y - lh(font) * 0.3);
  }
  // buttons
  const btns = [
    { text: '?  how to play', act: (b) => openGuide('instructions', [b.x + b.w / 2, b.y + b.h / 2]) },
    { text: 'play', act: playFromTitle, main: true },
  ];
  ctx.font = '600 16px ui-rounded, system-ui, sans-serif';
  const bw = 150, bh = 40, gap = 18, by = y + 28;
  let bx = cw / 2 - (btns.length * bw + (btns.length - 1) * gap) / 2;
  title.btns = [];
  for (const b of btns) {
    ctx.fillStyle = css(light, b.main ? 0.9 : 0.3);
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
    ctx.fillStyle = b.main ? css(pal.ink, 0.85) : css(light, 0.95);
    ctx.fillText(b.text, bx + bw / 2, by + 26);
    title.btns.push({ x: bx, y: by, w: bw, h: bh, act() { b.act(this); } });
    bx += bw + gap;
  }
  ctx.textAlign = 'left';
  ctx.restore();
}
const titleBtnAt = (mx, my) => game.phase === 'title' && !fade.action && title.leaving <= 0
  && title.btns.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);

// ---------- information & guide ----------
// The ? button (top right, always there) opens a panel with three tabs: Instructions, About and
// References. It's HTML over the canvas (in index.html) so the references can be real links. The
// panel grows out of whatever opened it and shrinks back into it; the game waits while it's open.
const guide = { open: false, el: document.getElementById('guide'), btn: document.getElementById('guide-btn'), from: null, timer: 0 };
const GUIDE_TABS = ['instructions', 'about', 'references'];
function guideTab(id) {
  GUIDE_TABS.forEach((t, i) => {
    const on = t === id;
    document.getElementById(`guide-tab-${t}`).setAttribute('aria-selected', on);
    document.getElementById(`guide-${t}`).hidden = !on;
    if (on) guide.el.querySelector('.guide-underline').style.transform = `translateX(${i * 100}%)`;
  });
}
// `at`: the screen point it grows out of (the ? button if not given)
function openGuide(tab, at) {
  if (guide.open) return;
  if (!at) { const r = guide.btn.getBoundingClientRect(); at = [r.left + r.width / 2, r.top + r.height / 2]; }
  guide.open = true;
  guide.from = document.activeElement;
  for (const k in keys) keys[k] = false;
  if (tab) guideTab(tab);
  const d = guide.el.querySelector('.guide-dialog');
  d.style.setProperty('--ox', `${at[0] - innerWidth / 2}px`);
  d.style.setProperty('--oy', `${at[1] - innerHeight / 2}px`);
  clearTimeout(guide.timer);
  guide.el.classList.add('mounted');
  // a frame for the collapsed start to be painted, then grow out of it
  requestAnimationFrame(() => requestAnimationFrame(() => guide.el.classList.add('shown')));
  guide.el.querySelector('.guide-dialog').focus({ preventScroll: true });
}
function closeGuide() {
  if (!guide.open) return;
  guide.open = false;
  guide.el.classList.remove('shown');
  guide.timer = setTimeout(() => guide.el.classList.remove('mounted'), 300);
  (guide.from && guide.from !== document.body ? guide.from : canvas).focus?.({ preventScroll: true });
  last = performance.now();   // don't count the time it was open
}
guide.btn.addEventListener('click', (e) => { e.currentTarget.blur(); wakeAudio(); guide.open ? closeGuide() : openGuide(); });
guide.el.querySelector('.guide-close').addEventListener('click', closeGuide);
guide.el.addEventListener('click', (e) => { if (e.target === guide.el) closeGuide(); });   // click outside the panel
GUIDE_TABS.forEach((t) => document.getElementById(`guide-tab-${t}`).addEventListener('click', () => guideTab(t)));

// end-of-night / game-over / win card
const againBtn = { x: 0, y: 0, w: 0, h: 0 };
const againAt = (mx, my) => (game.phase === 'free' || game.phase === 'rescued') && scene.done && !fade.action
  && mx >= againBtn.x && mx <= againBtn.x + againBtn.w && my >= againBtn.y && my <= againBtn.y + againBtn.h;
function drawCard(label) {
  if (game.phase === 'night' || game.phase === 'intro' || game.phase === 'title' || fade.action) return;
  if ((game.phase === 'rescued' || game.phase === 'free') && !scene.done) return;   // the scene plays out first
  let lines;
  if (game.phase === 'dawn') {
    const fed = game.tonight >= NIGHT_TARGET;
    const learned = game.learned || [];
    lines = [
      `safe in ${game.shelter.name} — night ${game.night} survived`,
      `ants eaten tonight  ${game.tonight}  ·  ${fed ? 'well fed' : 'still hungry'}`,
      `energy  ${Math.round(game.energy)}%  ·  stung ${game.stings === 1 ? 'once' : `${game.stings} times`}`,
      ...(learned.length ? [`your nose will remember: ${learned.join(', ')}  (see the nose memory panel)`] : []),
      'press Enter to sleep until dusk',
    ];
  } else if (game.phase === 'rescued') {
    lines = [
      'the rescue team found you',
      game.cause === 'daylight'
        ? `caught out in the daylight on night ${game.night} — back to safety for now`
        : `you ran out of energy on night ${game.night} — back to safety for now`,
      `ants eaten  ${game.total}`,
    ];
  }
  // the play again button (after the baby, or after the rescue), with its top at `by`
  const again = (by) => {
    const bw = 150, bh = 40, bx = cw / 2 - bw / 2;
    ctx.fillStyle = css(mix(pal.bottom, [255, 255, 255], 0.5), 0.9);
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
    ctx.font = '600 16px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(pal.ink, 0.85);
    ctx.fillText('play again', cw / 2, by + 26);
    ctx.textAlign = 'left';
    Object.assign(againBtn, { x: bx, y: by, w: bw, h: bh });
  };
  ctx.fillStyle = css(pal.ink, 0.45);
  ctx.fillRect(0, 0, cw, ch);
  if (game.phase === 'free') { again(ch * 0.5 - 20); return; }   // after the baby: just a way to play again (or Enter)
  ctx.textAlign = 'center';
  ctx.strokeStyle = css(pal.ink, 0.4);
  const light = mix(pal.bottom, [255, 255, 255], 0.5);
  const prompt = game.phase === 'dawn';   // the last line is the Enter prompt (the rescue card has a button instead)
  lines.forEach((l, i) => {
    const last = prompt && i === lines.length - 1;
    ctx.font = i === 0 ? '600 30px ui-rounded, system-ui, sans-serif' : last ? '600 15px ui-rounded, system-ui, sans-serif' : '16px system-ui, sans-serif';
    ctx.fillStyle = css(light, last ? 0.75 : 0.95);
    label(l, cw / 2, ch * 0.42 + (i === 0 ? 0 : 20 + i * 28) + (last ? 18 : 0));
  });
  ctx.textAlign = 'left';
  if (game.phase === 'rescued') again(ch * 0.42 + 20 + lines.length * 28 + 14);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  if (soundBtn.hidden !== (game.phase === 'title')) soundBtn.hidden = game.phase === 'title';
  if (!guide.open) {   // the game waits while the guide is open
    updateGame(dt);
    stepPalette(dt);
    updateAnts(dt, time);
    updateTamandua(dt, time);
    updateNests(dt, time);
    updateScent(dt, time);
  }
  zoom = lerp(zoom, closeUp ? 2.4 : 1, 1 - Math.exp(-dt * 4));
  sc = (ch / VIEW_H) * zoom;
  const zk = (zoom - 1) / 1.4;  // 0 wide … 1 close-up
  const camX = game.phase === 'intro' || game.phase === 'title' ? INTRO_CAM
    : game.phase === 'rescued' ? scene.camX ?? a.rx - 60
    : game.phase === 'free' ? scene.camX ?? a.rx + a.facing * 90
    : a.rx + a.facing * lerp(90, 20, zk);
  cam.x += (camX - cam.x) * (1 - Math.exp(-dt * 1.6));
  cam.y += (lerp(Math.min(-120, a.ry - 40), a.ry - 10, zk) - cam.y) * (1 - Math.exp(-dt * 2));
  render(time, dt);
  requestAnimationFrame(frame);
}
newGame();
game.phase = 'title';   // the story first, then the release
requestAnimationFrame(frame);
