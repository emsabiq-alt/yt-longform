import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { safeFilename } from "./util.js";

const TITLE_STOP_WORDS = new Set([
  "bagaimana", "kenapa", "mengapa", "yang", "dan", "dari", "untuk", "dengan",
  "pada", "dalam", "sebuah", "ini", "itu", "atau", "the", "a", "an", "of", "to"
]);

function titleTerms(item) {
  return [...new Set(
    `${item?.title || ""} ${item?.input?.topic || ""}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 3 && !TITLE_STOP_WORDS.has(term))
  )];
}

function sceneForImage(item, image) {
  return (item?.plan?.scenes || []).find((scene) => Number(scene?.index) === Number(image?.sceneIndex));
}

function imageContext(item, image) {
  const scene = sceneForImage(item, image) || {};
  const segment = scene.visualSegments?.[Number(image?.segmentIndex) || 0] || {};
  return [
    image?.prompt,
    scene.imagePrompt,
    scene.visualKeywords,
    scene.screenText,
    scene.chapter,
    scene.beatPurpose,
    scene.narration,
    segment.imagePrompt,
    segment.visualKeywords,
    segment.pexelsQuery,
    segment.narrativeContext
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreStoryboardImage(item, image, terms) {
  const context = imageContext(item, image);
  let score = 0;

  for (const term of terms) {
    if (context.includes(term)) score += 10;
  }

  // Adegan pembuka biasanya memperkenalkan inti judul dan merupakan fallback
  // yang paling aman bila kata kunci judul tidak muncul persis di prompt visual.
  const sceneIndex = Number(image?.sceneIndex);
  const segmentIndex = Number(image?.segmentIndex || 0);
  if (sceneIndex === 0) score += 12;
  else if (sceneIndex === 1) score += 6;
  if (segmentIndex === 0) score += 2;
  if (image?.provider === "openai") score += 1;

  return score;
}

/**
 * Urutkan gambar storyboard berdasarkan kedekatan dengan judul/topik.
 * Tidak memanggil model atau API gambar baru: hanya memakai aset yang sudah ada.
 */
export function rankStoryboardImages(item) {
  const terms = titleTerms(item);
  return (item?.assets?.images || [])
    .filter((image) => image?.path)
    .map((image) => ({ image, score: scoreStoryboardImage(item, image, terms) }))
    .sort((a, b) => (
      b.score - a.score
      || Number(a.image.sceneIndex || 0) - Number(b.image.sceneIndex || 0)
      || Number(a.image.segmentIndex || 0) - Number(b.image.segmentIndex || 0)
    ));
}

async function pickExistingStoryboardImage(item) {
  const candidates = rankStoryboardImages(item);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate.image.path);
      return candidate;
    } catch {
      // Aset lama dapat sudah dibersihkan; lanjut ke kandidat berikutnya.
    }
  }
  return null;
}

/**
 * Buat thumbnail 16:9 dari gambar storyboard paling relevan tanpa teks overlay.
 */
export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });

  const selected = await pickExistingStoryboardImage(item);
  if (!selected) {
    throw new Error("Tidak ada gambar storyboard yang tersedia untuk dijadikan thumbnail.");
  }

  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);
  await optimizeImage(selected.image.path, outputPath);

  console.log(
    `[Thumbnail] Memakai gambar storyboard scene ${selected.image.sceneIndex}, segmen ${selected.image.segmentIndex || 0} (skor ${selected.score}).`
  );

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider: "storyboard-image",
    sourcePath: selected.image.path,
    sceneIndex: selected.image.sceneIndex,
    segmentIndex: selected.image.segmentIndex || 0
  };
}

function optimizeImage(inputPath, outputPath) {
  const scaleCrop = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", scaleCrop,
      "-frames:v", "1",
      "-q:v", "4",
      outputPath
    ], { windowsHide: true, cwd: paths.rootDir });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Optimasi gambar thumbnail gagal (${code})`));
    });
  });
}
