// ═══════════════════════════════════════════════════════════════
//  ChordScribe — app.js
//  Full frontend logic: recording, upload, API, results, payments
// ═══════════════════════════════════════════════════════════════

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://your-app.railway.app'; // ← replace after deploy

const STRIPE_KEY = 'pk_live_XXXX'; // ← replace with your Stripe publishable key
const PRICE_ID   = 'price_XXXX';   // ← replace with your Stripe Price ID

// ── State ────────────────────────────────────────────────────────
const state = {
  page:           'landing',
  inputMode:      'record',
  outputs:        new Set(['lyrics','chords','tab']),
  isRecording:    false,
  mediaRecorder:  null,
  audioChunks:    [],
  audioBlob:      null,
  recordSeconds:  0,
  recTimerID:     null,
  audioCtx:       null,
  analyser:       null,
  animFrame:      null,
  hasPaid:        false,
  freeUsed:       false,
  lastResult:     null,
};

// Persist payment state across sessions
function loadStorage() {
  try {
    state.hasPaid   = localStorage.getItem('cs_paid') === 'true';
    state.freeUsed  = localStorage.getItem('cs_free_used') === 'true';
  } catch(e) {}
}

function saveStorage() {
  try {
    localStorage.setItem('cs_paid', state.hasPaid);
    localStorage.setItem('cs_free_used', state.freeUsed);
  } catch(e) {}
}

// ── Pages ────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  state.page = name;
  if (name === 'app') updateCreditsDisplay();
}

window.showPage = showPage;

function updateCreditsDisplay() {
  const label = document.getElementById('credits-label');
  const count = document.getElementById('credits-count');
  if (state.hasPaid) {
    label.textContent = 'Plan: ';
    count.textContent = 'Lifetime ∞';
    count.style.color = '#7fffd4';
  } else {
    label.textContent = 'Free analyses left: ';
    count.textContent = state.freeUsed ? '0' : '1';
    count.style.color = state.freeUsed ? '#dc2626' : '';
  }
}

function scrollToPricing() {
  document.getElementById('pricing-section').scrollIntoView({ behavior: 'smooth' });
}

window.scrollToPricing = scrollToPricing;

// ── Input tabs ───────────────────────────────────────────────────
function switchInputTab(mode, btn) {
  state.inputMode = mode;
  document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.input-tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + mode).classList.add('active');
  checkReady();
}

window.switchInputTab = switchInputTab;

// ── Output chips ─────────────────────────────────────────────────
function toggleChip(el) {
  const key = el.dataset.out;
  if (state.outputs.has(key)) {
    if (state.outputs.size === 1) return; // keep at least one
    state.outputs.delete(key);
    el.classList.remove('on');
  } else {
    state.outputs.add(key);
    el.classList.add('on');
  }
}

window.toggleChip = toggleChip;

// ── Recording ────────────────────────────────────────────────────
async function toggleRecord() {
  if (!state.isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
}

window.toggleRecord = toggleRecord;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    state.mediaRecorder = new MediaRecorder(stream, { mimeType });
    state.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };
    state.mediaRecorder.onstop = () => {
      state.audioBlob = new Blob(state.audioChunks, { type: mimeType });
      stream.getTracks().forEach(t => t.stop());
      stopVisualiser();
      document.getElementById('rec-status').textContent = 'RECORDING SAVED';
      document.getElementById('rec-hint').textContent = '✓ Ready to analyse';
      checkReady();
    };

    state.mediaRecorder.start(250);
    state.isRecording = true;

    // UI
    const btn = document.getElementById('rec-btn');
    btn.classList.add('recording');
    btn.textContent = '⏹';
    document.getElementById('rec-status').textContent = 'RECORDING...';
    document.getElementById('rec-hint').textContent = 'Play music near your mic, then tap stop';
    document.getElementById('wave-idle').style.display = 'none';

    // Timer
    state.recordSeconds = 0;
    state.recTimerID = setInterval(() => {
      state.recordSeconds++;
      const m = Math.floor(state.recordSeconds / 60);
      const s = String(state.recordSeconds % 60).padStart(2,'0');
      document.getElementById('rec-timer').textContent = `${m}:${s}`;
    }, 1000);

    startVisualiser(stream);
  } catch(err) {
    showToast('⚠ Mic access denied — check browser permissions');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  clearInterval(state.recTimerID);
  const btn = document.getElementById('rec-btn');
  btn.classList.remove('recording');
  btn.textContent = '🎙️';
}

