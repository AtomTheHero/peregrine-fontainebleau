/* ============================================================
   TABLESIGHT — executive demo (dark redesign)
   1 Vision capture · 2 Player data · 3 Decision engine
   4 Game protection · 5 Floor view
   ============================================================ */

'use strict';

/* ---------------- playback engine with seek ---------------- */
let runId = 0;          // bumped on every restart / seek -> cancels old runs
let paused = false;
let vtime = 0;          // virtual demo time (ms since demo start)
let ffTarget = 0;       // fast-forward: consume sleeps instantly until vtime reaches this

const $ = (id) => document.getElementById(id);

const PACE = 1.15;   // global pacing multiplier (>1 = slower, calmer)

function sleep(ms) {
  ms = Math.round(ms * PACE);
  const myRun = runId;
  return new Promise((resolve, reject) => {
    /* fast-forward mode: consume instantly (microtask, no real wait) */
    if (vtime + ms <= ffTarget) {
      vtime += ms;
      queueMicrotask(() => (myRun === runId ? resolve() : reject({ cancelled: true })));
      return;
    }
    let remaining = ms;
    if (vtime < ffTarget) { remaining -= (ffTarget - vtime); vtime = ffTarget; }
    let elapsed = 0;
    const step = 40;
    const tick = () => {
      if (myRun !== runId) return reject({ cancelled: true });
      if (!paused) { elapsed += step; vtime += step; updateScrubber(); }
      if (elapsed >= remaining) return resolve();
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}

/* timeline marks (measured; used by scrubber chapters + phase nav) */
const MARKS = {};
function mark(name) {
  MARKS[name] = Math.round(vtime);
  $('stage').dataset.marks = JSON.stringify(MARKS);
}

/* chapter times are measured from an instrumented full run (see MARKS) */
const TOTAL = 348340;
const CHAPTERS = [
  ['INTRO', 0], ['HAND 1', 6560], ['HAND 2', 26180], ['HAND 3', 46910],
  ['HAND 4', 67770], ['SURVEIL', 91520], ['THEFT', 161720],
  ['PROFILE', 173270], ['SIMS', 191470], ['DECISION', 201210],
  ['PHONE', 210730], ['AP PLAYER', 221020], ['AP DECISION', 294030],
  ['AP PHONE', 312700], ['FLOOR', 323000],
];
const PHASE_STARTS = { 1: 0, 2: 91520, 3: 173270, 4: 191470, 5: 221020, 6: 323000 };

$('pauseBtn').addEventListener('click', () => {
  paused = !paused;
  $('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
});
$('restartBtn').addEventListener('click', () => startDemo(0));
$('replayBtn').addEventListener('click', () => startDemo(0));
document.querySelectorAll('.phase-btn').forEach(btn =>
  btn.addEventListener('click', () => startDemo(PHASE_STARTS[+btn.dataset.scene])));

/* ---------------- scrubber UI ---------------- */
function updateScrubber() {
  const p = Math.min(vtime / TOTAL, 1) * 100;
  $('scrubFill').style.width = p + '%';
  if (!scrubDragging) $('scrubHead').style.left = p + '%';
}

let scrubDragging = false;
(function buildScrubber() {
  const track = $('scrubTrack');
  let ci = 0;
  for (const [label, t] of CHAPTERS) {
    const tick = document.createElement('div');
    tick.className = 'scrub-tick';
    tick.style.left = (t / TOTAL * 100) + '%';
    track.appendChild(tick);
    const chap = document.createElement('button');
    chap.className = 'scrub-chap';
    chap.style.left = (t / TOTAL * 100) + '%';
    chap.style.top = (ci++ % 2) ? '12px' : '0';
    chap.textContent = label;
    chap.addEventListener('click', (e) => { e.stopPropagation(); startDemo(t); });
    $('scrubChapters').appendChild(chap);
  }
  const pctFromEvent = (e) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  track.addEventListener('pointerdown', (e) => {
    scrubDragging = true;
    track.setPointerCapture(e.pointerId);
    $('scrubHead').style.left = (pctFromEvent(e) * 100) + '%';
  });
  track.addEventListener('pointermove', (e) => {
    if (scrubDragging) $('scrubHead').style.left = (pctFromEvent(e) * 100) + '%';
  });
  track.addEventListener('pointerup', (e) => {
    scrubDragging = false;
    startDemo(pctFromEvent(e) * TOTAL);
  });
})();

function showScene(n, tab = n, surv = false) {
  document.body.classList.toggle('surv-mode', surv);
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('visible'));
  $('scene' + n).classList.add('visible');
  document.querySelectorAll('.phase-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.scene === tab));
}

async function titleCard(phase, main, sub, hold = 2600) {
  $('titlePhase').textContent = phase;
  $('titleMain').textContent = main;
  $('titleSub').textContent = sub;
  $('titleOverlay').classList.add('show');
  await sleep(hold);
  $('titleOverlay').classList.remove('show');
  await sleep(500);
}

async function startDemo(targetMs = 0) {
  runId++;
  paused = false;
  vtime = 0;
  ffTarget = Math.max(0, Math.min(targetMs, TOTAL - 1000));
  $('pauseBtn').textContent = 'Pause';
  $('endOverlay').classList.remove('show');
  $('titleOverlay').classList.remove('show');
  updateScrubber();
  try {
    await runScene1();
    await runSceneSurv();
    await runScene2();
    await runIntel(INTEL_COMP);
    await runSceneAP();
    await runIntel(INTEL_AP);
    await runSceneFloor();
    mark('end');
    vtime = TOTAL;
    updateScrubber();
    $('endOverlay').classList.add('show');
  } catch (e) {
    if (!e || !e.cancelled) console.error(e);
  }
}

/* ============================================================
   SCENE 1 — COMPUTER VISION CAPTURE
   ============================================================ */

/* Fontainebleau-style betting spots: [left%, top%, rotation]. Seat 5 (index 3) is our player. */
const SPOTS = [
  [13, 33, -33], [23.5, 44.5, -22], [34.5, 51.5, -10],
  [45, 54, 0], [57.5, 51, 11], [69, 42.5, 23],
];
(function buildSpots() {
  for (const [x, y, r] of SPOTS) {
    const s = document.createElement('div');
    s.className = 'spot';
    s.style.left = x + '%'; s.style.top = y + '%';
    s.style.transform = `rotate(${r}deg)`;
    s.innerHTML =
      '<svg class="bt" viewBox="0 0 34 22"><polygon points="1,1 1,21 15,11"></polygon><polygon points="33,1 33,21 19,11"></polygon></svg>' +
      '<div class="sb sb1"></div><div class="sb sb2"></div>';
    $('spotLayer').appendChild(s);
  }
})();

const SUIT_RED = { '♥': 1, '♦': 1 };
const HILO = (r) => ('23456'.includes(r) ? 1 : ('789'.includes(r) ? 0 : -1));

let runningCount = 0, decksLeft = 4.5;
let sessionHands = 43, clockSec = 21 * 3600 + 14 * 60 + 32;
let clockTimer = null;

function fmtClock(s) {
  const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function logEvent(tag, text, cls = '') {
  const log = $('eventLog');
  const row = document.createElement('div');
  row.innerHTML = `<span class="t">${fmtClock(clockSec)}</span><span class="tag ${cls}">[${tag}]</span>${text}`;
  log.appendChild(row);
  while (log.children.length > 14) log.removeChild(log.firstChild);
}

function makeCard(rank, suit, faceDown) {
  const el = document.createElement('div');
  el.className = 'card ' + (SUIT_RED[suit] ? 'red' : 'black') + (faceDown ? ' facedown' : '');
  el.innerHTML = `<div class="corner">${rank}<small>${suit}</small></div><div class="pip">${suit}</div>`;
  return el;
}

/* deal a card from the shoe to (x%,y%) of the feed */
async function dealCard(rank, suit, x, y, rot, faceDown) {
  const el = makeCard(rank, suit, faceDown);
  el.style.left = '84%'; el.style.top = '8%'; el.style.transform = 'rotate(38deg)';
  $('cardLayer').appendChild(el);
  el.getBoundingClientRect(); // reflow
  el.style.left = x + '%'; el.style.top = y + '%'; el.style.transform = `rotate(${rot}deg)`;
  await sleep(470);
  return el;
}

function flipCard(el, rank, suit) {
  el.classList.remove('facedown');
  el.className = 'card ' + (SUIT_RED[suit] ? 'red' : 'black');
  el.innerHTML = `<div class="corner">${rank}<small>${suit}</small></div><div class="pip">${suit}</div>`;
}

/* tight CV box around a card dealt at (x%,y%) */
function cardBox(x, y, label) {
  return cvBox(x - 0.55, y - 1.1, 5.6, 11.4, label);
}

/* CV bounding box at (x%,y%) sized (w%,h%) */
function cvBox(x, y, w, h, label, cls = '') {
  const b = document.createElement('div');
  b.className = 'cvbox ' + cls;
  b.style.left = x + '%'; b.style.top = y + '%';
  b.style.width = w + '%'; b.style.height = h + '%';
  b.innerHTML = `<span class="cvlabel">${label}</span>`;
  if (y < 6) b.querySelector('.cvlabel').style.top = 'calc(100% + 6px)';
  $('cvLayer').appendChild(b);
  return b;
}

function updateCountHud(rank) {
  /* count tracked internally for the AP model; no longer surfaced in the HUD */
  if (rank) runningCount += HILO(rank);
}

async function banner(text, cls, hold = 1500) {
  const b = $('actionBanner');
  b.className = cls; b.textContent = text; b.classList.add('show');
  await sleep(hold);
  b.classList.remove('show');
  await sleep(220);
}

function setSkill(s) {
  $('skillScoreNum').textContent = s.score;
  $('skillGrade').textContent = s.grade;
  $('skillMeter').style.width = s.score + '%';
  $('adherence').textContent = s.adh;
  $('adherence').className = s.adhCls || 'warn';
  $('effEdge').textContent = s.edge;
  $('effEdge').className = s.edgeCls || 'ok';
  $('apProb').textContent = s.ap;
  $('apProb').className = s.apCls || '';
  $('avgBet').textContent = s.avg;
}

let houseNet = 0;
function updateSession(skill, ops) {
  $('sbHands').textContent = sessionHands;
  const net = $('sbNet');
  net.textContent = (houseNet >= 0 ? '+$' : '\u2212$') + Math.abs(houseNet).toLocaleString();
  net.className = houseNet >= 0 ? 'ok' : 'bad';
  const edge = parseFloat(String(skill.edge).replace('\u2212', '-'));
  const avg = parseFloat(String(skill.avg).replace(/[$,]/g, ''));
  const pace = ops ? ops[0] : 72;
  const theo = Math.round(edge / 100 * avg * pace);
  const th = $('sbTheo');
  th.textContent = (theo >= 0 ? '+$' : '\u2212$') + Math.abs(theo) + '/hr';
  th.className = theo >= 0 ? 'ok' : 'bad';
}

function setOps(pace, occ, eff) {
  $('hudOps').textContent = `Pace ${pace} hands/hr · Occupancy ${occ} · Dealer eff ${eff}%`;
}

function addHandChip(label, optimal) {
  const c = document.createElement('div');
  c.className = 'hand-chip ' + (optimal ? 'opt' : 'dev');
  c.textContent = label + (optimal ? ' ✓' : ' ✗');
  $('handChips').appendChild(c);
}

function chipStack(x, y, colors) {
  const s = document.createElement('div');
  s.className = 'chip-stack';
  s.style.left = x + '%'; s.style.top = y + '%';
  colors.forEach(col => {
    const c = document.createElement('div');
    c.className = 'chip ' + col;
    s.appendChild(c);
  });
  $('chipLayer').appendChild(s);
  return s;
}

/* ---- gesture read-out chip (replaces animated hand) ---- */
const GESTURE_LABEL = {
  STAND: 'Wave over cards — STAND',
  HIT: 'Tap on felt — HIT',
  DOUBLE: 'Chip push — DOUBLE DOWN',
};

async function animateGesture(kind) {
  const chip = document.createElement('div');
  chip.className = 'gesture-chip';
  chip.style.left = '55%';
  chip.style.top = '60%';
  chip.innerHTML =
    '<div class="g-text">Reading player gesture…</div>' +
    '<div class="g-sub">motion tracking · seat 5</div>' +
    '<div class="g-bar"><div></div></div>';
  $('floatLayer').appendChild(chip);
  chip.getBoundingClientRect();
  chip.classList.add('in');
  await sleep(480);
  logEvent('POSE', 'Player hand motion detected · tracking', '');
  chip.querySelector('.g-text').textContent = GESTURE_LABEL[kind] || kind;
  chip.querySelector('.g-sub').textContent = 'gesture confidence 97.8%';
  chip.querySelector('.g-bar div').style.width = '97.8%';
  chip.classList.add('locked');
  await sleep(1550);
  chip.classList.add('out');
  await sleep(380);
  chip.remove();
}

function floatText(x, y, txt, color) {
  const f = document.createElement('div');
  f.className = 'float-txt';
  f.style.left = x + '%'; f.style.top = y + '%'; f.style.color = color;
  f.textContent = txt;
  $('floatLayer').appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

/* ---- the scripted hands ---- */
const HANDS = [
  {
    bet: 100, chips: ['black', 'black'],
    player: [['10','♦'], ['6','♣']], pTotal: '16 (HARD)',
    dealerUp: ['9','♠'], dealerHole: ['8','♥'], dTotal: '17',
    dealerDraws: [],
    optimal: 'HIT', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Hard 16 vs 9 → basic strategy: <span class="hl">HIT</span> (surrender if allowed).',
    verdict: 'Player <span class="bad">STOOD on hard 16 vs 9</span> — costly deviation. EV given up: <span class="bad">−4.1%</span> of wager.',
    result: 'LOSS', payout: -100, resultText: 'DEALER 17 BEATS 16 — HOUSE WINS $100',
    chipLabel: '16v9', ops: [69, '5/6', 102], skill: { score: 61, grade: 'C', adh: '33%', edge: '2.0%', ap: '4.8%', avg: '$100' }
  },
  {
    bet: 150, chips: ['black', 'green', 'green'],
    player: [['A','♠'], ['7','♥']], pTotal: 'SOFT 18',
    dealerUp: ['6','♦'], dealerHole: ['10','♣'], dTotal: '16 → DRAWS',
    dealerDraws: [['9','♥']],
    optimal: 'DOUBLE', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Soft 18 vs 6 → basic strategy: <span class="hl">DOUBLE DOWN</span>.',
    verdict: 'Player <span class="bad">failed to double soft 18 vs 6</span>. Won the hand anyway — <span class="hl">outcome ≠ skill</span>. EV given up: <span class="bad">−9.2%</span>.',
    result: 'WIN', payout: 150, resultText: 'DEALER BUSTS 25 — PLAYER WINS $150',
    chipLabel: 'A7v6', ops: [71, '5/6', 104], skill: { score: 58, grade: 'C−', adh: '31%', edge: '2.2%', ap: '3.1%', avg: '$117' }
  },
  {
    bet: 100, chips: ['black', 'black'],
    player: [['8','♣'], ['8','♦']], pTotal: 'PAIR 8-8 (16)',
    dealerUp: ['10','♥'], dealerHole: ['Q','♠'], dTotal: '20',
    dealerDraws: [],
    optimal: 'SPLIT', action: 'HIT', gesture: 'TAP FELT — HIT',
    hitCard: ['K','♦'], hitTotal: '26 — BUST',
    reason: 'Pair of 8s vs 10 → basic strategy: <span class="hl">ALWAYS SPLIT 8s</span>.',
    verdict: 'Player <span class="bad">hit 8-8 instead of splitting</span> and busted. Signature low-skill error. EV given up: <span class="bad">−11.4%</span>.',
    result: 'LOSS', payout: -100, resultText: 'PLAYER BUSTS 26 — HOUSE WINS $100',
    chipLabel: '88vT', ops: [72, '6/6', 104], skill: { score: 54, grade: 'C−', adh: '29%', edge: '2.3%', ap: '2.4%', avg: '$112' }
  },
  {
    bet: 125, chips: ['black', 'green'],
    player: [['J','♥'], ['Q','♣']], pTotal: '20 (HARD)',
    dealerUp: ['7','♦'], dealerHole: ['9','♣'], dTotal: '16 → DRAWS',
    dealerDraws: [['8','♠']],
    optimal: 'STAND', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Hard 20 vs 7 → basic strategy: <span class="hl">STAND</span>.',
    verdict: '<span class="good">Correct play.</span> Bet sizing still shows <span class="hl">zero correlation with count</span> (r = 0.04) → not an advantage player.',
    result: 'WIN', payout: 125, resultText: 'DEALER BUSTS 24 — PLAYER WINS $125',
    chipLabel: '20v7', ops: [74, '6/6', 107], skill: { score: 56, grade: 'C−', adh: '31%', edge: '2.3%', ap: '2.1%', avg: '$118' }
  },
];

async function runScene1() {
  showScene(1);
  /* reset */
  ['cardLayer','chipLayer','cvLayer','floatLayer','eventLog','handChips'].forEach(id => $(id).innerHTML = '');
  $('strategyBody').innerHTML = 'Awaiting hand…';
  runningCount = 2; decksLeft = 4.5; sessionHands = 43;
  clockSec = 21 * 3600 + 14 * 60 + 32;
  $('hudHands').textContent = 'Session hands: 43';
  setSkill({ score: 63, grade: 'C', adh: '35%', edge: '1.9%', ap: '5.2%', avg: '$104' });
  setOps(68, '5/6', 101);
  houseNet = 360;
  updateSession({ edge: '1.9%', avg: '$104' }, [68]);
  updateCountHud();
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (!paused) { clockSec++; $('hudClock').textContent = fmtClock(clockSec); } }, 350);

  await titleCard('PHASE 01 / 06', 'Computer Vision Capture',
    'One overhead camera per table on the Fontainebleau Las Vegas casino floor. Every card, chip, gesture and payout — detected, classified and scored in real time. No pit clipboard. No guesswork.');

  /* lock onto the scene */
  logEvent('POSE', 'Dealer skeleton locked · conf 99.1%');
  cvBox(38, 2, 24, 14, 'DEALER · STAFF #221 · 99.1%', 'roi');
  await sleep(800);
  logEvent('POSE', 'Player seat 5 occupied · re-ID match');
  cvBox(34, 78, 32, 19, 'PLAYER #4187 · SEAT 5 · 98.7%', 'roi');
  await sleep(800);
  logEvent('FACE', 'Identity: Fontainebleau Rewards match — M. Torres (SILVER)', '');
  logEvent('SYNC', 'RFID bet data linked — wagers cross-validated', 'eval');
  cvBox(42.5, 55, 15, 15, 'BET ZONE · SEAT 5', 'roi');
  await sleep(1000);

  for (let i = 0; i < HANDS.length; i++) {
    mark('hand' + (i + 1));
    await playHand(HANDS[i], i);
  }

  await banner('SESSION PROFILE COMPLETE — STREAMING TO INTELLIGENCE LAYER', 'neutral', 2400);
  clearInterval(clockTimer);
}

async function playHand(h, idx) {
  const CV = $('cvLayer');
  /* keep the 3 ROI boxes (first children), clear the rest */
  while (CV.children.length > 3) CV.removeChild(CV.lastChild);
  $('cardLayer').innerHTML = '';
  $('chipLayer').innerHTML = '';

  /* --- bet detection --- */
  const stack = chipStack(46.6, 59.5, h.chips);
  await sleep(450);
  const betBox = cvBox(44.5, 55.5, 9, 12, `WAGER $${h.bet} DETECTED`);
  logEvent('CHIP', `Wager detected: $${h.bet} (${h.chips.length} chips) seat 5`, 'ocr');
  $('strategyBody').innerHTML = `Hand #${sessionHands + 1} · wager <span class="hl">$${h.bet}</span><br>Dealing…`;
  await sleep(900);

  /* --- deal: P1, D-up, P2, D-hole --- */
  const pc1 = await dealCard(h.player[0][0], h.player[0][1], 41, 66, -7, false);
  cardBox(41, 66, `${h.player[0][0]}${h.player[0][1]}`);
  logEvent('OCR', `Card: ${h.player[0][0]}${h.player[0][1]} → player seat 5`, 'ocr');
  updateCountHud(h.player[0][0]);
  await sleep(420);

  await dealCard(h.dealerUp[0], h.dealerUp[1], 43, 16, -4, false);
  cardBox(43, 16, `${h.dealerUp[0]}${h.dealerUp[1]}`);
  logEvent('OCR', `Card: ${h.dealerUp[0]}${h.dealerUp[1]} → dealer upcard`, 'ocr');
  updateCountHud(h.dealerUp[0]);
  await sleep(420);

  const pc2 = await dealCard(h.player[1][0], h.player[1][1], 46.5, 67.5, 5, false);
  cardBox(46.5, 67.5, `${h.player[1][0]}${h.player[1][1]}`);
  logEvent('OCR', `Card: ${h.player[1][0]}${h.player[1][1]} → player seat 5`, 'ocr');
  updateCountHud(h.player[1][0]);
  await sleep(420);

  const hole = await dealCard(h.dealerHole[0], h.dealerHole[1], 48.5, 16.5, 6, true);
  logEvent('OCR', 'Card: face-down → dealer hole', 'ocr');
  await sleep(500);

  /* --- strategy engine evaluates --- */
  cvBox(39.3, 63.2, 18.5, 17.5, `PLAYER ${h.pTotal}`, 'warn');
  logEvent('EVAL', `Player ${h.pTotal} vs dealer ${h.dealerUp[0]}`, 'eval');
  $('strategyBody').innerHTML =
    `Player: <span class="hl">${h.pTotal}</span> · Dealer: <span class="hl">${h.dealerUp[0]}${h.dealerUp[1]}</span><br>` +
    `Optimal play: <span class="good">${h.optimal}</span><br>Watching player decision…`;
  await sleep(1400);

  /* --- player acts: animated hand gesture, then classification --- */
  await animateGesture(h.action);
  await banner(`GESTURE DETECTED: ${h.gesture}`, 'neutral', 1400);
  logEvent('POSE', `Gesture classified: ${h.action} · conf 97.8%`, '');

  if (h.hitCard) {
    const hc = await dealCard(h.hitCard[0], h.hitCard[1], 52, 69, 12, false);
    cardBox(52, 69, `${h.hitCard[0]}${h.hitCard[1]}`);
    logEvent('OCR', `Card: ${h.hitCard[0]}${h.hitCard[1]} → player seat 5`, 'ocr');
    updateCountHud(h.hitCard[0]);
    await sleep(600);
    logEvent('EVAL', `Player total ${h.hitTotal}`, 'eval');
  }

  /* --- verdict --- */
  const good = h.action === h.optimal;
  const vText = h.verdictBanner ||
    (good ? `✓ OPTIMAL PLAY — ${h.action}` : `✗ DEVIATION — PLAYED ${h.action}, OPTIMAL ${h.optimal}`);
  await banner(vText, h.verdictClass || (good ? 'good' : 'bad'), 1800);
  $('strategyBody').innerHTML = h.reason + '<br>' + h.verdict;
  logEvent('EVAL', h.verdictLog || (good ? 'Decision optimal — skill model updated' : `Deviation logged — optimal was ${h.optimal}`), good ? 'eval' : 'alert');
  addHandChip(h.chipLabel, h.chipGood !== undefined ? h.chipGood : good);
  setSkill(h.skill);
  await sleep(1100);

  /* --- dealer resolves --- */
  flipCard(hole, h.dealerHole[0], h.dealerHole[1]);
  cardBox(48.5, 16.5, `${h.dealerHole[0]}${h.dealerHole[1]}`);
  logEvent('OCR', `Hole card revealed: ${h.dealerHole[0]}${h.dealerHole[1]} — dealer ${h.dTotal}`, 'ocr');
  updateCountHud(h.dealerHole[0]);
  await sleep(700);

  for (const [r, su] of h.dealerDraws) {
    await dealCard(r, su, 53.5, 17, 9, false);
    cardBox(53.5, 17, `${r}${su}`);
    logEvent('OCR', `Card: ${r}${su} → dealer`, 'ocr');
    updateCountHud(r);
    await sleep(500);
  }

  /* --- result --- */
  const win = h.result === 'WIN';
  await banner(h.resultText, win ? 'good' : 'bad', 1700);
  floatText(48, 52, (h.payout > 0 ? '+$' : '−$') + Math.abs(h.payout), win ? '#3FB77E' : '#E0655F');
  logEvent('CHIP', win ? `Payout $${h.payout} confirmed → player` : `Wager $${Math.abs(h.payout)} collected → house`, 'ocr');
  sessionHands++;
  $('hudHands').textContent = 'Session hands: ' + sessionHands;
  houseNet += -h.payout;
  updateSession(h.skill, h.ops);
  decksLeft = Math.max(3.5, decksLeft - 0.12);
  if (h.ops) {
    setOps(...h.ops);
    logEvent('OPS', `Table pace ${h.ops[0]} hands/hr · occupancy ${h.ops[1]}`, 'eval');
  }
  await sleep(900);
}

/* ============================================================
   SCENE 1B — SURVEILLANCE & GAME PROTECTION
   ============================================================ */

let protectedTally = 0, incidentCount = 0;

function addIncident(sev, title, sub, amt) {
  incidentCount++;
  $('survInc').textContent = incidentCount;
  const el = document.createElement('div');
  el.className = 'incident ' + sev;
  el.innerHTML = `<div class="inc-head"><b>${title}</b><span>${amt || ''}</span></div><div class="inc-sub">${sub}</div>`;
  $('incidentList').prepend(el);
  el.getBoundingClientRect();
  el.classList.add('on');
}

function bumpProtected(n) {
  protectedTally += n;
  $('survTally').textContent = '$' + protectedTally.toLocaleString();
}

function clearTable() {
  const CV = $('cvLayer');
  while (CV.children.length > 2) CV.removeChild(CV.lastChild);
  $('cardLayer').innerHTML = '';
  $('chipLayer').innerHTML = '';
}

async function runSceneSurv() {
  mark('surv');
  showScene(1, 2, true);
  ['cardLayer','chipLayer','cvLayer','floatLayer'].forEach(id => $(id).innerHTML = '');
  $('incidentList').innerHTML = '';
  protectedTally = 0; incidentCount = 0;
  $('survTally').textContent = '$0';
  $('survInc').textContent = '0';
  clockSec = 21 * 3600 + 38 * 60 + 12;
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (!paused) { clockSec++; $('hudClock').textContent = fmtClock(clockSec); } }, 350);

  await titleCard('PHASE 02 / 06', 'Surveillance, Automated',
    'The same camera that rates play also protects the game. Payout errors, missed deals, past-posting and chip theft \u2014 flagged in seconds, not found in tape review. No operator watching twelve feeds; the system watches every seat at every table.');

  cvBox(38, 2, 24, 14, 'DEALER \u00b7 STAFF #221 \u00b7 99.1%', 'roi');
  cvBox(16, 26, 68, 60, 'GAME PROTECTION \u00b7 ALL SEATS', 'roi');
  await sleep(1000);

  /* --- incident 1: dealer overpay --- */
  chipStack(46.6, 59.5, ['black', 'black']);
  await sleep(400);
  cvBox(44.5, 55.5, 9, 12, 'WAGER $100 \u00b7 RFID MATCH');
  await sleep(700);
  await dealCard('10', '\u2660', 41, 66, -7, false);
  await dealCard('7', '\u2665', 43, 16, -4, false);
  await dealCard('9', '\u2666', 46.5, 67.5, 5, false);
  const hole1 = await dealCard('10', '\u2663', 48.5, 16.5, 6, true);
  await sleep(600);
  flipCard(hole1, '10', '\u2663');
  await banner('PLAYER 19 BEATS DEALER 17 \u2014 PAYOUT DUE: $100', 'neutral', 1600);
  chipStack(43.5, 56, ['black', 'green', 'green']);
  await sleep(700);
  cvBox(41.5, 52, 8.5, 12, 'PAYOUT $150 \u00b7 EXPECTED $100', 'warn');
  await sleep(900);
  await banner('DEALER OVERPAY \u2014 $50 VARIANCE \u00b7 PIT NOTIFIED', 'bad', 2200);
  addIncident('warn', 'Dealer overpay \u2014 seat 3', 'Paid $150 on a $100 win \u00b7 pit notified before the player left the table', '+$50');
  bumpProtected(50);
  await sleep(1400);

  /* --- incident 2: blackjack short-pay --- */
  clearTable();
  await sleep(500);
  chipStack(46.6, 59.5, ['black']);
  await sleep(400);
  cvBox(44.5, 55.5, 9, 12, 'WAGER $100 \u00b7 RFID MATCH');
  await sleep(600);
  await dealCard('A', '\u2660', 41, 66, -7, false);
  await dealCard('9', '\u2666', 43, 16, -4, false);
  await dealCard('K', '\u2665', 46.5, 67.5, 5, false);
  await sleep(400);
  cvBox(39.3, 63.2, 18.5, 17.5, 'BLACKJACK \u00b7 PAYS 3:2', 'warn');
  await banner('BLACKJACK \u2014 PAYOUT DUE: $150', 'neutral', 1600);
  chipStack(43.5, 56, ['black', 'green']);
  await sleep(700);
  cvBox(41.5, 52, 8.5, 12, 'PAID $125 \u00b7 DUE $150', 'warn');
  await sleep(900);
  await banner('SHORT PAY \u2014 PLAYER OWED $25 \u00b7 CORRECTED BEFORE DISPUTE', 'bad', 2200);
  addIncident('warn', 'Blackjack short-pay \u2014 seat 3', '3:2 on $100 paid as $125 \u00b7 corrected at the table \u00b7 dispute and comp giveback avoided', '+$25');
  bumpProtected(25);
  await sleep(1400);

  /* --- incident 3: wrong-denomination payout --- */
  clearTable();
  await sleep(500);
  chipStack(46.6, 59.5, ['green', 'green']);
  await sleep(400);
  cvBox(44.5, 55.5, 9, 12, 'WAGER $50 \u00b7 RFID MATCH');
  await sleep(600);
  await dealCard('10', '\u2665', 41, 66, -7, false);
  await dealCard('9', '\u2660', 43, 16, -4, false);
  await dealCard('Q', '\u2666', 46.5, 67.5, 5, false);
  await sleep(400);
  await banner('PLAYER 20 BEATS DEALER 19 \u2014 PAYOUT DUE: $50', 'neutral', 1600);
  chipStack(43.5, 56, ['black', 'green']);
  await sleep(700);
  cvBox(41.5, 52, 8.5, 12, 'PAID $125 \u00b7 DUE $50 \u00b7 WRONG DENOM', 'warn');
  await sleep(900);
  await banner('WRONG CHIP \u2014 $100 BLACK PAID AS $25 GREEN \u00b7 $75 RECOVERED', 'bad', 2200);
  addIncident('warn', 'Wrong-denomination payout \u2014 seat 5', 'Black $100 paid in place of green $25 \u00b7 $75 recovered before the rack closed', '+$75');
  bumpProtected(75);
  await sleep(1400);

  /* --- incident 4: misdeal / exposed hole card --- */
  clearTable();
  await sleep(500);
  await dealCard('K', '\u2665', 41, 66, -7, false);
  await dealCard('5', '\u2663', 43, 16, -4, false);
  await dealCard('6', '\u2660', 46.5, 67.5, 5, false);
  await dealCard('J', '\u2666', 48.5, 16.5, 6, false);   // hole dealt face-up by mistake
  await sleep(400);
  cvBox(47.9, 15.4, 5.6, 11.4, 'HOLE CARD EXPOSED', 'warn');
  await sleep(900);
  await banner('MISDEAL \u2014 HOLE CARD EXPOSED \u00b7 HAND VOIDED PER PROCEDURE', 'bad', 2200);
  addIncident('warn', 'Misdeal \u2014 exposed hole card', 'Hand voided per procedure \u00b7 dealer coaching flag logged', '');
  await sleep(1400);

  /* --- incident 5: bet pinching --- */
  clearTable();
  await sleep(500);
  const pinchBet = chipStack(46.6, 59.5, ['black', 'green', 'green']);
  await sleep(400);
  cvBox(44.5, 55.5, 9, 12, 'WAGER $150 \u00b7 RFID MATCH');
  await sleep(700);
  await dealCard('10', '\u2660', 41, 66, -7, false);
  await dealCard('10', '\u2663', 43, 16, -4, false);
  await dealCard('6', '\u2663', 46.5, 67.5, 5, false);
  await sleep(700);
  pinchBet.removeChild(pinchBet.lastChild);
  pinchBet.removeChild(pinchBet.lastChild);
  await sleep(600);
  cvBox(43.5, 52.5, 11, 15, 'BET REDUCED AFTER DEAL', 'warn');
  await sleep(900);
  await banner('PINCHING \u2014 BET REDUCED $150 \u2192 $100 AFTER DEAL \u00b7 CLIP SAVED', 'bad', 2400);
  addIncident('alert', 'Bet pinching \u2014 seat 4', '$50 removed after a hard 16 was dealt \u00b7 RFID delta confirmed \u00b7 clip saved, pit notified', '+$50');
  bumpProtected(50);
  await sleep(1400);

  /* --- incident 6: past-posting --- */
  clearTable();
  await sleep(500);
  chipStack(46.6, 59.5, ['green', 'green']);
  await sleep(400);
  cvBox(44.5, 55.5, 9, 12, 'WAGER $50 \u00b7 RFID MATCH');
  await sleep(700);
  await dealCard('A', '\u2660', 41, 66, -7, false);
  await sleep(700);
  chipStack(46.9, 57.8, ['black']);   // chip added after first card
  await sleep(600);
  cvBox(43.5, 52.5, 11, 15, 'BET CHANGED AFTER DEAL', 'warn');
  await sleep(900);
  await banner('PAST-POSTING \u2014 BET RAISED $50 \u2192 $150 AFTER FIRST CARD \u00b7 CLIP SAVED', 'bad', 2400);
  addIncident('alert', 'Past-posting \u2014 seat 4', 'Bet raised after first card \u00b7 RFID mismatch confirmed \u00b7 clip saved, pit + surveillance notified', '+$100');
  bumpProtected(100);
  await sleep(1400);

  /* --- incident 7: chip theft at the rail --- */
  mark('theft');
  clearTable();
  await sleep(500);
  const rail = chipStack(30, 68, ['black', 'black', 'black', 'green', 'green']);
  cvBox(27.5, 61, 9.5, 14, 'RAIL \u00b7 SEAT 2 \u00b7 UNATTENDED', 'roi');
  await sleep(1400);
  rail.removeChild(rail.lastChild);
  rail.removeChild(rail.lastChild);
  rail.removeChild(rail.lastChild);
  await sleep(500);
  cvBox(27.5, 61, 9.5, 14, 'CHIP REMOVAL DETECTED', 'warn');
  await sleep(800);
  await banner('CHIP THEFT \u2014 $500 REMOVED FROM SEAT 2 RAIL \u00b7 SECURITY DISPATCHED', 'bad', 2400);
  addIncident('alert', 'Chip theft \u2014 seat 2 rail', 'Neighboring player removed $500 while seat unattended \u00b7 security dispatched \u00b7 clip saved', '+$500');
  bumpProtected(500);
  await sleep(1400);

  await banner('7 INCIDENTS FLAGGED \u00b7 $800 PROTECTED \u00b7 ZERO OPERATOR HOURS', 'neutral', 2600);
  clearInterval(clockTimer);
}

/* ============================================================
   SCENE 2 — DATA AGGREGATION
   ============================================================ */

const RAW_EVENTS = [
  'evt.card { rank:<b>10♦</b>, dest:seat5, conf:.994 }',
  'evt.chip { value:<b>$100</b>, zone:bet_5, n:2 }',
  'evt.gesture { class:<b>stand</b>, conf:.978 }',
  'evt.card { rank:<b>9♠</b>, dest:dealer, conf:.992 }',
  'evt.eval { optimal:<b>hit</b>, played:stand, dev:true }',
  'evt.payout { amt:<b>-$100</b>, dir:house }',
  'evt.card { rank:<b>A♠</b>, dest:seat5, conf:.995 }',
  'evt.pose { id:<b>player_4187</b>, seat:5, dwell:+1s }',
  'evt.eval { optimal:<b>double</b>, played:stand, dev:true }',
  'evt.card { rank:<b>8♣</b>, dest:seat5, conf:.993 }',
  'evt.card { rank:<b>8♦</b>, dest:seat5, conf:.991 }',
  'evt.eval { optimal:<b>split</b>, played:hit, dev:true }',
  'evt.payout { amt:<b>+$150</b>, dir:player }',
  'evt.count { rc:<b>+3</b>, tc:+0.7, spread_r:.04 }',
  'evt.card { rank:<b>J♥</b>, dest:seat5, conf:.996 }',
  'evt.eval { optimal:<b>stand</b>, played:stand, dev:false }',
  'evt.chip { value:<b>$125</b>, zone:bet_5, n:2 }',
  'evt.session { hands:<b>47</b>, dur:01:12:44 }',
];

const PROFILE_FIELDS = [
  ['PLAYER ID', '#4187', ''],
  ['CLUB LEVEL', 'SILVER', 'sapphire'],
  ['ZONE', 'PIT 3', ''],
  ['BANK', 'BJ-BANK-2', ''],
  ['ASSET', 'BJ-07', ''],
  ['STAND / SEAT', 'SEAT 5', ''],
  ['GAME TITLE', 'BLACKJACK 3:2', ''],
  ['BUY-IN', '$1,000', ''],
  ['TIME ON DEVICE', '1:12:44', ''],
  ['HANDS PLAYED', '47', ''],
  ['AVG BET', '$118', ''],
  ['NET WIN (HOUSE)', '+$285', 'good'],
  ['THEO WIN (SESSION)', '$127', 'good'],
  ['ADW (AVG DAILY WORTH)', '$412', 'good'],
  ['SKILL GRADE', 'C− (56/100)', 'warn'],
  ['STRAT ADHERENCE', '31%', 'warn'],
  ['EFFECTIVE EDGE', '2.3%', 'good'],
  ['AP PROBABILITY', '2.1%', ''],
];

const DERIVED = [
  ['Effective house edge vs this player', '2.3% (baseline 0.5%)', 92, '#3FB77E'],
  ['Theo uplift from skill errors', '+360%', 86, '#3FB77E'],
  ['Bet spread ↔ count correlation', 'r = 0.04 (none)', 8, '#7FA6D9'],
  ['Churn risk — checkout tomorrow 11:00', '42%', 42, '#C9A227'],
  ['Retention value (2 extra days)', '$824 theo', 74, '#3FB77E'],
];

async function runScene2() {
  mark('scene2');
  showScene(2, 3);
  $('rawStream').innerHTML = '';
  $('profileGrid').innerHTML = '';
  $('derivedList').innerHTML = '';
  $('pipeNote').innerHTML = '';
  $('pfName').textContent = '— — —';
  $('pfTier').textContent = 'RESOLVING IDENTITY…';
  const st = $('pfStatus'); st.textContent = 'SYNCING'; st.classList.remove('done');

  await titleCard('PHASE 03 / 06', 'Data Aggregation',
    'Every detection event streams into one unified player record — the full rating a casino currently needs three systems and a pit boss to approximate, built automatically per hand.');

  /* build empty field grid */
  const fields = PROFILE_FIELDS.map(([label]) => {
    const f = document.createElement('div');
    f.className = 'pf-field';
    f.innerHTML = `<label>${label}</label><b>—</b>`;
    $('profileGrid').appendChild(f);
    return f;
  });

  /* raw stream keeps flowing in background */
  let evIdx = 0;
  const streamTimer = setInterval(() => {
    if (paused) return;
    const row = document.createElement('div');
    row.innerHTML = `<span style="color:#2e3d4e">${String(1201 + evIdx).padStart(4,'0')}</span>  ${RAW_EVENTS[evIdx % RAW_EVENTS.length]}`;
    $('rawStream').appendChild(row);
    while ($('rawStream').children.length > 24) $('rawStream').removeChild($('rawStream').firstChild);
    evIdx++;
  }, 260);
  const myRun = runId;
  const stopStream = () => clearInterval(streamTimer);

  try {
    await sleep(900);
    $('pfName').textContent = 'Michael Torres';
    $('pfTier').textContent = 'FONTAINEBLEAU REWARDS · SILVER · #4187';

    /* fill fields one by one */
    for (let i = 0; i < fields.length; i++) {
      const [label, value, cls] = PROFILE_FIELDS[i];
      fields[i].classList.add('on');
      fields[i].querySelector('b').textContent = value;
      if (cls) fields[i].querySelector('b').className = cls;
      await sleep(330);
    }
    st.textContent = 'PROFILE COMPLETE'; st.classList.add('done');
    await sleep(500);

    /* derived metrics */
    for (const [label, val, pct, color] of DERIVED) {
      const d = document.createElement('div');
      d.className = 'derived-item';
      d.innerHTML = `<label>${label}<b>${val}</b></label><div class="dbar"><div style="background:${color}"></div></div>`;
      $('derivedList').appendChild(d);
      d.getBoundingClientRect();
      d.classList.add('on');
      d.querySelector('.dbar div').style.width = pct + '%';
      await sleep(520);
    }

    $('pipeNote').innerHTML =
      `<span class="hl">▸</span> PMS: Panorama Suite 5804, <span class="hl">checkout tomorrow 11:00</span><br>` +
      `<span class="hl">▸</span> 6 trips / 12 mo · rated play → <span class="hl">38,680 Tier Credits</span><br>` +
      `<span class="hl">▸</span> 1,320 Tier Credits short of <span class="hl">GOLD</span> (40,000)<br>` +
      `<span class="hl">▸</span> Handing off to intelligence layer…`;
    await sleep(2800);
  } finally {
    if (myRun === runId) stopStream(); else stopStream();
  }
}

/* ============================================================
   SCENE 3 — INTELLIGENCE LAYER + HOST DECISION
   ============================================================ */

const INTEL_COMP = {
  mark: 'scene3', tab: 4,
  title: ['PHASE 04 / 06', 'Intelligence Layer → Host',
    'The engine prices every action the casino could take — gross theo gained, comp cost, net expected value — and pushes the most profitable move to the host\'s phone while the player is still in the seat.'],
  inputHead: 'INPUT · PLAYER #4187',
  inputLines: [
    'player_id      : <b>#4187 — M. Torres</b>',
    'tier           : <b>SILVER</b> · Fontainebleau Rewards',
    'tier_credits   : <b>38,680</b> · <span class="warn">1,320 short of GOLD</span>',
    'live_position  : <b>PIT 3 · BJ-07 · SEAT 5</b>',
    'skill_grade    : <span class="warn">C− (adherence 31%)</span>',
    'effective_edge : <span class="good">2.3%</span> vs 0.5% baseline',
    'adw            : <span class="good">$412 / day</span>',
    'ap_probability : <span class="good">2.1% — cleared</span>',
    'room_status    : Panorama Ste 5804 · <span class="bad">CHECKOUT 11:00</span>',
    'churn_risk     : <span class="warn">42%</span>',
    'objective      : <b>maximize retained theo</b>',
  ],
  sims: 25000,
  readouts: [
    ['P(HOUSE PROFITS / DAY)', '97.7%', 'good'],
    ['PLAYER WIN PROB / HAND', '41.2%', 'warn'],
    ['THEO IF RETAINED +2 DAYS', '+$824', 'good'],
    ['DECISION LATENCY', '212 ms', 'cyan'],
  ],
  actionsHead: 'ACTION EVALUATION — NET EV = GROSS THEO GAIN − COMP COST',
  actions: [
    { name: 'Extend suite comp +2 nights — Panorama Suite', sub: '0.91 accept × 0.68 stay × $1,086 wknd theo',
      gain: '+$672', cost: '−$260', ev: '+$412', pct: 100, ok: true, selected: true },
    { name: 'Award 1,320 Tier Credits → GOLD now', sub: '0.44 return-trip lift × $1,540 avg trip theo',
      gain: '+$678', cost: '−$360', ev: '+$318', pct: 77, ok: true },
    { name: 'BleauLive Theater tickets — Saturday', sub: '0.74 accept × $605 extra-session theo',
      gain: '+$448', cost: '−$150', ev: '+$298', pct: 72, ok: true },
    { name: 'Dinner for two — Mother Wolf', sub: '0.88 accept × $245 late-night play after dinner',
      gain: '+$216', cost: '−$120', ev: '+$96', pct: 23, ok: true },
    { name: '$100 free slot play', sub: '$185 reinvested play · cannibalizes table time',
      gain: '+$185', cost: '−$100', ev: '+$85', pct: 20, ok: true },
    { name: 'No action', sub: '0.42 churn × $824 remaining-trip theo lost',
      gain: '$0', cost: '$0', ev: '−$346', pct: 0, ok: false },
  ],
  traceHead: 'DECISION TRACE — SUITE COMP EXTENSION',
  traceLines: [
    'P(accept offer) <b>0.91</b> × P(stays 2 nights) <b>0.68</b> = <b>0.62</b> conversion',
    '× 2-day theo <b>$824</b> × weekend uplift <b>1.32</b> = <b class="good">+$672 expected gross</b>',
    '− suite cost 2 nights × $130 = <b class="bad">−$260</b>',
    '= <b class="good">NET +$412</b> · ROI <b>1.6×</b> · beats next-best action by <b>$94</b>',
  ],
  phoneMark: 'phone',
  notifClass: 'notif priority',
  notifHTML: `
    <div class="notif-head">⚡ RECOMMENDED ACTION <span class="when">now</span></div>
    <div class="notif-title">Michael Torres — Silver</div>
    <div class="notif-body">
      At <b>BJ-07, Pit 3</b> right now · down $285 tonight.<br>
      Offer: <b>extend suite comp 2 nights</b> (Panorama Suite 5804).
    </div>
    <div class="notif-why">
      <b>WHY:</b> Skill grade C− → edge 2.3%. ADW $412/day.
      Checkout 11:00 tomorrow. $672 expected theo − $260 comp
      = <b>net +$412 (1.6× ROI)</b>.
      Hook: <b>1,320 Tier Credits from Gold</b>.
    </div>
    <div class="notif-actions">
      <button class="primary">Approve</button>
      <button>Adjust</button>
      <button>Dismiss</button>
    </div>`,
  toasts: [
    '<b>✓ PMS</b> — Panorama Suite 5804 extended through Thursday',
    '<b>✓ CRM</b> — offer sent via Fontainebleau Rewards app · read 21:29',
    '<b>✓ LEDGER</b> — comp logged · $260 against $824 projected theo',
  ],
};

const INTEL_AP = {
  mark: 'apdecision', tab: 5,
  title: ['PHASE 05 / 06', 'Game Protection Decision',
    'Same engine, opposite objective: when the vision layer confirms an advantage player, the system prices every defensive option and protects the house before the next shoe.'],
  inputHead: 'INPUT · PLAYER #2291 — GAME PROTECTION',
  inputLines: [
    'player_id      : <b>#2291 — J. Chen</b>',
    'tier           : <b>BLEAU</b> · account 11 days old',
    'live_position  : <b>PIT 3 · BJ-07 · SEAT 5</b>',
    'buy_in         : <b>$5,000 cash</b> · auto-logged (Title 31)',
    'skill_grade    : <span class="bad">A+ (adherence 100%)</span>',
    'bet_spread     : <span class="bad">12:1 · count corr r = 0.96</span>',
    'effective_edge : <span class="bad">−1.1% (player favored)</span>',
    'ap_probability : <span class="bad">94.2% — CONFIRMED</span>',
    'exposure       : <span class="bad">$8,200 / trip</span>',
    'objective      : <b>minimize loss · retain non-AP play</b>',
  ],
  sims: 28400,
  readouts: [
    ['P(ADVANTAGE PLAY)', '94.2%', 'bad'],
    ['HOUSE EDGE VS PLAYER', '−1.1%', 'bad'],
    ['EXPOSURE / TRIP', '−$8,200', 'bad'],
    ['DECISION LATENCY', '190 ms', 'cyan'],
  ],
  actionsHead: 'ACTION EVALUATION — NET EV = LOSS AVOIDED − REVENUE GIVEN UP',
  actions: [
    { name: 'Flat-bet request — cap at $50', sub: 'kills 12:1 spread · keeps his −EV flat play + other games',
      gain: '+$7,400', cost: '−$0', ev: '+$7,400', pct: 100, ok: true, selected: true },
    { name: 'Full back-off — no more blackjack', sub: 'ends exposure · loses his poker/baccarat action + PR risk',
      gain: '+$8,200', cost: '−$1,600', ev: '+$6,600', pct: 89, ok: true },
    { name: 'No mid-shoe entry (block back-counting)', sub: 'halves his edge windows · he adapts within days',
      gain: '+$3,900', cost: '−$0', ev: '+$3,900', pct: 53, ok: true },
    { name: 'Shuffle earlier (cut 1.5 decks)', sub: 'reduces count reliability · slows table 9% for all seats',
      gain: '+$2,800', cost: '−$900', ev: '+$1,900', pct: 26, ok: true },
    { name: 'No action', sub: '1.4% player edge × $300 avg high-count bet, 3-day trip',
      gain: '$0', cost: '$0', ev: '−$8,200', pct: 0, ok: false },
  ],
  traceHead: 'DECISION TRACE — FLAT-BET REQUEST',
  traceLines: [
    'Hi-Lo correlation <b>r = 0.96</b> · bet spread <b>12:1</b> ($25 → $300 at TC ≥ +3)',
    'player edge at high counts <b>1.4%</b> × $300 × 42 hands/hr × 4.5 hr × 3 days = <b class="bad">−$8,200 exposure</b>',
    'flat-bet cap removes spread → <b class="good">+$7,400 protected (91%)</b> · zero comp cost',
    '= <b class="good">NET +$7,400</b> · he keeps playing flat (house edge returns) · no confrontation',
  ],
  phoneMark: 'apphone',
  notifClass: 'notif priority alert',
  notifHTML: `
    <div class="notif-head">⚠ GAME PROTECTION <span class="when">now</span></div>
    <div class="notif-title">J. Chen — Bleau · AP confirmed 94%</div>
    <div class="notif-body">
      At <b>BJ-07, Pit 3</b> right now · spread $25→$300 with the count.<br>
      Action: <b>flat-bet request, $50 max</b> — pit supervisor to deliver.
    </div>
    <div class="notif-why">
      <b>WHY:</b> Perfect play + 12:1 spread (r = 0.96) = counting.
      Exposure $8,200/trip. Flat cap protects <b>+$7,400</b>
      with zero comp cost and no confrontation.
    </div>
    <div class="notif-actions">
      <button class="primary">Approve</button>
      <button>Adjust</button>
      <button>Dismiss</button>
    </div>`,
  toasts: [
    '<b>✓ PIT</b> — supervisor P. Ruiz dispatched to BJ-07',
    '<b>✓ SURVEILLANCE</b> — #2291 flagged · profile shared cross-property',
    '<b>✓ CRM</b> — comp offers & mailers suspended for #2291',
  ],
};

async function runIntel(cfg) {
  mark(cfg.mark);
  showScene(3, cfg.tab);
  $('intelInput').innerHTML = '';
  $('coreReadouts').innerHTML = '';
  $('actionList').innerHTML = '';
  $('phoneFeed').innerHTML = '';
  $('decisionTrace').innerHTML = '';
  $('decisionTrace').classList.remove('on');
  $('actionsHead').style.opacity = 0;
  $('coreSims').textContent = '0';
  $('coreRing').classList.remove('done');
  $('intelInputHead').textContent = cfg.inputHead;
  $('actionsHead').textContent = cfg.actionsHead;

  await titleCard(...cfg.title);

  /* input lines */
  for (const line of cfg.inputLines) {
    const d = document.createElement('div');
    d.innerHTML = line;
    d.style.animationDelay = '0s';
    $('intelInput').appendChild(d);
    await sleep(210);
  }

  /* simulation counter */
  const target = cfg.sims;
  let sims = 0;
  while (sims < target) {
    if (!paused) {
      sims = Math.min(target, sims + 700 + Math.floor(Math.random() * 900));
      $('coreSims').textContent = sims.toLocaleString();
    }
    await sleep(60);
  }
  $('coreRing').classList.add('done');

  /* readouts */
  for (const [label, val, cls] of cfg.readouts) {
    const r = document.createElement('div');
    r.className = 'readout';
    r.innerHTML = `<label>${label}</label><b class="${cls}">${val}</b>`;
    $('coreReadouts').appendChild(r);
    await sleep(320);
  }
  await sleep(400);

  /* action evaluation */
  if (cfg.tab === 4) mark('decision');
  $('actionsHead').style.opacity = 1;
  const rows = [];
  for (const a of cfg.actions) {
    const row = document.createElement('div');
    row.className = 'action-item';
    row.innerHTML =
      `<div class="action-name">${a.name}<small>${a.sub}</small></div>` +
      `<div class="action-col"><label>GROSS</label><b class="g">${a.gain}</b></div>` +
      `<div class="action-col"><label>COST</label><b class="c">${a.cost}</b></div>` +
      `<div class="action-evbar"><div></div></div>` +
      `<div class="action-ev ${a.ok ? (a.pct === 0 ? 'zero' : 'pos') : 'neg'}"><label>NET EV</label>${a.ev}</div>`;
    $('actionList').appendChild(row);
    row.getBoundingClientRect();
    row.classList.add('on');
    row.querySelector('.action-evbar div').style.width = Math.max(a.pct, 3) + '%';
    rows.push(row);
    await sleep(480);
  }
  await sleep(700);

  /* select winner */
  rows.forEach((row, i) => {
    if (cfg.actions[i].selected) {
      row.classList.add('selected');
      const badge = document.createElement('div');
      badge.className = 'action-badge';
      badge.textContent = 'SELECTED';
      row.appendChild(badge);
    } else row.classList.add('rejected');
  });
  await sleep(900);

  /* decision trace — show the math behind the winner */
  const trace = $('decisionTrace');
  trace.classList.add('on');
  trace.innerHTML = `<div class="trace-head">${cfg.traceHead}</div>`;
  for (const line of cfg.traceLines) {
    const d = document.createElement('div');
    d.className = 'trace-line';
    d.innerHTML = line;
    trace.appendChild(d);
    await sleep(650);
  }
  await sleep(1200);

  /* push to phone */
  mark(cfg.phoneMark);
  const notif = document.createElement('div');
  notif.className = cfg.notifClass;
  notif.innerHTML = cfg.notifHTML;
  $('phoneFeed').appendChild(notif);
  notif.getBoundingClientRect();
  notif.classList.add('on');
  await sleep(2600);

  /* host approves */
  const btn = notif.querySelector('.primary');
  btn.classList.add('pressed');
  btn.textContent = '✓ Approved';
  await sleep(900);

  for (const t of cfg.toasts) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = t;
    $('phoneFeed').appendChild(el);
    el.getBoundingClientRect();
    el.classList.add('on');
    await sleep(950);
  }
  await sleep(2600);
}

/* ============================================================
   SCENARIO 2 — THE ADVANTAGE PLAYER (reuses the table scene)
   ============================================================ */

const AP_HANDS = [
  {
    bet: 25, chips: ['red'],
    player: [['9','♣'], ['2','♦']], pTotal: '11 (HARD)',
    dealerUp: ['6','♠'], dealerHole: ['9','♦'], dTotal: '15 → DRAWS',
    dealerDraws: [['J','♣']],
    optimal: 'DOUBLE', action: 'DOUBLE', gesture: 'CHIP PUSH — DOUBLE DOWN',
    hitCard: ['K','♥'], hitTotal: '21',
    reason: '11 vs 6 → basic strategy: <span class="hl">DOUBLE DOWN</span>.',
    verdict: '<span class="good">Textbook.</span> Minimum bet while the count is neutral (TC +0.4). Watching bet sizing…',
    result: 'WIN', payout: 50, resultText: 'DEALER BUSTS 25 — PLAYER WINS $50 (DOUBLED)',
    chipLabel: '11v6', ops: [78, '3/6', 108],
    skill: { score: 78, grade: 'B+', adh: '100%', edge: '0.3%', ap: '34%', avg: '$25',
             adhCls: 'ok', apCls: 'warn' }
  },
  {
    bet: 75, chips: ['green', 'green', 'green'],
    player: [['A','♥'], ['8','♠']], pTotal: 'SOFT 19',
    dealerUp: ['5','♣'], dealerHole: ['10','♦'], dTotal: '15 → DRAWS',
    dealerDraws: [['9','♠']],
    optimal: 'STAND', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Soft 19 vs 5 → basic strategy: <span class="hl">STAND</span>.',
    verdict: '<span class="good">Perfect again.</span> Bet tripled to $75 as the true count climbed to <span class="hl">+2.1</span>. Spread correlation rising: <span class="warn">r = 0.81</span>.',
    result: 'WIN', payout: 75, resultText: 'DEALER BUSTS 24 — PLAYER WINS $75',
    chipLabel: 'A8v5', ops: [78, '3/6', 108],
    skill: { score: 86, grade: 'A−', adh: '100%', edge: '−0.2%', ap: '71%', avg: '$42',
             adhCls: 'ok', edgeCls: 'warn', apCls: 'warn' }
  },
  {
    bet: 300, chips: ['black', 'black', 'black'],
    player: [['10','♦'], ['6','♥']], pTotal: '16 (HARD)',
    dealerUp: ['10','♣'], dealerHole: ['6','♦'], dTotal: '16 → DRAWS',
    dealerDraws: [['10','♥']],
    optimal: 'HIT', action: 'STAND', gesture: 'HAND WAVE — STAND',
    verdictBanner: '⚠ HI-LO INDEX PLAY — 16v10 STAND AT TC +4.2',
    verdictClass: 'bad',
    verdictLog: 'Deviation matches Hi-Lo index — counting signature',
    chipGood: false,
    reason: '16 vs 10 → basic strategy says HIT. But at <span class="hl">TC ≥ 0</span> the counting index says <span class="bad">STAND</span>.',
    verdict: 'Bet jumped <span class="bad">$25 → $300</span> exactly as TC hit <span class="bad">+4.2</span>. This deviation is only correct for a counter. Spread corr: <span class="bad">r = 0.96</span>.',
    result: 'WIN', payout: 300, resultText: 'DEALER BUSTS 26 — PLAYER WINS $300',
    chipLabel: '16vT idx', ops: [79, '3/6', 108],
    skill: { score: 92, grade: 'A+', adh: '100%*', edge: '−1.1%', ap: '94.2%', avg: '$133',
             adhCls: 'ok', edgeCls: 'warn', apCls: 'warn' }
  },
];

async function runSceneAP() {
  mark('ap');
  showScene(1, 5);
  /* reset the table for a new session */
  ['cardLayer','chipLayer','cvLayer','floatLayer','eventLog','handChips'].forEach(id => $(id).innerHTML = '');
  $('strategyBody').innerHTML = 'Awaiting hand…';
  runningCount = 3; decksLeft = 3.8; sessionHands = 12;
  clockSec = 22 * 3600 + 41 * 60 + 8;
  $('hudHands').textContent = 'Session hands: 12';
  setSkill({ score: 74, grade: 'B', adh: '100%', ap: '18%', avg: '$25', edge: '0.4%', adhCls: 'ok' });
  setOps(78, '3/6', 108);
  houseNet = 75;
  updateSession({ edge: '0.4%', avg: '$25' }, [78]);
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (!paused) { clockSec++; $('hudClock').textContent = fmtClock(clockSec); } }, 350);

  await titleCard('PHASE 05 / 06', 'The Advantage Player',
    'Same table, 10:41 PM. A new face buys in for $5,000 and plays flawless blackjack. The system that comps weak players is also the one that catches sharp ones.');

  logEvent('POSE', 'Dealer skeleton locked · conf 99.1%');
  cvBox(38, 2, 24, 14, 'DEALER · STAFF #221 · 99.1%', 'roi');
  await sleep(700);
  logEvent('POSE', 'Player seat 5 occupied · new session opened');
  cvBox(34, 78, 32, 19, 'PLAYER #2291 · SEAT 5 · 97.9%', 'roi');
  await sleep(700);
  logEvent('FACE', 'Identity: J. Chen — BLEAU · account 11 days old', 'alert');
  logEvent('CHIP', 'Buy-in $5,000 cash · auto-logged (Title 31)', 'ocr');
  cvBox(42.5, 55, 15, 15, 'BET ZONE · SEAT 5', 'roi');
  await sleep(1000);

  for (const h of AP_HANDS) await playHand(h, 0);

  await banner('ADVANTAGE PLAY CONFIRMED 94.2% — ROUTING TO GAME PROTECTION', 'bad', 2600);
  clearInterval(clockTimer);
}

