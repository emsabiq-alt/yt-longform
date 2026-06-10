/**
 * Format Engine - mendefinisikan pola struktur video yang berbeda-beda.
 * Tujuannya: menghancurkan pola tetap "2 image 1 reaction" agar video tidak terasa template.
 */

export const FORMAT_TYPES = {
  dokumenter_klasik: {
    label: "Dokumenter Klasik",
    description: "Hook kuat → konteks → analisis mendalam → kesimpulan. Pola paling fleksibel, mirip Vox atau Lemmino.",
    reactionFrequency: 3,
    minScenes: 10,
    narrativeCue: "Bangun argumen logis step-by-step. Reaction muncul setiap 2 scene image sebagai pertanyaan penasaran yang membawa ke babak berikutnya."
  },
  investigasi_misteri: {
    label: "Investigasi Misteri",
    description: "Pertanyaan besar di awal → petunjuk-petunjuk → pengungkapan → konsekuensi. Seperti film detektif dokumenter.",
    reactionFrequency: 4,
    minScenes: 12,
    narrativeCue: "Susun seperti detektif: setiap scene image memberi petunjuk baru. Reaction muncul saat menemukan 'clue' penting. Jangan jawab semua di awal; simpan pengungkapan untuk babak akhir."
  },
  timeline_evolutif: {
    label: "Timeline Evolutif",
    description: "Masa lalu → transisi → masa kini → prediksi masa depan. Waktu adalah tulang punggung narasi.",
    reactionFrequency: 4,
    minScenes: 10,
    narrativeCue: "Gunakan penanda waktu yang jelas. Reaction berfungsi sebagai 'fast forward' atau pertanyaan 'lalu bagaimana sekarang?' yang menghubungkan era."
  },
  mitos_vs_fakta: {
    label: "Mitos vs Fakta",
    description: "Klaim populer → bukti menyangkal → mekanisme ilmiah → aplikasi nyata. Langsung hancurkan mitos.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Buka dengan klaim yang sering dipercaya. Reaction langsung menunjukkan keraguan atau kaget. Hancurkan mitos dengan data konkret, bukan opini."
  },
  kisah_manusia: {
    label: "Kisah Manusia",
    description: "Fokus pada individu, konflik pribadi, keputusan kritis, dan pelajaran hidup. Lebih naratif, lebih emosional.",
    reactionFrequency: 5,
    minScenes: 10,
    narrativeCue: "Ceritakan seperti biografi singkat. Reaction muncul hanya saat momen emosional atau keputusan kritis. Jangan terlalu banyak interupsi; biarkan narasi mengalir."
  },
  countdown: {
    label: "Countdown",
    description: "Hitung mundur #5 → #4 → #3 → #2 → #1 dengan alasan mendalam di balik setiap peringkat.",
    reactionFrequency: 2,
    minScenes: 12,
    narrativeCue: "Setiap angka countdown harus punya narasi kuat dan self-contained. Reaction berfungsi sebagai transisi 'tapi yang lebih mengejutkan adalah...'. Jangan rush; setiap peringkat pantas dijelaskan."
  },
  debat_dua_sisi: {
    label: "Debat Dua Sisi",
    description: "Argumen pro → kontra → data netral → penutup seimbang. Tampilkan kedua sisi secara adil.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Presentasikan argumen pro secara kuat, lalu kontra dengan sama kuat. Reaction adalah 'tapi tunggu, ada sisi lain'. Akhiri dengan sintesis, bukan pemenang."
  },
  fenomena_alam: {
    label: "Fenomena Alam",
    description: "Observasi → hipotesis → bukti → implikasi. Mulai dari apa yang terlihat, lalu mengapa.",
    reactionFrequency: 4,
    minScenes: 10,
    narrativeCue: "Mulai dari gejala yang terlihat sehari-hari. Reaction muncul saat mengajukan hipotesis. Akhiri dengan implikasi luas yang membuat penonton melihat alam berbeda."
  },
  perbandingan: {
    label: "Perbandingan",
    description: "A vs B, sebelum vs sesudah, atau dua pendekatan berbeda. Struktur paralel yang jelas.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Jelaskan sisi A secara adil, lalu sisi B. Reaction berfungsi sebagai 'bandingkan keduanya'. Jangan memihak terlalu dini; biarkan data bicara."
  },
  eksperimen_berpikir: {
    label: "Eksperimen Berpikir",
    description: "Bayangkan jika... → konsekuensi → implikasi nyata. Hipotesis ekstrem yang mengguncang perspektif.",
    reactionFrequency: 3,
    minScenes: 10,
    narrativeCue: "Gunakan 'bayangkan' atau 'apa jika' untuk membuka. Reaction muncul saat konsekuensi mulai tidak terduga atau absurd. Akhiri dengan pelajaran nyata yang bisa diterapkan."
  }
};

