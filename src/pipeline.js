import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { config, paths } from "./config.js";
import { estimateTtsUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneGridImage, generateSceneImage, transcribeSpeechSegments } from "./openai.js";
import {
  fetchPexelsClipForScene,
  PEXELS_SELECTOR_VERSION,
  scoreSceneVisualConcreteness
} from "./pexels.js";
import { renderLongformVideo } from "./longform-render.js";
import { generateThumbnail } from "./thumbnail.js";
import { saveItem, listContextItems } from "./storage.js";
import { createLongformDraft } from "./longform-story-engine.js";
import { nowIso, normalizeTtsText, alignCaptionsToSource } from "./util.js";
import { reportProgress } from "./progress.js";

const LANDSCAPE_SIZE = "1536x1024";

const SCENE_TTS_INSTRUCTIONS = [
  "Bacakan sepenuhnya dalam Bahasa Indonesia.",
  "Gaya suara: Sangat energik (high-energy), bersemangat (upbeat), dan penuh dorongan (encouraging), memproyeksikan antusiasme dan motivasi tinggi.",
  "Tanda baca & Jeda: Kalimat pendek dan bertenaga (punchy) dengan jeda strategis untuk menjaga keseruan dan kejelasan.",
  "Penyampaian: Cepat dan dinamis (fast-paced & dynamic), dengan intonasi naik untuk membangun momentum dan menjaga keterlibatan tetap tinggi.",
  "Gaya bahasa: Berorientasi tindakan dan langsung (action-oriented & direct), gunakan isyarat motivasi untuk mendorong pendengar.",
  "Nada suara: Positif, penuh tenaga (energetic), dan memberdayakan (empowering), menciptakan suasana penuh semangat dan pencapaian."
].join(" ");

/**
 * Pastikan aset visual dalam urutan yang benar: video relevan dicoba lebih
 * dahulu, lalu gambar hanya mengisi slot yang masih kosong.
 */
export async function ensureVisualAssets(item, options = {}) {
  const warnings = options.warnings || [];
  const pexelsRunner = options.pexelsRunner || ensurePexelsClips;
  const imageRunner = options.imageRunner || ensureImages;
  const pexelsOptions = options.pexelsOptions || {};
  const imageOptions = options.imageOptions || {};

  await pexelsRunner(item, { ...pexelsOptions, warnings });
  await imageRunner(item, {
    ...imageOptions,
    warnings,
    strict: options.strict ?? imageOptions.strict ?? true
  });
}

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
    imageQuality: input.imageQuality || config.openai.imageQuality,
    resolution: input.resolution || "720p"
  }, { existingItems });
  await saveItem(item);
  reportProgress("script", "Naskah siap", 100, item.title || "");

  // Pexels video clips dulu (prioritas), lalu gambar sebagai fallback
  await ensureVisualAssets(item, { warnings, strict: true });
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

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cleanIntentText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function segmentSlot(sceneIndex, segmentIndex) {
  return `${Number(sceneIndex)}:${Number(segmentIndex || 0)}`;
}

function sceneSegments(scene) {
  if (Array.isArray(scene?.visualSegments) && scene.visualSegments.length) {
    return scene.visualSegments;
  }
  return [scene || {}];
}

function buildSegmentScene(scene, segment, segmentIndex) {
  const segScene = {
    ...scene,
    visualKeywords: cleanIntentText(segment?.visualKeywords || scene?.visualKeywords),
    mustMatchTerms: Array.isArray(segment?.mustMatchTerms)
      ? segment.mustMatchTerms
      : Array.isArray(scene?.mustMatchTerms)
        ? scene.mustMatchTerms
        : [],
    narrativeContext: cleanIntentText(segment?.narrativeContext || scene?.narrativeContext),
    segmentIndex
  };

  if (own(segment, "pexelsQuery")) segScene.pexelsQuery = cleanIntentText(segment.pexelsQuery);
  else if (own(scene, "pexelsQuery")) segScene.pexelsQuery = cleanIntentText(scene.pexelsQuery);
  else delete segScene.pexelsQuery;

  return segScene;
}