// ── Waveform visualiser ──────────────────────────────────────────
function startVisualiser(stream) {
  const canvas  = document.getElementById('waveCanvas');
  const ctx     = canvas.getContext('2d');
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src    = state.audioCtx.createMediaStreamSource(stream);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 128;
  src.connect(state.analyser);

  const data = new Uint8Array(state.analyser.frequencyBinCount);

  function draw() {
    state.animFrame = requestAnimationFrame(draw);
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    state.analyser.getByteFrequencyData(data);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barW = (canvas.width / data.length) * 1.8;
    let x = 0;
    data.forEach(val => {
      const h = (val / 255) * canvas.height * 0.85;
      const alpha = 0.4 + (val / 255) * 0.6;
      ctx.fillStyle = `rgba(200,64,10,${alpha})`;
      ctx.fillRect(x, canvas.height - h, barW - 1, h);
      x += barW;
    });
  }
  draw();
}

function stopVisualiser() {
  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  if (state.audioCtx) state.audioCtx.close().catch(() => {});
  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('wave-idle').style.display = 'block';
}

// ── File upload ──────────────────────────────────────────────────
function handleFile(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  state.audioBlob = file;
  document.getElementById('file-bar').style.display = 'flex';
  document.getElementById('file-name-display').textContent = file.name;
  checkReady();
}

window.handleFile = handleFile;

// Drag & drop
const dropZone = document.getElementById('upload-drop');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) {
      state.audioBlob = file;
      document.getElementById('file-bar').style.display = 'flex';
      document.getElementById('file-name-display').textContent = file.name;
      checkReady();
    }
  });
}

// ── Ready check ──────────────────────────────────────────────────
function checkReady() {
  const hasAudio = !!state.audioBlob;
  document.getElementById('btn-analyse').disabled = !hasAudio;
}

