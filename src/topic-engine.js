/**
 * Topic Engine - pemilih topik mandiri untuk video longform.
 *
 * Tujuan: setiap kali topik dikosongkan, sistem memikirkan sendiri topik
 * BARU yang belum pernah dibuat (anti-duplikat), dengan variasi kategori,
 * sudut pandang, dan formatType. Tidak lagi default ke satu topik tertentu.
 */

import { requestIdeaJson } from "./openai.js";
import { cleanText } from "./util.js";
import { FORMAT_TYPES, pickFormatType } from "./format-engine.js";
import { loadHistory, checkFreshness, pickFreshIdeaFromBatch } from "./continuity-engine.js";
import { buildTrendingContext, formatTrendingForPrompt } from "./youtube-trends.js";
import { pickViralAngle, viralAnglePromptList, viralAngleSummary } from "./viral-angle-library.js";

export const TOPIC_CATEGORIES = [
  "sains", "penemuan", "sejarah", "tubuh manusia", "alam semesta",
  "teknologi", "benda sehari-hari", "tokoh dunia", "bahasa dan budaya",
  "makanan dan dapur", "material dan warna", "peta dan navigasi",
  "suara dan musik", "infrastruktur tersembunyi", "ekologi mikro",
  "ekonomi dan bisnis", "psikologi", "hewan dan tumbuhan", "luar angkasa",
  "arsitektur", "transportasi", "energi", "matematika sehari-hari", "misteri sejarah"
];

/**
 * Banyak sudut pandang per kategori agar cerita tidak itu-itu saja.
 * Setiap kategori punya 6–10 cara membahas topik.
 */
