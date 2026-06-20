/**
 * Title Engine — generate judul viral dari ringkasan konten (hook + summary + poin).
 * Judul dibuat AI berdasarkan deskripsi/inti video, bukan sekadar diambil dari topik.
 */

import { config } from "./config.js";
import { requestKnowledgeJson } from "./openai.js";
import { cleanText } from "./util.js";

// Pola contoh: SELALU menyebut subjek konkret (benda/makhluk/tempat nyata) + rasa penasaran.
// Penonton harus langsung paham videonya tentang apa, tapi jawabannya tetap ditahan.
const DEFAULT_TITLE_PATTERNS = [
  "Kenapa Madu Tidak Pernah Basi Meski Disimpan Ribuan Tahun",
  "Bagaimana Kompas Tahu Arah Utara di Tengah Lautan",
  "Kenapa Langit Malam Gelap Padahal Ada Miliaran Bintang",
  "Mengapa Kucing Mendengkur Padahal Tak Selalu Sedang Senang",
  "Kenapa Es Mengambang dan Tidak Tenggelam Seperti Benda Padat Lain",
  "Bagaimana Semut Menemukan Jalan Pulang Tanpa Pernah Tersesat",
  "Kenapa Keyboard Tidak Disusun Sesuai Urutan Abjad",
  "Mengapa Garam Dulu Lebih Berharga daripada Emas",
  "Kenapa Kita Tidak Bisa Mengingat Masa Bayi Sendiri",
  "Bagaimana Lebah Membuat Sarang Segi Enam yang Nyaris Sempurna",
  "Kenapa Air Laut Asin tapi Air Sungai Tidak",
  "Mengapa Pesawat Sebesar Itu Bisa Terbang Padahal Sangat Berat",
  "Kenapa Bawang Membuat Mata Kita Menangis Saat Dipotong",
  "Bagaimana Otak Tetap Bekerja Saat Kita Sedang Tidur"
];

// Frasa kabur yang dilarang menggantikan subjek konkret di judul.
const VAGUE_TITLE_PATTERNS = /\b(hal ini|hal kecil|hal biasa|hal sepele|fenomena ini|peristiwa ini|sesuatu yang|sesuatu|misteri ini|rahasia ini|benda ini|teknologi ini|suara ini|pola ini|mereka ini)\b/i;

/**
 * Bangun teks ringkasan dari plan untuk dijadikan bahan judul.
 */
function buildContentDigest(plan) {
  const hook = cleanText(plan?.hook || "", 400);
  const summary = cleanText(plan?.summary || "", 800);
  const points = (plan?.importantPoints || [])
    .slice(0, 5)
    .map((p) => cleanText(p, 220))
    .filter(Boolean);
  const parts = [
    hook ? `Hook: ${hook}` : "",
    summary ? `Ringkasan: ${summary}` : "",
    points.length ? `Poin penting:\n${points.map((p) => `- ${p}`).join("\n")}` : ""
  ].filter(Boolean);
  return parts.join("\n\n");
}

function stripEmoji(value) {
  return String(value || "")
    // Hapus emoji dan simbol variasi Unicode
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "")
    .trim();
}

function pickBestTitle(titles, currentTitle) {
  const candidates = Array.isArray(titles) ? titles : [titles];
  const valid = candidates
    .map((t) => cleanText(stripEmoji(t), 80))
    .filter((t) => t.length >= 10 && t.length <= 80 && /[a-zA-Z\u00C0-\u024F]/.test(t));
  if (!valid.length) return "";
  // Buang judul yang masih memakai frasa kabur (tanpa subjek konkret).
  const concrete = valid.filter((t) => !VAGUE_TITLE_PATTERNS.test(t));
  const pool = concrete.length ? concrete : valid;
  // Pilih yang paling singkat namun tetap informatif, maksimal 60 karakter.
  const preferred = pool.find((t) => t.length <= 60) || pool[0];
  return preferred;
}

