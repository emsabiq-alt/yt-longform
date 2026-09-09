"use strict";

/* ============================================================
   BanyakTau Studio – Dashboard v2
   ============================================================ */

const PIN_KEY = "bt_pin_v2";
let PIN = sessionStorage.getItem(PIN_KEY) || "";
let STATE = { items: [], queue: [], config: {}, activeRun: null, recentRuns: [], stats: {} };
let POLL_TIMER = null;
let SELECTED_TREND = null;
let TRENDS_LOADED = false;
let CMD_ACTIVE_IDX = -1;

/* ============================================================
   UTILITY
   ============================================================ */
const $ = id => document.getElementById(id);
const fmt = {
  dur: s => {
    s = Math.round(s || 0);
    const m = Math.floor(s / 60), ss = s % 60;
    return m ? `${m}m ${ss}s` : `${s}s`;
  },
  date: ts => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  },
  time: ts => {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  },
  usd: n => `$${(n || 0).toFixed(2)}`,
  rel: ts => {
    if (!ts) return "—";
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60e3) return "baru saja";
    if (d < 3600e3) return `${Math.floor(d / 60e3)} mnt lalu`;
    if (d < 86400e3) return `${Math.floor(d / 3600e3)} jam lalu`;
    return `${Math.floor(d / 86400e3)} hari lalu`;
  },
  num: n => (n || 0).toLocaleString("id-ID")
};

function toast(msg, type = "info", dur = 3500) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), dur);
}

function h(tag, cls, inner = "") {
  return `<${tag} class="${cls}">${inner}</${tag}>`;
}

/* ============================================================
   AUTH
   ============================================================ */
function checkAuth() {
  if (PIN) { showApp(); return; }
  $("authOverlay").classList.add("active");
}

$("authForm").addEventListener("submit", e => {
  e.preventDefault();
  const pin = $("authPin").value.trim();
  if (!pin) return;
  PIN = pin;
  sessionStorage.setItem(PIN_KEY, pin);
  $("authError").textContent = "";
  showApp();
  loadData();
});

$("logoutBtn").addEventListener("click", () => {
  PIN = "";
  sessionStorage.removeItem(PIN_KEY);
  location.reload();
});

function showApp() {
  $("authOverlay").classList.remove("active");
  $("app").classList.remove("hidden");
  startPolling();
  initMobileTabs();
  initCountdown();
  initClock();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const VIEW_META = {
  overview: { kicker: "Beranda", title: "Operational Overview" },
  create:   { kicker: "Produksi", title: "Generate Video Baru" },
  library:  { kicker: "Konten", title: "Pustaka Video" },
  queue:    { kicker: "Antrian", title: "Jadwal Produksi" },
  runs:     { kicker: "CI/CD", title: "Riwayat Workflow" },
  trends:   { kicker: "Intelijen", title: "Tren Berita Bertahan" },
  health:   { kicker: "Sistem", title: "Diagnostik" },
};

let currentView = "overview";

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => gotoView(btn.dataset.view));
});

document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => gotoView(btn.dataset.goto));
});

function gotoView(view) {
  if (!VIEW_META[view]) return;
  currentView = view;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".bt-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.view === view));
  const m = VIEW_META[view];
  $("viewKicker").textContent = m.kicker;
  $("viewTitle").textContent = m.title;
  if (view === "trends" && !TRENDS_LOADED) loadTrends();
  if (view === "health") renderHealth([]);
  renderCurrentView();
}

/* ============================================================
   MOBILE BOTTOM TABS
   ============================================================ */
