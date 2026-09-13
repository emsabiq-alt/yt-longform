/**
 * news-image.js
 * Download og:image dari artikel berita dan buat device mockup overlay
 * menggunakan template greenscreen (phone & tablet).
 *
 * Pipeline FFmpeg:
 *  1. Scale foto berita ke dalam area layar device (75% lebar layar, di-center)
 *  2. Composite ke template greenscreen di posisi layar yang hitam
 *  3. Chroma key untuk hapus background hijau → hands & device tetap, BG transparan
 *  4. Overlay di atas video utama dengan fade in/out
 */

import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PImage from "pureimage";
import { paths } from "./config.js";
import { resolveGoogleNewsUrl, isGoogleLogo, extractArticleImage } from "./news-research.js";
import { isGoogleImageApiAvailable, searchGoogleImages, downloadImageWithCandidates, isGenericPlaceholderQuery } from "./google-image.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets");

const DL_TIMEOUT_MS = 15_000;
const OVERLAY_DURATION = 5.5; // detik ditampilkan per scene (cukup waktu untuk membaca di layar HP)
const START_DELAY_SEC = 2.5; // jeda detik setelah scene dimulai sebelum mockup slide masuk
const SLIDE_DUR = 0.45; // detik durasi animasi slide masuk (bawah->atas) dan slide keluar (atas->bawah)

/**
 * Konfigurasi layar dalam template mockup (koordinat pixel di dimensi asli file,
 * 2816×1536 untuk kedua template saat ini). Koordinat dibatasi aman ke area hitam
 * layar murni tanpa menyentuh bezel, tangan, atau background hijau.
 * scaleMultiplier diatur agar mockup besar dan jelas terlihat di layar smartphone.
 */
const DEVICE_CONFIG = {
  phone: {
    templateFile: "phone-mockup.png",
    templateW: 2816,
    templateH: 1536,
    scaleMultiplier: 1.15, // Zoom lebih besar (+44% lebar layar) agar jelas di HP
    // Area layar hitam aman di dalam template phone
    screen: { x: 1195, y: 240, w: 410, h: 900 }
  },
  tablet: {
    templateFile: "tablet-mockup.png",
    templateW: 2816,
    templateH: 1536,
    scaleMultiplier: 1.02, // Zoom besar proporsional (+28% lebar layar)
    // Area layar hitam aman di dalam template tablet
    screen: { x: 1010, y: 210, w: 780, h: 1070 }
  }
};

// Warna chroma key green yang dipakai di template.
const CHROMA_COLOR = "0x3D9149";
const CHROMA_SIMILARITY = "0.07";
const CHROMA_BLEND = "0.03";

// Pastikan dimensi genap — filter scale/pad + encode yuva420p menolak lebar/tinggi ganjil.
function even(n) {
  return Math.round(n / 2) * 2;
}

const fontMontPath = path.join(paths.fontDir, "Montserrat-Black.ttf");
let fontLoaded = false;
function ensureFont() {
  if (fontLoaded) return;
  try {
    if (existsSync(fontMontPath)) {
      const f = PImage.registerFont(fontMontPath, "Montserrat");
      f.loadSync();
      fontLoaded = true;
    }
  } catch (err) {
    console.warn(`[NewsImage] Gagal memuat font Montserrat: ${err.message}`);
  }
}

/**
 * Validasi buffer gambar asli (JPEG, PNG, WebP) dan bukan halaman HTML redirect / error.
 */