function buildTitlePrompt(digest, currentTitle, category, subject) {
  return [
    "Kamu spesialis judul YouTube edukasi berbahasa Indonesia.",
    "Tugas: buat 5 judul video yang membuat orang PENASARAN dan mau membuka video.",
    "Bahan dasar (ringkasan konten video):",
    "---",
    digest,
    "---",
    `Subjek konkret video (WAJIB disebut eksplisit di judul): ${subject || currentTitle || "(tentukan dari ringkasan)"}`,
    `Judul saat ini: ${currentTitle || "(belum ada)"}`,
    `Kategori: ${category || "umum"}`,
    "",
    "ATURAN JUDUL:",
    "- Maksimal 60 karakter.",
    "- Bahasa Indonesia natural, singkat, padat.",
    "- Tidak pakai emoji dan tidak pakai tanda seru berlebihan.",
    "- WAJIB diawali kata penasaran: 'Bagaimana', 'Kenapa', atau 'Mengapa'.",
    "- WAJIB menyebut SUBJEK KONKRET yang dibahas (benda/makhluk/tempat/peristiwa nyata),",
    "  sehingga penonton LANGSUNG paham videonya tentang apa hanya dari judul.",
    "- DILARANG KERAS memakai kata ganti kabur sebagai pengganti subjek:",
    "  'Hal Ini', 'Hal Kecil', 'Fenomena Ini', 'Sesuatu', 'Benda Ini', 'Teknologi Ini', 'Misteri Ini'.",
    "  Tulis nama subjeknya secara langsung (mis. 'Madu', 'Kucing', 'Kompas', 'Es', 'Keyboard').",
    "- Boleh menahan JAWABAN (curiosity gap), tetapi SUBJEK + PERTANYAANNYA harus jelas.",
    "  Contoh benar: 'Kenapa Madu Tidak Pernah Basi' (subjek=madu jelas, jawaban ditahan).",
    "  Contoh SALAH: 'Kenapa Hal Ini Tidak Pernah Basi' (subjek kabur — DILARANG).",
    "- DILARANG pakai kata: 'skill', 'insentif', 'trik', 'hack', 'rahasia di balik'.",
    "- DILARANG gaya listicle ('5 Fakta...', '3 Hal...') atau gaya tips/tutorial.",
    "- Judul harus akurat sesuai konten; jangan clickbait yang menipu.",
    "",
    "Contoh pola yang HARUS diikuti (perhatikan: subjek selalu disebut jelas, variasikan diksinya):",
    ...DEFAULT_TITLE_PATTERNS.map((p) => `- ${p}`),
    "",
    "Kembalikan JSON valid saja dengan format:",
    '{ "titles": ["judul 1", "judul 2", "judul 3", "judul 4", "judul 5"] }'
  ].join("\n");
}

/**
 * Generate judul viral dari ringkasan konten plan.
 * @param {object} plan - Objek plan yang sudah dinormalisasi.
 * @param {object} input - Input asli (untuk kategori/topik fallback).
 * @returns {Promise<string>} Judul terpilih, atau string kosong jika gagal.
 */
export async function generateViralTitle(plan, input = {}) {
  if (!config.openai.apiKey) return "";
  const currentTitle = cleanText(plan?.title || input?.topic || "", 100);
  const subject = cleanText(input?.topic || plan?.title || "", 120);
  const digest = buildContentDigest(plan);
  if (!digest.trim()) return currentTitle;

  try {
    const promptText = buildTitlePrompt(digest, currentTitle, input?.category, subject);
    const result = await requestKnowledgeJson(promptText);
    const best = pickBestTitle(result?.titles, currentTitle);
    if (best) {
      console.log(`[Title Engine] Judul viral digenerate: "${best}"`);
      return best;
    }
  } catch (error) {
    console.warn(`[Title Engine] Gagal generate judul viral: ${error.message}`);
  }
  return currentTitle;
}
