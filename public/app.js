"use strict";

const PIN_KEY = "yt_dashboard_pin";
let PIN = sessionStorage.getItem(PIN_KEY) || "";
let STATE = { items: [], queue: [], config: {}, activeRun: null, recentRuns: [], stats: {} };
let POLL = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
function fmtDur(s) { return s ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : "-"; }

function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add("hidden"), 3500);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (PIN) headers["x-dashboard-pin"] = PIN;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    showAuth();
    throw new Error("Auth diperlukan");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Auth ----------
function showAuth() {
  $("#authOverlay").classList.add("active");
  $("#app").classList.add("hidden");
  if (POLL) clearInterval(POLL);
}
function hideAuth() {
  $("#authOverlay").classList.remove("active");
  $("#app").classList.remove("hidden");
}

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $("#authPin").value.trim();
  try {
    const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      $("#authError").textContent = d.error || "PIN salah.";
      return;
    }
    PIN = pin;
    sessionStorage.setItem(PIN_KEY, pin);
    $("#authError").textContent = "";
    hideAuth();
    boot();
  } catch (err) {
    $("#authError").textContent = err.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
  sessionStorage.removeItem(PIN_KEY);
  PIN = "";
  showAuth();
});

// ---------- Navigation ----------
const VIEW_TITLES = {
  overview: ["Ringkasan", "Operational Overview"],
  create: ["Buat Video", "Generator Video Panjang"],
  library: ["Pustaka", "Semua Video"],
  queue: ["Antrian", "Daftar Antrian Produksi"],
  runs: ["Proses", "Riwayat GitHub Actions"],
  health: ["Diagnostik", "Health Check Sistem"]
};
function switchView(view) {
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === view));
  const [k, t] = VIEW_TITLES[view] || ["", ""];
  $("#viewKicker").textContent = k;
  $("#viewTitle").textContent = t;
}
$$(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) switchView(goto.dataset.goto);
});

// ---------- Render ----------
function render() {
  renderMetrics();
  renderRun();
  renderConsole();
  renderLibrary();
  renderRecent();
  renderQueue();
  renderRuns();
  renderConfigLine();
}

function renderConfigLine() {
  const c = STATE.config || {};
  $("#configLine").textContent = `${c.repo || ""} · ${c.workflow || ""} · YT limit ${c.youtubeDailyUploadLimit ?? "-"}/hari`;
}

function renderMetrics() {
  const s = STATE.stats || {};
  const cards = [
    ["Total Video", s.total ?? 0],
    ["Terupload", s.uploaded ?? 0],
    ["Rendered", s.rendered ?? 0],
    ["Hari Ini", s.todayCount ?? 0],
    ["Total Durasi", fmtDur(s.totalDurationSec || 0)],
    ["Biaya (USD)", `$${(s.totalCostUsd || 0).toFixed(2)}`]
  ];
  $("#metrics").innerHTML = cards.map(([l, v]) => `<div class="metric"><div class="val">${esc(v)}</div><div class="lbl">${esc(l)}</div></div>`).join("");
}

function statusBadge(it) {
  if (it?.publish?.youtube?.url) return '<span class="badge ok">Terupload</span>';
  if (it?.status === "rendered" || it?.assets?.video?.url) return '<span class="badge running">Rendered</span>';
  if (it?.publish?.errors?.youtube) return '<span class="badge err">Gagal</span>';
  return '<span class="badge idle">Draft</span>';
}

function renderRun() {
  const r = STATE.activeRun;
  const badge = $("#runBadge");
  if (!r) {
    badge.className = "badge idle"; badge.textContent = "Idle";
    $("#progressBar").style.width = "0%";
    $("#runDetail").textContent = "Belum ada workflow berjalan.";
    $("#runSteps").innerHTML = "";
    $("#liveDot").className = "live-dot";
    return;
  }
  const running = r.status === "running";
  badge.className = `badge ${running ? "running" : (r.conclusion === "success" ? "ok" : r.conclusion === "failure" ? "err" : "idle")}`;
  badge.textContent = running ? "Running" : (r.conclusion || r.status || "Idle");
  $("#progressBar").style.width = `${r.progress ?? (running ? 10 : 100)}%`;
  $("#runDetail").textContent = r.detail || "";
  $("#liveDot").className = `live-dot ${running ? "" : "stale"}`;
  const steps = (r.logs || []).slice(-8);
  $("#runSteps").innerHTML = steps.map((l) => `<div class="run-step ${l.level}"><span class="ic"></span><span>${esc(l.text)}</span></div>`).join("");
}

function renderConsole() {
  const r = STATE.activeRun;
  const logs = r?.logs || [];
  $("#console").textContent = logs.length
    ? logs.map((l) => `[${new Date(l.at).toLocaleTimeString("id-ID")}] ${l.text}`).join("\n")
    : "Belum ada output.";
}

