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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets");

const DL_TIMEOUT_MS = 15_000;
const OVERLAY_DURATION = 4.2; // detik ditampilkan per scene
const FADE_DUR = 0.35;

/**
 * Konfigurasi layar dalam template greenscreen (koordinat pixel di template 1500×1000).
 * Sesuaikan jika template berbeda dimensi atau posisi layar berbeda.
 */
const DEVICE_CONFIG = {
  phone: {
    templateFile: "phone-mockup.jpg",
    templateW: 1500,
    templateH: 1000,
    // Area layar hitam di dalam template (perlu sedikit inset dari tepi layar)
    screen: { x: 598, y: 55, w: 305, h: 675 }
  },
  tablet: {
    templateFile: "tablet-mockup.jpg",
    templateW: 1500,
    templateH: 1000,
    // Area layar hitam di dalam template tablet
    screen: { x: 403, y: 55, w: 694, h: 725 }
  }
};

// Warna chroma key green yang dipakai di template
const CHROMA_COLOR = "0x3ECC52";
const CHROMA_SIMILARITY = "0.30";
const CHROMA_BLEND = "0.08";

/**
 * Download og:image dari newsItems yang cocok dengan mediaSource tiap scene.
 * Hasil: item.assets.newsImages = [{ sceneIndex, headline, outlet, imageUrl, imagePath }]
 */
export async function ensureNewsImages(item) {
  const scenes = item.plan?.scenes || [];
  const newsImages = [];

  for (const scene of scenes) {
    const src = scene.mediaSource;
    if (!src?.outlet) continue;

    const newsItems = item.input?.trend?.newsItems || [];
    const match = newsItems.find((ni) =>
      ni.imageUrl && (
        String(ni.outlet || ni.source || "").toLowerCase().includes(String(src.outlet || "").toLowerCase()) ||
        String(src.outlet || "").toLowerCase().includes(String(ni.outlet || ni.source || "").toLowerCase())
      )
    );
    if (!match?.imageUrl) continue;
    if (newsImages.some((n) => n.sceneIndex === Number(scene.index))) continue;

    newsImages.push({
      sceneIndex: Number(scene.index),
      headline: String(src.headline || match.headline || "").slice(0, 120),
      outlet: String(src.outlet || match.outlet || ""),
      imageUrl: match.imageUrl,
      imagePath: null
    });
  }

  if (!newsImages.length) return;

  if (!item.assets) item.assets = {};
  const newsDir = path.join(paths.generatedDir, "news-photos");
  await fs.mkdir(newsDir, { recursive: true });

  await Promise.allSettled(newsImages.map(async (entry) => {
    try {
      const ext = entry.imageUrl.match(/\.(jpe?g|png|webp)/i)?.[1]?.replace("jpeg", "jpg") || "jpg";
      const dest = path.join(newsDir, `news-scene-${entry.sceneIndex}.${ext}`);
      await downloadImage(entry.imageUrl, dest);
      entry.imagePath = dest;
      console.log(`[NewsImage] Scene ${entry.sceneIndex} (${entry.outlet}) → ${path.basename(dest)}`);
    } catch (err) {
      console.warn(`[NewsImage] Scene ${entry.sceneIndex} gagal: ${err.message}`);
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

    const clipPath = path.join(tmpDir, `news-overlay-${i}.mp4`);
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
    // Center overlay di video
    const posX = `(W-overlay_w)/2`;
    const posY = `(H-overlay_h)/2`;
    filters.push(
      `[${inLabel}]setpts=PTS-STARTPTS+${st}/TB[ov${idx}]`,
      `[${prevLabel}][ov${idx}]overlay=${posX}:${posY}:enable='between(t,${st},${en})':format=auto[${outLabel}]`
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
 * Chroma key menghapus background hijau → tangan & device terlihat, BG transparan.
 */
async function makeDeviceMockupClip({ newsImagePath, templatePath, outputPath, deviceType, resolution, runFfmpeg }) {
  const cfg = DEVICE_CONFIG[deviceType];
  const is1080 = resolution === "1080p";

  // Scale template ke 80% lebar video agar tidak terlalu besar
  const videoW = is1080 ? 1920 : 1280;
  const targetTemplateW = Math.round(videoW * 0.80);
  const targetTemplateH = Math.round(targetTemplateW * cfg.templateH / cfg.templateW);
  const scaleRatio = targetTemplateW / cfg.templateW;

  // Koordinat layar setelah template di-scale
  const sc = cfg.screen;
  const sX = Math.round(sc.x * scaleRatio);
  const sY = Math.round(sc.y * scaleRatio);
  const sW = Math.round(sc.w * scaleRatio);
  const sH = Math.round(sc.h * scaleRatio);

  // Konten di dalam layar: 72% lebar layar, di-center (jangan terlalu lebar)
  const contentW = Math.round(sW * 0.72);
  const contentH = Math.round(sH * 0.72);
  const contentOffX = sX + Math.round((sW - contentW) / 2);
  const contentOffY = sY + Math.round((sH - contentH) / 2);

  const filters = [
    // Scale template
    `[1:v]scale=${targetTemplateW}:${targetTemplateH}[tmpl]`,
    // Scale & pad foto berita ke area konten (letter/pillar box dengan black)
    `[0:v]scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease,` +
      `pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:black[content]`,
    // Overlay konten ke template di posisi layar
    `[tmpl][content]overlay=${contentOffX}:${contentOffY}[composite]`,
    // Chroma key: hapus green → background video utama akan terlihat
    `[composite]chromakey=color=${CHROMA_COLOR}:similarity=${CHROMA_SIMILARITY}:blend=${CHROMA_BLEND}[keyed]`,
    // Fade in/out
    `[keyed]fade=t=in:st=0:d=${FADE_DUR}:alpha=1,fade=t=out:st=${(OVERLAY_DURATION - FADE_DUR).toFixed(2)}:d=${FADE_DUR}:alpha=1[out]`
  ];

  await runFfmpeg([
    "-loop", "1", "-i", newsImagePath,
    "-loop", "1", "-i", templatePath,
    "-t", String(OVERLAY_DURATION),
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuva420p",
    "-y", outputPath
  ]);
}

async function downloadImage(imageUrl, destPath) {
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; yt-longform/1.0)" },
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
