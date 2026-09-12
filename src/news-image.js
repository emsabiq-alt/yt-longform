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
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./config.js";
import { resolveGoogleNewsUrl, isGoogleLogo, extractArticleImage } from "./news-research.js";
import { isGoogleImageApiAvailable, searchGoogleImages, downloadImageWithCandidates, isGenericPlaceholderQuery } from "./google-image.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets");

const DL_TIMEOUT_MS = 15_000;
const OVERLAY_DURATION = 4.2; // detik ditampilkan per scene
const SLIDE_DUR = 0.45; // detik durasi animasi slide masuk (bawah->atas) dan slide keluar (atas->bawah)

/**
 * Konfigurasi layar dalam template mockup (koordinat pixel di dimensi asli file,
 * 2816×1536 untuk kedua template saat ini). Koordinat dibatasi aman ke area hitam
 * layar murni tanpa menyentuh bezel, tangan, atau background hijau.
 */
const DEVICE_CONFIG = {
  phone: {
    templateFile: "phone-mockup.png",
    templateW: 2816,
    templateH: 1536,
    // Area layar hitam aman di dalam template phone
    screen: { x: 1195, y: 240, w: 410, h: 900 }
  },
  tablet: {
    templateFile: "tablet-mockup.png",
    templateW: 2816,
    templateH: 1536,
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
    const src = scene.mediaSource;
    if (!src?.outlet && !src?.headline) continue;

    const match = newsItems.find((ni) =>
      (ni.outlet && src.outlet && String(ni.outlet).toLowerCase().includes(String(src.outlet).toLowerCase())) ||
      (ni.source && src.outlet && String(ni.source).toLowerCase().includes(String(src.outlet).toLowerCase())) ||
      (ni.headline && src.headline && String(ni.headline).toLowerCase().includes(String(src.headline).toLowerCase()))
    );

    if (newsImages.some((n) => n.sceneIndex === Number(scene.index))) continue;

    newsImages.push({
      sceneIndex: Number(scene.index),
      headline: String(src.headline || match?.headline || match?.title || "").slice(0, 120),
      outlet: String(src.outlet || match?.outlet || match?.source || "Media Terkait").slice(0, 60),
      imageUrl: match?.imageUrl || src.imageUrl || null,
      url: match?.url || src.url || null,
      imagePath: null
    });
  }

  // 2. Jika tidak ada scene dengan mediaSource (misal tab Buat, atau AI lupa menyertakan),
  // pilih 1-2 scene bertipe image sebagai kandidat device mockup agar video tetap punya variasi visual
  if (!newsImages.length && scenes.length >= 2) {
    const candidateScenes = scenes.filter((s) => s.sceneType === "image" || !s.sceneType);
    const targets = [
      candidateScenes[1] || candidateScenes[0],
      candidateScenes[Math.min(5, candidateScenes.length - 1)]
    ].filter(Boolean);

    const uniqueTargets = [...new Set(targets)];
    for (let i = 0; i < uniqueTargets.length; i++) {
      const scene = uniqueTargets[i];
      const ni = newsItems[i] || null;
      newsImages.push({
        sceneIndex: Number(scene.index),
        headline: String(ni?.headline || ni?.title || scene.screenText || item.input?.topic || "").slice(0, 120),
        outlet: String(ni?.outlet || ni?.source || (ni ? "Berita Terkini" : "Dokumen Referensi")).slice(0, 60),
        imageUrl: ni?.imageUrl || null,
        url: ni?.url || null,
        imagePath: null
      });
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

    // 1. Prioritas Utama: Ambil gambar langsung dari Google Images API jika tersedia
    if (isGoogleImageApiAvailable()) {
      let q = entry.headline;
      if (isGenericPlaceholderQuery(q)) {
        q = isGenericPlaceholderQuery(item.input?.topic) ? null : item.input?.topic;
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
              console.log(`[NewsImage] Scene ${entry.sceneIndex}: Berhasil ambil dari Google Images API (${entry.outlet}) → ${path.basename(dest)}`);
            }
          }
        } catch (err) {
          console.warn(`[NewsImage] Scene ${entry.sceneIndex} Google Images API error: ${err.message}`);
        }
      }
    }

    // 2. Fallback Scraper: Jika Google Images API tidak aktif atau belum dapat, coba scraping og:image on-the-fly
    if (!entry.imagePath && !entry.imageUrl && entry.url) {
      const scraped = await scrapeOgImage(entry.url);
      if (scraped) {
        entry.imageUrl = scraped;
        console.log(`[NewsImage] Scene ${entry.sceneIndex}: og:image berhasil di-scrape → ${scraped}`);
      }
    }

    // 3. Coba download gambar berita jika ada imageUrl (jika belum didownload)
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

    // 4. Fallback: jika gambar berita tidak ada atau gagal unduh, gunakan aset gambar scene yang sudah ada (Tab Buat)
    if (!entry.imagePath) {
      const sceneImg = (item.assets?.images || []).find((img) => Number(img.sceneIndex) === entry.sceneIndex);
      if (sceneImg?.path) {
        entry.imagePath = sceneImg.path;
        console.log(`[NewsImage] Scene ${entry.sceneIndex} memakai fallback gambar scene: ${path.basename(sceneImg.path)}`);
      } else {
        const anyImg = (item.assets?.images || [])[0];
        if (anyImg?.path) {
          entry.imagePath = anyImg.path;
          console.log(`[NewsImage] Scene ${entry.sceneIndex} memakai fallback gambar alternatif: ${path.basename(anyImg.path)}`);
        }
      }
    }
  }));

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

    // Bergantian phone dan tablet
    const deviceType = i % 2 === 0 ? "phone" : "tablet";
    const templatePath = path.join(ASSETS_DIR, DEVICE_CONFIG[deviceType].templateFile);

    // Cek template ada
    try { await fs.access(templatePath); } catch {
      console.warn(`[NewsImage] Template ${deviceType} tidak ditemukan: ${templatePath}`);
      continue;
    }

    const clipPath = path.join(tmpDir, `news-overlay-${i}.mov`);
    try {
      await makeDeviceMockupClip({
        newsImagePath: entry.imagePath,
        templatePath,
        outputPath: clipPath,
        deviceType,
        resolution,
        runFfmpeg
      });
      // Tampilkan 1 detik setelah scene dimulai, tapi jangan lewat akhir scene
      const startSec = Math.max(0, Number(scene.startSec || 0) + 1);
      const endSec = Math.min(startSec + OVERLAY_DURATION, Number(scene.endSec || startSec + OVERLAY_DURATION));
      if (endSec - startSec < 2) continue;
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
async function makeDeviceMockupClip({ newsImagePath, templatePath, outputPath, deviceType, resolution, runFfmpeg }) {
  const cfg = DEVICE_CONFIG[deviceType];
  const is1080 = resolution === "1080p";

  // Scale template ke 80% lebar video agar proporsional dan menempel rapat di bawah
  const videoW = is1080 ? 1920 : 1280;
  const targetTemplateW = even(Math.round(videoW * 0.80));
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

  const filters = [
    // 1. Scale template, chromakey green background, dan hilangkan sisa green spill pada tangan/device
    `[1:v]scale=${targetTemplateW}:${targetTemplateH},` +
      `chromakey=color=${CHROMA_COLOR}:similarity=${CHROMA_SIMILARITY}:blend=${CHROMA_BLEND},` +
      `despill=green:expand=0.2[tmpl_keyed]`,
    // 2. Scale & pad foto berita ke area layar dengan letter/pillar box hitam + filter grain tipis
    `[0:v]scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease,` +
      `pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:black,` +
      `noise=alls=6:allf=t+u[content]`,
    // 3. Overlay konten ke atas layar template yang sudah di-key.
    // PENTING: Konten foto TIDAK PERNAH kena filter chromakey sehingga warna hijau foto tidak pernah tembus!
    `[tmpl_keyed][content]overlay=${contentOffX}:${contentOffY}[out]`
  ];

  // libx264 tidak mendukung alpha channel (ffmpeg akan diam-diam fallback ke yuv420p dan
  // membuang transparansi hasil chromakey). Pakai qtrle (lossless, alpha-capable) di
  // container .mov untuk clip transisi ini; hasilnya di-flatten ke libx264 tanpa alpha
  // begitu di-overlay ke video utama di applyNewsImageOverlays.
  await runFfmpeg([
    "-loop", "1", "-i", newsImagePath,
    "-loop", "1", "-i", templatePath,
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
  const out = createWriteStream(destPath);
  await pipeline(res.body, out);
}

async function copyFile(src, dest) {
  const { copyFile } = await import("node:fs/promises");
  await copyFile(src, dest);
}
