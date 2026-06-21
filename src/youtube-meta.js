/**
 * YouTube Meta - membangun judul, deskripsi, dan tag siap-copy dari item.
 * Tidak memanggil API; murni menyusun dari naskah yang sudah ada.
 */

import { cleanText } from "./util.js";

function oneLine(value, max = 5000) {
  return cleanText(String(value || "").replace(/\s+/g, " "), max).trim();
}

function titleCase(value) {
  const t = oneLine(value, 100);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Hapus awalan deskriptif yang membosankan agar judul langsung menggigit. */
function cleanCuriosity(value) {
  return value
    .replace(/^(Apa Itu|Penjelasan Tentang|Pembahasan|Analisis)\s+/i, "")
    .replace(/\s*[—–-]\s*(Sebuah|Suatu)?\s*(Analisis|Pembahasan|Penjelasan|Studi).*$/i, "")
    .trim();
}

/** Judul: maksimal 65 char, singkat padat bikin penasaran. */
export function buildTitle(item) {
  const raw = oneLine(item.title || item.plan?.title || item.input?.topic || "Fakta Menarik", 100);
  let title = titleCase(cleanCuriosity(raw));
  // Potong di 65 karakter agar tampil penuh di YouTube search & mobile
  if (title.length > 65) {
    const cut = title.slice(0, 65);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 35 ? cut.slice(0, lastSpace) : cut).trim();
    // Pastikan tidak berakhir di kata sambung
    title = title.replace(/\s+(yang|dan|di|ke|dari|untuk|pada|atau|ini|itu)$/i, "").trim();
  }
  // Hapus tanda baca ganda di akhir
  title = title.replace(/[?.!]{2,}$/, (m) => m[0]);
  return title;
}

/** Tag dari kata kunci judul + kategori + trending keywords. */
export function buildTags(item) {
  const stop = new Set(["yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa",
    "mengapa", "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "padahal", "the", "of"]);
  const fromTitle = oneLine(item.title || "", 200).toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .split(" ")
    .filter((w) => w.length > 3 && !stop.has(w));
  const base = ["edukasi", "pengetahuan", "fakta menarik", "belajar",
    oneLine(item.input?.category || "", 40)].filter(Boolean);
  const trendingKw = Array.isArray(item.input?.trendingKeywords)
    ? item.input.trendingKeywords.filter((kw) => kw && kw.length > 2 && kw.length < 40)
    : [];
  const all = [...new Set([...base, ...trendingKw.slice(0, 5), ...fromTitle])].slice(0, 18);
  return all;
}

/**
 * Deskripsi YouTube lengkap & rapi:
 * hook -> ringkasan -> poin -> timestamp opsional -> ajakan -> tag hashtag.
 */
export function buildDescription(item) {
  const hook = oneLine(item.plan?.hook || "", 400);
  const summary = oneLine(item.plan?.summary || "", 600);
  const points = (item.plan?.importantPoints || [])
    .slice(0, 6)
    .map((p) => `\u2705 ${oneLine(p, 140)}`)
    .filter(Boolean)
    .join("\n");

  const chapters = buildChapters(item);
  const sources = buildSourcesBlock(item);
  const tags = buildTags(item);
  const hashtags = tags.slice(0, 6).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");

  const blocks = [
    hook || item.title,
    summary,
    points ? `Yang akan kamu pahami:\n${points}` : "",
    chapters ? `Bab:\n${chapters}` : "",
    "Tonton sampai habis supaya gambaran lengkapnya nyambung.",
    "Kalau bermanfaat, like dan subscribe untuk video pengetahuan lainnya.",
    sources,
    hashtags
  ].filter(Boolean);

  return blocks.join("\n\n").slice(0, 4900);
}

/**
 * Blok atribusi sumber fakta. Wikipedia berlisensi CC BY-SA sehingga wajib
 * dicantumkan saat naskah memakai faktanya. Kosong bila tidak ada sumber.
 */
export function buildSourcesBlock(item) {
  const rawSources = Array.isArray(item.plan?.sources) ? item.plan.sources : [];
  const seen = new Set();
  const valid = [];
  for (const source of rawSources) {
    const url = oneLine(source?.url, 300);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    valid.push({ title: oneLine(source?.title, 160), url });
    if (valid.length >= 5) break;
  }
  if (!valid.length) return "";
  const lines = valid.map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.url}`).join("\n");
  return `Sumber & referensi fakta:\n${lines}\nSebagian fakta dirangkum dari Wikipedia (lisensi CC BY-SA).`;
}

/** Timestamp bab perkiraan dari durasi scene (kalau ada). */
function buildChapters(item) {
  const scenes = item.plan?.scenes || [];
  const render = Array.isArray(item.assets?.video?.chapters) ? item.assets.video.chapters : null;
  // Tanpa data timing per scene yang pasti, lewati agar tidak menyesatkan.
  if (!render) return "";
  return render.map((c) => `${c.time} ${c.label}`).join("\n");
}

/** Bundel lengkap untuk disimpan/ditampilkan. */
export function buildYoutubeMeta(item) {
  return {
    title: buildTitle(item),
    description: buildDescription(item),
    tags: buildTags(item)
  };
}

/** Teks siap-copy (blok untuk file .txt / konsol). */
export function formatMetaForCopy(item) {
  const meta = buildYoutubeMeta(item);
  return [
    "===== JUDUL =====",
    meta.title,
    "",
    "===== DESKRIPSI =====",
    meta.description,
    "",
    "===== TAG (pisahkan koma) =====",
    meta.tags.join(", "),
    ""
  ].join("\n");
}