/* ============================================================
   SCENE 4 — FLOOR ZOOM-OUT
   ============================================================ */

const FLOOR_TABLES = [
  ['BJ-05','BLACKJACK',310,4], ['BJ-07','BLACKJACK',412,5], ['BJ-09','BLACKJACK',280,3], ['BJ-11','BLACKJACK',195,4],
  ['BAC-02','BACCARAT',1240,6], ['BAC-05','BACCARAT',890,4], ['BAC-12','BACCARAT',2150,7], ['ROU-01','ROULETTE',340,6],
  ['ROU-03','ROULETTE',410,8], ['CR-01','CRAPS',620,9], ['CR-02','CRAPS',540,7], ['PAI-02','PAI GOW',290,5],
  ['PAI-03','PAI GOW',185,4], ['UTH-01','ULT. HOLD\u2019EM',225,5], ['BJ-14','BLACKJACK',330,5], ['MB-01','MINI BAC',465,6],
];

const FLOOR_EVENTS = [
  ['BJ-07', 'ok',    'Comp approved — M. Torres · +$412 EV',
   '21:29 · <b>BJ-07</b> — Suite comp approved · <b class="good">+$412 EV</b>'],
  ['BAC-12', 'warn', 'Buy-in $18,000 — auto-logged (Title 31)',
   '21:44 · <b>BAC-12</b> — $18K buy-in auto-logged · <b class="warn">Title 31</b>'],
  ['ROU-03', 'ok',   'Rating opened — #5512 (GOLD)',
   '22:03 · <b>ROU-03</b> — New rated session · #5512 (Gold)'],
  ['BJ-11', 'warn',  'Dealer pace −12% — coaching flag',
   '22:18 · <b>BJ-11</b> — Pace 61 hands/hr (−12%) · <b class="warn">ops flag</b>'],
  ['PAI-02', 'ok',   'Host dispatched — birthday recognition',
   '22:27 · <b>PAI-02</b> — Host dispatched · #8834 birthday · <b class="good">+$95 EV</b>'],
  ['BJ-14', 'warn',  'Dealer overpay $75 — recovered',
   '22:41 · <b>BJ-14</b> — Payout variance caught · <b class="good">+$75 recovered</b>'],
  ['BJ-07', 'alert', 'AP flat-bet enforced — $7.4K protected',
   '22:56 · <b>BJ-07</b> — Flat-bet enforced · #2291 · <b class="good">$7.4K protected</b>'],
];

