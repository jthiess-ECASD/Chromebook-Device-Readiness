/*
  TECHNICIAN PASSWORD: shared, salted SHA-256 hash
  To rotate the password:
    1. Open this app in a browser, then in the console run:
         await cdrHashPassword('new password here')
    2. Paste the returned hex string in as TECH_PASSWORD_HASH below.
  Current TECH_PASSWORD_HASH is for the password "testing".

  NOTE TO JACK AFTER THIS IS READY TO GO: REMOVE THIS COMMENT OR I WILL CRY
*/

const PASSWORD_SALT = 'cdr-ecasd-v1';
const TECH_PASSWORD_HASH = '4c1de90dfc3d8f809b2bc8a84e2c110482e3edf5d419f0dc5c7530ae43544db0';
const TECH_KEY = 'cdr.tech';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

const TESTS = [
  { id: 'microphone',  title: 'Microphone' },
  { id: 'speaker',     title: 'Speaker' },
  { id: 'camera',      title: 'Camera' },
  { id: 'touchscreen', title: 'Touchscreen' },
  { id: 'touchpad',    title: 'Touchpad' },
  { id: 'keyboard',    title: 'Keyboard' },
  { id: 'battery',     title: 'Battery' },
  { id: 'physical',    title: 'Physical Inspection' },
];

const STORAGE_KEY = 'cdr.results';

//  Test Results/States
const state = {
  results: loadResults(),    // { [testId]: { status, ts } }
  current: null,
  cleanup: null,
  tech: loadTech(),          // { username, ts } | null — for analytics reporting
};

function blankResults() {
  const obj = {};
  TESTS.forEach(t => { obj[t.id] = { status: null, ts: 0, comments: '' }; });
  return obj;
}
function loadResults() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return blankResults();
    const parsed = JSON.parse(raw);
    const merged = blankResults();
    TESTS.forEach(t => {
      if (parsed[t.id]) merged[t.id] = { ...merged[t.id], ...parsed[t.id] };
    });
    return merged;
  } catch {
    return blankResults();
  }
}
function saveSession() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.results));
}

//  View routing
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

//  Hashing / Auth
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function hashPassword(pw) {
  return sha256Hex(PASSWORD_SALT + '::' + pw);
}
//  Exposed so IT can compute a new hash to paste into TECH_PASSWORD_HASH.
window.cdrHashPassword = hashPassword;

//  Constant-time compare so wrong passwords don't leak length info via timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

//  Technician session (for analytics reporting)
function loadTech() {
  try {
    const raw = sessionStorage.getItem(TECH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.username === 'string' && parsed.username) return parsed;
    return null;
  } catch {
    return null;
  }
}
function setTech(username) {
  state.tech = { username, ts: Date.now() };
  sessionStorage.setItem(TECH_KEY, JSON.stringify(state.tech));
  renderTechBadge();
}
function clearTech() {
  state.tech = null;
  sessionStorage.removeItem(TECH_KEY);
  renderTechBadge();
}
function renderTechBadge() {
  const badge = document.getElementById('tech-badge');
  const nameEl = document.getElementById('tech-name');
  if (!badge || !nameEl) return;
  if (state.tech) {
    nameEl.textContent = state.tech.username;
    badge.hidden = false;
  } else {
    nameEl.textContent = '';
    badge.hidden = true;
  }
  const commentsSection = document.getElementById('test-comments');
  if (commentsSection) commentsSection.hidden = !state.tech;
}

