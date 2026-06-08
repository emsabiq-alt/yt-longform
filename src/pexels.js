/**
 * Pexels API — Search & download video B-roll untuk scene longform.
 *
 * Strategi:
 *   1. Cari video landscape di Pexels berdasarkan visualKeywords scene.
 *   2. Pilih file video HD (preferensi ≥720p, landscape).
 *   3. Download ke generated/clips/ untuk dipakai render pipeline.
 *
 * Docs: https://www.pexels.com/api/documentation/#videos-search
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const PEXELS_API_BASE = "https://api.pexels.com";

function assertPexels() {
  if (!config.pexels.apiKey) throw new Error("PEXELS_API_KEY belum diisi.");
}

function pexelsHeaders() {
  return { Authorization: config.pexels.apiKey };
}

/**
 * Cari video di Pexels.
 * @param {string} query - Kata kunci pencarian (bahasa Inggris).
 * @param {object} options
 * @param {string} [options.orientation] - landscape | portrait | square
 * @param {string} [options.size] - large | medium | small
 * @param {number} [options.perPage] - Jumlah hasil (1-80)
 * @param {number} [options.minDuration] - Durasi minimum (detik)
 * @returns {Promise<object[]>} Array of Pexels video objects
 */
export async function searchPexelsVideos(query, options = {}) {
  assertPexels();
  const url = new URL(`${PEXELS_API_BASE}/videos/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", options.orientation || "landscape");
  url.searchParams.set("size", options.size || "medium");
  url.searchParams.set("per_page", String(options.perPage || config.pexels.maxResultsPerScene || 5));
  if (options.minDuration) {
    url.searchParams.set("min_duration", String(options.minDuration));
  }

  const response = await fetch(url.toString(), { headers: pexelsHeaders() });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pexels search gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  return Array.isArray(data.videos) ? data.videos : [];
}

/**
 * Pilih file video terbaik dari hasil Pexels (preferensi HD landscape).
 * @param {object} video - Pexels video object
 * @returns {object|null} { url, width, height, quality }
 */
export function pickBestVideoFile(video) {
  if (!video?.video_files?.length) return null;
  const files = video.video_files
    .filter((f) => f.file_type === "video/mp4")
    .sort((a, b) => {
      // Prefer HD (720p-1080p), landscape, not too large
      const scoreA = videoFileScore(a);
      const scoreB = videoFileScore(b);
      return scoreB - scoreA;
    });
  return files[0] || null;
}

/**
 * Nilai file video untuk seleksi.
 */
function videoFileScore(file) {
  const w = Number(file.width || 0);
  const h = Number(file.height || 0);
  let score = 0;
  // Landscape bonus
  if (w > h) score += 100;
  // HD sweet spot (720p - 1080p)
  if (h >= 720 && h <= 1080) score += 80;
  else if (h >= 480 && h < 720) score += 40;
  else if (h > 1080) score += 30; // Too large, still ok
  // Prefer not too small
  if (w >= 1280) score += 20;
  // Quality label
  if (file.quality === "hd") score += 15;
  else if (file.quality === "sd") score += 5;
  return score;
}

/**
 * Download file video dari URL Pexels ke disk.
 * @param {string} videoUrl - URL file video
 * @param {string} outputPath - Path output lokal
 * @returns {Promise<string>} outputPath
 */
export async function downloadPexelsVideo(videoUrl, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Download Pexels video gagal HTTP ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body);
  const writer = createWriteStream(outputPath);
  await pipeline(nodeStream, writer);
  return outputPath;
}

/**
 * Cari dan download satu klip video Pexels untuk sebuah scene.
 * @param {object} params
 * @param {string} params.itemId - ID item
 * @param {object} params.scene - Scene object dari storyboard
 * @param {string} [params.topicFallback] - Fallback query jika visualKeywords kosong
 * @returns {Promise<object|null>} { sceneIndex, path, url, pexelsId, query } atau null
 */
export async function fetchPexelsClipForScene({ itemId, scene, topicFallback = "" }) {
  assertPexels();
  const clipsDir = path.join(paths.generatedDir, "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  // Build search query dari visualKeywords, jatuhkan ke topic jika kosong
  const rawKeywords = String(scene.visualKeywords || "").trim();
  const query = rawKeywords || topicFallback || "documentary footage";
  if (!query) return null;

  let videos = [];
  try {
    videos = await searchPexelsVideos(query, {
      orientation: "landscape",
      size: "medium",
      perPage: config.pexels.maxResultsPerScene,
      minDuration: config.pexels.minDurationSec
    });
  } catch (error) {
    console.warn(`[Pexels] Search gagal untuk scene ${scene.index} (query: "${query}"): ${error.message}`);
    return null;
  }

  if (!videos.length) {
    // Retry dengan query yang lebih sederhana (ambil 2 kata pertama)
    const simpleQuery = query.split(/\s+/).slice(0, 2).join(" ");
    if (simpleQuery !== query) {
      try {
        videos = await searchPexelsVideos(simpleQuery, {
          orientation: "landscape",
          size: "medium",
          perPage: 3,
          minDuration: config.pexels.minDurationSec
        });
      } catch {
        // silent fallback
      }
    }
  }

  if (!videos.length) {
    console.warn(`[Pexels] Tidak ada video untuk scene ${scene.index} (query: "${query}")`);
    return null;
  }

  // Pilih video acak dari top results agar bervariasi
  const topVideos = videos.slice(0, Math.min(3, videos.length));
  const chosen = topVideos[Math.floor(Math.random() * topVideos.length)];
  const bestFile = pickBestVideoFile(chosen);
  if (!bestFile?.link) {
    console.warn(`[Pexels] Tidak ada file MP4 yang cocok untuk scene ${scene.index}`);
    return null;
  }

  const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}-pexels-${chosen.id}.mp4`;
  const outputPath = path.join(clipsDir, filename);

  try {
    await downloadPexelsVideo(bestFile.link, outputPath);
    console.log(`[Pexels] Downloaded scene ${scene.index}: ${bestFile.width}x${bestFile.height} (${chosen.id}) query="${query}"`);
    return {
      sceneIndex: scene.index,
      provider: "pexels",
      pexelsId: chosen.id,
      pexelsUrl: chosen.url,
      query,
      width: bestFile.width,
      height: bestFile.height,
      path: outputPath,
      url: `/generated/clips/${filename}`
    };
  } catch (error) {
    console.warn(`[Pexels] Download gagal scene ${scene.index}: ${error.message}`);
    return null;
  }
}