export function isValidImageBuffer(buf) {
  if (!buf || buf.length < 1000) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WebP: RIFF ... WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

/**
 * Ambil foto entitas nyata ensiklopedis langsung dari Wikipedia REST API (Bahasa Indonesia & English).
 * Gratis, tanpa kuota API, dan 100% akurat untuk tempat bersejarah, gunung, danau, sains, dan tokoh.
 */
export async function fetchWikipediaImage(query) {
  if (!query || typeof query !== "string") return null;
  const clean = query.trim().replace(/\s+/g, "_");
  if (clean.length < 2 || isGenericPlaceholderQuery(query)) return null;

  for (const lang of ["id", "en"]) {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "yt-longform/1.0 (contact@banyaktau.id)" },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        let imgUrl = data.originalimage?.source || data.thumbnail?.source;
        if (imgUrl && !isGoogleLogo(imgUrl)) {
          if (imgUrl.includes("upload.wikimedia.org") && imgUrl.includes(".svg/")) {
            imgUrl = imgUrl.replace(/\/langid-\d+px-/, "/langid-1280px-").replace(/\/\d+px-/, "/1280px-");
          }
          return {
            imageUrl: imgUrl,
            title: data.title || query,
            outlet: lang === "id" ? "Wikipedia Indonesia" : "Wikipedia / Arsip"
          };
        }
      }
    } catch {
      // coba bahasa berikutnya
    }
  }
  return null;
}

/**
 * Verifikasi apakah suatu artikel berita relevan dengan scene tertentu.
 * Mencegah berita acak (seperti politik/gosip) nyasar ke scene sejarah/sains.
 */
export function isNewsItemRelevantToScene(ni, scene) {
  if (!ni || !scene) return false;
  const headline = String(ni.headline || ni.title || "").toLowerCase();
  const excerpt = String(ni.excerpt || "").toLowerCase();
  const narration = String(scene.narration || "").toLowerCase();
  const screenText = String(scene.screenText || "").toLowerCase();

  const entity = extractSceneRealEntityQuery(scene);
  if (entity && entity.length >= 3 && !isGenericPlaceholderQuery(entity)) {
    const eLower = entity.toLowerCase();
    if (headline.includes(eLower) || excerpt.includes(eLower)) {
      return true;
    }
  }

  const stopWords = new Set([
    "yang", "untuk", "pada", "dalam", "dengan", "akan", "dari", "bisa", "juga", "oleh",
    "karena", "saat", "setelah", "sebelum", "namun", "ketika", "sementara", "adalah", "tentang",
    "seperti", "lebih", "dapat", "bahwa", "tidak", "mereka", "kita", "kamu", "saya", "berita",
    "terkini", "terbaru", "indonesia", "hari", "pagi", "siang", "malam", "tahun", "bulan"
  ]);

  const sceneWords = new Set(
    `${narration} ${screenText}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w))
  );

  const newsWords = `${headline} ${excerpt}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));

  let matches = 0;
  for (const w of newsWords) {
    if (sceneWords.has(w)) matches++;
  }

  return matches >= 2;
}

/**
 * Render kartu header artikel/dokumen (Outlet badge + Judul) menggunakan pureimage.
 */
export async function createHeaderCardImage({ outlet, headline, width, isPhone, destPath }) {
  ensureFont();
  const height = isPhone ? 80 : 100;
  const img = PImage.make(width, height);
  const ctx = img.getContext("2d");

  // Background gelap elegan
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(0, 0, width, height);

  // Garis aksen cyan di bawah header
  ctx.fillStyle = "#00D2FF";
  ctx.fillRect(0, height - 3, width, 3);

  // Outlet badge pill
  const safeOutlet = (outlet || "DOKUMEN REFERENSI").toUpperCase().slice(0, 26);
  const badgeW = Math.min(width - 40, safeOutlet.length * (isPhone ? 8 : 10) + 20);
  ctx.fillStyle = "#00D2FF";
  ctx.fillRect(16, 10, badgeW, isPhone ? 22 : 24);

  ctx.fillStyle = "#0F172A";
  ctx.font = (isPhone ? "10pt" : "12pt") + " Montserrat";
  ctx.fillText(safeOutlet, 22, isPhone ? 25 : 27);

  // Headline
  ctx.fillStyle = "#FFFFFF";
  ctx.font = (isPhone ? "13pt" : "16pt") + " Montserrat";
  const cleanTitle = (headline || "").slice(0, 36);
  ctx.fillText(cleanTitle, 16, isPhone ? 58 : 70);

  const out = createWriteStream(destPath);
  await PImage.encodePNGToStream(img, out);
}

