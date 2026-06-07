/**
 * Topic Engine - "skill" pemilih topik mandiri untuk video longform.
 *
 * Tujuan: setiap kali topik dikosongkan, sistem memikirkan sendiri topik
 * BARU yang belum pernah dibuat (anti-duplikat), dengan variasi kategori,
 * sudut pandang, dan era. Tidak lagi default ke satu topik tertentu.
 */

import { requestIdeaJson } from "./openai.js";
import { listContextItems } from "./storage.js";
import { cleanText } from "./util.js";

export const TOPIC_CATEGORIES = [
  "sains", "penemuan", "sejarah", "tubuh manusia", "alam semesta",
  "teknologi", "benda sehari-hari", "tokoh dunia", "bahasa dan budaya",
  "makanan dan dapur", "material dan warna", "peta dan navigasi",
  "suara dan musik", "infrastruktur tersembunyi", "ekologi mikro",
  "ekonomi dan bisnis", "psikologi", "hewan dan tumbuhan", "luar angkasa",
  "arsitektur", "transportasi", "energi", "matematika sehari-hari", "misteri sejarah"
];

const ANGLES = [
  "kenapa bisa terjadi", "bagaimana cara kerjanya", "asal-usul yang jarang diketahui",
  "kesalahpahaman umum yang ternyata keliru", "dampak tak terduga",
  "rahasia di balik benda biasa", "kisah kegagalan yang mengubah dunia",
  "penemuan tak sengaja", "fakta yang melawan akal sehat", "evolusi dari masa ke masa"
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token signifikan dari sebuah judul/topik untuk deteksi kemiripan. */
function keywordSet(value) {
  const stop = new Set([
    "yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa", "mengapa",
    "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "the", "of", "a", "an",
    "padahal", "ternyata", "saja", "dengan", "atau", "juga", "para"
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

/** Kumpulkan "memori" topik yang sudah pernah dibuat. */
async function loadHistory() {
  try {
    const items = await listContextItems();
    return (items || [])
      .map((it) => it.input?.topic || it.topic || it.title || "")
      .map((t) => cleanText(t, 160))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isDuplicate(candidate, history, threshold = 0.5) {
  const cand = keywordSet(candidate);
  const candNorm = normalizeTitle(candidate);
  for (const past of history) {
    if (normalizeTitle(past) === candNorm) return true;
    if (similarity(cand, keywordSet(past)) >= threshold) return true;
  }
  return false;
}

function buildIdeaPrompt(history, category, angle) {
  const recent = history.slice(0, 60).map((t) => `- ${t}`).join("\n") || "- (belum ada)";
  return [
    "Kamu produser konten edukasi YouTube berbahasa Indonesia.",
    "Usulkan 8 IDE TOPIK video panjang yang faktual, menarik, dan membuat penasaran.",
    `Fokus kategori: ${category}. Sudut pandang yang diutamakan: ${angle}.`,
    "Topik harus SPESIFIK dan unik, bukan tema umum yang luas.",
    "WAJIB hindari kemiripan dengan daftar topik yang SUDAH PERNAH dibuat berikut:",
    recent,
    "Jangan mengusulkan ulang Kodak, atau topik apa pun yang mirip daftar di atas.",
    "Variasikan objek, tokoh, tempat, dan era. Jangan semuanya tentang bisnis/perusahaan.",
    "Kembalikan JSON valid saja dengan format:",
    '{ "ideas": [ { "topic": "kalimat judul topik", "category": "kategori", "angle": "sudut", "why": "kenapa menarik" } ] }'
  ].join("\n");
}

const OFFLINE_SEEDS = [
  "Kenapa madu tidak pernah basi meski disimpan ribuan tahun",
  "Bagaimana jam pasir kuno bisa mengukur waktu dengan akurat",
  "Mengapa langit malam gelap padahal ada miliaran bintang",
  "Rahasia di balik kenapa kunci pas punya banyak ukuran",
  "Bagaimana semut menemukan jalan pulang tanpa tersesat",
  "Kenapa kaca itu sebenarnya bukan benar-benar padat",
  "Asal-usul angka nol dan kenapa butuh ribuan tahun ditemukan",
  "Bagaimana terumbu karang membangun struktur sebesar kota",
  "Mengapa garam dulu lebih berharga daripada emas",
  "Kenapa warna biru paling langka di alam",
  "Bagaimana lampu lalu lintas pertama bekerja sebelum ada listrik",
  "Misteri kenapa kita lupa masa bayi kita sendiri",
  "Bagaimana kompas tahu arah utara di tengah lautan",
  "Kenapa roti bisa mengembang hanya dengan ragi mikroskopis",
  "Asal-usul kenapa keyboard tidak disusun urut abjad"
];

function offlinePick(history) {
  const fresh = OFFLINE_SEEDS.filter((seed) => !isDuplicate(seed, history, 0.6));
  const pool = fresh.length ? fresh : OFFLINE_SEEDS;
  return pick(pool);
}

/**
 * Pilih satu topik baru yang unik.
 * @returns {Promise<{topic, category, angle, source}>}
 */
export async function pickFreshTopic(options = {}) {
  const history = await loadHistory();
  const category = cleanText(options.category && options.category !== "random"
    ? options.category : pick(TOPIC_CATEGORIES), 80);
  const angle = pick(ANGLES);

  try {
    const data = await requestIdeaJson(buildIdeaPrompt(history, category, angle));
    const ideas = Array.isArray(data?.ideas) ? data.ideas : [];
    const fresh = ideas.filter((idea) => idea?.topic && !isDuplicate(idea.topic, history));
    const chosen = (fresh[0] || ideas[0]);
    if (chosen?.topic) {
      return {
        topic: cleanText(chosen.topic, 160),
        category: cleanText(chosen.category || category, 80),
        angle: cleanText(chosen.angle || angle, 80),
        source: "openai"
      };
    }
  } catch (error) {
    console.warn(`[Topic Engine] Gagal minta ide AI, pakai fallback: ${error.message}`);
  }

  return { topic: offlinePick(history), category, angle, source: "offline" };
}
