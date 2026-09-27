// Slurp — a young tamandua's first three nights in the wild.
// Everything is drawn procedurally on one canvas: dark shapes against a light sky.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const VIEW_H = 600;      // world units visible vertically
const WORLD_W = 5200;    // playable width
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
const rnd = mulberry32(11);
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
const groundY = (x) => 10 * Math.sin(x * 0.0037) + 6 * Math.sin(x * 0.0112 + 1.3) + 3 * Math.sin(x * 0.027 + 0.4);
const groundSlope = (x) => (groundY(x + 1) - groundY(x - 1)) / 2;

const groundPath = new Path2D();
groundPath.moveTo(-2000, 3000);
groundPath.lineTo(WORLD_W + 2000, 3000);
for (let x = WORLD_W + 2000; x >= -2000; x -= 16) groundPath.lineTo(x, groundY(x));
groundPath.closePath();
for (let x = -2000; x < WORLD_W + 2000; x += rand(5, 15)) {
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
  carton:     { crust: 0, bite: 11, burst: [4, 6], stock: 24, brood: 6 },   // papery nest hanging under a branch
  trunk:      { crust: 1, bite: 10, burst: [4, 6], stock: 28, brood: 6 },   // carton plastered onto a trunk
  mound:      { crust: 3, bite: 8,  burst: [6, 9], stock: 60, brood: 10 },  // sun-baked clay: hard but rich
  log:        { crust: 1, bite: 9,  burst: [3, 5], stock: 30, brood: 6 },   // soft, rotten fallen wood
  litter:     { crust: 0, bite: 13, burst: [2, 4], stock: 12, brood: 0 },   // leaf pile: easy, a small snack
  bark:       { crust: 0, bite: 10, burst: [3, 5], stock: 26, brood: 0 },   // loose bark down a trunk: peels off in plates
  deadbranch: { crust: 1, bite: 8,  burst: [3, 5], stock: 28, brood: 4 },   // bare dead branch: snaps if you dig too much
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
  litter: { fire: 0.55, termite: 0.25, carpenter: 0.2 },
  log:    { carpenter: 0.35, woodtermite: 0.3, termite: 0.25, fire: 0.1 },
  bark:   { woodtermite: 0.6, carpenter: 0.3, termite: 0.1 },
  deadbranch: { woodtermite: 0.5, carpenter: 0.4, azteca: 0.1 },
  antmound: { leafcutter: 1 },
  beehive:  { bee: 1 },
  mound:  { termite: 0.75, fire: 0.25 },
  carton: { azteca: 0.55, termite: 0.45 },
  trunk:  { azteca: 0.4, carpenter: 0.4, termite: 0.2 },
};
// from night 2 acrobat ants move into the tree nests too
const HOMES_LATER = {
  carton: { azteca: 0.35, acrobat: 0.35, termite: 0.3 },
  trunk:  { azteca: 0.3, carpenter: 0.3, acrobat: 0.25, termite: 0.15 },
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
  n.breaches = 0; n.brood = n.T.brood;
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
function makeTree(x) {
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
    if (ys.every((o) => Math.abs(o - y) > 80)) ys.push(y);
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
    dir = rnd() < 0.8 ? -dir : dir;
  }
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
  return t;
}
function branchPoint(b, s) {
  return { x: b.tree.x + b.dir * b.c * s, y: b.y - b.sn * s };
}
const branchThick = (b, s) => lerp(b.t0, b.t0 * 0.4, s / b.len);
function trunkFaceX(t, y, side) {
  const f = clamp((t.gy - y) / (t.gy - t.top), 0, 1);
  return t.x + side * t.hw * (1 - 0.15 * f);
}
for (let x = 560; x < WORLD_W - 300; x += rand(380, 620)) {
  if (mounds.some((m) => Math.abs(m.x - x) < 170)) x += 200;
  trees.push(makeTree(x));
}

