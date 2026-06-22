import { spawnSync } from "node:child_process";
import { config, paths } from "./config.js";
import { estimateTtsUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneImage, transcribeSpeechSegments } from "./openai.js";
import { fetchPexelsClipForScene, scoreSceneVisualConcreteness } from "./pexels.js";
import { renderLongformVideo } from "./longform-render.js";
import { generateThumbnail } from "./thumbnail.js";
import { saveItem, listContextItems } from "./storage.js";
import { createLongformDraft } from "./longform-story-engine.js";
import { nowIso, normalizeTtsText, alignCaptionsToSource } from "./util.js";
import { reportProgress } from "./progress.js";

const LANDSCAPE_SIZE = "1536x1024";

const SCENE_TTS_INSTRUCTIONS = [
  "Bacakan dalam Bahasa Indonesia dengan suara yang natural, hangat, dan percaya diri.",
  "Gaya dokumenter santai, bukan suara iklan dan bukan membaca teks secara kaku.",
  "Gunakan tempo sedang, variasikan intonasi, dan hindari jeda berlebihan, terutama di tengah kalimat.",
  "Tekankan kata penting secara halus. Hindari nada monoton dan jangan berbicara terlalu cepat."
].join(" ");

export async function generateFullItem(input = {}, options = {}) {
  const warnings = [];
  reportProgress("script", "Menyusun naskah AI", 10, "meminta storyboard");
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
  reportProgress("script", "Naskah siap", 100, item.title || "");

  // Pexels video clips dulu (prioritas), lalu gambar sebagai fallback
  await ensurePexelsClips(item, { warnings });
  await ensureImages(item, { warnings, strict: true });
  await ensureLongformSceneAudio(item, {
    provider: item.input.ttsProvider,
    voice: options.voice || input.ttsVoice,
    instructions: SCENE_TTS_INSTRUCTIONS,
    warnings,
    strict: true
  });
  if (config.automation.coldOpenEnabled) {
    await ensureHookAudio(item, {
      provider: item.input.ttsProvider,
      voice: options.voice || input.ttsVoice,
      warnings
    });
  }
  if (config.thumbnail?.enabled) {
    reportProgress("thumbnail", "Membuat thumbnail", 20, "");
    await ensureThumbnail(item, { warnings });
    reportProgress("thumbnail", "Thumbnail siap", 100, "");
  } else {
    console.log("[Thumbnail] THUMBNAIL_GENERATION_ENABLED=false, skip generate thumbnail.");
    reportProgress("thumbnail", "Thumbnail dilewati", 100, "manual mode");
  }
  reportProgress("render", "Merender video (FFmpeg)", 5, "menyusun segmen");
  await renderAndPersist(item);
  reportProgress("render", "Render selesai", 100, "");
  return { item, warnings };
}

/**
 * Cari dan download klip video dari Pexels untuk sebagian scene non-reaction.
 * Hasil akhir: video campuran gambar statis (DALL-E) + video bergerak (Pexels)
 * supaya lebih hidup. Jumlah scene video ≈ separuh agar tetap berimbang.
 *
 * Pemilihan scene penerima video:
 *   - semantic (default): scene paling KONKRET visualnya yang dapat B-roll, sebab
 *     keyword konkret jauh lebih gampang menemukan footage Pexels yang relevan;
 *     scene abstrak diserahkan ke DALL-E yang bisa melukiskan konsep.
 *   - fallback: pola ALTERNATING klasik (indeks genap dapat video).
 */