function flattenPexelsSegments(item) {
  const topicFallback = cleanIntentText(item?.input?.topic);
  const slots = [];
  let flatIndex = 0;

  for (const scene of item?.plan?.scenes || []) {
    if (scene?.sceneType === "reaction") continue;
    const segments = sceneSegments(scene);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex] || {};
      const segScene = buildSegmentScene(scene, segment, segmentIndex);
      const explicitIntent = own(segScene, "pexelsQuery");
      const query = explicitIntent
        ? cleanIntentText(segScene.pexelsQuery)
        : cleanIntentText(segScene.visualKeywords || topicFallback);
      const selectionText = [
        query,
        ...(Array.isArray(segScene.mustMatchTerms) ? segScene.mustMatchTerms : []),
        segScene.visualKeywords
      ].filter(Boolean).join(", ");

      slots.push({
        scene,
        segment,
        segScene,
        sceneIndex: scene.index,
        segmentIndex,
        flatIndex,
        slot: segmentSlot(scene.index, segmentIndex),
        explicitIntent,
        explicitImageFallback: explicitIntent && !query,
        hasSearchIntent: Boolean(query),
        query,
        selectionScore: scoreSceneVisualConcreteness({ visualKeywords: selectionText })
      });
      flatIndex += 1;
    }
  }
  return slots;
}

/**
 * Rencanakan slot Pexels per segmen. Kuota adalah batas maksimum, bukan target
 * yang dipaksakan: intent kosong tetap menjadi slot gambar.
 */
export function buildPexelsClipJobs(item, options = {}) {
  const seenSlots = new Set();
  const slots = flattenPexelsSegments(item).filter((slot) => {
    if (seenSlots.has(slot.slot)) return false;
    seenSlots.add(slot.slot);
    return true;
  });
  // Satu segmen tetap mendapat satu kesempatan. Untuk lebih dari satu segmen,
  // kuota mengikuti rasio klip (default 70% agar video mendominasi visual;
  // atur via PEXELS_CLIP_RATIO). Dibulatkan ke bawah agar rasio tidak terlampaui.
  const clipRatio = Math.max(0, Math.min(1, Number(options.clipRatio ?? config.pexels.clipRatio ?? 0.7)));
  const quota = slots.length === 1 ? 1 : Math.max(1, Math.floor(slots.length * clipRatio));
  const eligible = slots.filter((slot) => (
    slot.hasSearchIntent
    && !slot.explicitImageFallback
    // Intent terstruktur sudah divalidasi story engine. Fallback legacy hanya
    // layak dicari bila punya subjek visual konkret, bukan sekadar konsep.
    && (slot.explicitIntent || slot.selectionScore > 0)
  ));
  const semanticSelection = options.semanticSelection ?? true;

  let chosen;
  if (semanticSelection) {
    chosen = new Set(
      [...eligible]
        .sort((a, b) => (b.selectionScore - a.selectionScore) || (a.flatIndex - b.flatIndex))
        .slice(0, quota)
        .map((slot) => slot.slot)
    );
  } else {
    chosen = new Set(
      eligible
        .filter((slot) => slot.flatIndex % 2 === 0)
        .slice(0, quota)
        .map((slot) => slot.slot)
    );
  }

  return slots.filter((slot) => chosen.has(slot.slot));
}

/**
 * Hash intent stabil untuk memastikan klip lama hanya dipakai pada intent
 * storyboard yang sama.
 */