//  Technician login modal (Ctrl+Shift+L)
function setupTechModal() {
  const modal = document.getElementById('tech-modal');
  const form = document.getElementById('tech-form');
  const usernameInput = document.getElementById('tech-username');
  const passwordInput = document.getElementById('tech-password');
  const err = document.getElementById('tech-error');
  const cancelBtn = document.getElementById('tech-cancel');
  let attempts = 0;
  let lockedUntil = 0;

  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
  function open() {
    err.hidden = true;
    usernameInput.value = state.tech?.username || '';
    passwordInput.value = '';
    modal.hidden = false;
    setTimeout(() => (state.tech ? passwordInput : usernameInput).focus(), 50);
  }
  function close() {
    modal.hidden = true;
    err.hidden = true;
    passwordInput.value = '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now < lockedUntil) {
      showError(`Too many attempts. Try again in ${Math.ceil((lockedUntil - now)/1000)}s.`);
      return;
    }
    const username = usernameInput.value.trim();
    if (!username) { showError('Username is required.'); usernameInput.focus(); return; }
    const submitted = passwordInput.value;
    //  Small delay on every attempt — invisible to a human, costly to a script.
    await new Promise(r => setTimeout(r, 250));
    const hash = await hashPassword(submitted);
    if (safeEqual(hash, TECH_PASSWORD_HASH)) {
      attempts = 0;
      setTech(username);
      close();
    } else {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        lockedUntil = now + LOCKOUT_MS;
        attempts = 0;
        showError(`Too many attempts. Try again in ${Math.ceil(LOCKOUT_MS/1000)}s.`);
      } else {
        showError('Incorrect password.');
      }
      passwordInput.select();
    }
  });

  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') { e.preventDefault(); close(); }
  });

  return { open, close };
}

//  Handle cycling through tests
function firstIncompleteIndex() {
  const idx = TESTS.findIndex(t => !state.results[t.id].status);
  return idx === -1 ? 0 : idx;
}
function startSequence() {
  openTest(TESTS[firstIncompleteIndex()].id);
}
function advanceFromCurrent() {
  const idx = TESTS.findIndex(t => t.id === state.current);
  cleanupCurrent();
  if (idx < 0 || idx >= TESTS.length - 1) {
    state.current = null;
    renderReport();
    showView('view-report');
  } else {
    openTest(TESTS[idx + 1].id);
  }
}
function cleanupCurrent() {
  persistCurrentComments();
  if (typeof state.cleanup === 'function') {
    try { state.cleanup(); } catch (e) { console.warn(e); }
  }
  state.cleanup = null;
}

//  Dashboard
function enterDashboard() {
  showView('view-dashboard');
  renderDashboard();
  renderDeviceSummary();
}

function renderDashboard() {
  const grid = document.getElementById('test-grid');
  grid.innerHTML = '';
  TESTS.forEach(t => {
    const r = state.results[t.id];
    const card = document.createElement('div');
    card.className = 'card' + (r.status ? ' ' + r.status : '');
    card.innerHTML = `
      <div class="card-title">${t.title}</div>
      <span class="card-status ${r.status || ''}">${statusLabel(r.status)}</span>
    `;
    card.addEventListener('click', () => openTest(t.id));
    grid.appendChild(card);
  });
  updateProgress();
}

function statusLabel(s) {
  if (s === 'pass') return '✓ Pass';
  if (s === 'fail') return '✗ Fail';
  return 'Not tested';
}