/**
 * Scrape og:image atau twitter:image langsung dari URL artikel berita jika belum ada imageUrl.
 * Menyelesaikan URL redirect Google News RSS dan menolak logo Google News.
 */
export async function scrapeOgImage(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    let targetUrl = url;
    if (url.includes("news.google.com")) {
      targetUrl = await resolveGoogleNewsUrl(url);
    }

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractArticleImage(html, res.url || targetUrl);
  } catch {
    return null;
  }
}

/**
 * Ekstrak query entitas riil (tempat, fenomena, objek bersejarah, tokoh) dari scene
 * berdasarkan narasi, visualKeywords, spotlight, dan topik.
 * Menghindari kata placeholder (seperti "Fakta 1", "Scene 2", dll).
 */
export function extractSceneRealEntityQuery(scene, topic = "") {
  if (!scene) return "";

  // 1. Cek spotlight label jika ada nama entitas konkret (bukan sekadar angka atau unit)
  if (scene.spotlight?.label && !isGenericPlaceholderQuery(scene.spotlight.label)) {
    const label = scene.spotlight.label.trim();
    if (label.length >= 3 && !/^\d+[\s\w/%.-]*$/.test(label)) {
      return label;
    }
  }

  // 2. Cek visualKeywords konkret (nama tempat, objek alam, fenomena)
  const kwCandidates = [];
  const collectKw = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      kwCandidates.push(...val);
    } else if (typeof val === "string") {
      kwCandidates.push(...val.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean));
    }
  };
  collectKw(scene.visualKeywords);
  if (Array.isArray(scene.visualSegments)) {
    for (const seg of scene.visualSegments) {
      collectKw(seg?.visualKeywords);
    }
  }
  if (kwCandidates.length) {
    const concreteKw = kwCandidates.find((kw) => kw && typeof kw === "string" && !isGenericPlaceholderQuery(kw) && kw.length >= 4);
    if (concreteKw) return concreteKw;
  }

  // 3. Cek entity dari topik yang disebut secara spesifik dalam narasi scene ini
  const narration = String(scene.narration || "");
  const topicParts = String(topic || "")
    .split(/\s+(?:vs\.?|versus|lawan|dibandingkan|dan)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of topicParts) {
    if (part.length >= 4 && narration.toLowerCase().includes(part.toLowerCase())) {
      return part;
    }
  }

  // 4. Deteksi nama tempat geografis / objek nyata di narasi
  const geoMatch = narration.match(
    /\b(Danau\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|Gunung\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|Anak\s+Krakatau|Krakatau|Krakatoa|Selat\s+Sunda|Pulau\s+[A-Z][a-z]+|Kawah\s+[A-Z][a-z]+|Lembah\s+[A-Z][a-z]+|Taman\s+Nasional\s+[A-Z][a-z]+|Candi\s+[A-Z][a-z]+|Sungai\s+[A-Z][a-z]+|Palung\s+[A-Z][a-z]+|Samudra\s+[A-Z][a-z]+|Laut\s+[A-Z][a-z]+)\b/
  ) || narration.match(
    /\b(Cincin\s+Api\s+Pasifik|Cincin\s+Api|Ring\s+of\s+Fire|Lempeng\s+[Tt]ektonik|Tektonika\s+[Ll]empeng|Zona\s+[Ss]ubduksi|Patahan\s+[A-Z][a-z]+|Zaman\s+[Ee]s(?:\s+Purba)?|Musim\s+[Dd]ingin\s+[Vv]ulkanik|Supervolcano|Yellowstone|Tambora|Toba|Semeru|Merapi|Sinabung|Vesuvius|Pompeii|Fuji|Everest|Mariana|Bermuda|Atlantis)\b/i
  ) || narration.match(
    /\b(Teleskop\s+(?:Luar\s+Angkasa\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|Stasiun\s+Luar\s+Angkasa(?:\s+Internasional)?|Apollo\s+\d+|Voyager\s+\d*|Bima\s+Sakti|Andromeda|Lubang\s+Hitam)\b/i
  );
  if (geoMatch) {
    return geoMatch[1];
  }

  // 5. Cek mediaSource headline jika ada dan bukan generic
  if (scene.mediaSource?.headline && !isGenericPlaceholderQuery(scene.mediaSource.headline)) {
    return scene.mediaSource.headline;
  }

  // 6. Cek screenText jika bukan generic
  if (scene.screenText && !isGenericPlaceholderQuery(scene.screenText)) {
    return scene.screenText;
  }

  // 7. Fallback ke topik
  return !isGenericPlaceholderQuery(topic) ? topic : "";
}

