/**
 * Title Engine — generate judul viral dari ringkasan konten (hook + summary + poin).
 * Judul dibuat AI berdasarkan deskripsi/inti video, bukan sekadar diambil dari topik.
 */

import { config } from "./config.js";
import { requestKnowledgeJson } from "./openai.js";
import { cleanText } from "./util.js";

const DEFAULT_TITLE_PATTERNS = [
  "Otak Kita Ternyata Gampang Ditipu… Ini Alasannya",
  "Mata Bisa Melihat Sesuatu yang Sebenarnya Tidak Ada",
  "Ternyata Kebohongan Lebih Mudah Diingat daripada Fakta",
  "Rahasia yang Baru Terbuka Setelah Puluhan Tahun",
  "Rahasia di Balik Topik Ini yang Jarang Dibahas",
  "Kenapa Fenomena Ini Sulit Dijelaskan Ilmuwan?",
  "Hal Kecil yang Mengubah Sejarah Besar",
  "Ternyata Penyebabnya Bukan yang Kita Kira",
  "Keputusan Kecil yang Efeknya Mendunia",
  "Petunjuk Lama yang Sengaja Dihapus dari Sejarah",
  "Mitos yang Masih Banyak Dipercaya Tentang Topik Ini",
  "Sering Disebut Berbahaya, Ternyata Ini Justru Aman",
  "5 Fakta Aneh yang Bikin Otakmu Bingung",
  "5 Trik Pikiran yang Diam-diam Memanipulasimu",
  "Bagaimana Jika Skenario Ekstrem Ini Terjadi?",
  "Kesalahan Kecil yang Tanpa Sadar Kamu Lakukan",
  "Fenomena yang Bikin Otakmu Sulit Mempercayai Matamu",
  "Suara Ini Bikin 90% Orang Merinding, Ini Penjelasan Ilmiahnya",
  "Sejarah Tersembunyi di Balik Benda yang Kamu Pakai Tiap Hari",
  "Teknologi yang Akan Mengubah Cara Manusia Hidup",
  "Mengapa Hal Biasa Ini Bisa Hasilkan Efek Menakjubkan?",
  "Apa yang Terjadi Kalau Kebiasaan Ini Dihentikan?",
  "3 Hal yang Akan Mengubah Cara Berpikirmu",
  "Cara Kerja yang Terlihat Seperti Asli, Ternyata Begini",
  "Yang Jarang Diceritakan di Buku Sekolah Tentang Topik Ini"
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
    "- Tidak terlalu umum seperti 'Ini Fakta Menarik' tanpa subjek jelas.",
    "- Harus punya 'curiosity gap' atau sudut yang membuat penonton ingin tahu.",
    "- Boleh pakai angka, pertanyaan, paradoks, atau konsekuensi tersembunyi.",
    "- Judul harus akurat sesuai konten; jangan clickbait yang menipu.",
    "",
    "Panduan tambahan: gabungkan pola di atas, buat judul yang bikin orang berhenti scroll karena penasaran, dan jangan langsung memberi jawaban di judul.",
    "Contoh pola yang bisa dipakai (variasikan diksinya):",
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