export function pexelsIntentHash(scene = {}) {
  const intent = {
    pexelsQuery: own(scene, "pexelsQuery")
      ? cleanIntentText(scene.pexelsQuery).toLowerCase()
      : null,
    mustMatchTerms: [...new Set(
      (Array.isArray(scene.mustMatchTerms) ? scene.mustMatchTerms : [])
        .map((term) => cleanIntentText(term).toLowerCase())
        .filter(Boolean)
    )].sort(),
    visualKeywords: cleanIntentText(scene.visualKeywords).toLowerCase()
  };
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

export function isReusablePexelsClip(clip, scene) {
  return Boolean(
    clip?.path
    && isPexelsClip(clip)
    && validPexelsId(clip.pexelsId)
    && clip?.selectorVersion === PEXELS_SELECTOR_VERSION
    && clip?.intentHash === pexelsIntentHash(scene)
  );
}

function isPexelsClip(clip) {
  return clip?.provider === "pexels" || clip?.pexelsId !== undefined;
}

function validPexelsId(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function pexelsIdKey(value) {
  return validPexelsId(value) ? String(value).trim() : null;
}

async function pathExists(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  try {
    const mediaStat = await fs.stat(filePath);
    return mediaStat.isFile() && mediaStat.size > 0;
  } catch {
    return false;
  }
}

function createMediaExists(fileExists = pathExists) {
  const cache = new Map();
  return async (filePath, { refresh = false } = {}) => {
    if (typeof filePath !== "string" || !filePath.trim()) return false;
    if (refresh) cache.delete(filePath);
    if (!cache.has(filePath)) {
      cache.set(filePath, Promise.resolve()
        .then(() => fileExists(filePath))
        .then(Boolean)
        .catch(() => false));
    }
    return cache.get(filePath);
  };
}

function upsertPexelsAudit(audits, entry) {
  const slot = segmentSlot(entry.sceneIndex, entry.segmentIndex);
  const next = (Array.isArray(audits) ? audits : [])
    .filter((audit) => segmentSlot(audit.sceneIndex, audit.segmentIndex) !== slot);
  next.push(entry);
  return sortByScene(next);
}

/**
 * Cari dan download klip Pexels per segmen. Segmen yang tidak lolos kuota,
 * sengaja ber-intent kosong, atau tak punya kandidat relevan dibiarkan tanpa
 * metadata klip agar ensureImages membuat fallback gambar.
 */
export async function ensurePexelsClips(item, options = {}) {
  const warnings = options.warnings || [];
  const fetchClip = options.fetchClip || fetchPexelsClipForScene;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const delayMs = Math.max(0, Number(options.delayMs ?? 200) || 0);
  const semanticSelection = options.semanticSelection ?? config.pexels.semanticSelection;
  const pexelsEnabled = Boolean(config.pexels.apiKey && config.pexels.preferVideo);
  item.assets = item.assets || {};
  const allSlots = flattenPexelsSegments(item);
  const jobs = buildPexelsClipJobs(item, { semanticSelection });
  const jobSlots = new Set(jobs.map((job) => job.slot));
  const managedSlots = new Set(allSlots.map((slot) => slot.slot));
  const existingClips = [...(item.assets?.clips || [])];
  const existingImages = [...(item.assets?.images || [])];
  const pexelsBySlot = new Map();
  const blockingMediaBySlot = new Map();

  for (const clip of existingClips) {
    if (!isPexelsClip(clip)) continue;
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!pexelsBySlot.has(slot)) pexelsBySlot.set(slot, []);
    pexelsBySlot.get(slot).push(clip);
  }

  // Gambar valid yang sudah ada menang atas Pexels. Metadata stale hanya
  // dipangkas pada slot storyboard aktif; metadata di luar rencana dipertahankan.
  const images = [];
  for (const image of existingImages) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot)) {
      images.push(image);
      continue;
    }
    if (!await mediaExists(image.path)) continue;
    images.push(image);
    blockingMediaBySlot.set(slot, "existing-image");
  }

  // Klip manual/non-Pexels yang file-nya masih valid juga menang. Pengecekan
  // file mencegah metadata path yang sudah hilang memblokir regenerasi.
  const retainedNonPexelsClips = [];
  for (const clip of existingClips) {
    if (isPexelsClip(clip)) continue;
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot)) {
      retainedNonPexelsClips.push(clip);
      continue;
    }
    if (!await mediaExists(clip.path)) continue;
    retainedNonPexelsClips.push(clip);
    if (!blockingMediaBySlot.has(slot)) {
      blockingMediaBySlot.set(slot, "existing-media");
    }
  }

  // Pertahankan klip non-Pexels valid dan klip Pexels di luar storyboard aktif.
  // Semua slot aktif dibangun ulang dari kandidat reusable yang tervalidasi.
  const clips = [
    ...retainedNonPexelsClips,
    ...existingClips.filter((clip) => (
      isPexelsClip(clip)
      && !managedSlots.has(segmentSlot(clip.sceneIndex, clip.segmentIndex))
    ))
  ];
  const usedPexelsIds = new Set();
  const pendingJobs = [];
  let audits = [];

  // ID Pexels di luar storyboard terkelola tetap direservasi secara
  // konservatif, bahkan bila file lamanya tidak ada, agar video yang sama
  // tidak dipilih lagi untuk slot baru.
  for (const clip of clips) {
    if (!isPexelsClip(clip)) continue;
    const id = pexelsIdKey(clip.pexelsId);
    if (id !== null) usedPexelsIds.add(id);
  }

  for (const slot of allSlots) {
    if (jobSlots.has(slot.slot)) continue;
    const blockingReason = blockingMediaBySlot.get(slot.slot);
    audits = upsertPexelsAudit(audits, {
      sceneIndex: slot.sceneIndex,
      segmentIndex: slot.segmentIndex,
      status: "image-fallback",
      intentHash: pexelsIntentHash(slot.segScene),
      query: slot.query,
      fallbackReason: blockingReason || (slot.explicitImageFallback
        ? "explicit-image-fallback"
        : slot.hasSearchIntent
          ? "video-quota"
          : "no-search-intent")
    });
  }

  for (const job of jobs) {
    const blockingReason = blockingMediaBySlot.get(job.slot);
    if (blockingReason) {
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash: pexelsIntentHash(job.segScene),
        query: job.query,
        fallbackReason: blockingReason
      });
      continue;
    }

    let reusable = null;
    for (const clip of pexelsBySlot.get(job.slot) || []) {
      if (!isReusablePexelsClip(clip, job.segScene)) continue;
      const id = pexelsIdKey(clip.pexelsId);
      if (id === null || usedPexelsIds.has(id)) continue;
      if (!await mediaExists(clip.path)) continue;
      reusable = clip;
      break;
    }
    if (!reusable) {
      pendingJobs.push(job);
      continue;
    }

    clips.push(reusable);
    usedPexelsIds.add(String(reusable.pexelsId));
    audits = upsertPexelsAudit(audits, {
      sceneIndex: job.sceneIndex,
      segmentIndex: job.segmentIndex,
      status: "selected",
      intentHash: pexelsIntentHash(job.segScene),
      query: reusable.query || job.query,
      source: "reused"
    });
  }

  const fetchJobs = pendingJobs;

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  item.assets.pexelsAudit = audits;

  if (!pexelsEnabled) {
    for (const job of fetchJobs) {
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash: pexelsIntentHash(job.segScene),
        query: job.query,
        fallbackReason: "pexels-disabled"
      });
    }
    item.assets.pexelsAudit = audits;
    item.updatedAt = nowIso();
    await persistItem(item);
    console.log("[Pexels] Dimatikan atau API key tidak tersedia; slot tanpa klip valid memakai gambar.");
    return;
  }

  let clipDone = 0;
  const totalJobs = fetchJobs.length;
  reportProgress("images", "Mencari video B-roll Pexels", 0, `0/${totalJobs}`);
  console.log(`[Pexels] ${jobs.length}/${allSlots.length} segmen masuk kuota; ${totalJobs} perlu dicari.`);

  for (const job of fetchJobs) {
    const intentHash = pexelsIntentHash(job.segScene);
    let fetchAudit = null;
    try {
      reportProgress(
        "images",
        "Mencari video B-roll Pexels",
        totalJobs ? Math.round((clipDone / totalJobs) * 100) : 100,
        `scene ${job.sceneIndex} seg ${job.segmentIndex + 1}`
      );
      const clip = await fetchClip({
        itemId: item.id,
        scene: job.segScene,
        topicFallback: item.input?.topic || "",
        usedPexelsIds,
        onAudit: (audit) => {
          fetchAudit = audit;
        }
      });
      clipDone += 1;

      const fetchedId = pexelsIdKey(clip?.pexelsId);
      const validClip = Boolean(clip && cleanIntentText(clip.path) && fetchedId !== null);
      const duplicateId = validClip && usedPexelsIds.has(fetchedId);
      const fetchedFileExists = validClip && !duplicateId
        // Download dapat mengisi ulang path yang tadi tercatat stale, jadi
        // validasi hasil fetch harus membaca keadaan file terbaru.
        ? await mediaExists(clip.path, { refresh: true })
        : false;
      if (validClip && !duplicateId && fetchedFileExists) {
        const selected = {
          ...clip,
          provider: "pexels",
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          selectorVersion: PEXELS_SELECTOR_VERSION,
          intentHash
        };
        clips.push(selected);
        usedPexelsIds.add(fetchedId);
        audits = upsertPexelsAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "selected",
          intentHash,
          query: selected.query || job.query,
          source: "fetched"
        });
      } else {
        let fallbackReason = fetchAudit?.fallbackReason || "no-relevant-candidate";
        if (duplicateId) fallbackReason = "duplicate-pexels-id";
        else if (!validClip && clip) fallbackReason = "invalid-clip";
        else if (validClip) fallbackReason = "missing-fetched-file";
        audits = upsertPexelsAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "image-fallback",
          intentHash,
          query: fetchAudit?.query || job.query,
          fallbackReason
        });
      }
    } catch (error) {
      clipDone += 1;
      const message = `Pexels scene ${job.sceneIndex} seg ${job.segmentIndex} gagal: ${error.message}`;
      warnings.push(message);
      console.warn(message);
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash,
        query: job.query,
        fallbackReason: "fetch-error"
      });
    }

    item.assets.clips = sortByScene(clips);
    item.assets.pexelsAudit = audits;
    item.updatedAt = nowIso();
    await persistItem(item);
    reportProgress(
      "images",
      "Mencari video B-roll Pexels",
      totalJobs ? Math.round((clipDone / totalJobs) * 100) : 100,
      `${clipDone}/${totalJobs}`
    );
    if (delayMs > 0 && clipDone < totalJobs) await sleep(delayMs);
  }

  item.assets.clips = sortByScene(clips);
  item.assets.pexelsAudit = audits;
  item.updatedAt = nowIso();
  await persistItem(item);

  const totalClips = clips.filter((clip) => isPexelsClip(clip) && clip.path).length;
  const mode = semanticSelection ? "seleksi semantik" : "pola alternating";
  console.log(`[Pexels] Total klip valid: ${totalClips}; mode ${mode}, seleksi per segmen.`);
}