/**
 * Download og:image dari newsItems yang cocok dengan mediaSource tiap scene.
 * Mendukung mode berita (Tab Tren/Ide) dan fallback gambar scene (Tab Buat).
 * Hasil: item.assets.newsImages = [{ sceneIndex, headline, outlet, imageUrl, imagePath }]
 */
export async function ensureNewsImages(item) {
  const scenes = item.plan?.scenes || [];
  const newsImages = [];
  const newsItems = item.input?.trend?.newsItems || [];

  // 1. Ambil scene yang secara eksplisit memiliki mediaSource
  for (const scene of scenes) {
    try {
      const src = scene.mediaSource;
      if (!src?.outlet && !src?.headline) continue;

      const match = newsItems.find((ni) =>
        (ni.outlet && src.outlet && String(ni.outlet).toLowerCase().includes(String(src.outlet).toLowerCase())) ||
        (ni.source && src.outlet && String(ni.source).toLowerCase().includes(String(src.outlet).toLowerCase())) ||
        (ni.headline && src.headline && String(ni.headline).toLowerCase().includes(String(src.headline).toLowerCase()))
      );

      if (newsImages.some((n) => n.sceneIndex === Number(scene.index))) continue;

      const entityQuery = extractSceneRealEntityQuery(scene, item.input?.topic);
      newsImages.push({
        sceneIndex: Number(scene.index),
        searchQuery: entityQuery || src.headline || "",
        headline: String(src.headline || match?.headline || match?.title || entityQuery || "Dokumen Referensi").slice(0, 120),
        outlet: String(src.outlet || match?.outlet || match?.source || "Media Terkait").slice(0, 60),
        imageUrl: match?.imageUrl || src.imageUrl || null,
        url: match?.url || src.url || null,
        imagePath: null
      });
    } catch (err) {
      console.warn(`[NewsImage] Gagal parsing mediaSource scene ${scene.index}: ${err.message}`);
    }
  }

  // 2. Tambahkan scene bertipe image sebagai kandidat device mockup
  // agar mockup tampil lebih sering dan merata di sepanjang video (target 4-6 mockup).
  // KRITIS: Konten mockup HARUS 100% inline dengan narasi scene!
  const candidateScenes = scenes.filter((s) => s.sceneType === "image" || !s.sceneType);
  if (candidateScenes.length >= 2) {
    const step = Math.max(2, Math.floor(candidateScenes.length / 5));
    const targetScenes = [];
    for (let i = 1; i < candidateScenes.length; i += step) {
      targetScenes.push(candidateScenes[i]);
      if (targetScenes.length >= 6) break;
    }

    for (let i = 0; i < targetScenes.length; i++) {
      try {
        const scene = targetScenes[i];
        const sIdx = Number(scene.index);
        if (newsImages.some((n) => n.sceneIndex === sIdx)) continue;

        // Hanya pakai newsItem jika BENAR-BENAR relevan dengan narasi scene ini!
        // JANGAN pernah mapping newsItems[i] secara buta berdasarkan indeks array.
        const relevantNews = newsItems.find((ni) => isNewsItemRelevantToScene(ni, scene));
        const entityQuery = extractSceneRealEntityQuery(scene, item.input?.topic);

        const headline = String(
          relevantNews?.headline || relevantNews?.title
          || (entityQuery && !isGenericPlaceholderQuery(entityQuery) ? entityQuery : scene.screenText)
          || item.input?.topic
          || "Dokumen Referensi"
        ).slice(0, 120);

        const outlet = String(
          relevantNews?.outlet || relevantNews?.source
          || (entityQuery && !isGenericPlaceholderQuery(entityQuery) ? "Arsip Dokumentasi" : "Dokumen Referensi")
        ).slice(0, 60);

        newsImages.push({
          sceneIndex: sIdx,
          searchQuery: entityQuery || headline,
          headline,
          outlet,
          imageUrl: relevantNews?.imageUrl || null,
          url: relevantNews?.url || null,
          imagePath: null
        });
      } catch (err) {
        console.warn(`[NewsImage] Gagal parsing kandidat mockup scene ${targetScenes[i]?.index}: ${err.message}`);
      }
    }
  }

  if (!newsImages.length) return;

  if (!item.assets) item.assets = {};
  const newsDir = path.join(paths.generatedDir, "news-photos");
  await fs.mkdir(newsDir, { recursive: true });

  await Promise.allSettled(newsImages.map(async (entry) => {
    // 0. Bersihkan imageUrl jika terisi logo Google News
    if (entry.imageUrl && isGoogleLogo(entry.imageUrl)) {
      entry.imageUrl = null;
    }

    const scene = scenes.find((s) => Number(s.index) === entry.sceneIndex);
    const entityQ = entry.searchQuery || extractSceneRealEntityQuery(scene, item.input?.topic);

    // 1. Prioritas Utama: Wikipedia REST API (Gratis, Akurat 1:1 untuk entitas nyata ensiklopedis)
    if (!entry.imagePath && entityQ && !isGenericPlaceholderQuery(entityQ)) {
      try {
        const wiki = await fetchWikipediaImage(entityQ);
        if (wiki?.imageUrl) {
          const ext = wiki.imageUrl.match(/\.(jpe?g|png|webp)/i)?.[1]?.replace("jpeg", "jpg") || "jpg";
          const dest = path.join(newsDir, `news-scene-${entry.sceneIndex}-wiki.${ext}`);
          await downloadImage(wiki.imageUrl, dest);
          entry.imagePath = dest;
          entry.imageUrl = wiki.imageUrl;
          entry.outlet = wiki.outlet;
          if (!entry.headline || isGenericPlaceholderQuery(entry.headline)) {
            entry.headline = wiki.title;
          }
          console.log(`[NewsImage] Scene ${entry.sceneIndex}: Berhasil ambil dari Wikipedia ("${entityQ}" → ${entry.outlet}) → ${path.basename(dest)}`);
        }
      } catch (err) {
        console.warn(`[NewsImage] Scene ${entry.sceneIndex} Wikipedia error: ${err.message}`);
      }
    }

    // 2. Google Images API jika tersedia
    if (!entry.imagePath && isGoogleImageApiAvailable()) {
      let q = entry.searchQuery || entry.headline;
      if (isGenericPlaceholderQuery(q)) {
        q = entityQ;
      }
      if (q && !isGenericPlaceholderQuery(q)) {
        try {
          const fallbackQueries = [
            (entry.outlet && !isGenericPlaceholderQuery(entry.headline)) ? `${entry.outlet} ${entry.headline || ""}`.trim() : null,
            !isGenericPlaceholderQuery(item.input?.topic) ? item.input?.topic : null
          ].filter(Boolean);
          const candidates = await searchGoogleImages(q, { fallbackQueries });
          if (candidates.length) {
            const dest = path.join(newsDir, `news-scene-${entry.sceneIndex}.jpg`);
            const dl = await downloadImageWithCandidates(candidates, dest);
            if (dl.success) {
              entry.imagePath = dest;
              entry.imageUrl = dl.url;
              if (dl.source) entry.outlet = dl.source;
              console.log(`[NewsImage] Scene ${entry.sceneIndex}: Berhasil ambil dari Google Images API ("${q}" → ${entry.outlet}) → ${path.basename(dest)}`);
            }
          }
        } catch (err) {
          console.warn(`[NewsImage] Scene ${entry.sceneIndex} Google Images API error: ${err.message}`);
        }
      }
    }

    // 3. Fallback Scraper jika ada URL artikel relevan
    if (!entry.imagePath && !entry.imageUrl && entry.url) {
      const scraped = await scrapeOgImage(entry.url);
      if (scraped) {
        entry.imageUrl = scraped;
        console.log(`[NewsImage] Scene ${entry.sceneIndex}: og:image berhasil di-scrape → ${scraped}`);
      }
    }

    // 4. Download gambar jika imageUrl ada (misal dari mediaSource atau relevantNews)
    if (!entry.imagePath && entry.imageUrl) {
      try {
        const ext = entry.imageUrl.match(/\.(jpe?g|png|webp)/i)?.[1]?.replace("jpeg", "jpg") || "jpg";
        const dest = path.join(newsDir, `news-scene-${entry.sceneIndex}.${ext}`);
        await downloadImage(entry.imageUrl, dest);
        entry.imagePath = dest;
        console.log(`[NewsImage] Scene ${entry.sceneIndex} (${entry.outlet}) → ${path.basename(dest)}`);
      } catch (err) {
        console.warn(`[NewsImage] Scene ${entry.sceneIndex} download gambar berita gagal: ${err.message}`);
      }
    }

    // 5. Fallback gambar scene milik scene INI SENDIRI (Tab Buat)
    if (!entry.imagePath) {
      const sceneImg = (item.assets?.images || []).find((img) => Number(img.sceneIndex) === entry.sceneIndex);
      if (sceneImg?.path) {
        entry.imagePath = sceneImg.path;
        console.log(`[NewsImage] Scene ${entry.sceneIndex} memakai fallback gambar scene asli: ${path.basename(sceneImg.path)}`);
      }
    }
  }));

  // PENTING: Hanya simpan entry yang memiliki imagePath yang valid & inline!
  // JANGAN PERNAH memakai fallback gambar scene 0 / gambar acak yang tidak nyambung!
  item.assets.newsImages = newsImages.filter((n) => n.imagePath);
}