const CATEGORY_ANGLES = {
  sains: [
    "kenapa fenomena ini terjadi di level atom",
    "eksperimen kuno yang membuka pemahaman modern",
    "kesalahpahaman ilmiah yang populer di masyarakat",
    "perbandingan skala: dari mikro hingga kosmis",
    "proses alami yang berlangsung ribuan tahun",
    "teori yang hampir ditinggal tapi ternyata benar",
    "bagaimana ilmuwan pertama kali membuktikannya"
  ],
  penemuan: [
    "kisah kegagalan berulang sebelum akhirnya berhasil",
    "penemuan tak sengaja yang mengubah dunia",
    "siapa penemu sebenarnya yang terlupakan sejarah",
    "bagaimana penemuan ini dieksploitasi oleh orang lain",
    "evolusi desain dari versi pertama sampai sekarang",
    "konflik paten dan klaim penemuan"
  ],
  sejarah: [
    "peristiwa penting yang hampir tidak tercatat",
    "dampak jangka panjang yang belum disadari",
    "tokoh pinggiran yang mengubah arah sejarah",
    "keputusan kecil yang membawa perubahan besar",
    "versi sejarah yang sering disalahartikan",
    "bagaimana peristiwa ini membentuk kehidupan sekarang"
  ],
  "tubuh manusia": [
    "mekanisme biologis yang bekerja tanpa kita sadari",
    "evolusi anggota tubuh dari hewan purba",
    "mitos kesehatan yang sudah terbukti keliru",
    "bagaimana otak menipu indra kita",
    "proses regenerasi dan batas kemampuan tubuh",
    "perbedaan biologis yang sering diabaikan"
  ],
  "alam semesta": [
    "objek kosmis yang belum punya penjelasan pasti",
    "perjalanan waktu cahaya dari masa purba",
    "bagaimana manusia mengukur sesuatu yang tak terjangkau",
    "fenomena langka yang akan terjadi di masa depan",
    "tabrakan dan kelahiran benda langit",
    "kehidupan di luar bumi: kemungkinan dan bukti"
  ],
  teknologi: [
    "bagaimana algoritma mengubah perilaku manusia",
    "teknologi mati yang dulunya menjadi masa depan",
    "komponen kecil dengan dampak sistemik besar",
    "perlombaan teknologi antarnegara/perusahaan",
    "etika dan risiko yang tertinggal dari inovasi",
    "evolusi interface dari mekanis hingga digital"
  ],
  "benda sehari-hari": [
    "rahasia desain yang disembunyikan di depan mata",
    "mengapa bentuk dan warnanya seperti itu",
    "jejak sejarah dalam benda yang kita anggap biasa",
    "proses produksi massal yang kompleks",
    "alternatif lain yang kalah populer",
    "bagaimana benda ini mengubah rutinitas manusia"
  ],
  "tokoh dunia": [
    "keputusan kontroversial yang mengubah legasi",
    "kehidupan awal yang membentuk karakter",
    "orang terlupakan di balik kesuksesan tokoh besar",
    "dampak tak terduga dari satu tindakan tokoh",
    "bagaimana karya mereka hampir tidak diterima",
    "konspirasi dan mitos yang menyelimuti namanya"
  ],
  "bahasa dan budaya": [
    "asal-usul kata yang mencerminkan sejarah",
    "bahasa yang hampir punah dan upaya penyelamatan",
    "kesalahpahaman budaya antarbangsa",
    "evolusi tulisan dari simbol hingga alfabet",
    "ungkapan yang kehilangan makna aslinya",
    "bagaimana bahasa membentuk cara berpikir"
  ],
  "makanan dan dapur": [
    "proses kimiawi di balik transformasi rasa",
    "sejarah globalisasi satu bahan makanan",
    "mitos makanan yang sulit dilenyapkan",
    "teknik tradisional yang lebih canggih dari modern",
    "bagaimana industri makanan menciptakan selera",
    "makanan yang hampir punah dan bangkit kembali"
  ],
  "material dan warna": [
    "mengapa warna tertentu langka di alam",
    "proses ekstraksi bahan yang rumit",
    "material baru yang menggantikan tradisi berabad-abad",
    "simbolisme warna di berbagai peradaban",
    "ketahanan material dalam kondisi ekstrem",
    "dampak lingkungan dari produksi satu material"
  ],
  "peta dan navigasi": [
    "bagaimana manusia menavigasi sebelum kompas dan GPS",
    "distorsi peta yang mengubah persepsi dunia",
    "batas wilayah paling aneh di dunia",
    "teknologi navigasi rahasia dalam perang",
    "jejak penjelajah yang salah petah",
    "bagaimana koordinat diciptakan dan disepakati"
  ],
  "suara dan musik": [
    "fisika di balik nada dan getaran",
    "instrumen kuno dengan teknologi memukau",
    "bagaimana musik memengaruhi otak dan emosi",
    "genre musik yang lahir dari konflik sosial",
    "rekaman suara paling bersejarah",
    "fenomena suara alam yang belum terpecahkan"
  ],
  "infrastruktur tersembunyi": [
    "jaringan bawah tanah yang menopang kota modern",
    "bagaimana limbah kota dikelola tanpa kita sadari",
    "infrastruktur tua yang masih dipakai hingga kini",
    "proyek raksasa yang gagal atau dibatalkan",
    "teknologi sistemik yang jarang mendapat pujian",
    "dampak urbanisasi terhadap sumber daya tersembunyi"
  ],
  "ekologi mikro": [
    "dunia mikroba yang mengendalikan ekosistem",
    "symbiosis aneh antara makhluk hidup",
    "bagaimana satu spesies menghancurkan ekosistem",
    "proses dekomposisi yang mengembalikan kehidupan",
    "penyesuaian ekstrem makhluk kecil",
    "peran serangga yang diremehkan manusia"
  ],
  "ekonomi dan bisnis": [
    "bubble ekonomi yang hampir tidak terdeteksi",
    "produk gagal yang meruntuhkan perusahaan raksasa",
    "bagaimana harga sesungguhnya ditentukan",
    "strategi pemasaran yang mengubah kebiasaan konsumsi",
    "pasar gelap dan ekonomi informal",
    "inovasi bisnis yang lahir dari krisis"
  ],
  psikologi: [
    "bias kognitif yang mengendalikan keputusan kita",
    "eksperimen psikologi paling menggemparkan",
    "bagaimana ingatan bisa berubah tanpa kita sadari",
    "fenomena sosial yang memunculkan perilaku aneh",
    "bagaimana otak menangani kehilangan dan penguasaan",
    "perbedaan cara berpikir antargenerasi"
  ],
  "hewan dan tumbuhan": [
    "kemampuan super alami yang melebihi teknologi manusia",
    "proses evolusi yang terjadi dalam waktu singkat",
    "hubungan antara hewan dan manusia yang berubah drastis",
    "spesies yang bangkit dari kepunahan",
    "mekanisme bertahan hidup di kondisi paling ekstrem",
    "bagaimana satu tumbuhan mengubah sejarah manusia"
  ],
  "luar angkasa": [
    "misil dan satelit yang hampir memicu konflik",
    "kehidupan astronot yang tidak pernah ditampilkan",
    "teknologi luar angkasa yang dipakai di bumi",
    "planet/bulan yang lebih aneh dari fiksi",
    "perlombaan luar angkasa: rahasia dan kebohongan",
    "misi gagal yang memberi pelajaran berharga"
  ],
  arsitektur: [
    "struktur kuno yang defy teknologi zamannya",
    "desain bangunan yang menyembunyikan pesan rahasia",
    "bagaimana arsitektur mengendalikan perilaku manusia",
    "bangunan gagal dengan biaya fantastis",
    "material lokal yang membentuk gaya regional",
    "renovasi modern yang merusak warisan asli"
  ],
  transportasi: [
    "kendaraan revolusioner yang gagal di pasaran",
    "infrastruktur transportasi yang mengubah geografi",
    "bagaimana moda transportasi membentuk kota",
    "kecelakaan yang mengubah regulasi selamanya",
    "teknologi propulsi dari uap hingga listrik",
    "rute paling berbahaya yang masih aktif"
  ],
  energi: [
    "transisi energi yang hampir terjadi lebih awal",
    "sumber energi tersembunyi di alam",
    "bencana industri energi dan pelajarannya",
    "bagaimana satu bahan bakar mengubah geopolitik",
    "inovasi hemat energi yang ditemukan secara tidak sengaja",
    "pembangkit listrik dengan desain paling unik"
  ],
  "matematika sehari-hari": [
    "pola matematika di alam yang membingungkan ilmuwan",
    "bagaimana statistik bisa berbohong",
    "sistem satuan yang dibuat dengan cara aneh",
    "teori permainan dalam konflik sehari-hari",
    "bilangan dan konsep yang sulit dibayangkan",
    "algoritma sederhana yang mengatur dunia modern"
  ],
  "misteri sejarah": [
    "artefak dengan asal-usul yang tidak bisa dijelaskan",
    "peristiwa massal yang menghilang dari catatan",
    "teori alternatif yang ternyata punya bukti kuat",
    "kode dan simbol kuno yang baru terpecahkan",
    "tokoh sejarah dengan kematian mencurigakan",
    "lokasi legenda yang ditemukan secara tidak sengaja"
  ]
};

