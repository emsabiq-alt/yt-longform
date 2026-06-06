const CFG = window.YT_DASHBOARD_CONFIG || {};
let ALL_ITEMS = [];

const els = {
  list: document.getElementById("list"),
  stats: document.getElementById("stats"),
  empty: document.getElementById("empty"),
  updatedAt: document.getElementById("updatedAt"),
  search: document.getElementById("search"),
  refreshBtn: document.getElementById("refreshBtn"),
  detail: document.getElementById("detail"),
  detailBody: document.getElementById("detailBody"),
  closeDetail: document.getElementById("closeDetail")
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function statusBadge(item) {
  const yt = item.publish?.youtube?.url;
  if (yt) return '<span class="badge ok">Terupload</span>';
  if (item.status === "rendered" || item.assets?.video?.url) return '<span class="badge render">Rendered</span>';
  if (item.publish?.errors?.youtube) return '<span class="badge err">Gagal upload</span>';
  return '<span class="badge draft">Draft</span>';
}

async function loadState() {
  if (!CFG.stateUrl) {
    els.empty.textContent = "stateUrl belum dikonfigurasi di config.js";
    els.empty.classList.remove("hidden");
    return;
  }
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "Memuat...";
  try {
    const res = await fetch(`${CFG.stateUrl}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ALL_ITEMS = (Array.isArray(data) ? data : data.items || [])
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    els.updatedAt.textContent = `Diperbarui ${fmtDate(new Date().toISOString())}`;
    render();
  } catch (error) {
    els.empty.textContent = `Gagal memuat data: ${error.message}`;
    els.empty.classList.remove("hidden");
    els.list.innerHTML = "";
    els.stats.innerHTML = "";
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "Muat ulang";
  }
}

function render() {
  const q = (els.search.value || "").toLowerCase().trim();
  const items = q
    ? ALL_ITEMS.filter((it) => `${it.title} ${it.input?.topic || ""}`.toLowerCase().includes(q))
    : ALL_ITEMS;

  const uploaded = ALL_ITEMS.filter((it) => it.publish?.youtube?.url).length;
  const rendered = ALL_ITEMS.filter((it) => it.status === "rendered" || it.assets?.video?.url).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = ALL_ITEMS.filter((it) => String(it.createdAt || "").slice(0, 10) === today).length;

  els.stats.innerHTML = [
    statCard("Total Video", ALL_ITEMS.length),
    statCard("Rendered", rendered),
    statCard("Terupload YouTube", uploaded),
    statCard("Dibuat Hari Ini", todayCount)
  ].join("");

  els.empty.classList.toggle("hidden", items.length > 0);
  els.list.innerHTML = items.map(cardHtml).join("");
  els.list.querySelectorAll("[data-id]").forEach((node) => {
    node.addEventListener("click", () => openDetail(node.dataset.id));
  });
}

function statCard(label, value) {
  return `<div class="stat"><span class="stat-val">${value}</span><span class="stat-label">${esc(label)}</span></div>`;
}

function cardHtml(item) {
  const thumb = item.assets?.thumbnail?.url || "";
  const dur = item.assets?.video?.durationSec ? `${Math.round(item.assets.video.durationSec)}s` : "";
  return `
    <article class="card" data-id="${esc(item.id)}">
      <div class="thumb">${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="">` : '<div class="noimg">no thumb</div>'}</div>
      <div class="card-body">
        <div class="card-top">${statusBadge(item)} ${dur ? `<span class="muted">${dur}</span>` : ""}</div>
        <h3>${esc(item.title || "(tanpa judul)")}</h3>
        <p class="muted">${esc(item.input?.category || "")} · ${esc(fmtDate(item.createdAt))}</p>
      </div>
    </article>`;
}

function openDetail(id) {
  const item = ALL_ITEMS.find((it) => it.id === id);
  if (!item) return;
  const yt = item.publish?.youtube?.url;
  const video = item.assets?.video?.url;
  const points = (item.plan?.importantPoints || []).map((p) => `<li>${esc(p)}</li>`).join("");
  els.detailBody.innerHTML = `
    <h2>${esc(item.title || "")}</h2>
    <p class="muted">${esc(item.id)} · ${esc(fmtDate(item.createdAt))}</p>
    <div class="detail-grid">
      ${item.assets?.thumbnail?.url ? `<img class="detail-thumb" src="${esc(item.assets.thumbnail.url)}" alt="">` : ""}
      <div>
        <p>${statusBadge(item)}</p>
        ${yt ? `<p><a class="btn" href="${esc(yt)}" target="_blank" rel="noopener">Buka di YouTube</a></p>` : ""}
        ${video ? `<p><a class="link" href="${esc(video)}" target="_blank" rel="noopener">Video mentah (server)</a></p>` : ""}
        ${item.publish?.errors?.youtube ? `<p class="err-text">Error: ${esc(item.publish.errors.youtube)}</p>` : ""}
      </div>
    </div>
    ${item.plan?.hook ? `<h4>Hook</h4><p>${esc(item.plan.hook)}</p>` : ""}
    ${item.plan?.summary ? `<h4>Ringkasan</h4><p>${esc(item.plan.summary)}</p>` : ""}
    ${points ? `<h4>Poin Penting</h4><ul>${points}</ul>` : ""}
    <h4>Detail</h4>
    <ul class="kv">
      <li><span>Durasi</span><b>${item.assets?.video?.durationSec ? Math.round(item.assets.video.durationSec) + " detik" : "-"}</b></li>
      <li><span>Jumlah scene</span><b>${item.plan?.scenes?.length || "-"}</b></li>
      <li><span>TTS</span><b>${esc(item.assets?.audio?.provider || item.input?.ttsProvider || "-")}</b></li>
      <li><span>Estimasi biaya</span><b>$${(item.cost?.totalUsd || 0).toFixed?.(4) || 0}</b></li>
    </ul>`;
  els.detail.classList.remove("hidden");
}

els.refreshBtn.addEventListener("click", loadState);
els.search.addEventListener("input", render);
els.closeDetail.addEventListener("click", () => els.detail.classList.add("hidden"));
els.detail.addEventListener("click", (e) => { if (e.target === els.detail) els.detail.classList.add("hidden"); });

loadState();
setInterval(loadState, 60000);