// things on the forest floor keep clear of trees, each other, and the shelters; placeFloor tries
// x, then steps along until it finds room
const floorClear = (x, r) =>
  x - r > 100 && x + r < WORLD_W - 100 &&
  trees.every((t) => Math.abs(t.x - x) > r + 50) &&
  nests.every((n) => !n.ground || n.box.x1 + 20 < x - r || n.box.x0 - 20 > x + r) &&
  shelters.every((s) => s.kind === 'tree' || Math.abs(s.x - x) > r + s.r + 20);
function placeFloor(x, r, make) {
  for (let tries = 0; tries < 40; tries++, x += 23) if (floorClear(x, r)) { make(x); return true; }
  return false;
}

// ---------- shelters: somewhere to sleep through the day ----------
// Only three in the whole forest — a hollow in a tree, a burrow under an old stump, a hollow log —
// always in the same places, so part of each night is remembering where they are.
const shelters = [];
{
  // a knot hole high on a trunk: reached by climbing
  const t = trees.reduce((b, t) => (Math.abs(t.x - 1250) < Math.abs(b.x - 1250) ? t : b));
  let y = t.gy - 180;
  for (let k = 0; k < 60; k++) {
    const c = rand(t.gy - 240, t.gy - 120);
    const clearOfNest = [t.nest, t.bark].every((n) => !n || c < n.box.y0 - 30 || c > n.box.y1 + 30);
    if (clearOfNest && t.branches.every((b) => Math.abs(b.y - c) > 40)) { y = c; break; }
  }
  const rim = new Path2D(), hole = new Path2D();
  rim.moveTo(t.x + 10, y); rim.ellipse(t.x, y, 10, 15, 0, 0, TAU, true);
  hole.moveTo(t.x + 7, y + 1.5); hole.ellipse(t.x, y + 1.5, 7, 11.5, 0, 0, TAU, true);
  shelters.push({ kind: 'tree', name: 'a hollow in a tree', tree: t, x: t.x, y, rim, hole, found: false });
}
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
for (let x = 1300; x < WORLD_W - 200; x += rand(900, 1300)) placeFloor(x, 90, makeLog);
placeFloor(440, 50, makeLitter);  // one right by the start
for (let x = 800; x < WORLD_W - 200; x += rand(450, 750)) placeFloor(x, 50, makeLitter);

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
  const p = new Path2D(), x0 = -1800, x1 = WORLD_W * par + 1800;
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
for (let x = -1800; x < WORLD_W * FG_PAR + 1800; x += rand(200, 460)) {
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
BODY.bezierCurveTo(12, -18, 0, -19, -14, -20);      // belly
BODY.bezierCurveTo(-30, -21, -46, -20, -58, -24);   // flank
BODY.bezierCurveTo(-68, -26, -72, -30, -70, -36);   // back of the thigh
BODY.closePath();

const HEAD_PIVOT = [26, -40];
const HEAD = new Path2D();   // drawn around HEAD_PIVOT
// The crown sits on the continuation of the back line, so at rest back, neck and
// forehead read as one unbroken curve; a dip only appears when the head lifts.
HEAD.moveTo(-14, -7);
HEAD.quadraticCurveTo(0, -6.5, 16, -3.5);   // crown, continuing the slope of the back
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
let rimOn = true, helpOn = true, closeUp = false, showSpecies = false, flash = { text: '', t: 0 };
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Enter') onEnter();
  if (e.code === 'BracketRight' && game.phase === 'night') { game.clock = Math.min(1, game.clock + 30 / NIGHT_LEN); flash = { text: '+30 s', t: 0.8 }; }  // testing aid
  if (e.code === 'KeyR') { rimOn = !rimOn; flash = { text: rimOn ? 'rim light on' : 'rim light off', t: 1.2 }; }
  if (e.code === 'KeyH') helpOn = !helpOn;
  if (e.code === 'KeyZ') closeUp = !closeUp;
  if (e.code === 'KeyL') showSpecies = !showSpecies;
  if (e.code === 'KeyN' && game.phase === 'night' && game.night < NIGHTS) startNight(game.night + 1);  // testing aid
  if (e.code === 'KeyC') { tintOn = !tintOn; flash = { text: tintOn ? 'scent tint on' : 'scent tint off', t: 1.2 }; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// the tamandua only takes orders while a night is under way
const held = (...codes) => game.phase === 'night' && !fade.action && codes.some((c) => keys[c]);

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
  // running low on energy: slower, and too tired to hurry
  const weak = game.energy < WEAK;
  const hurry = (held('ShiftLeft', 'ShiftRight') && !weak ? 1.8 : 1) * (weak ? 0.75 : 1) * (a.buzz ? 0.7 : 1);

  if (a.mode === 'ground') {
    a.vel = approach(a.vel, still ? 0 : h * 48 * hurry, dt);
    a.x = clamp(a.x + a.vel * dt, 60, WORLD_W - 60);
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
    a.vel = approach(a.vel, still ? 0 : v * 30 * hurry, dt);
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
    const b = a.branch, sMin = b.tree.hw + 6, sMax = b.len - 22;
    a.vel = approach(a.vel, still ? 0 : h * b.dir * 36 * hurry, dt);
    a.s += a.vel * dt;
    if (a.s <= sMin) { a.s = sMin; a.vel = Math.max(a.vel, 0); }
    if (a.s >= sMax) { a.s = sMax; a.vel = Math.min(a.vel, 0); }
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
  const walkHead = a.mode === 'ground' ? 0.4 : 0.12;
  a.flinch = Math.max(0, a.flinch - dt);
  const headTarget = a.flinch > 0
    ? -0.45 + 0.08 * Math.sin(time * 40)   // stung: head jerks up and shakes
    : a.claw.t >= 0
    ? 0.35   // head tucked down toward the target, out of the paw's way
    : sniffing
    ? 0.44 + 0.04 * Math.sin(time * 10)
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
  updateTongue(dt, time, sniffing);
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
  if (a.mode === 'branch' && a.branch === b) {
    // and the tamandua goes down with it
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

const bodyBob = () => -1.5 * a.moveAmt * Math.abs(Math.sin(a.gait * TAU));
// a point along the snout's centre line (t = 0 at its base, 1 at the tip)
function snoutPoint(t) {
  const hx = lerp(SNOUT_BASE[0], SNOUT_TIP[0], t), hy = lerp(SNOUT_BASE[1], SNOUT_TIP[1], t);
  const c = Math.cos(a.head), s = Math.sin(a.head);
  return toWorld(HEAD_PIVOT[0] + hx * c - hy * s, HEAD_PIVOT[1] + bodyBob() + hx * s + hy * c);
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
    const p = w.snout ? snoutPoint(w.snout) : toWorld(w.lx, w.ly);
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
function tailShape(bob, time) {
  let ang, c1, c2, drag;
  if (a.mode === 'trunk') { ang = Math.PI - 0.35; c1 = 0.25; c2 = -1.6; drag = true; }
  // footage: on a vine the tail lies back along it, the tip drooping over;
  // on the ground it slopes down from the rump, trails, and the naked tip lifts a little
  else if (a.mode === 'branch') { ang = Math.PI - 0.3; c1 = 0.15; c2 = -1.2; drag = true; }
  else { ang = Math.PI - 0.7; c1 = 0.5; c2 = 0.5; drag = true; }
  const sway = 0.08 * Math.sin(time * 1.1) + 0.05 * a.moveAmt * Math.sin(a.gait * TAU);
  const N = 28, seg = 3.6, pts = [];
  let x = -57, y = -42.5 + bob;
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

function drawTamandua(time, rim) {
  const RW = 2.4;
  ctx.save();
  ctx.translate(a.rx, a.ry);
  ctx.rotate(a.rt);
  ctx.scale(a.rf * S, S);
  const rear = clawRear(a.claw.t);
  if (rear) { ctx.translate(REAR_PIVOT, 0); ctx.rotate(-rear); ctx.translate(-REAR_PIVOT, 0); }
  const color = rim ? css(mix(pal.bottom, [255, 255, 255], 0.35), 0.9) : css(pal.ink);
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineJoin = ctx.lineCap = 'round';
  const shape = (p) => { ctx.fill(p); if (rim) { ctx.lineWidth = RW * 2; ctx.stroke(p); } };

  const bob = bodyBob();
  const breathe = 1 + 0.012 * Math.sin(time * 2.2);

  shape(tailShape(bob, time));

  // legs (two-bone IK) as tapered limbs: heavy thighs, thick forearms; far pair first
  // Footfall timing (fraction of a stride): lateral sequence, hind then same-side fore.
  // Near side is the "left" pair, far side half a stride later.
  const D = a.diag;
  // `fwd` shifts a foot's centre of swing forward while walking. Footage: each fore paw lifts
  // to chest height and reaches far forward, landing below the snout, which hangs low.
  const legs = [
    { jx: -46, jy: -38, home: -44, fwd: -2, off: 0.5,     a: 22, b: 21, w: [17, 9, 6.5],  bend: -1, front: false },
    { jx: 22,  jy: -34, home: 26,  fwd: 14, off: 0.5 + D, a: 22, b: 20, w: [12, 9, 7],    bend: 1,  front: true },
    { jx: -52, jy: -38, home: -50, fwd: -2, off: 0,       a: 22, b: 21, w: [20, 10, 7],   bend: -1, front: false },
    { jx: 16,  jy: -34, home: 20,  fwd: 14, off: D,       a: 22, b: 20, w: [14, 10.5, 8], bend: 1,  front: true },
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
    const jx = L.front ? L.jx + sx * reach * 0.6 : L.jx;
    const jy = L.jy + bob + (L.front ? 3 * a.moveAmt : 0);
    L = { ...L, jx };
    const dx = fx - L.jx, dy = fy - jy, d = Math.min(Math.hypot(dx, dy), L.a + L.b - 0.01);
    const A = Math.acos(clamp((L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d), -1, 1));
    const k = Math.atan2(dy, dx) + L.bend * A;
    const kx = L.jx + Math.cos(k) * L.a, ky = jy + Math.sin(k) * L.a;
    const p = new Path2D();
    circ(p, L.jx, jy, L.w[0] / 2);
    limb(p, L.jx, jy, kx, ky, L.w[0], L.w[1]);
    limb(p, kx, ky, fx, fy - L.w[2] / 2, L.w[1], L.w[2]);
    if (L.front) {
      // hand rolled onto its outer edge, big claws curled under
      p.moveTo(fx + 7, fy - 3); p.ellipse(fx + 2, fy - 3, 5, 3, 0, 0, TAU, true);
      limb(p, fx + 5, fy - 3, fx + 9, fy - 0.5, 3, 1.2);
    } else {
      limb(p, fx - 4, fy - 2.5, fx + 8, fy - 1.5, 5, 3.2); // flat, plantigrade hind foot
    }
    shape(p);
  };
  drawLeg(legs[0], 0); drawLeg(legs[1], 1);

  ctx.save();
  ctx.translate(0, bob);
  ctx.scale(1, breathe);
  shape(BODY);
  ctx.restore();

  // head + ear (the tongue is drawn separately, in world space, in colour)
  ctx.save();
  ctx.translate(HEAD_PIVOT[0], HEAD_PIVOT[1] + bob);
  ctx.rotate(a.head);
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
const STRIKE_COST = 0.35;
const SLEEP_BONUS = 20;   // a night survived and a day's sleep
// clock: dawn light starts at DAWN (you can bed down from then on); at 1 the sun is up and a
// tamandua still out in the open is exposed and loses energy fast until it finds shelter
const DAWN = 0.8, DAY_END = 1.25, EXPOSED_DRAIN = 1.0;
const START_X = 320;

// phase: 'night' (playing) · 'dawn' (night survived, summary up) · 'rescued' (out of energy) · 'free' (won)
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

  // treading on a bullet ant
  bulletIn -= dt;
  const underfoot = (t) => { const d = (t.wx - a.rx) * a.facing; return d > -38 && d < 22; };  // hind paws … fore paws
  if (a.mode === 'ground' && bulletIn <= 0 && ants.some((t) => t.kind === 'bullet' && t.state === 'live' && underfoot(t))) {
    sting('body', 'bullet'); bulletIn = 3;
  }

  // stingless bees don't sting, but a cloud of them in your fur slows everything down
  let bees = 0;
  for (const t of ants) if (t.fly && t.state === 'live' && Math.hypot(t.wx - a.rx, t.wy - (a.ry - 18)) < 45) bees++;
  a.buzz = bees >= 2;
  if (a.buzz && game.time - buzzAt > 8) flash = { text: 'bees in your fur!', t: 1.6 };
  if (a.buzz) buzzAt = game.time;
}
let armyIn = 0, bulletIn = 0, buzzAt = -99;
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
  cam.x = START_X + 90;
  Object.assign(game, { energy: E_START, total: 0 });
  for (const k in journal) delete journal[k];     // a fresh start: the nose memory is earned again
  for (const k in tonight) delete tonight[k];
  memOpen = false;
  for (const s of shelters) s.found = false;
  startNight(1);
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
function onEnter() {
  if (fade.action) return;
  if (game.phase === 'night') {
    const s = shelterHere();
    if (!s) return;
    if (game.clock < DAWN) { flash = { text: 'too early — keep feeding until it gets light', t: 2.2 }; return; }
    fade.action = () => { game.phase = 'dawn'; game.shelter = s; game.learned = commitMemory(); };
  } else if (game.phase === 'dawn') {
    fade.action = game.night >= NIGHTS ? () => { game.phase = 'free'; } : () => {
      game.energy = Math.min(E_MAX, game.energy + SLEEP_BONUS);
      wakeAt(game.shelter);
      startNight(game.night + 1);
    };
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
  if (game.phase !== 'night') return;
  game.clock = Math.min(DAY_END, game.clock + dt / NIGHT_LEN);
  if (game.clock >= DAWN && !game.dawnWarned) { game.dawnWarned = true; flash = { text: "it's getting light — find somewhere to sleep", t: 3 }; }
  if (game.clock >= 1) {
    spend(EXPOSED_DRAIN * dt);
    if (!game.exposedWarned) { game.exposedWarned = true; flash = { text: "daylight — you're exposed! get to shelter", t: 3 }; }
  }
  if (game.swarms && game.swarms.length && game.clock >= game.swarms[0]) { game.swarms.shift(); startSwarm(); }
  updateSwarm(dt);
  for (const s of shelters) {
    if (!s.found && Math.hypot(s.x - a.rx, s.y - a.ry) < 110) {
      s.found = true;
      flash = { text: `${s.name} — somewhere to sleep`, t: 2.8 };
    }
  }
  const moving = Math.abs(a.vel) > 3;
  const hurrying = moving && held('ShiftLeft', 'ShiftRight') && game.energy >= WEAK;
  spend((DRAIN_REST + (moving ? DRAIN_MOVE : 0) + (hurrying ? DRAIN_HURRY : 0)) * dt);
  updateStings(dt);
  if (game.energy < WEAK && !game.warned) { game.warned = true; flash = { text: 'getting weak — find ants', t: 2.5 }; }
  if (game.energy >= WEAK + 5) game.warned = false;
  if (game.energy <= 0) { game.phase = 'rescued'; game.cause = game.clock >= 1 ? 'daylight' : 'energy'; }
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

  if (game.phase !== 'dawn') {  // tucked away asleep otherwise
    if (rimOn) drawTamandua(time, true);
    drawTamandua(time, false);
  }
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
  ctx.font = '600 18px ui-rounded, system-ui, sans-serif';
  label('slurp', 20, 34);
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
      'Z  close-up     C  scent tint',
      `R  rim: ${rimOn ? 'on' : 'off'}     H  hide     testing:  ]  skip 30 s   N  next night   L  label species`,
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
    // what you've just started eating
    found.t -= dt;
    ctx.font = '600 16px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = css(pal.ink, Math.min(1, found.t * 1.5) * 0.75);
    label(SCENTS[found.species].name, cw / 2, 88);
    ctx.textAlign = 'left';
  }
  drawCard(label);
  if (fade.k > 0) {
    ctx.fillStyle = css(pal.ink, fade.k);
    ctx.fillRect(0, 0, cw, ch);
  }
}

// top right: time till dawn, energy, tonight's ants
function drawStats(time, label) {
  const W = 170, x1 = cw - 20, x0 = x1 - W;
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
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if (memBtn.on && mx >= memBtn.x && mx <= memBtn.x + memBtn.w && my >= memBtn.y && my <= memBtn.y + memBtn.h) memOpen = !memOpen;
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const over = memBtn.on && mx >= memBtn.x && mx <= memBtn.x + memBtn.w && my >= memBtn.y && my <= memBtn.y + memBtn.h;
  canvas.style.cursor = over ? 'pointer' : '';
});

// end-of-night / game-over / win card
function drawCard(label) {
  if (game.phase === 'night' || fade.action) return;
  let lines;
  if (game.phase === 'dawn') {
    const fed = game.tonight >= NIGHT_TARGET;
    const learned = game.learned || [];
    lines = [
      `safe in ${game.shelter.name.replace(/^a /, 'the ')} — night ${game.night} survived`,
      `ants eaten tonight  ${game.tonight}  ·  ${fed ? 'well fed' : 'still hungry'}`,
      `energy  ${Math.round(game.energy)}  ·  stung ${game.stings === 1 ? 'once' : `${game.stings} times`}`,
      ...(learned.length ? [`your nose will remember: ${learned.join(', ')}  (see nose memory, top right)`] : []),
      game.night >= NIGHTS ? 'Enter  sleep through your last day' : `Enter  sleep until dusk  (+${SLEEP_BONUS} energy)`,
    ];
  } else if (game.phase === 'rescued') {
    lines = [
      'the rescue team found you',
      game.cause === 'daylight'
        ? `caught out in the daylight on night ${game.night} — back to rehab for now`
        : `you ran out of energy on night ${game.night} — back to rehab for now`,
      `ants eaten  ${game.total}`,
      'Enter  try again',
    ];
  } else {
    lines = [
      'three nights on your own',
      "you're ready for a life in the wild",
      `ants eaten  ${game.total}`,
      'Enter  play again',
    ];
  }
  ctx.fillStyle = css(pal.ink, 0.45);
  ctx.fillRect(0, 0, cw, ch);
  ctx.textAlign = 'center';
  ctx.strokeStyle = css(pal.ink, 0.4);
  const light = mix(pal.bottom, [255, 255, 255], 0.5);
  lines.forEach((l, i) => {
    ctx.font = i === 0 ? '600 30px ui-rounded, system-ui, sans-serif' : i === lines.length - 1 ? '600 15px ui-rounded, system-ui, sans-serif' : '16px system-ui, sans-serif';
    ctx.fillStyle = css(light, i === lines.length - 1 ? 0.75 : 0.95);
    label(l, cw / 2, ch * 0.42 + (i === 0 ? 0 : 20 + i * 28) + (i === lines.length - 1 ? 18 : 0));
  });
  ctx.textAlign = 'left';
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  updateGame(dt);
  stepPalette(dt);
  updateAnts(dt, time);
  updateTamandua(dt, time);
  updateNests(dt, time);
  updateScent(dt, time);
  zoom = lerp(zoom, closeUp ? 2.4 : 1, 1 - Math.exp(-dt * 4));
  sc = (ch / VIEW_H) * zoom;
  const zk = (zoom - 1) / 1.4;  // 0 wide … 1 close-up
  cam.x += (a.rx + a.facing * lerp(90, 20, zk) - cam.x) * (1 - Math.exp(-dt * 1.6));
  cam.y += (lerp(Math.min(-120, a.ry - 40), a.ry - 10, zk) - cam.y) * (1 - Math.exp(-dt * 2));
  render(time, dt);
  requestAnimationFrame(frame);
}
flash = { text: 'night 1', t: 2.5 };
requestAnimationFrame(frame);