const DEFAULT_ANGLES = [
  "kenapa bisa terjadi", "bagaimana cara kerjanya", "asal-usul yang jarang diketahui",
  "kesalahpahaman umum yang ternyata keliru", "dampak tak terduga",
  "rahasia di balik benda biasa", "kisah kegagalan yang mengubah dunia",
  "penemuan tak sengaja", "fakta yang melawan akal sehat", "evolusi dari masa ke masa"
];

// Kategori "pertanyaan sehari-hari" yang paling relatable bagi orang awam.
// Mode "Seimbang": ~60% topik diambil dari kategori ini, sisanya tetap variasi penuh.
const EVERYDAY_CATEGORIES = new Set([
  "sains", "tubuh manusia", "benda sehari-hari", "makanan dan dapur",
  "hewan dan tumbuhan", "psikologi", "material dan warna", "suara dan musik",
  "matematika sehari-hari", "alam semesta", "peta dan navigasi"
]);

// Tebak kategori everyday dari kata kunci seed offline agar topik↔kategori↔angle koheren.
function inferEverydayCategory(topic) {
  const t = String(topic || "").toLowerCase();
  const map = [
    [/kucing|anjing|hewan|semut|burung|ikan|lebah|tumbuh|pohon|tanaman|terumbu|karang/, "hewan dan tumbuhan"],
    [/tubuh|otak|mata|tidur|darah|jantung|bayi|ingat|lupa|menangis|mendengkur/, "tubuh manusia"],
    [/madu|roti|garam|makan|masak|dapur|kopi|teh|ragi|bawang|gula/, "makanan dan dapur"],
    [/langit|bintang|planet|bulan|matahari|galaksi|angkasa|kosmos/, "alam semesta"],
    [/kompas|peta|navigasi|arah|utara|gps/, "peta dan navigasi"],
    [/kaca|es|air|logam|warna|material|baterai|cermin|biru/, "material dan warna"],
    [/keyboard|ponsel|listrik|mesin|komputer|internet|lampu/, "teknologi"],
    [/angka|nol|matematik|statistik|waktu|jam/, "matematika sehari-hari"]
  ];
  for (const [re, cat] of map) if (re.test(t)) return cat;
  return "benda sehari-hari";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function isDuplicate(candidate, history, threshold = 0.5) {
  return !checkFreshness(
    { topic: candidate, title: candidate, category: "", angle: "", formatType: "" },
    history,
    { topicThreshold: threshold, titleThreshold: threshold }
  ).isFresh;
}

function categoryAngles(category) {
  const key = String(category || "").toLowerCase().trim();
  const list = CATEGORY_ANGLES[key] || CATEGORY_ANGLES[key.replace(/[^a-z0-9]/g, "")];
  return list && list.length ? list : DEFAULT_ANGLES;
}

function buildIdeaPrompt(history, category, angle, formatType, viralAngle, trendingContext = null) {
  const recent = history
    .slice(0, 80)
    .map((item) => `- [${item.category || "umum"}] ${item.topic}${item.title && item.title !== item.topic ? ` | judul: ${item.title}` : ""}`)
    .join("\n") || "- (belum ada)";
  const anglesForCategory = categoryAngles(category).join("; ");
  const ft = FORMAT_TYPES[formatType];
  const label = ft?.label || formatType;
  const description = ft?.description || "";
  const trendingBlock = formatTrendingForPrompt(trendingContext);
  const viralBlock = viralAngleSummary(viralAngle);

  return [
    "Kamu produser konten edukasi YouTube berbahasa Indonesia.",
    "Usulkan 8 IDE TOPIK video panjang yang faktual, menarik, dan membuat penasaran.",
    "PRIORITAS UTAMA: pertanyaan SEHARI-HARI yang relatable dan masih jadi teka-teki bagi orang awam",
    "(contoh: kenapa madu tidak pernah basi, kenapa kucing mendengkur, kenapa langit malam gelap,",
    "kenapa es mengambang). Boleh juga sejarah/sains/misteri lebih dalam ASALKAN tetap memancing rasa",
    "penasaran tinggi dan menyebut subjek konkret yang dikenal orang.",
    "Tulis setiap 'topic' sebagai PERTANYAAN yang menyebut SUBJEK KONKRET (benda/makhluk/tempat nyata),",
    "bukan tema abstrak. Hindari kata ganti kabur seperti 'hal ini' atau 'fenomena ini'.",
    `Fokus kategori: ${category}. Sudut pandang yang diutamakan: ${angle}.`,
    `Format video yang wajib digunakan: ${label}. ${description}`,
    `Kemasan viral utama yang wajib dipakai:\n${viralBlock}`,
    "Bank angle viral lain untuk variasi diksi, jangan dipakai semuanya sekaligus:",
    viralAnglePromptList(),
    "Topik harus SPESIFIK dan unik, bukan tema umum yang luas.",
    "Topik harus sudah terasa seperti ide video yang punya konflik, misteri, taruhan, atau konsekuensi.",
    "Jangan buat topik netral seperti judul ensiklopedia. Hindari format 'Penjelasan tentang X'.",
    `Daftar sudut pandang yang tersedia untuk kategori ${category}: ${anglesForCategory}.`,
    trendingBlock ? `\n${trendingBlock}\n` : "",
    "WAJIB hindari kemiripan dengan daftar topik yang SUDAH PERNAH dibuat berikut:",
    recent,
    "Jangan mengusulkan ulang subjek, tokoh, objek, tempat, atau peristiwa yang sama walau judul dan angle berbeda.",
    "Variasikan objek, tokoh, tempat, dan era. Jangan semuanya tentang bisnis/perusahaan.",
    "Untuk SETIAP ide, beri 'viralScore' 0-100 = perkiraan potensi banyak ditonton, dinilai dari:",
    "relatable bagi orang awam + rasa penasaran + sering dicari/ditanyakan orang + evergreen (tahan lama).",
    "Kembalikan JSON valid saja dengan format:",
    '{ "ideas": [ { "topic": "pertanyaan sehari-hari dengan subjek konkret", "category": "kategori", "angle": "sudut", "viralScore": 0, "why": "kenapa menarik & banyak dicari" } ] }'
  ].filter(Boolean).join("\n");
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
  "Asal-usul kenapa keyboard tidak disusun urut abjad",
  "Mengapa kucing mendengkur dan apa manfaatnya",
  "Kenapa es mengambang padahal air padat biasanya lebih berat",
  "Bagaimana cermin dua arah bekerja di ruang interogasi",
  "Misteri tulisan yang belum terpecahkan selama berabad-abad",
  "Mengapa baterai ponsel tidak bisa 100% awet bertahun-tahun"
];

function offlinePick(history) {
  const fresh = OFFLINE_SEEDS.filter((seed) => !isDuplicate(seed, history, 0.6));
  return fresh.length ? pick(fresh) : "";
}

export function pickBalancedCategory(history = []) {
  const recent = new Set(history.slice(0, 3).map((item) => item.category).filter(Boolean));
  const counts = new Map(TOPIC_CATEGORIES.map((category) => [category, 0]));
  for (const item of history.slice(0, 30)) {
    if (counts.has(item.category)) counts.set(item.category, counts.get(item.category) + 1);
  }
  const candidates = TOPIC_CATEGORIES.filter((category) => !recent.has(category));
  const minimum = Math.min(...candidates.map((category) => counts.get(category) || 0));
  const balanced = candidates.filter((category) => (counts.get(category) || 0) <= minimum + 1);
  const pool = balanced.length ? balanced : candidates.length ? candidates : TOPIC_CATEGORIES;
  // Mode "Seimbang": condong (~60%) ke kategori everyday yang relatable, sisanya variasi penuh.
  const everyday = pool.filter((category) => EVERYDAY_CATEGORIES.has(category));
  return pick(everyday.length && Math.random() < 0.6 ? everyday : pool);
}

export function filterFreshTrendingContext(context, history = []) {
  if (!context?.themes?.length) return context;
  const themes = context.themes.filter((theme) => {
    const topic = [theme.theme, theme.angle].filter(Boolean).join(" ");
    const check = checkFreshness({
      topic,
      title: theme.theme || topic,
      category: theme.category || "",
      angle: theme.angle || "",
      formatType: ""
    }, history, { topicThreshold: 0.42, titleThreshold: 0.5 });
    if (!check.isFresh) console.log(`[Trends] Skip tema lama: ${check.reason}`);
    return check.isFresh;
  });
  const topKeywords = (context.topKeywords || []).filter((keyword) => !isDuplicate(keyword, history, 0.8));
  return { ...context, themes, topKeywords };
}

/**
 * Pilih satu topik baru yang unik.
 * @returns {Promise<{topic, category, angle, formatType, source}>}
 */
export async function pickFreshTopic(options = {}) {
  const history = await loadHistory(80);
  const category = cleanText(options.category && options.category !== "random"
    ? options.category : pickBalancedCategory(history), 80);

  // Ambil sinyal trending (graceful skip jika API key tidak ada)
  let trendingContext = null;
  try {
    trendingContext = filterFreshTrendingContext(await buildTrendingContext(), history);
    if (trendingContext?.enabled && trendingContext.themes.length) {
      console.log(`[Topic Engine] Trending context: ${trendingContext.themes.length} tema, skor ${trendingContext.trendingScore}/100`);
    }
  } catch (error) {
    console.warn(`[Topic Engine] Trending context gagal: ${error.message}`);
  }

  // Coba hingga 5 kali untuk menemukan kombinasi yang benar-benar segar
  for (let attempt = 1; attempt <= 5; attempt++) {
    const angle = pick(categoryAngles(category));
    const formatType = pickFormatType();
    const viralAngle = pickViralAngle(history);

    try {
      const data = await requestIdeaJson(buildIdeaPrompt(history, category, angle, formatType, viralAngle, trendingContext));
      const ideas = Array.isArray(data?.ideas) ? data.ideas : [];
      // Pilih ide paling berpotensi viral lebih dulu (skor tinggi → urutan awal),
      // lalu pickFreshIdeaFromBatch menjamin tetap lolos anti-duplikat.
      const ranked = [...ideas].sort((a, b) => (Number(b?.viralScore) || 0) - (Number(a?.viralScore) || 0));
      const fresh = ranked.filter((idea) => idea?.topic && !isDuplicate(idea.topic, history));
      const chosen = pickFreshIdeaFromBatch(fresh, formatType, angle, category, history, viralAngle)
        || pickFreshIdeaFromBatch(ranked, formatType, angle, category, history, viralAngle);
      if (chosen && fresh[0]?.topic === chosen.topic) {
        console.log(`[Topic Engine] Ide terpilih (viralScore ${fresh[0]?.viralScore ?? "-"}): ${chosen.topic}`);
      }

      if (chosen) {
        return {
          topic: chosen.topic,
          category: chosen.category,
          angle: chosen.angle,
          formatType,
          viralAngleId: viralAngle.id,
          viralAngleLabel: viralAngle.label,
          source: "openai",
          trendingScore: trendingContext?.trendingScore || 0,
          trendingKeywords: trendingContext?.topKeywords || []
        };
      }

      console.log(`[Continuity] Attempt ${attempt}: tidak ada ide fresh dari batch, mencoba ulang...`);
    } catch (error) {
      console.warn(`[Topic Engine] Attempt ${attempt} gagal: ${error.message}`);
    }
  }

  // Fallback: offline seed dengan formatType baru
  const offlineTopic = offlinePick(history);
  if (!offlineTopic) {
    throw new Error("Tidak ada topik offline yang benar-benar baru. Hentikan run agar tidak mengulang topik lama.");
  }
  const formatType = pickFormatType();
  const viralAngle = pickViralAngle(history);
  // Koheren dgn seed: kategori ditebak dari topik & angle netral, BUKAN kategori acak —
  // mencegah cerita/judul melenceng dari topik aslinya (mis. topik kucing → judul transportasi).
  const offlineCategory = inferEverydayCategory(offlineTopic);
  return {
    topic: offlineTopic,
    category: offlineCategory,
    angle: "kenapa bisa terjadi",
    formatType,
    viralAngleId: viralAngle.id,
    viralAngleLabel: viralAngle.label,
    source: "offline",
    trendingScore: 0,
    trendingKeywords: []
  };
}