function initMobileTabs() {
  const tabData = [
    { view: "overview", icon: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11h7V2H2v9zm0 7h7v-5H2v5zm9 0h7v-9h-7v9zm0-16v5h7V2h-7z"/></svg>`, label: "Beranda" },
    { view: "create",   icon: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="8"/><path d="M10 6v8M6 10h8"/></svg>`, label: "Buat" },
    { view: "library",  icon: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="7" height="12" rx="1.5"/><rect x="11" y="4" width="7" height="12" rx="1.5"/></svg>`, label: "Pustaka" },
    { view: "trends",   icon: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 14l6-6 3 3 7-7"/><path d="M14 4h4v4"/></svg>`, label: "Tren" },
    { view: "health",   icon: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3l6 3v5c0 3.5-2.5 6-6 7-3.5-1-6-3.5-6-7V6l6-3z"/></svg>`, label: "Sistem" },
  ];
  const bar = document.createElement("nav");
  bar.className = "bottom-tabs";
  bar.innerHTML = tabData.map(t =>
    `<button class="bt-item${t.view === "overview" ? " active" : ""}" data-view="${t.view}">${t.icon}<span>${t.label}</span></button>`
  ).join("");
  document.body.appendChild(bar);
  bar.querySelectorAll(".bt-item").forEach(b => b.addEventListener("click", () => gotoView(b.dataset.view)));
}

/* ============================================================
   CLOCK & COUNTDOWN
   ============================================================ */
function initClock() {
  function tick() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  tick(); setInterval(tick, 10000);
}

function initCountdown() {
  function computeNext() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(21, 15, 0, 0); // 04:15 WIB = 21:15 UTC prev day
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  function tick() {
    const diff = computeNext() - Date.now();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    $("nextRunCountdown").textContent =
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    $("nextRunLocal").textContent = computeNext().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
  }
  tick(); setInterval(tick, 1000);
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadData() {
  try {
    const headers = PIN ? { "x-pin": PIN } : {};
    const res = await fetch("/api/state", { headers });
    if (res.status === 401) { toast("PIN salah atau expired.", "err"); return; }
    if (!res.ok) return;
    const data = await res.json();
    STATE = { items: [], queue: [], recentRuns: [], stats: {}, ...data };
    renderCurrentView();
    updateQueueBadge();
    updateConfigLine();
  } catch (e) {
    console.warn("loadData error:", e);
  }
}

function startPolling() {
  loadData();
  POLL_TIMER = setInterval(loadData, 15000);
}

function renderCurrentView() {
  switch (currentView) {
    case "overview": renderOverview(); break;
    case "library":  renderLibrary(); break;
    case "queue":    renderQueue(); break;
    case "runs":     renderRuns(); break;
  }
}

function updateQueueBadge() {
  const n = (STATE.queue || []).length;
  const badge = $("queueBadge");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

function updateConfigLine() {
  const c = STATE.config || {};
  $("configLine").textContent = [c.resolution, c.ttsProvider].filter(Boolean).join(" · ");
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverview() {
  renderMetrics();
  renderActiveRun();
  renderRecentItems();
}

function renderMetrics() {
  const s = STATE.stats || {};
  const cards = [
    { icon: "🎬", label: "Total Video", val: fmt.num(s.total), color: "var(--accent-bg)", trend: null },
    { icon: "✅", label: "Terupload", val: fmt.num(s.uploaded), color: "var(--green-bg)", trend: s.todayCount ? `+${s.todayCount} hari ini` : null, tDir: "up" },
    { icon: "🎞️", label: "Rendered", val: fmt.num(s.rendered), color: "var(--blue-bg)", trend: null },
    { icon: "❌", label: "Gagal", val: fmt.num(s.failed), color: "var(--red-bg)", trend: null, tDir: s.failed > 0 ? "dn" : null },
    { icon: "💰", label: "Total Biaya", val: fmt.usd(s.totalCostUsd), color: "var(--yellow-bg)", trend: null },
    { icon: "⏱️", label: "Total Durasi", val: fmt.dur(s.totalDurationSec), color: "var(--accent-bg)", trend: null },
  ];
  $("metrics").innerHTML = cards.map(c => `
    <div class="metric-card">
      <div class="metric-top">
        <div class="metric-icon" style="background:${c.color}">${c.icon}</div>
        ${c.trend ? `<span class="metric-trend ${c.tDir || ""}">${c.trend}</span>` : ""}
      </div>
      <div class="metric-val">${c.val}</div>
      <div class="metric-label">${c.label}</div>
    </div>
  `).join("");
}

function renderActiveRun() {
  const run = STATE.activeRun;
  const badge = $("runBadge");
  const bar = $("progressBar");
  const pct = $("progressPct");
  const detail = $("runDetail");
  const steps = $("runSteps");
  const link = $("runLink");

  if (!run) {
    badge.className = "badge idle"; badge.textContent = "Idle";
    bar.style.width = "0%"; pct.textContent = "0%";
    detail.textContent = "Belum ada workflow berjalan.";
    steps.innerHTML = ""; link.classList.add("hidden");
    return;
  }

  const isRunning = run.status === "in_progress";
  badge.className = `badge ${isRunning ? "running" : run.status === "success" ? "done" : "failed"}`;
  badge.textContent = isRunning ? "Berjalan" : run.status === "success" ? "Selesai" : "Gagal";

  const progress = run.progress || 0;
  bar.style.width = `${progress}%`;
  pct.textContent = `${progress}%`;
  detail.textContent = run.step || (isRunning ? "Memproses..." : "Selesai.");

  const STEPS = ["Inisialisasi", "Skrip & Audio", "Aset Visual", "Render Video", "Upload YouTube"];
  const curStep = Math.min(Math.floor(progress / 20), 4);
  steps.innerHTML = STEPS.map((s, i) => {
    const cls = i < curStep ? "done" : i === curStep ? "active" : "pending";
    return `<div class="run-step ${cls}"><span class="step-dot"></span>${s}</div>`;
  }).join("");

  if (run.url) {
    link.classList.remove("hidden");
    link.innerHTML = `<a href="${run.url}" target="_blank" rel="noopener">Lihat di GitHub Actions →</a>`;
  }

  // Append to console
  if (run.log) {
    const cons = $("console");
    cons.textContent = run.log.slice(-3000);
    cons.scrollTop = cons.scrollHeight;
  }
}

function renderRecentItems() {
  const items = (STATE.items || []).slice(0, 8);
  if (!items.length) { $("recentList").innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p class="muted">Belum ada video.</p></div>`; return; }
  $("recentList").innerHTML = items.map(item => videoCardHTML(item)).join("");
  $("recentList").querySelectorAll(".video-card").forEach((card, i) => {
    card.addEventListener("click", () => openDrawer(items[i]));
  });
}

/* ============================================================
   LIBRARY
   ============================================================ */
function renderLibrary() {
  const search = ($("librarySearch").value || "").toLowerCase();
  const filter = $("libraryFilter").value;
  const sort   = $("librarySort").value;

  let items = (STATE.items || []).filter(it => {
    if (filter !== "all" && it.status !== filter) return false;
    if (search && !(it.title || "").toLowerCase().includes(search)) return false;
    return true;
  });

  if (sort === "oldest")   items = [...items].reverse();
  else if (sort === "duration") items = [...items].sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0));
  else if (sort === "cost") items = [...items].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0));

  const uploaded = (STATE.items || []).filter(x => x.status === "uploaded").length;
  const rendered = (STATE.items || []).filter(x => x.status === "rendered").length;
  const failed   = (STATE.items || []).filter(x => x.status === "failed").length;

  $("libStats").innerHTML = [
    `<span class="lib-stat"><b>${(STATE.items||[]).length}</b> total</span>`,
    `<span class="lib-stat"><b>${uploaded}</b> terupload</span>`,
    `<span class="lib-stat"><b>${rendered}</b> rendered</span>`,
    failed ? `<span class="lib-stat" style="color:var(--red)"><b>${failed}</b> gagal</span>` : "",
  ].join("");

  if (!items.length) {
    $("libraryGrid").innerHTML = "";
    $("libraryEmpty").classList.remove("hidden");
    return;
  }
  $("libraryEmpty").classList.add("hidden");
  $("libraryGrid").innerHTML = items.map(it => videoCardHTML(it)).join("");
  $("libraryGrid").querySelectorAll(".video-card").forEach((card, i) => {
    card.addEventListener("click", () => openDrawer(items[i]));
  });
}

[$("librarySearch"), $("libraryFilter"), $("librarySort")].forEach(el => {
  el.addEventListener("input", renderLibrary);
});

/* ============================================================
   VIDEO CARD
   ============================================================ */
function videoCardHTML(item) {
  const thumb = item.thumbnailUrl ? `<img class="vc-thumb-img" src="${item.thumbnailUrl}" loading="lazy" alt="">` :
    `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" width="40" height="40" opacity=".15"><rect x="4" y="8" width="40" height="28" rx="3"/><path d="M18 18l14 6-14 6V18z"/></svg>`;
  const status = item.status || "pending";
  return `
    <div class="video-card">
      <div class="vc-thumb">
        ${thumb}
        <div class="vc-play"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 5l10 5-10 5V5z"/></svg></div>
        <span class="vc-status-dot ${status}"></span>
      </div>
      <div class="vc-body">
        <div class="vc-title">${escHtml(item.title || "Tanpa judul")}</div>
        <div class="vc-meta">
          ${item.durationSec ? `<span class="vc-chip">⏱ ${fmt.dur(item.durationSec)}</span>` : ""}
          ${item.costUsd ? `<span class="vc-chip">💰 ${fmt.usd(item.costUsd)}</span>` : ""}
          <span class="vc-chip">${statusLabel(status)}</span>
        </div>
      </div>
    </div>`;
}

function statusLabel(s) {
  return { uploaded: "✅ Upload", rendered: "🎞️ Rendered", failed: "❌ Gagal", pending: "⏳ Antri" }[s] || s;
}

/* ============================================================
   QUEUE
   ============================================================ */
function renderQueue() {
  const queue = STATE.queue || [];
  if (!queue.length) {
    $("queueList").innerHTML = "";
    $("queueEmpty").classList.remove("hidden");
    return;
  }
  $("queueEmpty").classList.add("hidden");
  $("queueList").innerHTML = queue.map((it, i) => `
    <div class="queue-item">
      <span class="qi-num">#${i + 1}</span>
      <div class="qi-body">
        <div class="qi-title">${escHtml(it.topic || "(AI memilih topik)")}</div>
        <div class="qi-meta">${it.durationSec ? fmt.dur(it.durationSec) : ""} · ${it.ttsProvider || "openai"} · ${it.resolution || "1080p"}</div>
      </div>
      <div class="qi-actions">
        <button class="btn ghost tiny" data-qi="${i}" data-action="remove">Hapus</button>
      </div>
    </div>
  `).join("");
  $("queueList").querySelectorAll("[data-action='remove']").forEach(btn => {
    btn.addEventListener("click", () => removeFromQueue(+btn.dataset.qi));
  });
}

async function removeFromQueue(idx) {
  const queue = STATE.queue || [];
  if (!queue[idx]) return;
  try {
    await apiFetch("/api/queue", { method: "DELETE", body: JSON.stringify({ index: idx }) });
    toast("Item dihapus dari antrian.", "ok");
    await loadData();
  } catch { toast("Gagal menghapus.", "err"); }
}

/* ============================================================
   RUNS
   ============================================================ */
function renderRuns() {
  const runs = STATE.recentRuns || [];
  if (!runs.length) {
    $("runsList").innerHTML = "";
    $("runsEmpty").classList.remove("hidden");
    return;
  }
  $("runsEmpty").classList.add("hidden");
  $("runsList").innerHTML = runs.map(r => {
    const cls = r.conclusion === "success" ? "success" : r.status === "in_progress" ? "in_progress" : "failure";
    return `
    <div class="run-item">
      <span class="ri-status ${cls}"></span>
      <div class="ri-body">
        <div class="ri-title">${escHtml(r.name || "GitHub Actions Run")}</div>
        <div class="ri-meta">${fmt.date(r.created_at)} ${fmt.time(r.created_at)} · ${r.conclusion || r.status || "—"}</div>
      </div>
      <div class="ri-link">${r.html_url ? `<a href="${r.html_url}" target="_blank" rel="noopener">Lihat →</a>` : ""}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   TRENDS
   ============================================================ */
async function loadTrends() {
  TRENDS_LOADED = true;
  $("trendList").innerHTML = `<div class="empty-state"><p class="muted">Memuat tren...</p></div>`;
  try {
    const data = await apiFetch("/api/trends");
    renderTrends(data);
  } catch (e) {
    $("trendList").innerHTML = `<div class="empty-state"><p class="muted">Gagal memuat tren. Coba lagi.</p></div>`;
    TRENDS_LOADED = false;
  }
}

$("refreshTrendsBtn").addEventListener("click", () => { TRENDS_LOADED = false; loadTrends(); });

function renderTrends(data) {
  const items = data.trends || data.items || data || [];
  if (data.criteria) {
    $("trendCriteria").textContent = "Kriteria: " + data.criteria;
    $("trendMedia").textContent = data.sources ? "Sumber: " + data.sources : "";
    $("trendUpdated").textContent = data.updatedAt ? "Diperbarui: " + fmt.rel(data.updatedAt) : "";
  }
  if (!items.length) {
    $("trendList").innerHTML = `<div class="empty-state"><p class="muted">Tidak ada tren tersedia saat ini.</p></div>`;
    return;
  }
  $("trendList").innerHTML = items.map((t, i) => {
    const hot = i < 3;
    return `
    <div class="trend-card">
      <div class="trend-rank ${hot ? "hot" : ""}">#${i + 1}</div>
      <div class="trend-body">
        <div class="trend-title-row">
          <span class="trend-title-text">${escHtml(t.title || t.topic || t)}</span>
          <button class="btn ghost tiny trend-use-btn" data-idx="${i}">Gunakan</button>
        </div>
        <div class="trend-meta">
          ${t.category ? `<span>${t.category}</span>` : ""}
          ${t.score != null ? `<span class="trend-score">Skor ${Math.round(t.score)}</span>` : ""}
          ${t.publishedAt ? `<span>${fmt.rel(t.publishedAt)}</span>` : ""}
          ${t.source ? `<span>${escHtml(t.source)}</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");
  $("trendList").querySelectorAll(".trend-use-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = items[+btn.dataset.idx];
      selectTrend(t);
    });
  });
}

function selectTrend(t) {
  SELECTED_TREND = t;
  $("trendSelectedCard").classList.remove("hidden");
  $("trendSelTitle").textContent = t.title || t.topic || t;
  gotoView("create");
  const topicInput = document.querySelector("#createForm input[name='topic']");
  if (topicInput) topicInput.value = t.title || t.topic || "";
  updateEstimate();
  toast("Tren dipilih. Sesuaikan lalu klik Generate.", "ok");
}

$("clearTrend").addEventListener("click", () => {
  SELECTED_TREND = null;
  $("trendSelectedCard").classList.add("hidden");
  const topicInput = document.querySelector("#createForm input[name='topic']");
  if (topicInput) topicInput.value = "";
});

/* ============================================================
   HEALTH
   ============================================================ */
$("preflightBtn").addEventListener("click", runPreflight);

async function runPreflight() {
  const list = $("healthList");
  list.innerHTML = `<div class="empty-state"><p class="muted">Memeriksa sistem...</p></div>`;
  try {
    const data = await apiFetch("/api/preflight");
    const checks = data.checks || [];
    list.innerHTML = checks.map(c => {
      const level = c.ok ? "ok" : c.required === false ? "warn" : "error";
      return `<div class="health-item">
        <span class="hi-dot ${level}"></span>
        <div class="hi-body">
          <div class="hi-name">${escHtml(c.name)}</div>
          <div class="hi-msg muted">${escHtml(c.detail || "")}</div>
        </div>
      </div>`;
    }).join("");
    if (!checks.length) list.innerHTML = `<div class="empty-state"><p class="muted">Tidak ada data preflight.</p></div>`;
    toast("Diagnostik selesai.", "ok");
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p class="muted">Gagal menjalankan diagnostik: ${escHtml(e.message)}</p></div>`;
    toast("Gagal diagnostik.", "err");
  }
}

function setHealthItem(id, level, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector(".hi-dot").className = `hi-dot ${level}`;
  el.querySelector(".hi-msg").textContent = msg;
}

function renderHealth(items) {
  if (!items.length) {
    $("healthList").innerHTML = `<div class="empty-state"><p class="muted">Klik "Jalankan" untuk cek semua sistem.</p></div>`;
  }
}

/* ============================================================
   CREATE FORM
   ============================================================ */
const FORMATS = [
  { value: "", label: "🤖 AI Pilih" },
  { value: "story", label: "📖 Narasi" },
  { value: "explainer", label: "🔬 Edukasi" },
  { value: "listicle", label: "📋 List" },
  { value: "documentary", label: "🎥 Dokumenter" },
  { value: "mystery", label: "🔍 Misteri" },
];

const TTS_VOICES = {
  openai: [
    { value: "onyx", label: "Onyx (Dalam)" },
    { value: "nova", label: "Nova (Jernih)" },
    { value: "echo", label: "Echo (Natural)" },
    { value: "fable", label: "Fable (Hangat)" },
    { value: "shimmer", label: "Shimmer (Lembut)" },
  ],
  elevenlabs: [
    { value: "Rachel", label: "Rachel" },
    { value: "Adam", label: "Adam" },
    { value: "Bella", label: "Bella" },
  ],
};

function initCreateForm() {
  // Format picker
  $("formatPicker").innerHTML = FORMATS.map(f =>
    `<button type="button" class="format-btn${f.value === "" ? " active" : ""}" data-val="${f.value}">${f.label}</button>`
  ).join("");
  $("formatPicker").querySelectorAll(".format-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $("formatPicker").querySelectorAll(".format-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $("formatTypeInput").value = btn.dataset.val;
    });
  });

  // TTS provider change
  const providerSel = document.querySelector("#createForm select[name='ttsProvider']");
  const voiceSel = $("ttsVoiceSelect");
  function updateVoices() {
    const p = providerSel.value;
    const voices = TTS_VOICES[p] || TTS_VOICES.openai;
    voiceSel.innerHTML = voices.map(v => `<option value="${v.value}">${v.label}</option>`).join("");
  }
  updateVoices();
  providerSel.addEventListener("change", updateVoices);

  // Estimate
  document.getElementById("createForm").querySelectorAll("select").forEach(s => s.addEventListener("change", updateEstimate));
  updateEstimate();

  // Generate / queue buttons
  $("btnGenerate").addEventListener("click", () => submitCreate(false));
  $("btnQueue").addEventListener("click", () => submitCreate(true));
}

function updateEstimate() {
  const form = document.getElementById("createForm");
  const dur = +(form.querySelector("[name='durationSec']")?.value || 1200);
  const quality = form.querySelector("[name='imageQuality']")?.value || "low";
  const provider = form.querySelector("[name='ttsProvider']")?.value || "openai";
  const scenes = +(form.querySelector("[name='sceneCount']")?.value || 26);

  const words = Math.round(dur * 2.35);
  const ttsCost = provider === "elevenlabs" ? words * 0.00003 : words * 0.000015;
  const imgPerScene = quality === "high" ? 3 : quality === "medium" ? 2 : 1;
  const imgCost = scenes * imgPerScene * 0.04;
  const total = ttsCost + imgCost;

  $("estDur").textContent = `~${Math.round(dur / 60)} mnt`;
  $("estWords").textContent = `~${fmt.num(words)}`;
  $("estCost").textContent = `~${fmt.usd(ttsCost)}`;
  $("estImg").textContent = `~${fmt.usd(imgCost)}`;
  $("estTotal").textContent = `~${fmt.usd(total)}`;
}

async function submitCreate(queue) {
  const form = document.getElementById("createForm");
  const data = Object.fromEntries(new FormData(form));
  data.formatType = $("formatTypeInput").value;
  if (data.force === "on") data.force = true;

  if (SELECTED_TREND) data.trendContext = SELECTED_TREND;

  const btn = queue ? $("btnQueue") : $("btnGenerate");
  btn.disabled = true;
  btn.textContent = queue ? "Menambahkan..." : "Memulai...";
  try {
    const endpoint = queue ? "/api/queue" : "/api/run";
    const method = queue ? "POST" : "POST";
    await apiFetch(endpoint, { method, body: JSON.stringify(data) });
    toast(queue ? "Ditambahkan ke antrian." : "Workflow dimulai! Pantau di Proses.", "ok");
    if (!queue) gotoView("overview");
    else gotoView("queue");
    await loadData();
  } catch (e) {
    toast("Gagal: " + (e.message || "error"), "err");
  } finally {
    btn.disabled = false;
    btn.textContent = queue ? "Tambah ke Antrian" : "Generate Sekarang";
  }
}

/* ============================================================
   DRAWER
   ============================================================ */
function openDrawer(item) {
  const b = $("drawerBody");
  const thumb = item.thumbnailUrl
    ? `<div class="drawer-thumb"><img src="${item.thumbnailUrl}" alt=""></div>`
    : `<div class="drawer-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-3)">No thumbnail</div>`;

  b.innerHTML = `
    ${thumb}
    <div class="drawer-title">${escHtml(item.title || "Tanpa judul")}</div>
    <div class="drawer-meta">
      <span class="vc-chip">${statusLabel(item.status)}</span>
      ${item.durationSec ? `<span class="vc-chip">⏱ ${fmt.dur(item.durationSec)}</span>` : ""}
      ${item.costUsd ? `<span class="vc-chip">💰 ${fmt.usd(item.costUsd)}</span>` : ""}
    </div>
    <div class="drawer-section">
      <div class="drawer-section-label">Detail</div>
      ${drawerRow("ID", item.id || "—")}
      ${drawerRow("Dibuat", fmt.date(item.createdAt))}
      ${drawerRow("TTS", item.ttsProvider || "—")}
      ${drawerRow("Resolusi", item.resolution || "—")}
      ${drawerRow("Adegan", item.sceneCount || "—")}
      ${drawerRow("Format", item.formatType || "—")}
    </div>
    <div class="drawer-actions">
      ${item.youtubeUrl ? `<a href="${item.youtubeUrl}" target="_blank" rel="noopener" class="btn primary tiny">▶ Tonton di YouTube</a>` : ""}
      ${item.videoPath ? `<button class="btn ghost tiny" onclick="copyToClip('${escHtml(item.videoPath || "")}')">Salin Path</button>` : ""}
    </div>`;
  $("drawer").classList.remove("hidden");
}

function drawerRow(label, val) {
  return `<div class="drawer-row"><span class="muted">${label}</span><b>${escHtml(String(val))}</b></div>`;
}

$("closeDrawer").addEventListener("click", () => $("drawer").classList.add("hidden"));
$("drawer").addEventListener("click", e => { if (e.target === $("drawer")) $("drawer").classList.add("hidden"); });

/* ============================================================
   COMMAND PALETTE
   ============================================================ */
const CMD_ITEMS = [
  { label: "Ringkasan", action: () => gotoView("overview"), icon: "🏠" },
  { label: "Buat Video Baru", action: () => gotoView("create"), icon: "🎬" },
  { label: "Pustaka Video", action: () => gotoView("library"), icon: "📚" },
  { label: "Antrian Produksi", action: () => gotoView("queue"), icon: "📋" },
  { label: "Riwayat Proses", action: () => gotoView("runs"), icon: "⚡" },
  { label: "Tren Berita", action: () => { gotoView("trends"); if (!TRENDS_LOADED) loadTrends(); }, icon: "📈" },
  { label: "Diagnostik Sistem", action: () => { gotoView("health"); runPreflight(); }, icon: "🛡️" },
  { label: "Refresh Data", action: () => { loadData(); toast("Data diperbarui.", "ok"); }, icon: "🔄" },
  { label: "Keluar", action: () => { PIN = ""; sessionStorage.removeItem(PIN_KEY); location.reload(); }, icon: "🚪" },
];

$("cmdBtn").addEventListener("click", openCmd);
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openCmd(); }
  if (e.key === "Escape") { closeCmd(); closeKbd(); }
  if ($("cmdPalette").classList.contains("hidden") && !e.target.closest("input, select, textarea")) {
    if (e.key === "?") { e.preventDefault(); openKbd(); }
    if (e.key === "r" || e.key === "R") { e.preventDefault(); triggerRefresh(); }
    const n = parseInt(e.key);
    if (n >= 1 && n <= 7) { const views = ["overview","create","library","queue","runs","trends","health"]; gotoView(views[n-1]); }
  }
  if (!$("cmdPalette").classList.contains("hidden")) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveCmdSel(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCmdSel(-1); }
    if (e.key === "Enter") { e.preventDefault(); execCmdSel(); }
  }
});

function openCmd() {
  $("cmdPalette").classList.remove("hidden");
  $("cmdInput").value = "";
  CMD_ACTIVE_IDX = -1;
  renderCmdItems(CMD_ITEMS);
  requestAnimationFrame(() => $("cmdInput").focus());
}
function closeCmd() { $("cmdPalette").classList.add("hidden"); }

$("cmdPalette").addEventListener("click", e => { if (e.target === $("cmdPalette")) closeCmd(); });

$("cmdInput").addEventListener("input", () => {
  const q = $("cmdInput").value.toLowerCase();
  const filtered = q
    ? CMD_ITEMS.filter(c => c.label.toLowerCase().includes(q))
      .concat((STATE.items || []).filter(it => it.title && it.title.toLowerCase().includes(q)).slice(0,4).map(it => ({
        label: it.title, icon: "🎞️", action: () => openDrawer(it)
      })))
    : CMD_ITEMS;
  CMD_ACTIVE_IDX = -1;
  renderCmdItems(filtered);
});

function renderCmdItems(items) {
  $("cmdResults").innerHTML = (items.length ? items : [{ label: "Tidak ditemukan.", icon: "—", action: null }])
    .map((c, i) => `<div class="cmd-item" data-idx="${i}">${c.icon ? `<span class="cmd-item-icon">${c.icon}</span>` : ""}<span>${escHtml(c.label)}</span></div>`)
    .join("");
  $("cmdResults").querySelectorAll(".cmd-item").forEach((el, i) => {
    el.addEventListener("click", () => { if (items[i]?.action) { items[i].action(); closeCmd(); } });
    el.addEventListener("mouseenter", () => { CMD_ACTIVE_IDX = i; highlightCmd(i); });
  });
}

function moveCmdSel(dir) {
  const items = $("cmdResults").querySelectorAll(".cmd-item");
  CMD_ACTIVE_IDX = Math.max(0, Math.min(items.length - 1, CMD_ACTIVE_IDX + dir));
  highlightCmd(CMD_ACTIVE_IDX);
}
function highlightCmd(idx) {
  $("cmdResults").querySelectorAll(".cmd-item").forEach((el, i) => el.classList.toggle("active", i === idx));
}
function execCmdSel() {
  const el = $("cmdResults").querySelector(".cmd-item.active");
  if (el) el.click();
}

/* ============================================================
   KEYBOARD SHORTCUT MODAL
   ============================================================ */
$("kbdHintBtn").addEventListener("click", openKbd);
$("closeKbd").addEventListener("click", closeKbd);
$("kbdModal").addEventListener("click", e => { if (e.target === $("kbdModal")) closeKbd(); });
function openKbd() { $("kbdModal").classList.remove("hidden"); }
function closeKbd() { $("kbdModal").classList.add("hidden"); }

/* ============================================================
   REFRESH BUTTON
   ============================================================ */
$("refreshBtn").addEventListener("click", triggerRefresh);
function triggerRefresh() {
  $("refreshBtn").classList.add("spinning");
  loadData().finally(() => setTimeout(() => $("refreshBtn").classList.remove("spinning"), 600));
}

/* ============================================================
   CONSOLE CONTROLS
   ============================================================ */
$("clearLog").addEventListener("click", () => { $("console").textContent = ""; });
$("copyLog").addEventListener("click", () => {
  navigator.clipboard?.writeText($("console").textContent || "").then(() => toast("Log disalin.", "ok"));
});

/* ============================================================
   API HELPER
   ============================================================ */
async function apiFetch(url, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(PIN ? { "x-pin": PIN } : {}), ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) throw new Error("Tidak terotorisasi.");
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

/* ============================================================
   HELPERS
   ============================================================ */
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function slugify(s) { return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); }
function copyToClip(text) { navigator.clipboard?.writeText(text).then(() => toast("Disalin.", "ok")); }

/* ============================================================
   INIT
   ============================================================ */
initCreateForm();
checkAuth();
