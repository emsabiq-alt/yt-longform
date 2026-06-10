/**
 * Continuity Engine - memastikan ide, judul, tema, angle, dan formatType
 * tidak sama atau terlalu mirip dengan video yang sudah pernah dibuat.
 */

import { listContextItems } from "./storage.js";
import { cleanText } from "./util.js";

const SIMILARITY_THRESHOLD = 0.5;
const COMBO_LOOKBACK = 15;
const TITLE_SIMILARITY_THRESHOLD = 0.55;

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordSet(value) {
  const stop = new Set([
    "yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa", "mengapa",
    "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "the", "of", "a", "an",
    "padahal", "ternyata", "saja", "dengan", "atau", "juga", "para", "sebuah",
    "seorang", "suatu", "paling", "hanya", "lebih", "sangat", "banyak"
  ]);
  return new Set(
    normalizeTitle(value)
      .split(" ")
      .filter((w) => w.length > 3 && !stop.has(w))
  );
}

function similarity(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const w of aSet) if (bSet.has(w)) inter += 1;
  return inter / Math.min(aSet.size, bSet.size);
}

export async function loadHistory(limit = 100) {
  try {
    const items = await listContextItems();
    return (items || [])
      .map((it) => ({
        topic: cleanText(it.input?.topic || it.topic || it.title || "", 160),
        title: cleanText(it.title || "", 100),
        category: cleanText(it.input?.category || it.category || "", 80),
        angle: cleanText(it.input?.angle || it.angle || "", 80),
        formatType: cleanText(it.input?.formatType || it.formatType || "", 40)
      }))
      .filter((it) => it.topic)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Cek apakah kombinasi kandidat cukup segar dibandingkan history.
 * @returns {{ isFresh: boolean, reason: string, similarItem: object|null }}
 */
export function checkFreshness(candidate, history, options = {}) {
  const topicThreshold = options.topicThreshold || SIMILARITY_THRESHOLD;
  const titleThreshold = options.titleThreshold || TITLE_SIMILARITY_THRESHOLD;
  const comboLookback = options.comboLookback || COMBO_LOOKBACK;

  const candNorm = normalizeTitle(candidate.topic);
  const candKeywords = keywordSet(candidate.topic);
  const candTitleKeywords = keywordSet(candidate.title || candidate.topic);

  const recentHistory = history.slice(0, comboLookback);

  for (const past of recentHistory) {
    // Topik identik
    if (normalizeTitle(past.topic) === candNorm) {
      return { isFresh: false, reason: `topik identik pernah dibuat: "${past.title || past.topic}"`, similarItem: past };
    }

    // Topik mirip
    if (similarity(candKeywords, keywordSet(past.topic)) >= topicThreshold) {
      return { isFresh: false, reason: `topik terlalu mirip dengan: "${past.title || past.topic}"`, similarItem: past };
    }

    // Kombinasi category + angle + formatType sama
    if (
      past.category === candidate.category &&
      past.angle === candidate.angle &&
      past.formatType === candidate.formatType
    ) {
      return { isFresh: false, reason: `kombinasi kategori+angle+formatType sama dengan: "${past.title || past.topic}"`, similarItem: past };
    }
  }

  // Cek judul mirip di seluruh history
  for (const past of history) {
    if (similarity(candTitleKeywords, keywordSet(past.title)) >= titleThreshold) {
      return { isFresh: false, reason: `judul terlalu mirip dengan: "${past.title}"`, similarItem: past };
    }
  }

  return { isFresh: true, reason: "", similarItem: null };
}

/**
 * Verifikasi batch ide dari AI dan ambil yang pertama kali fresh.
 * @returns {object|null} idea yang fresh, atau null jika tidak ada.
 */
export function pickFreshIdeaFromBatch(ideas, formatType, angle, category, history) {
  for (const idea of ideas) {
    if (!idea?.topic) continue;
    const candidate = {
      topic: cleanText(idea.topic, 160),
      title: cleanText(idea.topic, 160),
      category: cleanText(idea.category || category, 80),
      angle: cleanText(idea.angle || angle, 80),
      formatType
    };
    const check = checkFreshness(candidate, history);
    if (check.isFresh) return candidate;
    console.log(`[Continuity] Skip ide: ${check.reason}`);
  }
  return null;
}