function updateProgress() {
  const total = TESTS.length;
  const done = TESTS.filter(t => state.results[t.id].status).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${done} of ${total} complete`;
}

async function renderDeviceSummary() {
  const el = document.getElementById('device-summary');
  const ua = navigator.userAgent;
  const isCros = /CrOS/.test(ua);
  const platform = isCros ? 'Chrome OS' : (navigator.platform || 'Unknown');
  const cores = navigator.hardwareConcurrency || '?';
  const mem = navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '?';
  el.textContent = `${platform} · ${cores} cores · ${mem} RAM · ${screen.width}×${screen.height}`;
}

//  Test runner
function openTest(id) {
  cleanupCurrent();
  state.current = id;
  const test = TESTS.find(t => t.id === id);
  const idx = TESTS.findIndex(t => t.id === id);
  document.getElementById('test-title').textContent = test.title;
  document.getElementById('test-step').textContent = `Step ${idx + 1} of ${TESTS.length}`;
  const nextBtn = document.getElementById('btn-next');
  nextBtn.textContent = idx === TESTS.length - 1 ? 'Finish →' : 'Next →';
  const body = document.getElementById('test-body');
  body.innerHTML = '';
  body.classList.toggle('touchscreen-mode', id === 'touchscreen');
  document.getElementById('test-instructions').textContent = '';
  const commentsInput = document.getElementById('test-comments-input');
  commentsInput.value = state.results[id].comments || '';
  showView('view-test');
  if (typeof TEST_HANDLERS[id] === 'function') {
    state.cleanup = TEST_HANDLERS[id](body) || null;
  }
}

function persistCurrentComments() {
  if (!state.current) return;
  const input = document.getElementById('test-comments-input');
  const value = (input.value || '').trim();
  if (state.results[state.current].comments !== value) {
    state.results[state.current].comments = value;
    saveSession();
  }
}

function leaveToDashboard() {
  cleanupCurrent();
  state.current = null;
  enterDashboard();
}

function markCurrent(status) {
  if (!state.current) return;
  persistCurrentComments();
  const existing = state.results[state.current] || {};
  state.results[state.current] = { ...existing, status, ts: Date.now() };
  saveSession();
  advanceFromCurrent();
}

/*
  Individual test handlers
  Each returns an optional cleanup function (called on back / pass / fail).
*/
const TEST_HANDLERS = {};

//  Microphone
TEST_HANDLERS.microphone = function (body) {
  setInstructions('Click Record, speak for a few seconds, then play it back. If you can hear yourself clearly, mark Pass.');

  body.innerHTML = `
    <canvas class="mic-vis" id="mic-vis" width="840" height="240"></canvas>
    <div class="mic-time" id="mic-time">00:00</div>
    <div class="mic-controls">
      <button class="btn btn-primary" id="mic-record">● Record</button>
      <button class="btn" id="mic-stop" disabled>■ Stop</button>
      <button class="btn" id="mic-play" disabled>▶ Play</button>
    </div>
    <audio id="mic-audio" controls hidden></audio>
  `;

  let mediaStream = null;
  let recorder = null;
  let chunks = [];
  let audioCtx = null;
  let analyser = null;
  let rafId = null;
  let startTime = 0;
  let timerId = null;

  const canvas = document.getElementById('mic-vis');
  const ctx = canvas.getContext('2d');
  const recBtn = document.getElementById('mic-record');
  const stopBtn = document.getElementById('mic-stop');
  const playBtn = document.getElementById('mic-play');
  const audioEl = document.getElementById('mic-audio');
  const timeEl = document.getElementById('mic-time');

  function drawWave() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const slice = canvas.width / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 128.0;
      const y = (v * canvas.height) / 2;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    rafId = requestAnimationFrame(drawWave);
  }

  function fmtTime(ms) {
    const s = Math.floor(ms/1000);
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  recBtn.addEventListener('click', async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      drawWave();

      chunks = [];
      recorder = new MediaRecorder(mediaStream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        audioEl.src = URL.createObjectURL(blob);
        audioEl.hidden = false;
        playBtn.disabled = false;
      };
      recorder.start();
      startTime = Date.now();
      timerId = setInterval(() => { timeEl.textContent = fmtTime(Date.now() - startTime); }, 250);
      recBtn.disabled = true;
      stopBtn.disabled = false;
    } catch (err) {
      alert('Microphone access denied or unavailable: ' + err.message);
    }
  });

  stopBtn.addEventListener('click', () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (rafId) cancelAnimationFrame(rafId);
    if (timerId) clearInterval(timerId);
    if (audioCtx) audioCtx.close();
    audioCtx = null; analyser = null; rafId = null;
    stopBtn.disabled = true;
  });

  playBtn.addEventListener('click', () => audioEl.play());

  return () => {
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearInterval(timerId);
      if (audioCtx) audioCtx.close();
      if (audioEl.src) URL.revokeObjectURL(audioEl.src);
    } catch {}
  };
};

//  Speaker (built-in speakers + headphone jack)
TEST_HANDLERS.speaker = function (body) {
  setInstructions('Press each button and confirm sound comes from the correct speaker. Then plug in wired headphones and repeat — confirm sound switches to headphones with no static.');

  body.innerHTML = `
    <div class="speaker-pad">
      <button class="btn" data-ch="left">◀ Left</button>
      <button class="btn" data-ch="right">Right  ▶</button>
      <button class="btn" data-ch="both">◀ Both ▶</button>
      <button class="btn" data-ch="sweep">Frequency Sweep</button>
    </div>
    <div class="speaker-meter"><span id="spk-status" class="muted">Idle</span></div>
  `;

  let audioCtx = null;
  let activeNodes = [];

  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function stopAll() {
    activeNodes.forEach(n => { try { n.stop(); } catch {} });
    activeNodes = [];
  }
  function tone(freq, durMs, pan) {
    const ac = ensureCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const panner = ac.createStereoPanner();
    osc.type = 'sine';
    osc.frequency.value = freq;
    panner.pan.value = pan;
    gain.gain.value = 0;
    osc.connect(gain).connect(panner).connect(ac.destination);
    const now = ac.currentTime;
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain.gain.linearRampToValueAtTime(0, now + durMs/1000);
    osc.start(now);
    osc.stop(now + durMs/1000 + 0.05);
    activeNodes.push(osc);
    return osc;
  }

  const status = document.getElementById('spk-status');
  body.querySelectorAll('button[data-ch]').forEach(btn => {
    btn.addEventListener('click', () => {
      stopAll();
      const ch = btn.dataset.ch;
      if (ch === 'left')  { tone(440, 1500, -1); status.textContent = 'Playing 440 Hz (Left)'; }
      if (ch === 'right') { tone(440, 1500, 1);  status.textContent = 'Playing 440 Hz (Right)'; }
      if (ch === 'both')  { tone(440, 1500, 0);  status.textContent = 'Playing 440 Hz (Both)'; }
      if (ch === 'sweep') {
        const ac = ensureCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        const now = ac.currentTime;
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(8000, now + 3);
        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
        gain.gain.linearRampToValueAtTime(0, now + 3);
        osc.connect(gain).connect(ac.destination);
        osc.start(now);
        osc.stop(now + 3.1);
        activeNodes.push(osc);
        status.textContent = 'Sweeping 200 Hz → 8 kHz';
      }
      setTimeout(() => { if (status.textContent.startsWith('Playing') || status.textContent.startsWith('Sweep')) status.textContent = 'Idle'; }, 3500);
    });
  });

  return () => { stopAll(); if (audioCtx) audioCtx.close(); };
};

//  Camera
TEST_HANDLERS.camera = function (body) {
  setInstructions('You should see a live preview from the built-in camera. Wave your hand to confirm motion. Mark Pass if image is clear.');

  body.innerHTML = `
    <div class="camera-frame"><video id="cam-video" autoplay playsinline muted></video></div>
    <p id="cam-status" class="muted">Requesting camera…</p>
  `;
  const video = document.getElementById('cam-video');
  const status = document.getElementById('cam-status');
  let stream = null;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
    .then(s => {
      stream = s;
      video.srcObject = s;
      const track = s.getVideoTracks()[0];
      const settings = track.getSettings();
      status.textContent = `${track.label || 'Camera'} · ${settings.width || '?'}×${settings.height || '?'} @ ${settings.frameRate || '?'} fps`;
    })
    .catch(err => {
      status.textContent = 'Camera unavailable: ' + err.message;
    });

  return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
};

//  Touchscreen
TEST_HANDLERS.touchscreen = function (body) {
  setInstructions('Drag your finger across every cell. The cell turns green when touched. All cells must light up.');

  const COLS = 12, ROWS = 8;
  body.innerHTML = `
    <div class="touch-grid" id="touch-grid" style="grid-template-columns: repeat(${COLS}, 1fr); grid-template-rows: repeat(${ROWS}, 1fr);"></div>
    <p id="touch-status" class="muted">0 / ${COLS*ROWS} cells touched</p>
  `;
  const grid = document.getElementById('touch-grid');
  const status = document.getElementById('touch-status');
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const c = document.createElement('div');
    c.className = 'touch-cell';
    grid.appendChild(c);
    cells.push(c);
  }

  let hits = 0;
  function hitFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el && el.classList.contains('touch-cell') && !el.classList.contains('hit')) {
      el.classList.add('hit');
      hits++;
      status.textContent = `${hits} / ${COLS*ROWS} cells touched`;
      if (hits === COLS*ROWS) status.textContent = 'All cells touched. ✓';
    }
  }
  function handle(e) {
    if (e.touches) {
      for (const t of e.touches) hitFromPoint(t.clientX, t.clientY);
    } else if (e.buttons) {
      hitFromPoint(e.clientX, e.clientY);
    }
    e.preventDefault();
  }
  grid.addEventListener('touchstart', handle, { passive: false });
  grid.addEventListener('touchmove', handle, { passive: false });
  grid.addEventListener('pointerdown', handle);
  grid.addEventListener('pointermove', handle);

  return () => {};
};

//  Touchpad
TEST_HANDLERS.touchpad = function (body) {
  setInstructions('Move the cursor inside the box, click, two-finger tap (right click), and two-finger scroll. All checkboxes should turn green.');

  body.innerHTML = `
    <div class="touchpad-zone" id="tp-zone">
      <div class="touchpad-cursor" id="tp-cursor" hidden></div>
    </div>
    <div class="checklist">
      <label><input type="checkbox" id="tp-move" disabled> Cursor movement</label>
      <label><input type="checkbox" id="tp-click" disabled> Left click</label>
      <label><input type="checkbox" id="tp-rclick" disabled> Right click</label>
      <label><input type="checkbox" id="tp-scroll" disabled> Two-finger scroll</label>
    </div>
  `;
  const zone = document.getElementById('tp-zone');
  const cursor = document.getElementById('tp-cursor');
  const cb = {
    move: document.getElementById('tp-move'),
    click: document.getElementById('tp-click'),
    rclick: document.getElementById('tp-rclick'),
    scroll: document.getElementById('tp-scroll'),
  };
  function onMove(e) {
    const rect = zone.getBoundingClientRect();
    cursor.hidden = false;
    cursor.style.left = (e.clientX - rect.left) + 'px';
    cursor.style.top = (e.clientY - rect.top) + 'px';
    cb.move.checked = true;
  }
  function onDown(e) {
    if (e.button === 0) cb.click.checked = true;
    if (e.button === 2) cb.rclick.checked = true;
  }
  function onContext(e) { e.preventDefault(); cb.rclick.checked = true; }
  function onWheel(e) { e.preventDefault(); cb.scroll.checked = true; }

  zone.addEventListener('mousemove', onMove);
  zone.addEventListener('mousedown', onDown);
  zone.addEventListener('contextmenu', onContext);
  zone.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    zone.removeEventListener('mousemove', onMove);
    zone.removeEventListener('mousedown', onDown);
    zone.removeEventListener('contextmenu', onContext);
    zone.removeEventListener('wheel', onWheel);
  };
};

//  Keyboard
TEST_HANDLERS.keyboard = function (body) {
  setInstructions('Press every key. Each key turns green when pressed. Try every row including function keys and modifiers.');

  //  Chromebook specific layout (I know it looks ugly but I think this is the only real way to do this) 
  //  Key, KeyboardEvent.code, width (optional)
  const rows = [
    [['Esc','Escape',1.2],['F1','F1'],['F2','F2'],['F3','F3'],['F4','F4'],['F5','F5'],['F6','F6'],['F7','F7'],['F8','F8'],['F9','F9'],['F10','F10'],['Power','Power',1.2]],
    [['`','Backquote'],['1','Digit1'],['2','Digit2'],['3','Digit3'],['4','Digit4'],['5','Digit5'],['6','Digit6'],['7','Digit7'],['8','Digit8'],['9','Digit9'],['0','Digit0'],['-','Minus'],['=','Equal'],['Backspace','Backspace',2]],
    [['Tab','Tab',1.6],['Q','KeyQ'],['W','KeyW'],['E','KeyE'],['R','KeyR'],['T','KeyT'],['Y','KeyY'],['U','KeyU'],['I','KeyI'],['O','KeyO'],['P','KeyP'],['[','BracketLeft'],[']','BracketRight'],['\\','Backslash',1.5]],
    [['Search','MetaLeft',1.8],['A','KeyA'],['S','KeyS'],['D','KeyD'],['F','KeyF'],['G','KeyG'],['H','KeyH'],['J','KeyJ'],['K','KeyK'],['L','KeyL'],[';','Semicolon'],['\'','Quote'],['Enter','Enter',2]],
    [['Shift','ShiftLeft',2.4],['Z','KeyZ'],['X','KeyX'],['C','KeyC'],['V','KeyV'],['B','KeyB'],['N','KeyN'],['M','KeyM'],[',','Comma'],['.','Period'],['/','Slash'],['Shift','ShiftRight',2.4]],
    [['Ctrl','ControlLeft',1.4],['Alt','AltLeft',1.4],['Space','Space',6],['Alt','AltRight',1.4],['Ctrl','ControlRight',1.4],['◀','ArrowLeft'],['▲','ArrowUp'],['▼','ArrowDown'],['▶','ArrowRight']],
  ];

  let html = '<div class="keyboard">';
  rows.forEach(row => {
    html += '<div class="kb-row">';
    row.forEach(([label, code, w]) => {
      const cls = w >= 4 ? 'widest' : w >= 2 ? 'wider' : w > 1 ? 'wide' : '';
      html += `<div class="kb-key ${cls}" data-code="${code}">${label}</div>`;
    });
    html += '</div>';
  });
  html += '</div><p id="kb-log">Last key: —</p>';
  body.innerHTML = html;

  const log = document.getElementById('kb-log');
  function onKey(e) {
    log.textContent = `Last key: ${e.key} (code=${e.code})`;
    const el = body.querySelector(`.kb-key[data-code="${e.code}"]`);
    if (el) el.classList.add('hit');
    // Don't preventDefault: F-keys need to be observable but dont need to blocked from system actions. FUTURE JACK PLEASE DETERMINE IF THIS ACTUALLY SHOULD BE BLOCKED BEFORE DEPLOYMENT!!! DONT MAKE ME CRY
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
};