export async function ensurePexelsClips(item, options = {}) {
  if (!config.pexels.apiKey || !config.pexels.preferVideo) {
    console.log("[Pexels] Dimatikan atau API key tidak tersedia, skip Pexels clips.");
    return;
  }
  const warnings = options.warnings || [];
  const clips = [...(item.assets.clips || [])];
  const nonReactionScenes = item.plan.scenes.filter((s) => s.sceneType !== "reaction");

  // Jaga jumlah scene video setara pola alternating (≈separuh) agar mix tetap seimbang.
  const videoQuota = Math.ceil(nonReactionScenes.length / 2);

  let pexelsScenes;
  let imageOnlyScenes;
  if (config.pexels.semanticSelection) {
    // Rangking scene berdasarkan kekonkretan keyword, ambil yang teratas sebanyak kuota.
    const ranked = [...nonReactionScenes].sort(
      (a, b) => scoreSceneVisualConcreteness(b) - scoreSceneVisualConcreteness(a)
    );
    const chosen = new Set(ranked.slice(0, videoQuota).map((s) => s.index));
    pexelsScenes = nonReactionScenes.filter((s) => chosen.has(s.index));   // pertahankan urutan asli
    imageOnlyScenes = nonReactionScenes.filter((s) => !chosen.has(s.index));
    console.log(`[Pexels] Seleksi semantik: ${pexelsScenes.length} scene video (paling konkret), ${imageOnlyScenes.length} scene gambar DALL-E`);
  } else {
    // Pola alternating klasik: scene non-reaction genap (0, 2, 4...) dapat video.
    pexelsScenes = nonReactionScenes.filter((_, idx) => idx % 2 === 0);
    imageOnlyScenes = nonReactionScenes.filter((_, idx) => idx % 2 !== 0);
    console.log(`[Pexels] Pola alternating: ${pexelsScenes.length} scene video Pexels, ${imageOnlyScenes.length} scene gambar DALL-E`);
  }

  let clipDone = 0;
  reportProgress("images", "Mencari video B-roll Pexels", 0, `0/${pexelsScenes.length}`);

  for (const scene of pexelsScenes) {
    const existing = clips.find((c) => Number(c.sceneIndex) === Number(scene.index));
    if (existing?.path) { clipDone += 1; continue; }

    try {
      reportProgress("images", "Mencari video B-roll Pexels", Math.round((clipDone / pexelsScenes.length) * 100), `scene ${scene.index}`);
      const clip = await fetchPexelsClipForScene({
        itemId: item.id,
        scene,
        topicFallback: item.input?.topic || ""
      });
      clipDone += 1;
      if (clip) {
        const index = clips.findIndex((c) => Number(c.sceneIndex) === Number(scene.index));
        if (index >= 0) clips.splice(index, 1, clip);
        else clips.push(clip);
        item.assets.clips = sortByScene(clips);
        item.updatedAt = nowIso();
        await saveItem(item);
      }
      reportProgress("images", "Mencari video B-roll Pexels", Math.round((clipDone / pexelsScenes.length) * 100), `${clipDone}/${pexelsScenes.length}`);
    } catch (error) {
      clipDone += 1;
      const message = `Pexels scene ${scene.index} gagal: ${error.message}`;
      warnings.push(message);
      console.warn(message);
    }

    // Rate limit: tunggu 200ms antara request ke Pexels API
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  item.assets.clips = sortByScene(clips);
  await saveItem(item);

  const totalClips = clips.filter((c) => c.path).length;
  const mode = config.pexels.semanticSelection ? "seleksi semantik" : "pola alternating";
  console.log(`[Pexels] Total klip video: ${totalClips}/${pexelsScenes.length} scene (${mode})`);
}

export async function ensureImages(item, options = {}) {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  const warnings = options.warnings || [];
  const images = [...(item.assets.images || [])];
  const size = item.input.imageSize || LANDSCAPE_SIZE;
  const quality = item.input.imageQuality || config.openai.imageQuality;

  // Hanya generate gambar untuk scene yang BELUM punya klip Pexels
  const clips = item.assets.clips || [];
  const imageScenes = item.plan.scenes.filter((s) => {
    if (s.sceneType === "reaction") return false;
    // Skip jika sudah punya klip video Pexels
    const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(s.index) && c.path);
    return !hasClip;
  });

  if (imageScenes.length === 0) {
    console.log("[Images] Semua scene sudah punya klip Pexels, skip generate gambar DALL-E.");
    return;
  }

  console.log(`[Images] Generate gambar DALL-E untuk ${imageScenes.length} scene yang belum punya klip video.`);
  let imageDone = 0;
  reportProgress("images", "Membuat gambar fallback (DALL-E)", 0, `0/${imageScenes.length}`);

  for (const scene of imageScenes) {
    const existing = images.find((image) => Number(image.sceneIndex) === Number(scene.index));
    if (existing?.path) { imageDone += 1; continue; }
    try {
      reportProgress("images", "Membuat gambar fallback (DALL-E)", Math.round((imageDone / imageScenes.length) * 100), `scene ${scene.index}`);
      const image = await generateImageWithRetry({ item, scene, size, quality });
      imageDone += 1;
      reportProgress("images", "Membuat gambar fallback (DALL-E)", Math.round((imageDone / imageScenes.length) * 100), `${imageDone}/${imageScenes.length}`);
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
  const provider = String(options.provider || item.input.ttsProvider || "elevenlabs").toLowerCase() === "elevenlabs"
    ? "elevenlabs"
    : "openai";
  const scenes = item.plan?.scenes || [];
  const sceneAudio = [];
  let totalChars = 0;
  let audioDone = 0;
  reportProgress("audio", "Membuat suara TTS per scene", 0, `0/${scenes.length}`);

  for (const scene of scenes) {
    const text = normalizeTtsText(sceneNarrationText(scene));
    if (!text) {
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    reportProgress("audio", "Membuat suara TTS per scene", Math.round((audioDone / scenes.length) * 100), `scene ${scene.index}`);
    const suffix = `scene-${String(scene.index).padStart(2, "0")}-${provider}-natural`;
    let audio;
    let currentProvider = provider;
    try {
      if (provider === "elevenlabs") {
        try {
          audio = await generateElevenLabsSpeech({ itemId: item.id, text, voiceId: options.voice, filenameSuffix: suffix });
        } catch (elError) {
          console.warn(`[TTS] ElevenLabs gagal, fallback ke OpenAI: ${elError.message}`);
          warnings.push(`ElevenLabs scene ${scene.index} gagal: ${elError.message}. Menggunakan fallback OpenAI.`);
          currentProvider = "openai";
          const fallbackSuffix = `scene-${String(scene.index).padStart(2, "0")}-openai-fallback`;
          audio = await generateOpenAiSpeech({
            itemId: item.id,
            text,
            voice: config.openai.ttsVoice,
            instructions: options.instructions || SCENE_TTS_INSTRUCTIONS,
            filenameSuffix: fallbackSuffix
          });
        }
      } else {
        audio = await generateOpenAiSpeech({
          itemId: item.id,
          text,
          voice: options.voice,
          instructions: options.instructions || SCENE_TTS_INSTRUCTIONS,
          filenameSuffix: suffix
        });
      }
    } catch (error) {
      if (options.strict) throw error;
      warnings.push(`TTS scene ${scene.index} gagal: ${error.message}`);
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    let captions = [];
    try {
      const whisperSegments = await transcribeSpeechSegments(audio.path);
      captions = alignCaptionsToSource(text, whisperSegments);
    } catch (error) {
      warnings.push(`Transkripsi subtitle scene ${scene.index} gagal: ${error.message}`);
      captions = [];
    }

    totalChars += text.length;
    audioDone += 1;
    reportProgress("audio", "Membuat suara TTS per scene", Math.round((audioDone / scenes.length) * 100), `${audioDone}/${scenes.length}`);
    sceneAudio.push({
      sceneIndex: scene.index,
      sceneType: scene.sceneType || "image",
      provider: currentProvider,
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

/**
 * TTS khusus untuk "cold open" (hook teaser di 15 detik pertama).
 * Membacakan item.plan.hook sebagai kalimat pembuka yang punchy, terpisah dari
 * scene audio. Visualnya nanti memakai media scene-1 (Pexels/gambar) di render.
 * Gagal/terlewat = aman: render otomatis kembali ke struktur tanpa cold open.
 */
export async function ensureHookAudio(item, options = {}) {
  const warnings = options.warnings || [];
  const hookText = normalizeTtsText(item.plan?.hook || "");
  if (!hookText) return;

  const provider = String(options.provider || item.input.ttsProvider || "elevenlabs").toLowerCase() === "elevenlabs"
    ? "elevenlabs"
    : "openai";
  reportProgress("audio", "Membuat suara hook (cold open)", 0, "");

  let audio;
  let currentProvider = provider;
  try {
    if (provider === "elevenlabs") {
      try {
        audio = await generateElevenLabsSpeech({ itemId: item.id, text: hookText, voiceId: options.voice, filenameSuffix: "cold-open-elevenlabs" });
      } catch (elError) {
        console.warn(`[TTS] ElevenLabs cold-open gagal, fallback ke OpenAI: ${elError.message}`);
        warnings.push(`ElevenLabs cold-open gagal: ${elError.message}. Menggunakan fallback OpenAI.`);
        currentProvider = "openai";
        audio = await generateOpenAiSpeech({
          itemId: item.id,
          text: hookText,
          voice: config.openai.ttsVoice,
          instructions: SCENE_TTS_INSTRUCTIONS,
          filenameSuffix: "cold-open-openai-fallback"
        });
      }
    } else {
      audio = await generateOpenAiSpeech({
        itemId: item.id,
        text: hookText,
        voice: options.voice,
        instructions: SCENE_TTS_INSTRUCTIONS,
        filenameSuffix: "cold-open-openai"
      });
    }
  } catch (error) {
    warnings.push(`Cold-open TTS gagal: ${error.message}`);
    reportProgress("audio", "Hook cold open dilewati", 100, "tanpa suara");
    return;
  }

  item.assets.hookAudio = {
    provider: currentProvider,
    path: audio.path,
    url: audio.url,
    text: hookText,
    characters: hookText.length
  };
  item.cost.ttsUsd = Number((Number(item.cost.ttsUsd || 0) + estimateTtsUsd(hookText.length, currentProvider, config.pricing)).toFixed(5));
  updateTotalCost(item);
  item.updatedAt = nowIso();
  await saveItem(item);
  reportProgress("audio", "Suara hook siap", 100, "");
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
  // Cek: setiap scene image/summary harus punya MINIMAL klip video ATAU gambar
  const requiredScenes = (item.plan.scenes || []).filter((scene) => scene.sceneType !== "reaction");
  const clips = item.assets.clips || [];
  const images = item.assets.images || [];
  for (const scene of requiredScenes) {
    const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(scene.index) && c.path);
    const hasImage = images.find((img) => Number(img.sceneIndex) === Number(scene.index) && img.path);
    if (!hasClip && !hasImage) {
      const error = new Error(`Scene ${scene.index} belum punya media (klip video atau gambar). Generate dulu.`);
      error.status = 409;
      throw error;
    }
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