export function pickFormatType() {
  const keys = Object.keys(FORMAT_TYPES);
  return keys[Math.floor(Math.random() * keys.length)];
}

export function formatTypeDescription(formatType) {
  return FORMAT_TYPES[formatType]?.description || FORMAT_TYPES.dokumenter_klasik.description;
}

export function formatTypeNarrativeCue(formatType) {
  return FORMAT_TYPES[formatType]?.narrativeCue || FORMAT_TYPES.dokumenter_klasik.narrativeCue;
}

function patternDokumenterKlasik(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if ((i + 1) % 3 === 0 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternInvestigasiMisteri(count) {
  const types = [];
  const clue1 = Math.max(2, Math.floor(count * 0.3));
  const clue2 = Math.max(clue1 + 2, Math.floor(count * 0.6));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === clue1 || i === clue2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternTimelineEvolutif(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.35));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternMitosVsFakta(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i > 0 && i % 2 === 1 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternKisahManusia(count) {
  const types = [];
  const emotional = Math.floor(count * 0.45);
  const climax = count > 12 ? Math.floor(count * 0.75) : -1;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === emotional || i === climax) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternCountdown(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i % 2 === 1 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternDebatDuaSisi(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.33));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.66));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternFenomenaAlam(count) {
  const types = [];
  const h = Math.max(2, Math.floor(count * 0.3));
  const c = Math.max(h + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === h || i === c) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternPerbandingan(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.33));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.66));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternEksperimenBerpikir(count) {
  const types = [];
  const w = Math.max(2, Math.floor(count * 0.35));
  const imp = Math.max(w + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === w || i === imp) types.push("reaction");
    else types.push("image");
  }
  return types;
}

/**
 * Bangun array scene types berdasarkan formatType dan jumlah scene.
 * Scene terakhir selalu 'summary'.
 * @param {number} sceneCount
 * @param {string} formatType
 * @returns {string[]}
 */
export function buildScenePattern(sceneCount, formatType = "dokumenter_klasik") {
  const count = Math.max(8, Math.floor(sceneCount || 14));
  switch (formatType) {
    case "dokumenter_klasik": return patternDokumenterKlasik(count);
    case "investigasi_misteri": return patternInvestigasiMisteri(count);
    case "timeline_evolutif": return patternTimelineEvolutif(count);
    case "mitos_vs_fakta": return patternMitosVsFakta(count);
    case "kisah_manusia": return patternKisahManusia(count);
    case "countdown": return patternCountdown(count);
    case "debat_dua_sisi": return patternDebatDuaSisi(count);
    case "fenomena_alam": return patternFenomenaAlam(count);
    case "perbandingan": return patternPerbandingan(count);
    case "eksperimen_berpikir": return patternEksperimenBerpikir(count);
    default: return patternDokumenterKlasik(count);
  }
}

/**
 * Ambil sceneType untuk index tertentu. Kalau AI sudah mengirimkan sceneType yang valid,
 * gunakan itu. Kalau tidak, pakai pola dari formatType.
 */
export function resolveSceneType(value, index, total, formatType = "dokumenter_klasik") {
  if (value && ["image", "reaction", "summary"].includes(value)) return value;
  const pattern = buildScenePattern(total, formatType);
  return pattern[index] || "image";
}