export async function ensureImages(item, options = {}) {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  const warnings = options.warnings || [];
  const generateImage = options.generateImage || generateImageWithRetry;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  item.assets = item.assets || {};
  const managedSlots = new Set(flattenPexelsSegments(item).map((slot) => slot.slot));
  const images = [];
  const clips = [];
  let prunedStaleMedia = false;

  for (const image of item.assets.images || []) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot) || await mediaExists(image.path)) {
      images.push(image);
    } else {
      prunedStaleMedia = true;
    }
  }
  for (const clip of item.assets.clips || []) {
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot) || await mediaExists(clip.path)) {
      clips.push(clip);
    } else {
      prunedStaleMedia = true;
    }
  }

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  if (prunedStaleMedia) {
    item.updatedAt = nowIso();
    await persistItem(item);
  }

  const size = item.input.imageSize || LANDSCAPE_SIZE;
  const quality = item.input.imageQuality || config.openai.imageQuality;

  // Hanya generate gambar untuk scene yang BELUM punya klip Pexels
  const imageScenes = item.plan.scenes.filter((s) => {
    if (s.sceneType === "reaction") return false;
    return true;
  });

  if (imageScenes.length === 0) {
    console.log("[Images] Tidak ada scene yang perlu gambar DALL-E.");
    return;
  }

  const gridMode = options.gridMode ?? config.openai.imageGridMode;
  const gridQuality = options.gridQuality || config.openai.imageGridQuality || quality;
  const generateGridImages = options.generateGridImages || generateGridImagesDefault;

  // Kelompokkan pekerjaan PER SCENE: kumpulkan segmen yang belum punya media
  // (klip Pexels/gambar). Grid 2x2 dipakai jika scene punya 4 visualSegments
  // dan >= 2 segmen kosong (1 panggilan API menghasilkan 4 panel).
  let totalSegments = 0;
  const sceneJobs = [];
  for (const scene of imageScenes) {
    const segments = scene.visualSegments?.length ? scene.visualSegments : [{ imagePrompt: scene.imagePrompt, visualKeywords: scene.visualKeywords }];
    const missing = [];
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      // Skip jika sudah punya klip video Pexels untuk segmen ini
      const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(scene.index) && Number(c.segmentIndex || 0) === segIdx && c.path);
      if (hasClip) continue;
      // Skip jika sudah punya gambar untuk segmen ini
      const hasImage = images.find((img) => Number(img.sceneIndex) === Number(scene.index) && Number(img.segmentIndex || 0) === segIdx && img.path);
      if (hasImage) continue;
      missing.push({ segIdx, segment: segments[segIdx] });
      totalSegments++;
    }
    if (missing.length) sceneJobs.push({ scene, segments, missing });
  }

  if (totalSegments === 0) {
    console.log("[Images] Semua segmen sudah punya media (klip/gambar), skip generate gambar DALL-E.");
    return;
  }

  console.log(`[Images] Generate gambar untuk ${totalSegments} segmen visual (${gridMode ? "grid 2x2 per scene" : "single per segmen"}).`);
  let imageDone = 0;
  reportProgress("images", "Membuat gambar (grid multi-segment)", 0, `0/${totalSegments}`);

  const generateSingleSegment = async ({ scene, segIdx, segment }) => {
    const segScene = {
      ...scene,
      imagePrompt: segment.imagePrompt || scene.imagePrompt,
      segmentIndex: segIdx
    };
    const image = await generateImage({ item, scene: segScene, size, quality });
    image.segmentIndex = segIdx;
    return image;
  };

  for (const { scene, segments, missing } of sceneJobs) {
    const useGrid = gridMode && segments.length === 4 && missing.length >= 2;
    reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `scene ${scene.index}`);

    if (useGrid) {
      try {
        const panels = await generateGridImages({ item, scene, segments, size, quality: gridQuality });
        const missingIndexes = new Set(missing.map((entry) => entry.segIdx));
        for (const panel of panels) {
          // Simpan hanya panel untuk segmen yang belum punya media
          // (panel milik segmen ber-klip Pexels dibuang).
          if (!missingIndexes.has(Number(panel.segmentIndex))) continue;
          images.push(panel);
          imageDone += 1;
        }
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `${imageDone}/${totalSegments}`);
        item.assets.images = sortByScene(images);
        item.updatedAt = nowIso();
        await persistItem(item);
        continue;
      } catch (error) {
        // Fallback otomatis ke single-image per segmen (perilaku lama).
        const message = `Grid gambar scene ${scene.index} gagal: ${error.message}. Fallback ke single-image per segmen.`;
        console.warn(`[Images] ${message}`);
        warnings.push(message);
      }
    }

    for (const { segIdx, segment } of missing) {
      try {
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `scene ${scene.index} seg ${segIdx + 1}`);
        const image = await generateSingleSegment({ scene, segIdx, segment });
        imageDone += 1;
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `${imageDone}/${totalSegments}`);
        images.push(image);
        item.assets.images = sortByScene(images);
        item.updatedAt = nowIso();
        await persistItem(item);
      } catch (error) {
        const message = `Gambar scene ${scene.index} seg ${segIdx} gagal: ${error.message}`;
        if (options.strict) throw new Error(message);
        warnings.push(message);
      }
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
  // Cek: setiap segmen visual dari setiap scene image/summary harus punya MINIMAL klip video ATAU gambar
  const requiredScenes = (item.plan.scenes || []).filter((scene) => scene.sceneType !== "reaction");
  const clips = item.assets.clips || [];
  const images = item.assets.images || [];
  for (const scene of requiredScenes) {
    const segCount = scene.visualSegments?.length || 1;
    for (let segIdx = 0; segIdx < segCount; segIdx++) {
      const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(scene.index) && Number(c.segmentIndex || 0) === segIdx && c.path);
      const hasImage = images.find((img) => Number(img.sceneIndex) === Number(scene.index) && Number(img.segmentIndex || 0) === segIdx && img.path);
      if (!hasClip && !hasImage) {
        const error = new Error(`Scene ${scene.index} segmen ${segIdx + 1} belum punya media (klip video atau gambar). Generate dulu.`);
        error.status = 409;
        throw error;
      }
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

async function generateGridImagesDefault({ item, scene, segments, size, quality }) {
  try {
    return await generateSceneGridImage({ itemId: item.id, scene, segments, size, quality });
  } catch (error) {
    // Retry sekali dengan prompt panel yang di-safe-kan (pola sama dengan generateImageWithRetry).
    const safeSegments = segments.map((segment, segIdx) => ({
      ...segment,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        `moment ${segIdx + 1} of 4 in sequence`,
        "objects, hands, table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    }));
    const panels = await generateSceneGridImage({ itemId: item.id, scene, segments: safeSegments, size, quality });
    for (const panel of panels) panel.recoveredFrom = error.message;
    return panels;
  }
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
  return [...items].sort((a, b) => (
    (Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0))
    || (Number(a.segmentIndex || 0) - Number(b.segmentIndex || 0))
  ));
}