function cardHtml(it) {
  const thumb = it?.assets?.thumbnail?.url || "";
  const dur = it?.assets?.video?.durationSec;
  return `<article class="card" data-id="${esc(it.id)}">
    <div class="thumb">${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="">` : '<div class="noimg">no thumbnail</div>'}${dur ? `<span class="dur">${Math.round(dur)}s</span>` : ""}</div>
    <div class="body"><div class="top">${statusBadge(it)}</div>
    <h4>${esc(it.title || "(tanpa judul)")}</h4>
    <p class="muted" style="font-size:12px">${esc(it.input?.category || "")} · ${esc(fmtDate(it.createdAt))}</p></div>
  </article>`;
}

function bindCards(container) {
  container.querySelectorAll("[data-id]").forEach((n) => n.addEventListener("click", () => openDrawer(n.dataset.id)));
}

function renderRecent() {
  const items = (STATE.items || []).slice(0, 4);
  const el = $("#recentList");
  el.innerHTML = items.length ? items.map(cardHtml).join("") : '<p class="muted">Belum ada video.</p>';
  bindCards(el);
}

function renderLibrary() {
  const q = ($("#librarySearch").value || "").toLowerCase().trim();
  const filter = $("#libraryFilter").value;
  let items = STATE.items || [];
  if (q) items = items.filter((it) => `${it.title} ${it.input?.topic || ""}`.toLowerCase().includes(q));
  if (filter !== "all") {
    items = items.filter((it) => {
      if (filter === "uploaded") return it?.publish?.youtube?.url;
      if (filter === "rendered") return (it?.status === "rendered" || it?.assets?.video?.url) && !it?.publish?.youtube?.url;
      if (filter === "failed") return it?.publish?.errors?.youtube;
      return true;
    });
  }
  const el = $("#libraryGrid");
  el.innerHTML = items.map(cardHtml).join("");
  bindCards(el);
  $("#libraryEmpty").classList.toggle("hidden", items.length > 0);
}

function renderQueue() {
  const q = STATE.queue || [];
  const el = $("#queueList");
  el.innerHTML = q.map((item) => `
    <div class="queue-row">
      <div class="meta"><b>${esc(item.topic || "(AI memilih topik)")}</b><br>
      <small>${esc(item.category)} · ${item.durationSec}s · ${item.sceneCount} scene · ${esc(item.ttsVoice)} · <span class="badge ${item.status === "dispatched" ? "running" : "idle"}">${esc(item.status)}</span></small></div>
      <div class="acts">
        <button class="btn primary tiny" data-q-run="${esc(item.id)}">Generate</button>
        <button class="btn ghost tiny" data-q-del="${esc(item.id)}">Hapus</button>
      </div>
    </div>`).join("");
  $("#queueEmpty").classList.toggle("hidden", q.length > 0);
  el.querySelectorAll("[data-q-run]").forEach((b) => b.addEventListener("click", () => runQueueItem(b.dataset.qRun)));
  el.querySelectorAll("[data-q-del]").forEach((b) => b.addEventListener("click", () => deleteQueueItem(b.dataset.qDel)));
}

function renderRuns() {
  const runs = STATE.recentRuns || [];
  $("#runsList").innerHTML = runs.length ? runs.map((r) => `
    <div class="run-row">
      <div class="meta"><b>${esc(r.display_title || r.name)}</b><br>
      <small>${esc(r.event)} · ${esc(fmtDate(r.created_at))}</small></div>
      <div class="acts">
        <span class="badge ${r.conclusion || r.status}">${esc(r.conclusion || r.status)}</span>
        <a class="btn ghost tiny" href="${esc(r.html_url)}" target="_blank" rel="noopener">Buka</a>
      </div>
    </div>`).join("") : '<p class="muted">Belum ada run.</p>';
}

// ---------- Drawer ----------
function openDrawer(id) {
  const it = (STATE.items || []).find((x) => x.id === id);
  if (!it) return;
  const yt = it?.publish?.youtube?.url;
  const video = it?.assets?.video?.url;
  const points = (it.plan?.importantPoints || []).map((p) => `<li>${esc(p)}</li>`).join("");
  $("#drawerBody").innerHTML = `
    <h2>${esc(it.title || "")}</h2>
    <p class="muted">${esc(it.id)} · ${esc(fmtDate(it.createdAt))}</p>
    ${it.assets?.thumbnail?.url ? `<img class="detail-thumb" src="${esc(it.assets.thumbnail.url)}" alt="">` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      ${statusBadge(it)}
      ${yt ? `<a class="btn primary tiny" href="${esc(yt)}" target="_blank" rel="noopener">▶ YouTube</a>` : ""}
      ${video ? `<a class="btn ghost tiny" href="${esc(video)}" target="_blank" rel="noopener">Video mentah</a>` : ""}
    </div>
    ${it.publish?.errors?.youtube ? `<p style="color:var(--err)">Error: ${esc(it.publish.errors.youtube)}</p>` : ""}
    ${it.plan?.hook ? `<h4>Hook</h4><p>${esc(it.plan.hook)}</p>` : ""}
    ${it.plan?.summary ? `<h4>Ringkasan</h4><p>${esc(it.plan.summary)}</p>` : ""}
    ${points ? `<h4>Poin Penting</h4><ul>${points}</ul>` : ""}
    <h4>Detail</h4>
    <ul class="kv">
      <li><span>Durasi</span><b>${fmtDur(it.assets?.video?.durationSec)}</b></li>
      <li><span>Scene</span><b>${it.plan?.scenes?.length || "-"}</b></li>
      <li><span>TTS</span><b>${esc(it.assets?.audio?.provider || it.input?.ttsProvider || "-")}</b></li>
      <li><span>Kategori</span><b>${esc(it.input?.category || "-")}</b></li>
      <li><span>Biaya</span><b>$${Number(it.cost?.totalUsd || 0).toFixed(4)}</b></li>
    </ul>`;
  $("#drawer").classList.remove("hidden");
}
$("#closeDrawer").addEventListener("click", () => $("#drawer").classList.add("hidden"));
$("#drawer").addEventListener("click", (e) => { if (e.target === $("#drawer")) $("#drawer").classList.add("hidden"); });

// ---------- Actions ----------
function formData() {
  const f = $("#createForm");
  return {
    topic: f.topic.value.trim(),
    category: f.category.value,
    durationSec: Number(f.durationSec.value),
    sceneCount: Number(f.sceneCount.value),
    ttsProvider: f.ttsProvider.value,
    ttsVoice: f.ttsVoice.value,
    imageQuality: f.imageQuality.value,
    force: f.force.checked
  };
}

$("#btnGenerate").addEventListener("click", async () => {
  const btn = $("#btnGenerate");
  btn.disabled = true; btn.textContent = "Mengirim…";
  try {
    await api("/api/run", { method: "POST", body: JSON.stringify(formData()) });
    toast("Workflow ter-trigger. Pantau di tab Proses.", "ok");
    switchView("overview");
    setTimeout(refresh, 4000);
  } catch (e) { toast(e.message, "err"); }
  finally { btn.disabled = false; btn.textContent = "🚀 Generate Sekarang"; }
});

$("#btnQueue").addEventListener("click", async () => {
  try {
    await api("/api/queue", { method: "POST", body: JSON.stringify(formData()) });
    toast("Ditambahkan ke antrian.", "ok");
    await refresh();
    switchView("queue");
  } catch (e) { toast(e.message, "err"); }
});

async function runQueueItem(id) {
  const item = (STATE.queue || []).find((q) => q.id === id);
  if (!item) return;
  try {
    await api("/api/queue", { method: "POST", body: JSON.stringify({ ...item, run_now: true }) });
    toast("Item antrian di-generate.", "ok");
    setTimeout(refresh, 3000);
  } catch (e) { toast(e.message, "err"); }
}

async function deleteQueueItem(id) {
  try {
    await api("/api/queue", { method: "DELETE", body: JSON.stringify({ id }) });
    toast("Item dihapus.", "ok");
    await refresh();
  } catch (e) { toast(e.message, "err"); }
}

$("#preflightBtn").addEventListener("click", async () => {
  $("#healthList").innerHTML = '<p class="muted">Memeriksa…</p>';
  try {
    const { checks } = await api("/api/preflight");
    $("#healthList").innerHTML = checks.map((c) => `
      <div class="health-row"><span class="dot ${c.ok ? "ok" : (c.required ? "bad" : "warn")}"></span>
      <div><b>${esc(c.name)}</b><small>${esc(c.detail)}</small></div></div>`).join("");
  } catch (e) { $("#healthList").innerHTML = `<p style="color:var(--err)">${esc(e.message)}</p>`; }
});

$("#copyLog").addEventListener("click", () => {
  navigator.clipboard.writeText($("#console").textContent).then(() => toast("Log disalin.", "ok"));
});

$("#librarySearch").addEventListener("input", renderLibrary);
$("#libraryFilter").addEventListener("change", renderLibrary);
$("#refreshBtn").addEventListener("click", refresh);

// ---------- Data ----------
async function refresh() {
  try {
    STATE = await api("/api/state");
    render();
  } catch (e) {
    if (!String(e.message).includes("Auth")) toast(e.message, "err");
  }
}

function boot() {
  refresh();
  if (POLL) clearInterval(POLL);
  POLL = setInterval(refresh, 15000);
}

// clock
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }, 1000);

// init
if (PIN) {
  hideAuth();
  boot();
} else {
  showAuth();
}
