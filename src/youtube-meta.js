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

/** Judul: maksimal 100 char, menarik tapi tidak clickbait berlebihan. */
export function buildTitle(item) {
  const base = oneLine(item.title || item.plan?.title || item.input?.topic || "Fakta Menarik", 100);
  let title = titleCase(base);
  if (title.length > 100) {
    const cut = title.slice(0, 100);
    title = cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 100).trim();
  }
  return title;
}

/** Tag dari kata kunci judul + kategori. */
export function buildTags(item) {
  const stop = new Set(["yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa",
    "mengapa", "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "padahal", "the", "of"]);
  const fromTitle = oneLine(item.title || "", 200).toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .split(" ")
    .filter((w) => w.length > 3 && !stop.has(w));
  const base = ["edukasi", "pengetahuan", "fakta menarik", "belajar",
    oneLine(item.input?.category || "", 40)].filter(Boolean);
  const all = [...new Set([...base, ...fromTitle])].slice(0, 15);
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
  const tags = buildTags(item);
  const hashtags = tags.slice(0, 6).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");

  const blocks = [
    hook || item.title,
    summary,
    points ? `Yang akan kamu pahami:\n${points}` : "",
    chapters ? `Bab:\n${chapters}` : "",
    "Tonton sampai habis supaya gambaran lengkapnya nyambung.",
    "Kalau bermanfaat, like dan subscribe untuk video pengetahuan lainnya.",
    hashtags
  ].filter(Boolean);

  return blocks.join("\n\n").slice(0, 4900);
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
