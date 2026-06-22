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

// --- Seleksi semantik & relevansi -----------------------------------------
// Heuristik murni (gratis, tanpa panggilan API) untuk dua hal:
//   1. Memilih scene mana yang layak dapat B-roll video (kekonkretan keyword).
//   2. Merangking/menyaring klip Pexels berdasarkan overlap keyword↔judul klip.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "by",
  "at", "from", "as", "is", "are", "be", "this", "that", "these", "those",
  "its", "their", "our", "your"
]);

// Kata bermuatan abstrak/intangible: sulit difilmkan apa adanya, lebih cocok
// dilukiskan gambar DALL-E ketimbang dicari sebagai B-roll nyata di Pexels.
const ABSTRACT_WORDS = new Set([
  "history", "historical", "future", "past", "era", "age", "concept", "idea",
  "theory", "policy", "strategy", "system", "crisis", "growth", "decline",
  "rise", "fall", "power", "strength", "weakness", "dominance", "dominion",
  "influence", "trust", "confidence", "stability", "instability", "uncertainty",
  "freedom", "democracy", "economy", "economic", "finance", "financial",
  "inflation", "recession", "diversification", "globalization", "geopolitics",
  "geopolitical", "relations", "diplomacy", "sentiment", "fear", "hope",
  "change", "transformation", "evolution", "impact", "effect", "importance",
  "significance", "value", "wealth", "debt", "aftermath", "reserve", "reserves"
]);

/**
 * Pecah teks jadi kata bermakna (lowercase, buang stopword & kata <3 huruf).
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Skor "kekonkretan" visual sebuah scene berdasarkan visualKeywords.
 * Makin tinggi → makin mudah dapat B-roll nyata di Pexels; makin rendah →
 * lebih baik diserahkan ke gambar DALL-E (yang bisa melukiskan konsep abstrak).
 * @param {object} scene - butuh field visualKeywords (string dipisah koma).
 * @returns {number}
 */
export function scoreSceneVisualConcreteness(scene) {
  const phrases = String(scene?.visualKeywords || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phrases.length) return -5; // tanpa keyword: query Pexels lemah → utamakan gambar
  let score = 0;
  for (const phrase of phrases) {
    const tokens = tokenizeWords(phrase);
    if (!tokens.length) continue;
    const abstract = tokens.filter((t) => ABSTRACT_WORDS.has(t)).length;
    const concrete = tokens.length - abstract;
    score += concrete - abstract;                       // konkret menambah, abstrak mengurangi
    if (concrete > 0 && abstract === 0) score += 0.5;   // frasa murni konkret: bonus kecil
  }
  return score;
}

/**
 * "Judul" klip Pexels — diturunkan dari slug URL (Pexels tak punya field title).
 * Contoh: https://www.pexels.com/video/aerial-view-of-a-city-3209828/ → "aerial view of a city".
 * @param {object} video - Pexels video object
 * @returns {string}
 */
export function clipTitleFromVideo(video) {
  const url = String(video?.url || "");
  const match = url.match(/\/video\/(.+?)-\d+\/?$/);
  const slug = match ? match[1] : url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "");
  return slug.replace(/-/g, " ");
}

/**
 * Relevansi klip = jumlah kata keyword unik yang muncul di judul klip Pexels.
 * @param {string[]} keywordTokens - hasil tokenizeWords(visualKeywords)
 * @param {object} video - Pexels video object
 * @returns {number}
 */
export function clipRelevanceScore(keywordTokens, video) {
  if (!keywordTokens?.length) return 0;
  const titleTokens = new Set(tokenizeWords(clipTitleFromVideo(video)));
  if (!titleTokens.size) return 0;
  let hits = 0;
  for (const kw of new Set(keywordTokens)) {
    if (titleTokens.has(kw)) hits += 1;
  }
  return hits;
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

  // Rangking kandidat berdasarkan relevansi keyword↔judul klip, lalu kualitas file.
  // Tokens dari keyword scene (bukan query efektif) agar relevansi tetap mengukur
  // niat asli scene meski search jatuh ke simpleQuery.
  const keywordTokens = tokenizeWords(rawKeywords || topicFallback);
  const scored = videos.map((video) => ({
    video,
    relevance: clipRelevanceScore(keywordTokens, video),
    fileScore: videoFileScore(pickBestVideoFile(video) || {})
  }));
  scored.sort((a, b) => (b.relevance - a.relevance) || (b.fileScore - a.fileScore));

  const topRelevance = scored[0].relevance;

  // Gate minRelevance: hanya menolak bila ambang > 0 dan tak satu pun klip mencapainya.
  // minRelevance = 0 berarti hanya merangking, tak pernah menolak (scene jatuh ke DALL-E
  // hanya bila Pexels memang kosong).
  if (config.pexels.minRelevance > 0 && topRelevance < config.pexels.minRelevance) {
    console.warn(`[Pexels] Scene ${scene.index} ditolak: relevansi tertinggi ${topRelevance} < minRelevance ${config.pexels.minRelevance} (query="${query}")`);
    return null;
  }

  // Acak di antara kandidat ber-relevansi tertinggi (maks 3) agar tetap bervariasi
  // tanpa mengorbankan ketepatan.
  const pool = scored.filter((s) => s.relevance === topRelevance).slice(0, 3);
  const chosen = pool[Math.floor(Math.random() * pool.length)].video;
  const bestFile = pickBestVideoFile(chosen);
  if (!bestFile?.link) {
    console.warn(`[Pexels] Tidak ada file MP4 yang cocok untuk scene ${scene.index}`);
    return null;
  }

  const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}-pexels-${chosen.id}.mp4`;
  const outputPath = path.join(clipsDir, filename);

  try {
    await downloadPexelsVideo(bestFile.link, outputPath);
    console.log(`[Pexels] Downloaded scene ${scene.index}: ${bestFile.width}x${bestFile.height} (${chosen.id}) relevance=${topRelevance} query="${query}"`);
    return {
      sceneIndex: scene.index,
      provider: "pexels",
      pexelsId: chosen.id,
      pexelsUrl: chosen.url,
      query,
      relevance: topRelevance,
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