/**
 * Render semua device mockup overlay untuk item dan overlay ke video.
 * Bergantian antara phone dan tablet untuk variasi visual.
 *
 * @param {string} inputVideoPath
 * @param {string} outputVideoPath
 * @param {object} item
 * @param {object[]} renderScenes - scenes dengan startSec, endSec
 * @param {string} resolution
 * @param {Function} runFfmpeg
 */
export async function applyNewsImageOverlays(inputVideoPath, outputVideoPath, item, renderScenes, resolution, runFfmpeg) {
  const newsImages = (item.assets?.newsImages || []).filter((n) => n.imagePath);
  if (!newsImages.length) {
    await copyFile(inputVideoPath, outputVideoPath);
    return;
  }

  const is1080 = resolution === "1080p";
  const videoW = is1080 ? 1920 : 1280;
  const videoH = is1080 ? 1080 : 720;

  // Buat overlay clip untuk tiap newsImage
  const overlayClips = [];
  const tmpDir = path.dirname(outputVideoPath);

  for (let i = 0; i < newsImages.length; i++) {
    const entry = newsImages[i];
    const scene = renderScenes.find((s) => Number(s.index) === entry.sceneIndex);
    if (!scene) continue;

    // Paling sering tablet (70% tablet, 30% phone sesuai preferensi penonton)
    const deviceType = (i % 3 === 2) ? "phone" : "tablet";
    const templatePath = path.join(ASSETS_DIR, DEVICE_CONFIG[deviceType].templateFile);

    // Cek template ada
    try { await fs.access(templatePath); } catch {
      console.warn(`[NewsImage] Template ${deviceType} tidak ditemukan: ${templatePath}`);
      continue;
    }

    const clipPath = path.join(tmpDir, `news-overlay-${i}.mov`);
    let headerPath = null;
    if (entry.headline && entry.outlet) {
      try {
        const hPath = path.join(tmpDir, `news-header-${i}.png`);
        const cfg = DEVICE_CONFIG[deviceType];
        const multiplier = cfg.scaleMultiplier || 1.05;
        const targetTemplateW = even(Math.round(videoW * multiplier));
        const scaleRatio = targetTemplateW / cfg.templateW;
        const sW = even(Math.round(cfg.screen.w * scaleRatio));
        await createHeaderCardImage({
          outlet: entry.outlet,
          headline: entry.headline,
          width: sW,
          isPhone: deviceType === "phone",
          destPath: hPath
        });
        headerPath = hPath;
      } catch (err) {
        // Lanjut tanpa header jika error pembuatan kartu
      }
    }

    try {
      await makeDeviceMockupClip({
        newsImagePath: entry.imagePath,
        headerPath,
        templatePath,
        outputPath: clipPath,
        deviceType,
        resolution,
        runFfmpeg
      });
      // Tampilkan 2.5 detik setelah scene dimulai (agar narator mulai bicara dulu), durasi 5.5 detik
      const startSec = Math.max(0, Number(scene.startSec || 0) + START_DELAY_SEC);
      const endSec = Math.min(startSec + OVERLAY_DURATION, Number(scene.endSec || startSec + OVERLAY_DURATION) - 0.2);
      if (endSec - startSec < 2.5) continue;
      overlayClips.push({ clipPath, startSec, endSec, videoW, videoH });
    } catch (err) {
      console.warn(`[NewsImage] Gagal buat overlay scene ${entry.sceneIndex}: ${err.message}`);
    }
  }

  if (!overlayClips.length) {
    await copyFile(inputVideoPath, outputVideoPath);
    return;
  }

  // Bangun FFmpeg filter_complex untuk semua overlay sekaligus
  const inputs = ["-i", inputVideoPath];
  overlayClips.forEach((o) => inputs.push("-i", o.clipPath));

  const filters = [];
  let prevLabel = "0:v";

  overlayClips.forEach((o, idx) => {
    const inLabel = `${idx + 1}:v`;
    const outLabel = idx === overlayClips.length - 1 ? "outv" : `tmp${idx}`;
    const st = o.startSec.toFixed(3);
    const en = o.endSec.toFixed(3);
    // Center horizontal, rapat ke batas layar bawah (resting Y = H - overlay_h).
    // Animasi slide masuk dari bawah ke atas, lalu slide keluar kembali dari atas ke bawah.
    const posX = `(W-overlay_w)/2`;
    const posY = `if(lte(t,${st}+${SLIDE_DUR}),H-overlay_h*0.5*(1-cos(PI*(t-${st})/${SLIDE_DUR})),if(gte(t,${en}-${SLIDE_DUR}),(H-overlay_h)+overlay_h*0.5*(1-cos(PI*(t-(${en}-${SLIDE_DUR}))/${SLIDE_DUR})),H-overlay_h))`;
    filters.push(
      `[${inLabel}]setpts=PTS-STARTPTS+${st}/TB[ov${idx}]`,
      `[${prevLabel}][ov${idx}]overlay=x='${posX}':y='${posY}':enable='between(t,${st},${en})':format=auto[${outLabel}]`
    );
    prevLabel = outLabel;
  });

  await runFfmpeg([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[outv]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "copy",
    "-y", outputVideoPath
  ]);
}

