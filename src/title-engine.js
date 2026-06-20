/**
 * Title Engine — generate judul viral dari ringkasan konten (hook + summary + poin).
 * Judul dibuat AI berdasarkan deskripsi/inti video, bukan sekadar diambil dari topik.
 */

import { config } from "./config.js";
import { requestKnowledgeJson } from "./openai.js";
import { cleanText } from "./util.js";

const DEFAULT_TITLE_PATTERNS = [
  "Bagaimana Otak Kita Bisa Ditipu Begitu Mudahnya",
  "Kenapa Mata Bisa Melihat Sesuatu yang Tidak Ada",
  "Mengapa Kebohongan Lebih Mudah Diingat daripada Fakta",
  "Bagaimana Rahasia Ini Baru Terbuka Setelah Puluhan Tahun",
  "Kenapa Fenomena Ini Sulit Dijelaskan Sampai Sekarang",
  "Bagaimana Hal Kecil Ini Mengubah Sejarah Besar",
  "Kenapa Penyebabnya Bukan yang Selama Ini Kita Kira",
  "Bagaimana Satu Keputusan Kecil Mengubah Segalanya",
  "Kenapa Petunjuk Ini Sengaja Dihapus dari Sejarah",
  "Mengapa Mitos Ini Masih Banyak Dipercaya Orang",
  "Kenapa yang Disebut Berbahaya Ternyata Justru Aman",
  "Bagaimana Pikiran Diam-diam Memanipulasi Kita",
  "Kenapa Hal Biasa Ini Bisa Menghasilkan Efek Menakjubkan",
  "Bagaimana Benda Sehari-hari Menyimpan Rahasia Besar",
  "Kenapa Suara Ini Bikin 90% Orang Merinding",
  "Mengapa Teknologi Ini Akan Mengubah Cara Manusia Hidup",
  "Bagaimana Sesuatu yang Terlihat Asli Ternyata Bukan",
  "Kenapa Hal Ini Jarang Diceritakan di Buku Sekolah",
  "Bagaimana Alam Menyembunyikan Pola yang Luar Biasa",
  "Kenapa Kita Tidak Pernah Menyadari Hal Ini Sebelumnya"
];

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
  // Pilih yang paling singkat namun tetap informatif, maksimal 60 karakter.
  const preferred = valid.find((t) => t.length <= 60) || valid[0];
  return preferred;
}

function buildTitlePrompt(digest, currentTitle, category) {
  return [
    "Kamu spesialis judul YouTube edukasi berbahasa Indonesia.",
    "Tugas: buat 5 judul video yang membuat orang PENASARAN dan mau membuka video.",
    "Bahan dasar (ringkasan konten video):",
    "---",
    digest,
    "---",
    `Judul saat ini: ${currentTitle || "(belum ada)"}`,
    `Kategori: ${category || "umum"}`,
    "",
    "ATURAN JUDUL:",
    "- Maksimal 60 karakter.",
    "- Bahasa Indonesia natural, singkat, padat.",
    "- Tidak pakai emoji.",
    "- Tidak pakai tanda seru berlebihan.",
    "- WAJIB diawali kata penasaran: 'Bagaimana', 'Kenapa', atau 'Mengapa'.",
    "- Gaya pertanyaan yang bikin penonton berhenti scroll karena ingin tahu jawabannya.",
    "- Contoh BAGUS: 'Bagaimana Kompas Menemukan Utara di Lautan', 'Kenapa Madu Tidak Pernah Basi'.",
    "- DILARANG pakai kata: 'skill', 'insentif', 'trik', 'hack', 'rahasia di balik'.",
    "- DILARANG gaya listicle ('5 Fakta...', '3 Hal...') atau gaya tips/tutorial.",
    "- Harus punya 'curiosity gap' — penonton ingin tahu tapi jawaban tidak ada di judul.",
    "- Judul harus akurat sesuai konten; jangan clickbait yang menipu.",
    "",
    "Contoh pola yang HARUS diikuti (variasikan diksinya):",
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
  const digest = buildContentDigest(plan);
  if (!digest.trim()) return currentTitle;

  try {
    const promptText = buildTitlePrompt(digest, currentTitle, input?.category);
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
