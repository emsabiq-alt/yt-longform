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

const MIN_SCORE = 0.48; // Toleransi skor pencocokan lebih baik agar kartu lebih sering muncul
const MIN_GAP_SEC = 5; // Jeda minimum antar kartu lebih rapat (sebelumnya 8s)
const MAX_PER_VIDEO = 22; // Kuota per video dinaikkan (sebelumnya 14)
const CARD_DURATION_SEC = 4.5; // Durasi tampil lebih lama (sebelumnya 3.6s) agar terbaca jelas di HP
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

/**
 * Ekstraksi otomatis Spotlight jika AI tidak mengisi field spotlight.
 * Menjamin 8-18 spotlight muncul konsisten per video pada scene informatif.
 */
export function extractAutoSpotlight(scene) {
  if (!scene || scene.sceneType === "reaction" || scene.sceneType === "summary") return null;
  const narration = String(scene.narration || "").trim();
  if (!narration) return null;

  const rawScreenText = String(scene.screenText || "").trim();
  const isGeneric = /^(babak|scene|bagian|fakta|segmen)\s*\d*$/i.test(rawScreenText);

  // 1. Cari angka, persentase, tahun, atau satuan kuantitatif di narasi
  const statMatch =
    narration.match(/\b((?:(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|ratus|ribu|juta|miliar|triliun|puluhan|ratusan|ribuan|jutaan|miliaran|\d+[\d,.]*)\s+)+(?:persen|%|ribu|juta|miliar|triliun|meter|kilometer|km|ton|kg|derajat|jam|tahun|kali(?: lipat)?|sm|masehi|dolar|rupiah))\b/i) ||
    narration.match(/\b(tahun\s+\d{4}|\d{4}\s*sm|abad\s+ke-?\w+)\b/i);

  const words = narration.split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "").trim()).filter(Boolean);
  if (words.length < 3) return null;

  let label = "";
  let sublabel = "";
  let phrase = "";

  if (statMatch && statMatch.index !== undefined) {
    const matchIdx = statMatch.index;
    const beforeWords = narration.slice(0, matchIdx).split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "").trim()).filter(Boolean);
    const startWordIdx = Math.max(0, beforeWords.length - 1);
    const phraseWords = words.slice(startWordIdx, startWordIdx + 4);
    phrase = phraseWords.join(" ");

    if (!isGeneric && rawScreenText.length >= 3 && rawScreenText.length <= 42) {
      label = rawScreenText;
      sublabel = statMatch[0].trim();
    } else {
      label = statMatch[0].trim();
      sublabel = "Fakta Kunci";
    }
  } else if (!isGeneric && rawScreenText.length >= 3 && rawScreenText.length <= 42) {
    const phraseWords = words.slice(0, Math.min(4, words.length));
    phrase = phraseWords.join(" ");
    label = rawScreenText;
    sublabel = "Poin Utama";
  }

  if (!label || !phrase) return null;

  return {
    type: "keypoint",
    label: cleanShort(label, 42),
    sublabel: cleanShort(sublabel, 52),
    phrase: cleanShort(phrase, 90)
  };
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
    const spotlight = normalizeSpotlight(scene?.spotlight) || extractAutoSpotlight(scene);
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

// Keypoint spotlight — pojok kiri bawah (diperbesar agar jelas di layar smartphone)
const KP_X = 64;
const KP_Y = 450;
const KP_W = 540;

// Figure spotlight — tengah layar (PlayRes 1280×720, diperbesar agar jelas di HP)
const FIG_W = 660;
const FIG_X = Math.round((1280 - FIG_W) / 2); // 310
const FIG_Y = 230; // sepertiga atas layar agar tidak tutup caption bawah

/**
 * Baris ASS untuk kartu spotlight.
 * - type "figure"   → kartu besar di tengah layar (nama tokoh + jabatan)
 * - type "keypoint" → kartu kecil di pojok kiri bawah (fakta kunci)
 */
export function spotlightDialogueLines(placements, dialogueFn, escapeFn) {
  const events = [];
  for (const card of placements || []) {
    const isFigure = card.type === "figure";
    const twoLine = Boolean(card.sublabel);
    const fade = "{\\fad(250,300)}";

    if (isFigure) {
      // Kartu tokoh: tengah layar, lebih besar
      const height = twoLine ? 144 : 98;
      const top = FIG_Y;
      events.push(dialogueFn(
        card.startSec, card.endSec, "FigurePanel",
        `${fade}{\\an7\\pos(${FIG_X},${top})\\p1}m 0 0 l ${FIG_W} 0 l ${FIG_W} ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "FigureBar",
        `${fade}{\\an7\\pos(${FIG_X},${top})\\p1}m 0 0 l 8 0 l 8 ${height} l 0 ${height}`
      ));
      // Nama tokoh (centered dalam kartu)
      events.push(dialogueFn(
        card.startSec + 0.08, card.endSec, "FigureLabel",
        `${fade}{\\an5\\pos(${Math.round(FIG_X + FIG_W / 2)},${top + (twoLine ? 46 : 52)})}${escapeFn(card.label)}`
      ));
      if (twoLine) {
        events.push(dialogueFn(
          card.startSec + 0.14, card.endSec, "FigureSub",
          `${fade}{\\an5\\pos(${Math.round(FIG_X + FIG_W / 2)},${top + 100})}${escapeFn(card.sublabel)}`
        ));
      }
    } else {
      // Kartu keypoint: pojok kiri bawah (font lebih besar, panel lebih lega)
      const height = twoLine ? 116 : 80;
      const top = KP_Y + (twoLine ? 0 : 20);
      events.push(dialogueFn(
        card.startSec, card.endSec, "SpotlightPanel",
        `${fade}{\\an7\\pos(${KP_X},${top})\\p1}m 0 0 l ${KP_W} 0 l ${KP_W} ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "SpotlightBar",
        `${fade}{\\an7\\pos(${KP_X},${top})\\p1}m 0 0 l 6 0 l 6 ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.08, card.endSec, "SpotlightLabel",
        `${fade}{\\an7\\pos(${KP_X + 24},${top + 16})}${escapeFn(card.label)}`
      ));
      if (twoLine) {
        events.push(dialogueFn(
          card.startSec + 0.14, card.endSec, "SpotlightSub",
          `${fade}{\\an7\\pos(${KP_X + 24},${top + 64})}${escapeFn(card.sublabel)}`
        ));
      }
    }
  }
  return events;
}

export function spotlightStyles() {
  const body = config.render.fontBody;
  return [
    // Keypoint — pojok kiri bawah (font diperbesar dari 30->36 dan 22->26)
    `Style: SpotlightPanel,${body},20,&HC011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightLabel,${body},36,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`,
    `Style: SpotlightSub,${body},26,${ACCENT},&H000000FF,&H9011171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`,
    // Figure — tengah layar (font diperbesar dari 38->46 dan 26->30)
    `Style: FigurePanel,${body},20,&HE011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: FigureBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: FigureLabel,${body},46,&H00FFFFFF,&H000000FF,&HAA11171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.8,0,5,0,0,0,1`,
    `Style: FigureSub,${body},30,${ACCENT},&H000000FF,&HAA11171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,5,0,0,0,1`
  ];
}