// ── Analysis ─────────────────────────────────────────────────────
async function startAnalysis() {
  // Paywall check
  if (!state.hasPaid && state.freeUsed) {
    showPage('paywall');
    return;
  }

  if (!state.audioBlob) {
    showToast('Please record or upload audio first');
    return;
  }

  showPage('processing');
  animateSteps();

  try {
    const formData = new FormData();
    formData.append('audio', state.audioBlob, 'recording.webm');
    formData.append('outputs', JSON.stringify(Array.from(state.outputs)));

    const res = await fetch(`${API_BASE}/analyse`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Server error' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const result = await res.json();
    state.lastResult = result;

    // Mark free analysis used
    if (!state.hasPaid) {
      state.freeUsed = true;
      saveStorage();
    }

    renderResults(result);
    showPage('results');

  } catch(err) {
    showPage('app');
    showToast('⚠ Analysis failed: ' + err.message);
    console.error(err);
  }
}

window.startAnalysis = startAnalysis;

// ── Processing animation ─────────────────────────────────────────
function animateSteps() {
  const steps = document.querySelectorAll('.proc-step');
  const bar   = document.getElementById('proc-bar');
  steps.forEach(s => s.classList.remove('active','done'));
  bar.style.width = '0%';

  let i = 0;
  const msgs = [
    'Separating audio stems...',
    'Running speech recognition...',
    'Detecting key and tempo...',
    'Mapping chord progressions...',
    'Building tablature...',
    'Rendering sheet music...',
  ];

  const tick = setInterval(() => {
    if (i > 0) steps[i-1]?.classList.replace('active','done');
    if (i < steps.length) {
      steps[i].classList.add('active');
      document.getElementById('proc-sub').textContent = msgs[i] || '';
      bar.style.width = ((i + 1) / steps.length * 85) + '%';
    }
    i++;
    if (i > steps.length) clearInterval(tick);
  }, 900);
}

// ── Render results ────────────────────────────────────────────────
function renderResults(data) {
  // Song banner
  document.getElementById('result-title').textContent =
    data.song_title || 'Analysed Track';

  const metaEl = document.getElementById('song-meta');
  metaEl.innerHTML = '';
  const metas = [
    ['Key', data.key],
    ['BPM', data.bpm],
    ['Time', data.time_signature],
    ['Genre', data.genre],
    ['Capo', data.capo || 'None'],
  ];
  metas.forEach(([label, val]) => {
    if (!val) return;
    const pill = document.createElement('div');
    pill.className = 'meta-pill';
    pill.innerHTML = `<strong>${label}</strong> ${val}`;
    metaEl.appendChild(pill);
  });

  // Lyrics + chords
  renderLyrics(data);

  // Chord chart
  renderChordChart(data);

  // Tab
  renderTab(data);

  // Sheet music
  renderSheetMusic(data);
}

// ── Lyrics ───────────────────────────────────────────────────────
function renderLyrics(data) {
  const out = document.getElementById('lyrics-output');
  out.innerHTML = '';

  (data.lyrics_chords || []).forEach(section => {
    const lbl = document.createElement('span');
    lbl.className = 'lyrics-section-label';
    lbl.textContent = `[ ${section.section} ]`;
    out.appendChild(lbl);

    (section.lines || []).forEach(line => {
      const row = document.createElement('span');
      row.className = 'lyric-row';

      // Chord row
      const chordRow = document.createElement('div');
      chordRow.className = 'chord-above';
      (line.chords || []).forEach(c => {
        const tag = document.createElement('span');
        tag.className = 'chord-above-item';
        tag.style.left = (c.position || 0) + 'px';
        tag.textContent = c.chord;
        chordRow.appendChild(tag);
      });

      const words = document.createElement('div');
      words.className = 'lyric-words';
      words.textContent = line.lyric;

      row.appendChild(chordRow);
      row.appendChild(words);
      out.appendChild(row);
    });
  });
}

// ── Chord chart ──────────────────────────────────────────────────
function renderChordChart(data) {
  const grid = document.getElementById('chord-chart-output');
  grid.innerHTML = '';

  (data.unique_chords || []).forEach(chord => {
    const card = document.createElement('div');
    card.className = 'chord-diagram';
    card.innerHTML = `
      <div class="chord-diag-name">${chord.name}</div>
      ${buildFretDiagram(chord.frets || [])}
      <div class="chord-diag-type">${chord.type || ''}</div>
    `;
    grid.appendChild(card);
  });
}

function buildFretDiagram(frets) {
  // frets = array of 6 numbers: -1=muted, 0=open, N=fret number
  const minFret = Math.min(...frets.filter(f => f > 0), 99);
  const baseFret = minFret === 99 ? 1 : minFret;

  let html = '<div class="fret-grid">';
  for (let row = 0; row < 4; row++) {
    html += '<div class="fret-row-diag">';
    for (let s = 0; s < 6; s++) {
      const f = frets[s];
      const pressed = f > 0 && (f - baseFret) === row;
      html += `<div class="fret-cell">${pressed ? '<div class="fret-dot"></div>' : ''}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ── Tab ──────────────────────────────────────────────────────────
function renderTab(data) {
  const out = document.getElementById('tab-output');
  out.innerHTML = '';

  const lines = (data.guitar_tab || '').split('\n');
  const labels = ['e','B','G','D','A','E'];

  lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'tab-row';
    row.innerHTML = `
      <span class="tab-str-label">${labels[i] || ''}</span>
      <span class="tab-str-content">${escHtml(line)}</span>
    `;
    out.appendChild(row);
  });

  if (data.progression_note) {
    const note = document.createElement('div');
    note.className = 'tab-note';
    note.textContent = '★ ' + data.progression_note;
    out.appendChild(note);
  }
}

// ── Sheet music canvas ───────────────────────────────────────────
function renderSheetMusic(data) {
  const canvas = document.getElementById('sheetCanvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const staffY = 90, ls = 14; // line spacing

  // Title
  ctx.fillStyle = '#1a1814';
  ctx.font = 'bold 16px "Syne", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.song_title || 'Transcription', W/2, 40);

  // Key + BPM
  ctx.font = '11px "Martian Mono", monospace';
  ctx.fillStyle = '#7a7268';
  ctx.fillText(`Key: ${data.key || '?'}  ·  ${data.bpm || '?'} BPM  ·  ${data.time_signature || '4/4'}`, W/2, 58);

  ctx.textAlign = 'left';

  // Draw staff
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(55, staffY + i * ls);
    ctx.lineTo(W - 30, staffY + i * ls);
    ctx.stroke();
  }

  // Treble clef
  ctx.font = '72px serif';
  ctx.fillStyle = '#1a1814';
  ctx.fillText('𝄞', 16, staffY + 52);

  // Time signature
  ctx.font = 'bold 18px serif';
  ctx.fillText('4', 74, staffY + 14);
  ctx.fillText('4', 74, staffY + 28);

  // Notes from chords
  const chords = (data.unique_chords || []).map(c => c.name);
  const noteOffsets = { C:7, D:0, E:-7, F:-14, G:-21, A:-28, B:-35 };
  let x = 108;

  chords.slice(0, 8).forEach((chordName, idx) => {
    const root = chordName[0].toUpperCase();
    const baseOffset = noteOffsets[root] ?? 0;
    const noteY = staffY + ls * 3 + baseOffset;

    // Chord label above staff
    ctx.font = '11px "Martian Mono", monospace';
    ctx.fillStyle = '#c8400a';
    ctx.fillText(chordName, x - 6, staffY - 10);

    // Note head
    ctx.fillStyle = '#1a1814';
    ctx.beginPath();
    ctx.ellipse(x, noteY, 6, 4.5, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    ctx.strokeStyle = '#1a1814';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 5, noteY);
    ctx.lineTo(x + 5, noteY - 35);
    ctx.stroke();

    // Ledger line if needed
    if (noteY > staffY + ls * 4 + 4) {
      ctx.beginPath();
      ctx.moveTo(x - 8, staffY + ls * 5);
      ctx.lineTo(x + 13, staffY + ls * 5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    x += 68;
    // Bar line every 4 notes
    if ((idx + 1) % 4 === 0 && idx < chords.length - 1) {
      ctx.beginPath();
      ctx.moveTo(x - 10, staffY);
      ctx.lineTo(x - 10, staffY + ls * 4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // End double bar
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W-34, staffY); ctx.lineTo(W-34, staffY+ls*4); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W-30, staffY); ctx.lineTo(W-30, staffY+ls*4); ctx.stroke();

  // Footer
  ctx.lineWidth = 1;
  ctx.fillStyle = '#bbb';
  ctx.font = '9px "Martian Mono", monospace';
  ctx.fillText('Generated by ChordScribe', 55, H - 16);
}

// ── Result tabs ──────────────────────────────────────────────────
function switchResultTab(name, btn) {
  document.querySelectorAll('.result-tab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.result-pane').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('pane-' + name).classList.add('on');
}

window.switchResultTab = switchResultTab;

// ── Export ───────────────────────────────────────────────────────
function exportPDF() {
  window.print();
}

window.exportPDF = exportPDF;

// ── Stripe payment ───────────────────────────────────────────────
async function handlePayment() {
  const btn = document.getElementById('btn-pay');
  btn.textContent = 'Opening checkout...';
  btn.disabled = true;

  try {
    // Create Stripe checkout session via backend
    const res = await fetch(`${API_BASE}/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_id: PRICE_ID }),
    });

    if (!res.ok) throw new Error('Could not create checkout session');

    const { url } = await res.json();
    window.location.href = url; // Redirect to Stripe hosted checkout

  } catch(err) {
    showToast('⚠ Payment error: ' + err.message);
    btn.textContent = 'Pay £4.99 — Unlock Forever';
    btn.disabled = false;
  }
}

window.handlePayment = handlePayment;

// Check for successful payment return (Stripe redirects back with ?payment=success)
function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success') {
    state.hasPaid = true;
    saveStorage();
    showToast('🎉 Payment successful! Unlimited access unlocked.');
    showPage('app');
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ── PWA service worker registration ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.log('SW failed:', err));
  });
}

// ── PWA install prompt ───────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show install banner after 30s
  setTimeout(() => {
    if (deferredInstallPrompt) showInstallBanner();
  }, 30000);
});

function showInstallBanner() {
  showToast('📱 Add ChordScribe to your home screen for the best experience');
}

// ── Init ─────────────────────────────────────────────────────────
loadStorage();
checkPaymentReturn();