//. Battery
TEST_HANDLERS.battery = function (body) {
  setInstructions('Verify charge level, charging status, and that values update if you plug/unplug the charger.');

  body.innerHTML = `<div class="info-list" id="batt-info"><div class="info-row"><span class="label">Status</span><span>Loading…</span></div></div>`;
  const info = document.getElementById('batt-info');

  function fmt(secs) {
    if (!isFinite(secs) || secs <= 0) return '—';
    const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
    return `${h}h ${m}m`;
  }
  function render(b) {
    info.innerHTML = `
      <div class="info-row"><span class="label">Charge level</span><span>${Math.round(b.level*100)}%</span></div>
      <div class="info-row"><span class="label">Charging</span><span>${b.charging ? 'Yes' : 'No'}</span></div>
      <div class="info-row"><span class="label">Time to full</span><span>${b.charging ? fmt(b.chargingTime) : '—'}</span></div>
      <div class="info-row"><span class="label">Time remaining</span><span>${!b.charging ? fmt(b.dischargingTime) : '—'}</span></div>
    `;
  }

  let battery = null;
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      battery = b;
      render(b);
      ['chargingchange','levelchange','chargingtimechange','dischargingtimechange'].forEach(ev => b.addEventListener(ev, () => render(b)));
    }).catch(() => {
      info.innerHTML = `<div class="info-row"><span class="label">Status</span><span>Battery API not supported on this device.</span></div>`;
    });
  } else {
    info.innerHTML = `<div class="info-row"><span class="label">Status</span><span>Battery API not supported on this device.</span></div>`;
  }

  return () => {};
};

