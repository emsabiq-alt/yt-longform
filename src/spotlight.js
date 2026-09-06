import { config } from "./config.js";
import { buildWordTimeline, findPhraseTime, tokenizeMatchText } from "./word-timeline.js";

/**
 * Popup "Spotlight": kartu kecil berisi satu poin kunci yang muncul tepat saat
 * frasa pemicunya diucapkan.
 *
 * Prinsip desain: presisi datang dari PENOLAKAN, bukan animasi. Kartu hanya
 * tampil kalau frasa pemicu benar-benar ketemu di timeline kata dengan skor
 * tinggi. Tidak ketemu → dibatalkan, bukan ditebak posisinya. Popup yang muncul
 * di waktu yang salah lebih merusak daripada tidak ada popup sama sekali.
 *
 * ponytail: satu bentuk kartu (teks) untuk semua tipe. Tipe "figure" memakai
 * kartu yang sama, hanya sublabel-nya diisi peran tokoh, karena render kartu
 * foto lewat pureimage tidak bisa menggambar teks dengan font variable yang
 * dipakai repo ini (fillText crash pada NotoSans-Variable). Upgrade: tambahkan
 * font statis lalu render kartu berfoto sebagai overlay PNG.
 */

const MIN_SCORE = 0.6;
const MIN_GAP_SEC = 25;
const MAX_PER_VIDEO = 4;
const CARD_DURATION_SEC = 3.6;
const LEAD_IN_SEC = 0.12;

const stats = { candidates: 0, placed: 0, rejectedScore: 0, rejectedQuota: 0, rejectedGap: 0 };

export function normalizeSpotlight(raw) {
  if (!raw || typeof raw !== "object") return null;
  const label = cleanShort(raw.label, 42);
  const phrase = cleanShort(raw.phrase, 90);
  if (!label || !phrase) return null;
  const type = raw.type === "figure" ? "figure" : "keypoint";
  return { type, label, sublabel: cleanShort(raw.sublabel, 52), phrase };
}

function cleanShort(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").trim();
}

/**
 * Tentukan kapan tiap kartu muncul. Scene reaction dan summary dilewati:
 * keduanya sudah punya teks penuh layar sendiri.
 * @returns {{ sceneIndex: number, startSec: number, endSec: number, label: string, sublabel: string, type: string, score: number }[]}
 */
export function planSceneSpotlights(scenes, options = {}) {
  const maxPerVideo = Number(options.maxPerVideo ?? MAX_PER_VIDEO);
  const minGap = Number(options.minGapSec ?? MIN_GAP_SEC);
  const minScore = Number(options.minScore ?? MIN_SCORE);
  const placed = [];

  for (const scene of scenes || []) {
    if (scene?.sceneType === "reaction" || scene?.sceneType === "summary") continue;
    const spotlight = normalizeSpotlight(scene?.spotlight);
    if (!spotlight) continue;
    stats.candidates += 1;

    if (placed.length >= maxPerVideo) {
      stats.rejectedQuota += 1;
      continue;
    }

    const timeline = buildWordTimeline(scene.sceneCaptions);
    const match = findPhraseTime(timeline, tokenizeMatchText(spotlight.phrase));
    if (!match || match.score < minScore) {
      stats.rejectedScore += 1;
      continue;
    }

    const sceneStart = Number(scene.startSec || 0);
    const sceneDuration = Number(scene.durationSec || 0);
    const localStart = Math.max(0, match.time - LEAD_IN_SEC);
    // Kartu tidak boleh menyeberang ke scene berikutnya: visual di baliknya
    // sudah berganti dan kartu jadi terlihat nyasar.
    const available = sceneDuration - localStart;
    if (available < 1.6) {
      stats.rejectedScore += 1;
      continue;
    }
    const startSec = sceneStart + localStart;
    if (placed.length && startSec - placed.at(-1).startSec < minGap) {
      stats.rejectedGap += 1;
      continue;
    }

    placed.push({
      sceneIndex: Number(scene.index || 0),
      startSec: Number(startSec.toFixed(3)),
      endSec: Number((startSec + Math.min(CARD_DURATION_SEC, available)).toFixed(3)),
      label: spotlight.label,
      sublabel: spotlight.sublabel,
      type: spotlight.type,
      score: Number(match.score.toFixed(2))
    });
    stats.placed += 1;
  }

  return placed;
}

/**
 * Satu baris ringkasan penempatan spotlight per render, lalu reset counter.
 */
export function logSpotlightStats() {
  if (!stats.candidates) return null;
  const snapshot = { ...stats };
  console.log(
    `[Spotlight] kandidat ${snapshot.candidates} | tampil ${snapshot.placed} | ditolak skor/ruang ${snapshot.rejectedScore}, kuota ${snapshot.rejectedQuota}, jarak ${snapshot.rejectedGap}`
  );
  for (const key of Object.keys(stats)) stats[key] = 0;
  return snapshot;
}

const ACCENT = "&H004CC8F5";
const CARD_X = 64;
const CARD_Y = 470;
const CARD_W = 470;

/**
 * Baris ASS untuk satu kartu: panel vektor + garis aksen + teks. Semuanya
 * digambar dengan drawing command ASS (\p1) sehingga tidak menambah dependency
 * grafis maupun pass ffmpeg baru — ikut terbakar di pass subtitle yang sudah ada.
 */
export function spotlightDialogueLines(placements, dialogueFn, escapeFn) {
  const events = [];
  for (const card of placements || []) {
    const twoLine = Boolean(card.sublabel);
    const height = twoLine ? 104 : 72;
    const top = CARD_Y + (twoLine ? 0 : 20);
    const fade = "{\\fad(220,260)}";

    events.push(dialogueFn(
      card.startSec,
      card.endSec,
      "SpotlightPanel",
      `${fade}{\\an7\\pos(${CARD_X},${top})\\p1}m 0 0 l ${CARD_W} 0 l ${CARD_W} ${height} l 0 ${height}`
    ));
    events.push(dialogueFn(
      card.startSec,
      card.endSec,
      "SpotlightBar",
      `${fade}{\\an7\\pos(${CARD_X},${top})\\p1}m 0 0 l 6 0 l 6 ${height} l 0 ${height}`
    ));
    events.push(dialogueFn(
      card.startSec + 0.08,
      card.endSec,
      "SpotlightLabel",
      `${fade}{\\an7\\pos(${CARD_X + 24},${top + 14})}${escapeFn(card.label)}`
    ));
    if (twoLine) {
      events.push(dialogueFn(
        card.startSec + 0.14,
        card.endSec,
        "SpotlightSub",
        `${fade}{\\an7\\pos(${CARD_X + 24},${top + 58})}${escapeFn(card.sublabel)}`
      ));
    }
  }
  return events;
}

export function spotlightStyles() {
  const body = config.render.fontBody;
  return [
    `Style: SpotlightPanel,${body},20,&HC011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightLabel,${body},30,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`,
    `Style: SpotlightSub,${body},22,${ACCENT},&H000000FF,&H9011171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`
  ];
}