async function runSceneFloor() {
  mark('floor');
  showScene(4, 6);
  $('floorGrid').innerHTML = '';
  $('queueFeed').innerHTML = '';
  $('floorStats').innerHTML = '';

  await titleCard('PHASE 06 / 06', 'The Whole Floor, One Brain',
    'Every table, every seat, every decision — the same pipeline running property-wide, feeding one host queue. One table was the demo. This is the product.');

  /* stats bar */
  const stats = [
    ['TABLES LIVE', '128'], ['RATED SESSIONS', '61'], ['THEO TODAY', '$438K'],
    ['LEAKAGE RECOVERED', '$23K'], ['DECISIONS TODAY', '217'], ['COMP ROI', '3.2×'],
  ];
  for (const [label, val] of stats) {
    const el = document.createElement('div');
    el.className = 'floor-stat';
    el.innerHTML = `<label>${label}</label><b>${val}</b>`;
    $('floorStats').appendChild(el);
    await sleep(200);
  }

  /* table grid */
  const cards = {};
  for (const [id, game, theo, occ] of FLOOR_TABLES) {
    const el = document.createElement('div');
    el.className = 'floor-table';
    const dots = Array.from({length: 9}, (_, i) =>
      `<span class="occ-dot${i < occ ? ' on' : ''}"></span>`).slice(0, game === 'CRAPS' ? 9 : 7).join('');
    el.innerHTML =
      `<div class="ft-head"><b>${id}</b><span>${game}</span></div>` +
      `<div class="ft-theo">$${theo}<small>/HR THEO</small></div>` +
      `<div class="ft-occ">${dots}</div>` +
      `<div class="ft-msg"></div>`;
    $('floorGrid').appendChild(el);
    cards[id] = el;
    await sleep(90);
  }
  await sleep(600);

  /* events light up tables + host queue */
  for (const [id, cls, msg, queueHTML] of FLOOR_EVENTS) {
    const card = cards[id];
    card.classList.remove('flash-ok','flash-warn','flash-alert');
    card.getBoundingClientRect();
    card.classList.add('flash-' + cls);
    card.querySelector('.ft-msg').innerHTML = msg;
    const q = document.createElement('div');
    q.className = 'queue-item q-' + cls;
    q.innerHTML = queueHTML;
    $('queueFeed').prepend(q);
    q.getBoundingClientRect();
    q.classList.add('on');
    await sleep(1900);
  }
  await sleep(2400);
}

/* ---------------- go (optional ?t=SECONDS deep link) ---------------- */
const startAtSec = new URLSearchParams(location.search).get('t');
startDemo(startAtSec ? +startAtSec * 1000 : 0);