//  Physical Inspection
TEST_HANDLERS.physical = function (body) {
  setInstructions('Please inspect the device physically');
  body.innerHTML = `
    <div class="physical-message">
      <p>Please inspect the device physically</p>
    </div>
  `;
  return () => {};
};

//  Helpers
function setInstructions(text) {
  document.getElementById('test-instructions').textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

//  Report
function buildReportPayload() {
  const ua = navigator.userAgent;
  const platform = /CrOS/.test(ua) ? 'Chrome OS' : (navigator.platform || 'Unknown');
  const passed = TESTS.filter(t => state.results[t.id].status === 'pass').length;
  const failed = TESTS.filter(t => state.results[t.id].status === 'fail').length;
  const untested = TESTS.length - passed - failed;
  const overall = failed > 0 ? 'fail' : (untested > 0 ? 'incomplete' : 'pass');

  return {
    schemaVersion: 1,
    device: {
      platform,
      userAgent: ua,
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio },
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemoryGB: navigator.deviceMemory || null,
    },
    session: {
      reportedAt: new Date().toISOString(),
    },
    summary: { passed, failed, untested, overall },
    results: state.results,
  };
}


function renderReport() {
  const payload = buildReportPayload();
  const { passed, failed, untested } = payload.summary;

  const body = document.getElementById('report-body');
  body.innerHTML = `
    <div class="report-summary">
      <div class="summary-card pass"><div class="num">${passed}</div><div>Passed</div></div>
      <div class="summary-card fail"><div class="num">${failed}</div><div>Failed</div></div>
      <div class="summary-card"><div class="num">${untested}</div><div>Not tested</div></div>
    </div>
    <div class="info-list" style="width:auto;margin-bottom:1rem;">
      <div class="info-row"><span class="label">Date</span><span>${new Date().toLocaleString()}</span></div>
      <div class="info-row"><span class="label">Platform</span><span>${payload.device.platform}</span></div>
      <div class="info-row"><span class="label">Resolution</span><span>${payload.device.screen.width}×${payload.device.screen.height}</span></div>
      <div class="info-row"><span class="label">User agent</span><span style="font-size:0.75rem">${payload.device.userAgent}</span></div>
    </div>
    <table class="report-table">
      <thead><tr><th>Test</th><th>Status</th><th>Tested at</th>${state.tech ? '<th>Comments</th>' : ''}</tr></thead>
      <tbody>
        ${TESTS.map(t => {
          const r = state.results[t.id];
          return `<tr>
            <td>${t.title}</td>
            <td>${statusLabel(r.status)}</td>
            <td>${r.ts ? new Date(r.ts).toLocaleTimeString() : '—'}</td>
            ${state.tech ? `<td class="report-comments">${r.comments ? escapeHtml(r.comments) : '—'}</td>` : ''}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

//  Wire-up
function init() {
  const techModal = setupTechModal();
  renderTechBadge();

  //  Ctrl+Shift+L opens the technician login modal from any view.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      techModal.open();
    }
  });
  document.getElementById('tech-logout').addEventListener('click', clearTech);

  document.getElementById('btn-begin').addEventListener('click', startSequence);
  document.getElementById('btn-exit-welcome').addEventListener('click', () => {
    window.close();
  });
  document.getElementById('btn-exit-dashboard').addEventListener('click', () => {
    if (confirm('Exit and clear all results for this device?')) {
      state.results = blankResults();
      saveSession();
      showView('view-welcome');
    }
  });
  document.getElementById('btn-dashboard').addEventListener('click', leaveToDashboard);
  document.getElementById('btn-pass').addEventListener('click', () => markCurrent('pass'));
  document.getElementById('btn-fail').addEventListener('click', () => markCurrent('fail'));
  document.getElementById('btn-next').addEventListener('click', advanceFromCurrent);

  const commentsInput = document.getElementById('test-comments-input');
  commentsInput.addEventListener('input', persistCurrentComments);
  commentsInput.addEventListener('blur', persistCurrentComments);

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Clear all test results for this device?')) {
      state.results = blankResults();
      saveSession();
      renderDashboard();
    }
  });
  document.getElementById('btn-report').addEventListener('click', () => {
    renderReport();
    showView('view-report');
  });
  document.getElementById('btn-back-from-report').addEventListener('click', enterDashboard);
  document.getElementById('btn-finish').addEventListener('click', () => {
    if (confirm('Finish this device and clear all results?')) {
      state.results = blankResults();
      saveSession();
      showView('view-welcome');
    }
  });

  //  Register service worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