/**
 * Buat satu clip device mockup (4 detik) dengan foto berita di dalam layar.
 * Template di-chromakey dan di-despill TERLEBIH DAHULU, baru konten berita di-overlay di atasnya.
 * Dengan cara ini, konten berita TIDAK PERNAH kena chroma key (tidak akan tembus/transparan).
 */
async function makeDeviceMockupClip({ newsImagePath, headerPath, templatePath, outputPath, deviceType, resolution, runFfmpeg }) {
  const cfg = DEVICE_CONFIG[deviceType];
  const is1080 = resolution === "1080p";

  // Scale template diperbesar (zoom-in) agar konten berita di layar HP/tablet jelas terbaca di smartphone
  const videoW = is1080 ? 1920 : 1280;
  const multiplier = cfg.scaleMultiplier || 1.05;
  const targetTemplateW = even(Math.round(videoW * multiplier));
  const targetTemplateH = even(Math.round(targetTemplateW * cfg.templateH / cfg.templateW));
  const scaleRatio = targetTemplateW / cfg.templateW;

  // Koordinat layar setelah template di-scale
  const sc = cfg.screen;
  const sX = even(Math.round(sc.x * scaleRatio));
  const sY = even(Math.round(sc.y * scaleRatio));
  const sW = even(Math.round(sc.w * scaleRatio));
  const sH = even(Math.round(sc.h * scaleRatio));

  // Konten di dalam layar: mengisi seluruh area layar hitam aman
  const contentW = sW;
  const contentH = sH;
  const contentOffX = sX;
  const contentOffY = sY;

  const inputs = [
    "-loop", "1", "-i", newsImagePath,
    "-loop", "1", "-i", templatePath
  ];

  let contentFilter = `[0:v]scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease,` +
    `pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:black,` +
    `noise=alls=6:allf=t+u[content]`;

  if (headerPath) {
    inputs.push("-loop", "1", "-i", headerPath);
    contentFilter = `[0:v]scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease,` +
      `pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:black,` +
      `noise=alls=6:allf=t+u[content_raw];` +
      `[content_raw][2:v]overlay=0:0[content]`;
  }

  const filters = [
    // 1. Scale template, chromakey green background, dan hilangkan sisa green spill pada tangan/device
    `[1:v]scale=${targetTemplateW}:${targetTemplateH},` +
      `chromakey=color=${CHROMA_COLOR}:similarity=${CHROMA_SIMILARITY}:blend=${CHROMA_BLEND},` +
      `despill=green:expand=0.2[tmpl_keyed]`,
    // 2. Scale & pad foto berita ke area layar (+ header jika ada)
    contentFilter,
    // 3. Overlay konten ke atas layar template yang sudah di-key.
    // PENTING: Konten foto TIDAK PERNAH kena filter chromakey sehingga warna hijau foto tidak pernah tembus!
    `[tmpl_keyed][content]overlay=${contentOffX}:${contentOffY}[out]`
  ];

  // libx264 tidak mendukung alpha channel (ffmpeg akan diam-diam fallback ke yuv420p dan
  // membuang transparansi hasil chromakey). Pakai qtrle (lossless, alpha-capable) di
  // container .mov untuk clip transisi ini; hasilnya di-flatten ke libx264 tanpa alpha
  // begitu di-overlay ke video utama di applyNewsImageOverlays.
  await runFfmpeg([
    ...inputs,
    "-t", String(OVERLAY_DURATION),
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-c:v", "qtrle",
    "-pix_fmt", "argb",
    "-y", outputPath
  ]);
}

async function downloadImage(imageUrl, destPath) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
  };
  try {
    const origin = new URL(imageUrl).origin;
    headers["Referer"] = `${origin}/`;
  } catch {}
  const res = await fetch(imageUrl, {
    headers,
    signal: AbortSignal.timeout(DL_TIMEOUT_MS),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    throw new Error(`Invalid content-type: ${contentType}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!isValidImageBuffer(buffer)) {
    throw new Error(`Downloaded buffer is not a valid image or too small (${buffer.length} bytes)`);
  }

  await fs.writeFile(destPath, buffer);
}

async function copyFile(src, dest) {
  const { copyFile } = await import("node:fs/promises");
  await copyFile(src, dest);
}
