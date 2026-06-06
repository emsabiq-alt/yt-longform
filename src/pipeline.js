import { spawnSync } from "node:child_process";
import { config, paths } from "./config.js";
import { estimateTtsUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneImage, transcribeSpeechSegments } from "./openai.js";
import { renderLongformVideo } from "./longform-render.js";
import { generateThumbnail } from "./thumbnail.js";
import { saveItem, listContextItems } from "./storage.js";
import { createLongformDraft } from "./longform-story-engine.js";
import { nowIso } from "./util.js";

const LANDSCAPE_SIZE = "1536x1024";

const SCENE_TTS_INSTRUCTIONS = [
  "Bacakan dalam Bahasa Indonesia dengan suara yang natural, hangat, dan percaya diri.",
  "Gaya dokumenter santai, bukan suara iklan dan bukan membaca teks secara kaku.",
  "Gunakan tempo sedang, variasikan intonasi, dan beri jeda pendek pada tanda baca.",
  "Tekankan kata penting secara halus. Hindari nada monoton dan jangan berbicara terlalu cepat."
].join(" ");

export async function generateFullItem(input = {}, options = {}) {
  const warnings = [];
  const existingItems = await listContextItems();
  const item = await createLongformDraft({
    topic: input.topic || "",
    category: input.category || "random",
    durationSec: input.durationSec || config.automation.durationSec,
    sceneCount: input.sceneCount || config.automation.sceneCount,
    ttsProvider: input.ttsProvider || "openai",
    imageQuality: input.imageQuality || config.openai.imageQuality
  }, { existingItems });
  await saveItem(item);

  await ensureImages(item, { warnings, strict: true });
  await ensureLongformSceneAudio(item, {
    provider: item.input.ttsProvider,
    voice: options.voice || input.ttsVoice,
    instructions: SCENE_TTS_INSTRUCTIONS,
    warnings,
    strict: true
  });
  await ensureThumbnail(item, { warnings });
  await renderAndPersist(item);
  return { item, warnings };
}

export async function ensureImages(item, options = {}) {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  const warnings = options.warnings || [];
  const images = [...(item.assets.images || [])];
  const size = item.input.imageSize || LANDSCAPE_SIZE;
  const quality = item.input.imageQuality || config.openai.imageQuality;

  for (const scene of item.plan.scenes) {
    if (scene.sceneType === "reaction") continue;
    const existing = images.find((image) => Number(image.sceneIndex) === Number(scene.index));
    if (existing?.path) continue;
    try {
      const image = await generateImageWithRetry({ item, scene, size, quality });
      const index = images.findIndex((entry) => Number(entry.sceneIndex) === Number(scene.index));
      if (index >= 0) images.splice(index, 1, image);
      else images.push(image);
      item.assets.images = sortByScene(images);
      item.updatedAt = nowIso();
      await saveItem(item);
    } catch (error) {
      const message = `Gambar scene ${scene.index} gagal: ${error.message}`;
      if (options.strict) throw new Error(message);
      warnings.push(message);
    }
  }
  item.assets.images = sortByScene(images);
}

/**
 * TTS per scene (termasuk reaction). Durasi visual mengikuti durasi audio asli
 * sehingga subtitle dan suara selalu sinkron dan tidak ada narasi yang terpotong.
 */
export async function ensureLongformSceneAudio(item, options = {}) {
  const warnings = options.warnings || [];
  const provider = String(options.provider || item.input.ttsProvider || "openai").toLowerCase() === "elevenlabs"
    ? "elevenlabs"
    : "openai";
  const scenes = item.plan?.scenes || [];
  const sceneAudio = [];
  let totalChars = 0;

  for (const scene of scenes) {
    const text = sceneNarrationText(scene);
    if (!text) {
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    const suffix = `scene-${String(scene.index).padStart(2, "0")}-${provider}-natural`;
    let audio;
    try {
      audio = provider === "elevenlabs"
        ? await generateElevenLabsSpeech({ itemId: item.id, text, filenameSuffix: suffix })
        : await generateOpenAiSpeech({
            itemId: item.id,
            text,
            voice: options.voice,
            instructions: options.instructions || SCENE_TTS_INSTRUCTIONS,
            filenameSuffix: suffix
          });
    } catch (error) {
      if (options.strict) throw error;
      warnings.push(`TTS scene ${scene.index} gagal: ${error.message}`);
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    let captions = [];
    try {
      captions = await transcribeSpeechSegments(audio.path);
    } catch (error) {
      warnings.push(`Transkripsi subtitle scene ${scene.index} gagal: ${error.message}`);
      captions = [];
    }

    totalChars += text.length;
    sceneAudio.push({
      sceneIndex: scene.index,
      sceneType: scene.sceneType || "image",
      provider,
      path: audio.path,
      url: audio.url,
      characters: text.length,
      captions
    });
  }

  item.assets.sceneAudio = sceneAudio;
  item.assets.audio = {
    provider,
    sceneBased: true,
    characters: totalChars,
    scenes: sceneAudio.filter((entry) => entry.path).length
  };
  item.input.ttsProvider = provider;
  item.cost.ttsUsd = estimateTtsUsd(totalChars, provider, config.pricing);
  updateTotalCost(item);
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

function sceneNarrationText(scene) {
  return String(scene.narration || scene.screenText || "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ensureThumbnail(item, options = {}) {
  if (item.assets.thumbnail?.path) return;
  const warnings = options.warnings || [];
  try {
    item.assets.thumbnail = await generateThumbnail(item);
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    warnings.push(`Thumbnail gagal: ${error.message}`);
  }
}

export async function renderAndPersist(item) {
  assertReadyToRender(item);
  item.assets.video = await renderLongformVideo(item);
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

export function assertReadyToRender(item) {
  const requiredImages = (item.plan.scenes || []).filter((scene) => scene.sceneType !== "reaction").length;
  const imageCount = item.assets.images?.length || 0;
  if (imageCount < requiredImages) {
    const error = new Error("Gambar belum lengkap. Generate gambar dulu sampai semua scene siap.");
    error.status = 409;
    throw error;
  }
  const hasSceneAudio = (item.assets.sceneAudio || []).some((entry) => entry?.path);
  if (!hasSceneAudio) {
    const error = new Error("Audio TTS per scene belum tersedia. Generate suara dulu.");
    error.status = 409;
    throw error;
  }
}

export function ffmpegAvailable() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  return ffmpeg.status === 0;
}

async function generateImageWithRetry({ item, scene, size, quality }) {
  try {
    return await generateSceneImage({ itemId: item.id, scene, size, quality });
  } catch (error) {
    const safeScene = {
      ...scene,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        "objects, hands, table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    };
    const image = await generateSceneImage({ itemId: item.id, scene: safeScene, size, quality });
    image.recoveredFrom = error.message;
    return image;
  }
}

function updateTotalCost(item) {
  item.cost = item.cost || {};
  item.cost.totalUsd = Number((
    Number(item.cost.storyUsd || 0)
    + Number(item.cost.imageUsd || 0)
    + Number(item.cost.ttsUsd || 0)
    + Number(item.cost.videoUsd || 0)
  ).toFixed(5));
}

function sortByScene(items) {
  return [...items].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
}
