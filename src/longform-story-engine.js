import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { estimateTotalCost } from "./cost.js";
import { requestKnowledgeJson } from "./openai.js";
import { fetchWikipediaFacts } from "./wikipedia.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";
import { pickFreshTopic } from "./topic-engine.js";
import { generateViralTitle } from "./title-engine.js";
import { buildScenePattern, formatTypeDescription, formatTypeNarrativeCue, pickFormatType, resolveSceneType } from "./format-engine.js";
import { getViralAngleById, pickViralAngle, viralAngleSummary } from "./viral-angle-library.js";
import { polishPlanForLayAudience, simplifyForLayAudience } from "./story-language.js";

const categories = [
  "sains",
  "penemuan",
  "sejarah",
  "tubuh manusia",
  "alam semesta",
  "teknologi",
  "benda sehari-hari",
  "tokoh dunia",
  "bahasa dan budaya",
  "makanan dan dapur",
  "material dan warna",
  "peta dan navigasi",
  "suara dan musik",
  "infrastruktur tersembunyi",
  "ekologi mikro"
];

/**
 * Catatan struktur cerita per kategori agar naskah tidak monoton.
 * Setiap kategori punya fokus narasi, elemen wajib, dan variasi rencana.
 */
const CATEGORY_STORY_NOTES = {
  sains: "Gunakan analogi konkret untuk menjelaskan mekanisme abstrak. Libatkan sejarah pembuktian, kesalahan ilmiah populer, dan aplikasi nyata di kehidupan. Variasi: bandingkan skala, urutkan proses langkah demi langkah, atau ungkap 'siapa penemu pertama'.",
  penemuan: "Ceritakan perjalanan dari masalah → percobaan → kegagalan → momen eurekah. Soroti pihak yang diuntungkan/dirugikan. Variasi: penemuan tak sengaja, penemuan yang direbut, atau penemuan yang gagal beradaptasi.",
  sejarah: "Jalin narasi kronologis dengan fokus pada dilema manusia, bukan sekadar tanggal. Gunakan perspektif tokoh pinggiran. Variasi: peristiwa terlupakan, dampak jangka panjang, propaganda versus fakta.",
  "tubuh manusia": "Hubungkan mekanisme biologis dengan pengalaman sehari-hari pembaca. Bantah mitos populer dengan data. Variasi: perbandingan dengan hewan, evolusi anggota tubuh, atau trik otak yang menipu indra.",
  "alam semesta": "Bangun rasa skala yang membuat penonton terkesima. Gunakan satuan yang mudah dibayangkan. Variasi: misteri yang belum terpecahkan, perjalanan waktu cahaya, atau fenomena langka yang akan terjadi.",
  teknologi: "Jelaskan komponen kecil dengan konsekuensi besar. Bahas etika dan dampak sosial. Variasi: teknologi mati, perlombaan antarpesaing, atau algoritma yang mengubah perilaku manusia.",
  "benda sehari-hari": "Ungkap sejarah tersembunyi di balik desain yang tampak biasa. Libatkan proses produksi. Variasi: mengapa bentuknya demikian, alternatif yang kalah populer, atau jejak sejarah peradaban.",
  "tokoh dunia": "Fokus pada satu keputusan kritis yang mengubah legasi. Gunakan kutipan atau anekdot konkret. Variasi: musuh/rival terlupakan, momen hampir gagal, atau konsekuensi tak terduga.",
  "bahasa dan budaya": "Jelaskan evolusi dari simbol/kata hingga makna modern. Hubungkan dengan peristiwa sejarah. Variasi: bahasa hampir punah, kesalahpahaman antarbudaya, atau kata yang berubah makna.",
  "makanan dan dapur": "Padukan sains kimia, sejarah globalisasi, dan tradisi kuliner. Variasi: mitos makanan, proses fermentasi, perdagangan rempah, atau industri yang menciptakan selera massa.",
  "material dan warna": "Ceritakan asal-usul bahan, proses ekstraksi, dan simbolisme budaya. Variasi: warna langka, material masa depan, dampak lingkungan, atau peran dalam seni/kekuasaan.",
  "peta dan navigasi": "Bangun pemahaman bahwa peta adalah interpretasi, bukan fakta mutlak. Variasi: distorsi peta, navigator hebat yang tersesat, batas aneh, atau teknologi rahasia.",
  "suara dan musik": "Jelaskan fisika getaran dan dampak emosional. Variasi: instrumen kuno, genre yang lahir dari konflik, rekaman bersejarah, atau fenomena suara alam misterius.",
  "infrastruktur tersembunyi": "Bawa penonton ke 'bagian lain' kota yang tidak terlihat. Variasi: jaringan bawah tanah, proyek gagal, teknologi tua yang masih bekerja, atau dampak iklim.",
  "ekologi mikro": "Ceritakan dunia mikro dengan gaya epik. Variasi: symbiosis aneh, satu spesies penghancur ekosistem, kemampuan adaptasi ekstrem, atau peran penting serangga.",
  "ekonomi dan bisnis": "Gunakan kisah nyata perusahaan/produk untuk menjelaskan konsep ekonomi. Variasi: bubble, produk gagal, strategi harga psikologis, atau pasar gelap.",
  psikologi: "Mulai dari skenario penonton bisa relate, lalu jelaskan mekanisme otak. Variasi: eksperimen kontroversial, bias kognitif, memori palsu, atau fenomena kerumunan.",
  "hewan dan tumbuhan": "Soroti 'kemampuan super' alami dan proses evolusi. Variasi: pertahanan unik, symbiosis, spesies bangkit dari kepunahan, atau tumbuhan yang mengubah sejarah.",
  "luar angkasa": "Gabungkan sensasi petualangan dengan fakta keras. Variasi: misi rahasia, kecelakaan tersembunyi, teknologi turunan, atau objek kosmis paling aneh.",
  arsitektur: "Fokus pada satu detail struktur yang mencerminkan filosofi zaman. Variasi: kode tersembunyi, bangunan gagal, pengaruh agama/kekuasaan, atau material lokal.",
  transportasi: "Ceritakan bagaimana kendaraan mengubah geografi dan gaya hidup. Variasi: kendaraan revolusioner yang gagal, rute mematikan, evolusi mesin, atau insiden yang mengubah regulasi.",
  energi: "Jelaskan sumber energi dari 'sangat lokal' hingga geopolitik. Variasi: transisi yang hampir terjadi, bencana industri, inovasi hemat energi, atau bahan bakar masa depan.",
  "matematika sehari-hari": "Temukan pola matematika di pengalaman umum. Variasi: statistik menipu, sistem satuan aneh, algoritma tak terlihat, atau bilangan yang sulit dibayangkan.",
  "misteri sejarah": "Susun narasa investigasi tanpa memaksakan kesimpulan. Variasi: artefak aneh, peristiwa yang menghilang, kode baru terpecahkan, atau kematian tokoh mencurigakan."
};

const STORY_VARIATIONS = [
  "Buka dengan paradoks atau fakta yang melawan intuisi, lalu jelaskan mekanismenya secara bertahap.",
  "Susun sebagai kisah detektif: pertanyaan besar di awal, petunjuk di tengah, jawaban yang lebih kompleks di akhir.",
  "Gunakan sudut pandang manusia biasa yang terkena dampak topik ini dalam kehidupan nyata.",
  "Ceritakan evolusi dari masa lalu ke masa kini, lalu tebak dampak masa depan.",
  "Bandingkan dua versi: mitos populer versus fakta ilmiah/sejarah.",
  "Fokus pada konflik antarpihak: penemu vs peniru, tradisi vs modern, alam vs teknologi.",
  "Ungkap tokoh/pinggiran yang berperan besar namanya terlupakan.",
  "Jelaskan proses langkah demi langkah seolah penonton ikut melakukannya.",
  "Bangun rasa skala dengan membandingkan ukuran/waktu dengan yang familiar.",
  "Tutup dengan refleksi etis atau ajakan melihat topik dari sudut baru."
];

function storyNoteFor(category) {
  const key = String(category || "").toLowerCase().trim();
  return CATEGORY_STORY_NOTES[key]
    || CATEGORY_STORY_NOTES[key.replace(/[^a-z0-9]/g, "")]
    || "Buat naskah dokumenter mendalam dengan banyak detail faktual, beat naratif jelas, dan kesimpulan yang membuat penonton merasa lebih tahu.";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Ekstrak SATU kalimat pertanyaan punchy dari hook GPT untuk cold open.
 * Kalau GPT tetap mengembalikan paragraf panjang, ambil kalimat tanya pertama.
 * Fallback: kalimat pertama, atau buat pertanyaan generik dari topik.
 */
function extractHookQuestion(rawHook, topic) {
  const full = cleanText(rawHook || "", 500);
  if (!full) return `Tahukah kamu tentang ${cleanText(topic, 60)}?`;

  // Pisahkan kalimat-kalimat berdasarkan tanda akhir kalimat.
  const sentences = full.match(/[^.!?]+[.!?]+/g) || [full];

  // Prioritas 1: cari kalimat yang berakhir dengan tanda tanya.
  const question = sentences.find((s) => s.trim().endsWith("?"));
  if (question) {
    const trimmed = question.trim();
    // Kalau pertanyaan cukup pendek (≤120 char), pakai langsung.
    if (trimmed.length <= 120) return trimmed;
    // Kalau terlalu panjang, potong di batas kata terakhir lalu tambah "?"
    const short = trimmed.slice(0, 115).replace(/\s+\S*$/, "").trim();
    return short.replace(/[,.;:!?]+$/, "") + "?";
  }

  // Prioritas 2: kalimat pertama saja (bukan paragraf penuh).
  const first = sentences[0].trim();
  if (first.length <= 120) return first;
  const short = first.slice(0, 115).replace(/\s+\S*$/, "").trim();
  return short.replace(/[,.;:!?]+$/, "") + "?";
}

/**
 * Membuat draft naskah video panjang (landscape 16:9) memakai OpenAI GPT.
 * @param {object} rawInput - Parameter masukan dari user
 * @returns {Promise<object>} - Objek item naskah terstruktur
 */
export async function createLongformDraft(rawInput) {
  const seed = { ...(rawInput || {}) };
  if (!cleanText(seed.topic || "", 5)) {
    const fresh = await pickFreshTopic({ category: seed.category });
    seed.topic = fresh.topic;
    if (!seed.category || seed.category === "random") seed.category = fresh.category;
    seed.angle = fresh.angle;
    seed.formatType = fresh.formatType;
    seed.viralAngleId = fresh.viralAngleId;
    seed.viralAngleLabel = simplifyForLayAudience(fresh.viralAngleLabel || "", 80);
    console.log(`[Topic Engine] Topik otomatis (${fresh.source}): "${fresh.topic}" [${fresh.category}] [${fresh.formatType}] [${seed.viralAngleLabel || "angle acak"}]`);
  } else {
    if (!seed.angle) seed.angle = "asal-usul yang jarang diketahui";
    if (!seed.formatType) seed.formatType = pickFormatType();
    if (!seed.viralAngleId) {
      const viralAngle = pickViralAngle();
      seed.viralAngleId = viralAngle.id;
      seed.viralAngleLabel = simplifyForLayAudience(viralAngle.label, 80);
    }
  }
  const input = normalizeInput(seed);

  // Grounding fakta dari Wikipedia (gratis, tanpa API key). Hanya saat OpenAI aktif
  // karena fallback offline memakai naskah template yang tidak memanfaatkan fakta.
  let wiki = null;
  if (config.openai.apiKey) {
    try {
      wiki = await fetchWikipediaFacts(input.topic);
      if (wiki?.sources?.length) {
        console.log(`[Wikipedia] Grounding fakta aktif: ${wiki.sources.map((s) => s.title).join(", ")}`);
      }
    } catch (error) {
      console.warn(`[Wikipedia] Lewati grounding: ${error.message}`);
    }
  }

  const promptText = buildPrompt(input, wiki);
  let plan;
  let source = "offline";

  if (config.openai.apiKey) {
    try {
      console.log(`[Story Longform] Meminta naskah AI untuk topik: "${input.topic}" (${input.durationSec}s, ${input.sceneCount} scenes)...`);
      plan = await requestKnowledgeJson(promptText);
      source = "openai";
    } catch (error) {
      console.warn(`[Story Longform] Gagal memanggil OpenAI, menggunakan fallback offline: ${error.message}`);
      plan = fallbackPlan(input, error.message);
    }
  } else {
    plan = fallbackPlan(input, "OPENAI_API_KEY belum aktif.");
  }

  let normalized = normalizePlan(plan, input);

  // Generate judul viral dari ringkasan konten jika diaktifkan.
  if (config.automation.viralTitleEnabled && config.openai.apiKey) {
    try {
      const viralTitle = await generateViralTitle(normalized, input);
      if (viralTitle) {
        normalized.title = viralTitle;
      }
    } catch (error) {
      console.warn(`[Story Longform] Title engine error: ${error.message}`);
    }
  }

  const minimumNarrationWords = Math.round(input.durationSec * 1.75);
  if (config.openai.apiKey && narrationWordCount(normalized) < minimumNarrationWords) {
    try {
      const expandedPlan = await requestKnowledgeJson([
        promptText,
        "",
        "REVISI WAJIB:",
        `Naskah sebelumnya terlalu pendek. Tulis ulang dengan minimal ${minimumNarrationWords} kata narasi yang benar-benar dibacakan TTS.`,
        "Hitung hanya scene image dan summary. Scene reaction tidak dibacakan TTS.",
        "Setiap scene image harus 48-65 kata. Scene summary harus 55-75 kata.",
        `Pertahankan tepat jumlah scene dan pola format ${input.formatType}, dengan scene terakhir summary.`
      ].join("\n"));
      normalized = normalizePlan(expandedPlan, input);
    } catch (error) {
      console.warn(`[Story Longform] Revisi panjang naskah gagal: ${error.message}`);
    }
  }

  // Catat sumber Wikipedia HANYA bila naskah benar-benar dari OpenAI yang di-grounding,
  // agar atribusi di deskripsi tidak menyesatkan saat fallback offline dipakai.
  if (source === "openai" && wiki?.sources?.length) {
    normalized.sources = wiki.sources;
    normalized.factSource = "wikipedia";
  }

  normalized = finalizeNormalizedPlan(normalized, input);

  const narrationText = normalized.scenes
    .filter((scene) => scene.sceneType !== "reaction")
    .map((scene) => scene.narration)
    .join(" ");
  const outputText = JSON.stringify(normalized);

  const cost = estimateTotalCost({
    promptText,
    outputText,
    sceneCount: normalized.scenes.length,
    imageSize: "1536x1024", // Landscape DALL-E 3 size
    imageQuality: input.imageQuality,
    narrationChars: narrationText.length,
    ttsProvider: input.ttsProvider,
    pricing: config.pricing
  });

  const item = {
    id: createId("tau-lf"),
    source,
    status: "draft",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    input,
    title: normalized.title,
    plan: normalized,
    assets: {
      images: [],
      clips: [],
      audio: null,
      video: null
    },
    cost
  };

  item.assets.storyboard = await writeLongformStoryboard(item);
  return item;
}

function normalizeInput(input) {
  const durationSec = clamp(Number(input.durationSec || 300), 300, 900);
  // Long video butuh storyboard lebih banyak agar alurnya terasa dokumenter, bukan Shorts yang dipanjangin.
  const sceneCount = clamp(Number(input.sceneCount || Math.round(durationSec / 18)), 10, 28);

  return {
    topic: cleanText(input.topic || "Fakta menarik yang jarang diketahui orang", 260),
    category: cleanText(input.category && input.category !== "random" ? input.category : "umum", 80),
    angle: simplifyForLayAudience(input.angle || "asal-usul yang jarang diketahui", 80),
    formatType: cleanText(input.formatType || "dokumenter_klasik", 40),
    viralAngleId: cleanText(input.viralAngleId || "", 40),
    viralAngleLabel: simplifyForLayAudience(input.viralAngleLabel || "", 80),
    tone: cleanText(input.tone || "narrator, serius tapi menarik, informatif, mendalam, seperti video dokumenter Vox atau Lemmino", 180),
    durationSec,
    sceneCount,
    ttsProvider: String(input.ttsProvider || "elevenlabs").toLowerCase() === "openai" ? "openai" : "elevenlabs",
    imageSize: "1536x1024", // Default landscape
    imageQuality: cleanText(input.imageQuality || "standard", 20)
  };
}

function buildPrompt(input, wiki = null) {
  const categoryNote = simplifyForLayAudience(storyNoteFor(input.category), 700);
  const variation = simplifyForLayAudience(pick(STORY_VARIATIONS), 400);
  const formatDesc = simplifyForLayAudience(formatTypeDescription(input.formatType), 500);
  const formatCue = simplifyForLayAudience(formatTypeNarrativeCue(input.formatType), 500);
  const scenePattern = buildScenePattern(input.sceneCount, input.formatType).join(", ");
  const viralAngle = getViralAngleById(input.viralAngleId);
  const viralBlock = simplifyForLayAudience(
    viralAngleSummary(viralAngle) || `${input.viralAngleLabel || "angle viral"}: Gunakan kemasan yang membuat topik terasa punya konflik, misteri, taruhan, atau akibat yang jelas.`,
    1400
  );
  const wikiBlock = wiki?.facts
    ? [
        "",
        "FAKTA REFERENSI DARI WIKIPEDIA (jadikan dasar fakta, jangan dibantah):",
        wiki.facts,
        "Aturan pemakaian fakta di atas:",
        "- Untuk nama, tanggal, angka, dan tempat, IKUTI referensi ini; jangan menyebut data yang bertentangan.",
        "- Boleh menyusun ulang menjadi narasi yang menarik serta menambah analogi, transisi, dan konteks umum yang aman.",
        "- Jika sebuah detail tidak ada di referensi, hindari mengarang angka atau nama spesifik yang belum tentu benar.",
        "- Isi factCheckNote bahwa fakta inti dirujuk dari Wikipedia dan tetap perlu verifikasi akhir sebelum publikasi."
      ].join("\n")
    : "";
  return [
    `FORMAT VIDEO: ${input.formatType}. ${formatDesc}`,
    `PANDUAN NARASI FORMAT: ${formatCue}`,
    `POLA SCENE WAJIB: ${scenePattern}. Scene terakhir wajib summary.`,
    "Buat naskah video dokumenter horizontal landscape (16:9) dalam Bahasa Indonesia untuk channel BanyakTau.",
    "Video berdurasi panjang, jadi bahasanya harus runtut, kaya informasi, dan tetap mudah diikuti orang awam.",
    "GAYA BAHASA DAN PENYAJIAN (WAJIB DIPATUHI):",
    "  - Gunakan gaya bahasa populer yang dinamis, seru, dan mudah dipahami layaknya video essay kelas dunia seperti Vox atau Kurzgesagt.",
    "  - HINDARI istilah akademis, sosiologis, atau teoritis yang berbelit-belit dan terkesan klise. Pakai benda, kejadian, angka, dan contoh yang konkret.",
    "  - Penonton ingin tahu fakta unik dan jawabannya secara langsung, sederhana, dan konkret.",
    "  - Buat narasi yang to-the-point, jelas, dan fokus pada fakta unik/informasi 'daging' yang memancing rasa penasaran penonton.",
    "Hindari gaya bahasa lebay atau pembuka Shorts yang berisik. Penonton video panjang mencari detail faktual ('isinya daging semua').",
    "Struktur cerita harus punya pembuka yang kuat, isi yang maju langkah demi langkah, bagian paling penting yang terasa jelas, dan penutup yang mudah diingat.",
    "Setiap scene harus berisi narasi yang dibacakan oleh TTS dan teks layar (screenText) yang sinkron. Tulis narasi agar mudah dibaca TTS: angka dan satuan ditulis dengan kata-kata (misal 'tiga puluh derajat Celcius', 'seribu kilometer per jam'), hindari singkatan dan simbol seperti %, Rp, AI, 3D, &, kecuali sangat umum.",
    "PENTING UNTUK TTS: Tulis narasi sebagai kalimat-kalimat yang MENGALIR KONTINU. HINDARI titik koma (;), titik tiga (...), tanda kurung, dan tanda kutip karena memicu jeda panjang saat dibacakan. Gunakan koma atau kata sambung ('dan', 'lalu', 'sementara', 'karena') untuk menghubungkan klausa. Satu kalimat = satu napas bicara yang mulus.",
    "Scene reaction adalah jembatan singkat berupa pertanyaan atau pernyataan penasaran 8-16 kata. Jangan menjelaskan jawaban pada scene reaction; jawabannya dilanjutkan pada scene image berikutnya.",
    "Narasi scene reaction tidak akan dibacakan TTS. Teksnya hanya muncul di layar sebagai jeda hening singkat.",
    "Setiap scene image wajib memiliki 48-65 kata narasi. Scene summary wajib memiliki 55-75 kata narasi.",
    "Scene reaction tidak memerlukan visualKeywords atau imagePrompt. Isi reactionCue dengan ekspresi yang cocok: heran, kaget, skeptis, menemukan petunjuk, atau setuju.",
    "Scene terakhir wajib bertipe summary dengan screenText 'Ringkasan Inti' dan narasi kesimpulan yang tidak kosong.",
    "Buat storyboard longform yang komprehensif: banyak beat kecil, punya fungsi naratif jelas, dan tidak terasa seperti storyboard Shorts.",
    "Storyboard tidak boleh memakai judul layar generik berulang. Tulis screenText yang spesifik sesuai fakta scene, bukan label konsep umum.",
    "",
    "ANTI-PENGULANGAN NARASI (WAJIB DIPATUHI):",
    "- Setiap scene WAJIB menambahkan informasi, fakta, data, contoh, atau cara melihat BARU yang BELUM PERNAH disebut di scene manapun sebelumnya.",
    "- DILARANG mengulang poin yang sama dengan kata-kata berbeda. Jika scene 3 sudah menjelaskan 'kebijakan yang menghambat', scene 4 TIDAK BOLEH mengatakan 'regulasi yang tidak efektif' karena itu poin yang sama.",
    "- Setiap scene harus membuat penonton berkata 'wah saya baru tahu ini'. Hindari informasi yang sudah umum diketahui.",
    "- Gunakan DATA SPESIFIK: angka, tahun, nama orang/tempat/organisasi, perbandingan konkret. Jangan narasi generik yang bisa ditempelkan ke topik apapun.",
    "- Progresi narasi: scene awal = latar belakang unik, scene tengah = cara kerja/bukti/data baru di setiap scene, scene akhir = arti atau akibat yang belum dibahas.",
    "- Jangan memakai screenText, chapter, atau beatPurpose yang sama persis di dua scene berbeda. Setiap baris storyboard harus punya tugas yang berbeda.",
    `CATATAN KATEGORI (${input.category}): ${categoryNote}`,
    `VARIASI CERITA UNTUK NASKAH INI: ${variation}`,
    `KEMASAN VIRAL UTAMA:\n${viralBlock}`,
    "Gunakan kemasan viral ini sebagai tulang punggung judul, hook 30 detik pertama, dan transisi antar babak. Jangan hanya menempelkannya di judul.",
    "Kembalikan JSON valid saja dengan format:",
    "{ title, hook, summary, importantPoints:[string], factCheckNote, scenes:[{ index, sceneType:'image'|'reaction'|'summary', durationSec, narration, screenText, visualKeywords, imagePrompt, visualSegments:[{ imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms:[string], narrativeContext }], chapter, beatPurpose, reactionCue }] }",
    "",
    "JUDUL (cadangan): Buat judul singkat (maksimal 60 karakter), spesifik dengan subjek konkret yang jelas, dan memancing rasa penasaran tanpa terasa template. Judul final akan disempurnakan terpisah, jadi cukup sediakan satu judul layak pakai.",
    "",
    "FIELD 'hook' DALAM JSON:",
    "Field 'hook' adalah SATU kalimat pertanyaan punchy yang muncul sebagai teaser pembuka (cold open) sebelum intro.",
    "WAJIB: maksimal 15-20 kata, HARUS berakhir tanda tanya (?), dan HARUS merupakan kalimat utuh yang berdiri sendiri.",
    "Contoh bagus: 'Kenapa kopi yang kamu pesan selalu lebih lama dari yang dijanjikan?'",
    "Contoh buruk: 'Bayangkan Anda datang ke warung kopi yang selalu penuh. Data antrian menunjukkan waktu tunggu...' (terlalu panjang, bukan pertanyaan utuh)",
    "Field 'hook' BERBEDA dari narasi scene 1. Scene 1 boleh panjang; field 'hook' HARUS singkat.",
    "",
    "NARASI SCENE 1 (30 DETIK PERTAMA):",
    "Scene 1 HARUS membuat penonton TIDAK BISA meninggalkan video. Gunakan salah satu teknik hook yang kuat dan relevan:",
    "  - Fakta mengejutkan yang melawan intuisi, tetapi sebutkan subjeknya secara jelas",
    "  - Statistik kontroversial dengan sumber jelas",
    "  - Pertanyaan spesifik yang membuat penonton HARUS tahu jawabannya",
    "  - Skenario 'bagaimana jika' yang dramatis dan masuk akal",
    "  - Kontras tajam antara yang dipercaya publik dan bukti yang muncul",
    "  - Detail kecil yang ternyata membuka masalah besar",
    "JANGAN PERNAH mulai dengan 'Halo semuanya', 'Selamat datang', atau perkenalan channel.",
    "Langsung masuk ke inti yang membuat penasaran. Hook menentukan 70% retensi penonton.",
    "",
    `Topik Utama: ${input.topic}`,
    `Kategori: ${input.category}`,
    `Sudut Pandang: ${input.angle}`,
    `Kemasan Viral: ${simplifyForLayAudience(input.viralAngleLabel || viralAngle?.label || input.viralAngleId || "acak", 80)}`,
    `Tone Narasi: ${input.tone}`,
    `Durasi Total: ${input.durationSec} detik`,
    `Jumlah Scene: ${input.sceneCount}`,
    `Target Jumlah Kata: sekitar ${Math.round(input.durationSec * 2.1)} kata bahasa Indonesia secara keseluruhan.`,
    wikiBlock,
    "",
    "PENTING: pexelsQuery pada setiap visualSegment adalah query utama untuk MENCARI VIDEO STOCK di Pexels. visualKeywords tetap wajib sebagai fallback kompatibilitas.",
    "KATA KUNCI VISUAL (visualKeywords) untuk scene image/summary wajib:",
    "  - Dalam bahasa Inggris",
    "  - 3-5 kata GENERIK yang bisa ditemukan di stock video (misal: 'ocean waves aerial', 'laboratory scientist research', 'city skyline night')",
    "  - Jangan terlalu spesifik atau abstrak. Gunakan kata benda/kata kerja konkret.",
    "  - Variasikan antar scene agar video B-roll tidak monoton (jangan semua 'technology digital').",
    "  - Contoh bagus: 'ancient ruins archaeological dig', 'microscope cells biology', 'factory assembly line robot', 'tropical forest canopy aerial'",
    "  - Contoh buruk: 'abstract digital network visualization' (terlalu abstrak untuk stock video)",
    "FALLBACK IMAGE PROMPT (imagePrompt) untuk scene image/summary wajib menggambarkan pemandangan horizontal 16:9 yang artistik tanpa teks/tulisan di dalamnya.",
    "",
    "VISUAL SEGMENTS (WAJIB untuk scene image/summary, TIDAK untuk reaction):",
    "Setiap scene berdurasi 20-25 detik. JANGAN hanya pakai 1 gambar/video selama itu. Penonton akan bosan.",
    "Setiap scene image/summary WAJIB punya array 'visualSegments' berisi TEPAT 4 sub-visual berurutan.",
    "4 sub-visual itu HARUS membentuk PROGRESI VISUAL yang mengikuti urutan narasi scene:",
    "  - Sub-visual 1 = apa yang terlihat saat kalimat pembuka scene dibacakan.",
    "  - Sub-visual 2-3 = perkembangan/inti/bukti di tengah narasi.",
    "  - Sub-visual 4 = penutup/akibat/kesimpulan bagian akhir narasi scene.",
    "KONTINUITAS: keempat sub-visual harus terasa seperti satu rangkaian cerita — subjek utama, lokasi, atau objek kunci yang sama berlanjut antar sub-visual (berubah sudut pandang, jarak, atau momen), BUKAN 4 gambar acak yang tidak berhubungan.",
    "Setiap sub-visual menggambarkan APA yang harus TERLIHAT di layar saat bagian narasi itu dibacakan.",
    "Setiap sub-visual juga WAJIB punya pexelsQuery dan mustMatchTerms untuk pencarian stock video:",
    "  - pexelsQuery: satu frasa pencarian stock dalam bahasa Inggris, konkret, idealnya 3-7 kata.",
    "  - mustMatchTerms: array berisi 1-3 istilah subjek bahasa Inggris yang wajib tampak relevan pada hasil.",
    "  - Jangan isi pexelsQuery dengan konsep abstrak atau kata generik seperti 'documentary footage'.",
    "Contoh scene tentang 'cermin lift untuk aksesibilitas' (perhatikan progresi + kontinuitas subjek lift):",
    "  visualSegments: [",
    "    { imagePrompt: 'wheelchair user approaching modern elevator, horizontal cinematic', visualKeywords: 'wheelchair elevator entrance', pexelsQuery: 'wheelchair user entering elevator', mustMatchTerms: ['wheelchair', 'elevator'], narrativeContext: 'cermin membantu pengguna kursi roda' },",
    "    { imagePrompt: 'wheelchair user inside elevator facing mirror, medium shot', visualKeywords: 'wheelchair inside elevator mirror', pexelsQuery: 'wheelchair user inside elevator', mustMatchTerms: ['wheelchair', 'elevator'], narrativeContext: 'posisi masuk tanpa bisa berbalik' },",
    "    { imagePrompt: 'elevator mirror reflection showing buttons panel, close up', visualKeywords: 'elevator buttons panel mirror', pexelsQuery: 'elevator mirror buttons panel', mustMatchTerms: ['elevator', 'buttons'], narrativeContext: 'melihat tombol lewat pantulan cermin' },",
    "    { imagePrompt: 'modern accessible elevator interior wide angle', visualKeywords: 'modern elevator interior design', pexelsQuery: 'modern accessible elevator interior', mustMatchTerms: ['elevator'], narrativeContext: 'standar aksesibilitas internasional' }",
    "  ]",
    "Setiap sub-visual HARUS relevan dengan bagian narasi yang sedang dibacakan saat itu.",
    "Field visualKeywords dan imagePrompt di level scene tetap wajib diisi sebagai fallback."
  ].join("\n");
}

/**
 * Normalisasi visualSegments dari output AI.
 * Jika AI mengembalikan array visualSegments yang valid, bersihkan dan validasi.
 * Jika tidak, auto-split dari imagePrompt dan visualKeywords scene menjadi 4 segmen (grid 2x2).
 * @param {Array|null} rawSegments - visualSegments dari AI
 * @param {string} sceneImagePrompt - imagePrompt fallback level scene
 * @param {string} sceneVisualKeywords - visualKeywords fallback level scene
 * @param {string} topic - topik utama
 * @param {number} index - index scene (0-based)
 * @param {{allowScenePexelsIntent?: boolean}} [options] - Izinkan keyword level scene menjadi intent Pexels.
 * @returns {Array} - Array of { imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms, narrativeContext }
 */
const GENERIC_PEXELS_TERMS = new Set([
  "activity", "aerial", "angle", "background", "camera", "cinematic",
  "close", "close-up", "closeup", "closeups", "detail", "documentary", "drone", "establishing",
  "footage", "horizontal", "landscape", "macro", "medium", "modern",
  "motion", "overview", "people", "professional", "scene", "shot", "slow",
  "stock", "texture", "up", "video", "view", "visual", "wide",
  "wide-angle", "working"
]);

const PEXELS_QUERY_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but",
  "by", "for", "from", "in", "into", "is", "it", "its", "of", "on",
  "or", "that", "the", "their", "these", "this", "those", "to", "was",
  "were", "with"
]);

const MEANINGLESS_PEXELS_TERMS = new Set([
  "false", "nan", "none", "null", "true", "undefined", "unknown"
]);

const MEANINGLESS_PEXELS_QUERIES = new Set([
  "n a", "no query", "not available", "object object"
]);

const UNSAFE_PEXELS_SINGULARS = new Set([
  "atlas", "bias", "business", "chaos", "cosmos", "economics", "ethics",
  "headquarters", "lens", "mathematics", "means", "news", "physics",
  "politics", "series", "species"
]);

const PEXELS_IRREGULAR_PLURAL_FORMS = new Map([
  ["analyses", "analysis"],
  ["biases", "bias"],
  ["buses", "bus"],
  ["campuses", "campus"],
  ["crises", "crisis"],
  ["focuses", "focus"],
  ["gases", "gas"],
  ["lenses", "lens"],
  ["statuses", "status"],
  ["theses", "thesis"],
  ["viruses", "virus"]
]);

function pexelsTokenMatchForms(token) {
  const normalized = String(token || "").toLowerCase().replace(/[’']/g, "");
  const forms = new Set(normalized ? [normalized] : []);
  if (PEXELS_IRREGULAR_PLURAL_FORMS.has(normalized)) {
    forms.add(PEXELS_IRREGULAR_PLURAL_FORMS.get(normalized));
    return forms;
  }
  if (
    normalized.length <= 3
    || UNSAFE_PEXELS_SINGULARS.has(normalized)
    || normalized.endsWith("ss")
    || normalized.endsWith("us")
    || normalized.endsWith("is")
  ) {
    return forms;
  }
  if (normalized.length > 4 && normalized.endsWith("ies")) {
    forms.add(`${normalized.slice(0, -3)}y`);
    return forms;
  }
  if (normalized.length > 4 && /(ches|shes|xes|zes|sses)$/.test(normalized)) {
    forms.add(normalized.slice(0, -2));
    return forms;
  }
  if (normalized.endsWith("s")) {
    forms.add(normalized.slice(0, -1));
  }
  return forms;
}

function isGenericPexelsToken(token) {
  const normalized = String(token || "").toLowerCase();
  return [...pexelsTokenMatchForms(normalized)].some((form) => (
    GENERIC_PEXELS_TERMS.has(form)
  )) || /^\d+$/.test(normalized);
}

function isConcretePexelsToken(token) {
  const normalized = String(token || "").toLowerCase();
  return Boolean(normalized)
    && !isGenericPexelsToken(normalized)
    && !PEXELS_QUERY_STOPWORDS.has(normalized)
    && !MEANINGLESS_PEXELS_TERMS.has(normalized)
    && /[\p{L}]/u.test(normalized);
}

function isGenericPexelsPhraseToken(token, position, tokens) {
  const normalized = String(token || "").toLowerCase();
  const previous = position > 0
    ? String(tokens[position - 1] || "").toLowerCase()
    : "";
  return normalized === "ups" && previous === "close";
}

function concretePexelsQueryTokens(tokens) {
  return tokens.filter((token, position, allTokens) => (
    isConcretePexelsToken(token)
    && !isGenericPexelsPhraseToken(token, position, allTokens)
  ));
}

function pexelsTokensOverlap(left, right) {
  const leftForms = pexelsTokenMatchForms(left);
  return [...pexelsTokenMatchForms(right)].some((form) => leftForms.has(form));
}

function sanitizePexelsQuery(value) {
  if (typeof value !== "string") return "";
  const tokens = cleanText(value, 120)
    .replace(/[|,;/]+/g, " ")
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  const query = tokens.join(" ");
  if (
    !concretePexelsQueryTokens(tokens).length
    || MEANINGLESS_PEXELS_QUERIES.has(query.toLowerCase())
  ) {
    return "";
  }
  return query;
}

function normalizeMustMatchTerms(rawTerms, pexelsQuery) {
  const queryTokens = sanitizePexelsQuery(pexelsQuery)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const concreteQueryTokens = concretePexelsQueryTokens(queryTokens)
    .filter((token, position, tokens) => tokens.indexOf(token) === position);
  const provided = Array.isArray(rawTerms)
    ? rawTerms
    : typeof rawTerms === "string"
      ? rawTerms.split(",")
      : [];
  const normalized = [];
  for (const candidate of provided) {
    const term = sanitizePexelsQuery(candidate).toLowerCase();
    const tokens = term.split(/\s+/).filter(isConcretePexelsToken);
    if (!term) continue;
    for (const token of tokens) {
      const queryToken = concreteQueryTokens.find((queryCandidate) => (
        pexelsTokensOverlap(token, queryCandidate)
      ));
      if (queryToken && !normalized.includes(queryToken)) normalized.push(queryToken);
      if (normalized.length >= 3) break;
    }
    if (normalized.length >= 3) break;
  }
  for (const queryToken of concreteQueryTokens) {
    if (normalized.length >= 3) break;
    if (!normalized.includes(queryToken)) normalized.push(queryToken);
  }
  return normalized;
}

const SEGMENT_ANGLE_VARIATIONS = [
  ["wide establishing shot", "overview aerial landscape"],
  ["close up detail macro", "detail texture close up"],
  ["medium shot people activity", "people working professional"],
  ["over the shoulder perspective", "perspective depth detail"]
];

export const VISUAL_SEGMENT_COUNT = 4;

export function normalizeVisualSegments(rawSegments, sceneImagePrompt, sceneVisualKeywords, topic, index, options = {}) {
  const allowScenePexelsIntent = options.allowScenePexelsIntent
    ?? Boolean(cleanText(sceneVisualKeywords || "", 150));
  // Jika AI mengembalikan array valid dengan ≥2 item, bersihkan dan pakai (pad ke 4 bila kurang).
  if (Array.isArray(rawSegments) && rawSegments.length >= 2) {
    const segments = rawSegments.slice(0, VISUAL_SEGMENT_COUNT).map((seg) => {
      const segmentKeywords = cleanText(seg?.visualKeywords || "", 150);
      const visualKeywords = segmentKeywords || cleanText(sceneVisualKeywords || "", 150);
      const hasExplicitQuery = Object.prototype.hasOwnProperty.call(seg || {}, "pexelsQuery");
      const pexelsQuery = hasExplicitQuery
        ? sanitizePexelsQuery(seg?.pexelsQuery)
        : sanitizePexelsQuery(segmentKeywords || (allowScenePexelsIntent ? sceneVisualKeywords : ""));
      return {
        imagePrompt: cleanText(seg?.imagePrompt || sceneImagePrompt, 500),
        visualKeywords,
        pexelsQuery,
        mustMatchTerms: pexelsQuery ? normalizeMustMatchTerms(seg?.mustMatchTerms, pexelsQuery) : [],
        narrativeContext: cleanText(seg?.narrativeContext || "", 200)
      };
    });
    // Pad ke 4 segmen dengan variasi angle dari segmen terakhir agar grid 2x2 selalu penuh.
    while (segments.length < VISUAL_SEGMENT_COUNT) {
      const base = segments[segments.length - 1];
      const angle = SEGMENT_ANGLE_VARIATIONS[segments.length % SEGMENT_ANGLE_VARIATIONS.length];
      segments.push({
        ...base,
        imagePrompt: cleanText(`${base.imagePrompt}, ${angle[0]}`, 500),
        mustMatchTerms: [...(base.mustMatchTerms || [])]
      });
    }
    return segments;
  }

  // Auto-split: buat 4 segmen dari scene-level prompt.
  // Variasikan angle visual agar setiap segmen tidak identik.
  const segCount = VISUAL_SEGMENT_COUNT;
  const segments = [];
  const pexelsQuery = allowScenePexelsIntent ? sanitizePexelsQuery(sceneVisualKeywords) : "";
  const mustMatchTerms = pexelsQuery ? normalizeMustMatchTerms([], pexelsQuery) : [];
  for (let i = 0; i < segCount; i++) {
    const angleLabel = SEGMENT_ANGLE_VARIATIONS[i]?.[0] || "cinematic angle";
    const angleKeywords = SEGMENT_ANGLE_VARIATIONS[i]?.[1] || "documentary footage";
    segments.push({
      imagePrompt: sceneImagePrompt
        ? `${sceneImagePrompt}, ${angleLabel}, horizontal 16:9`
        : fallbackImagePrompt(topic, index) + `, ${angleLabel}`,
      visualKeywords: sceneVisualKeywords
        ? `${sceneVisualKeywords} ${angleKeywords}`.trim().slice(0, 150)
        : `${angleKeywords} documentary`,
      pexelsQuery,
      mustMatchTerms: [...mustMatchTerms],
      narrativeContext: ""
    });
  }
  return segments;
}

function normalizePlan(plan, input) {
  const rawScenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : [];
  const durations = distributeDurations(input.durationSec, input.sceneCount);

  const scenes = rawScenes.slice(0, input.sceneCount).map((scene, index) => {
    const duration = durations[index] || 20;
    const sceneType = resolveSceneType(scene?.sceneType, index, input.sceneCount, input.formatType);
    const reactionLine = sceneType === "reaction" ? normalizeReactionNarration(scene, index) : "";
    const screenText = sceneType === "summary"
      ? "Ringkasan Inti"
      : sceneType === "reaction"
        ? reactionLine
        : cleanText(scene?.screenText || `Babak ${index + 1}`, 100);
    const narration = sceneType === "reaction"
      ? reactionLine
      : cleanText(scene?.narration || `Ini adalah bagian penjelasan untuk babak ke-${index + 1}.`, 1600);
    const rawSceneVisualKeywords = sceneType === "reaction" ? "" : cleanText(scene?.visualKeywords || "", 150);
    const sceneVisualKeywords = sceneType === "reaction" ? "" : rawSceneVisualKeywords || fallbackKeywords(index);
    const sceneImagePrompt = sceneType === "reaction" ? "" : cleanText(scene?.imagePrompt || fallbackImagePrompt(input.topic, index), 500);
    return {
      index: index + 1,
      sceneType,
      durationSec: duration,
      narration,
      screenText,
      visualKeywords: sceneVisualKeywords,
      imagePrompt: sceneImagePrompt,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        scene?.visualSegments,
        sceneImagePrompt,
        sceneVisualKeywords,
        input.topic,
        index,
        { allowScenePexelsIntent: Boolean(rawSceneVisualKeywords) }
      ),
      chapter: cleanText(scene?.chapter || chapterName(index, input.sceneCount), 80),
      beatPurpose: cleanText(scene?.beatPurpose || beatPurpose(index, input.sceneCount), 180),
      reactionCue: cleanText(scene?.reactionCue || reactionCue(index), 120)
    };
  });

  // Jika scene kurang dari target
  while (scenes.length < input.sceneCount) {
    const index = scenes.length;
    const sceneType = resolveSceneType("", index, input.sceneCount, input.formatType);
    const fbKeywords = sceneType === "reaction" ? "" : fallbackKeywords(index);
    const fbImagePrompt = sceneType === "reaction" ? "" : fallbackImagePrompt(input.topic, index);
    scenes.push({
      index: index + 1,
      sceneType,
      durationSec: durations[index] || 20,
      narration: sceneType === "reaction"
        ? fallbackReactionNarration(index)
        : `Ini adalah bagian penjelasan tambahan untuk babak ke-${index + 1}.`,
      screenText: sceneType === "summary" ? "Ringkasan Inti" : fallbackScreenText(index, input.sceneCount),
      visualKeywords: fbKeywords,
      imagePrompt: fbImagePrompt,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        null,
        fbImagePrompt,
        fbKeywords,
        input.topic,
        index,
        { allowScenePexelsIntent: false }
      ),
      chapter: chapterName(index, input.sceneCount),
      beatPurpose: beatPurpose(index, input.sceneCount),
      reactionCue: reactionCue(index)
    });
  }

  const summary = completeSummary(plan?.summary, plan?.importantPoints, input.topic);
  const summaryScene = scenes.at(-1);
  if (summaryScene) {
    summaryScene.sceneType = "summary";
    summaryScene.screenText = "Ringkasan Inti";
    summaryScene.narration = completeSummaryNarration(summaryScene.narration, summary);
  }

  let normalized = {
    title: cleanText(plan?.title || input.topic, 100),
    hook: extractHookQuestion(plan?.hook, input.topic),
    summary,
    importantPoints: Array.isArray(plan?.importantPoints) ? plan.importantPoints.map(p => cleanText(p, 220)).slice(0, 8) : ["Poin utama pertama."],
    factCheckNote: cleanText(plan?.factCheckNote || "Konten disusun dengan bantuan AI dan belum diverifikasi manual. Periksa ulang fakta penting sebelum dipublikasikan.", 300),
    scenes
  };
  return finalizeNormalizedPlan(normalized, input);
}

function distributeDurations(totalSec, count) {
  const base = Math.floor(totalSec / count);
  const remainder = totalSec % count;
  const list = Array(count).fill(base);
  for (let i = 0; i < remainder; i++) {
    list[i] += 1;
  }
  return list;
}

function fallbackPlan(input, errorMsg = "") {
  const count = input.sceneCount;
  const scenes = [];
  for (let i = 0; i < count; i++) {
    const sceneType = resolveSceneType("", i, count, input.formatType);
    const fbKw = sceneType === "reaction" ? "" : fallbackKeywords(i);
    const fbIp = sceneType === "reaction" ? "" : fallbackImagePrompt(input.topic, i);
    scenes.push({
      index: i + 1,
      sceneType,
      narration: sceneType === "reaction"
        ? fallbackReactionNarration(i)
        : fallbackNarration(input.topic, i, count, errorMsg),
      screenText: sceneType === "summary" ? "Ringkasan Inti" : fallbackScreenText(i, count),
      visualKeywords: fbKw,
      imagePrompt: fbIp,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        null,
        fbIp,
        fbKw,
        input.topic,
        i,
        { allowScenePexelsIntent: false }
      ),
      chapter: chapterName(i, count),
      beatPurpose: beatPurpose(i, count),
      reactionCue: reactionCue(i)
    });
  }
  return {
    title: cleanText(input.topic, 100),
    hook: `Mengapa ${input.topic} menjadi pelajaran penting hari ini?`,
    summary: `Pembahasan ini menelusuri ${input.topic} mulai dari latar belakang, sebab, hingga dampaknya, lalu menutup dengan intisari yang mudah diingat.`,
    importantPoints: [
      `Latar belakang penting seputar ${input.topic}.`,
      `Sebab atau cara kerja utama di balik ${input.topic}.`,
      `Dampak serta pelajaran yang bisa diambil dari ${input.topic}.`
    ],
    scenes
  };
}

export function buildLongformStoryboard(plan) {
  return (plan.scenes || []).map((scene) => ({
    sceneIndex: scene.index,
    sceneType: scene.sceneType || "image",
    chapter: scene.chapter || chapterName(Number(scene.index || 1) - 1, plan.scenes.length),
    durationSec: scene.durationSec,
    screenText: scene.screenText,
    narrativePurpose: scene.beatPurpose || "",
    visualKeywords: scene.visualKeywords,
    visualPrompt: scene.imagePrompt,
    visualSegments: scene.visualSegments || [],
    reactionCue: scene.reactionCue || "",
    narrationPreview: cleanText(scene.narration, 240)
  }));
}

function finalizeNormalizedPlan(plan, input) {
  const polished = polishPlanForLayAudience(plan, input);
  polished.longformStoryboard = buildLongformStoryboard(polished);
  return polished;
}

function normalizedSceneType(value, index, total) {
  // Legacy function kept for any external callers; delegates to format-aware resolveSceneType
  if (index === total - 1) return "summary";
  return (index + 1) % 3 === 0 && index < total - 2 ? "reaction" : "image";
}

function normalizeReactionNarration(scene, index) {
  const candidates = [
    scene?.reactionText,
    firstSentence(scene?.narration),
    scene?.screenText,
    fallbackReactionNarration(index)
  ];
  let text = candidates.map((value) => cleanText(value, 180)).find(Boolean) || fallbackReactionNarration(index);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) text = words.slice(0, 16).join(" ");
  if (words.length < 6) text = `${text.replace(/[?.!]+$/g, "")}, lalu apa yang terjadi berikutnya`;
  if (!/[?.!]$/.test(text)) text = `${text}?`;
  return text;
}

function firstSentence(value) {
  return String(value || "").match(/^[^.!?]+[.!?]?/)?.[0] || "";
}

function fallbackReactionNarration(index) {
  const lines = [
    "Lalu, apa yang sebenarnya terjadi setelah perubahan besar itu?",
    "Tapi kenapa tanda penting ini justru sempat diabaikan?",
    "Di sinilah ceritanya mulai berubah. Apa penyebab utamanya?",
    "Pertanyaannya, siapa yang paling terdampak oleh keputusan tersebut?"
  ];
  return lines[index % lines.length];
}

function completeSummary(summary, importantPoints, topic) {
  const cleaned = cleanText(summary || "", 700);
  if (/[.!?]$/.test(cleaned) && cleaned.length >= 80) return cleaned;
  const points = Array.isArray(importantPoints)
    ? importantPoints.map((point) => cleanText(point, 180).replace(/[.!?]+$/g, "")).filter(Boolean).slice(0, 3)
    : [];
  const fallback = points.length
    ? points.join(". ")
    : `Pembahasan ini menunjukkan inti penting dari ${topic} dan alasan dampaknya masih relevan.`;
  const value = cleaned.length >= 80 ? cleaned : fallback;
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function completeSummaryNarration(sceneNarration, summary) {
  const sceneText = cleanText(sceneNarration || "", 1600);
  const summaryText = cleanText(summary || "", 700);
  const sceneWords = sceneText.split(/\s+/).filter(Boolean).length;
  if (sceneWords >= 50 && /[.!?]$/.test(sceneText)) return sceneText;

  const combined = [sceneText, summaryText]
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index)
    .join(" ");
  return combined || "Ringkasan inti belum tersedia.";
}

function narrationWordCount(plan) {
  return (plan.scenes || [])
    .filter((scene) => scene.sceneType !== "reaction")
    .reduce((sum, scene) => sum + String(scene.narration || "").split(/\s+/).filter(Boolean).length, 0);
}

async function writeLongformStoryboard(item) {
  const storyboardDir = path.join(paths.generatedDir, "storyboards");
  await fs.mkdir(storyboardDir, { recursive: true });
  const filename = `${item.id}-longform-storyboard.json`;
  const outputPath = path.join(storyboardDir, filename);
  await fs.writeFile(outputPath, `${JSON.stringify({
    id: item.id,
    title: item.title,
    topic: item.input.topic,
    category: item.input.category,
    durationSec: item.input.durationSec,
    sceneCount: item.plan.scenes.length,
    formatType: item.input.formatType,
    angle: item.input.angle,
    sources: Array.isArray(item.plan.sources) ? item.plan.sources : [],
    storyboard: item.plan.longformStoryboard || buildLongformStoryboard(item.plan)
  }, null, 2)}\n`, "utf8");
  return {
    path: outputPath,
    url: `/generated/storyboards/${filename}`,
    count: item.plan.scenes.length
  };
}

function chapterName(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.16) return "Pembuka";
  if (position <= 0.42) return "Awal Masalah";
  if (position <= 0.68) return "Bukti Baru";
  if (position <= 0.88) return "Akibatnya";
  return "Penutup";
}

function beatPurpose(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.16) return "Membuat penonton paham pertanyaan utamanya.";
  if (position <= 0.42) return "Membuka data, sejarah, atau sebab penting.";
  if (position <= 0.68) return "Menjelaskan masalah utama dengan contoh konkret.";
  if (position <= 0.88) return "Memperlihatkan akibat dan perubahan yang terjadi.";
  return "Menutup cerita dengan intisari yang mudah diingat.";
}

function reactionCue(index) {
  const cues = [
    "ekspresi heran singkat",
    "mengangguk karena fakta masuk akal",
    "mimik skeptis ketika data terasa mengejutkan",
    "ekspresi menemukan petunjuk",
    "reaksi kaget tanpa suara"
  ];
  return cues[index % cues.length];
}

function fallbackScreenText(index, total) {
  const labels = ["Awal Masalah", "Fakta Terlewat", "Bukti Baru", "Angka Penting", "Pilihan Sulit", "Akibatnya", "Arah Berubah", "Pelajaran"];
  return `${labels[index % labels.length]} ${Math.min(total, index + 1)}`;
}

function fallbackKeywords(index) {
  const keywords = [
    "documentary investigation office archive",
    "vintage technology factory research",
    "business meeting strategy failure",
    "macro close up documents evidence",
    "city night timelapse industry change",
    "museum display invention history"
  ];
  return keywords[index % keywords.length];
}

function fallbackImagePrompt(topic, index) {
  return [
    `horizontal cinematic documentary scene about ${topic}`,
    `story beat ${index + 1}`,
    "editorial knowledge video visual, realistic lighting, no text, no watermark"
  ].join(", ");
}

function fallbackNarration(topic, index, total, errorMsg) {
  const intro = index === 0
    ? `Bayangkan sebuah keputusan kecil yang pelan-pelan mengubah arah sebuah cerita besar. Dalam topik ${topic}, bagian paling menarik bukan cuma apa yang terjadi, tetapi kenapa banyak orang baru menyadarinya setelah dampaknya terasa.`
    : `Pada bagian ke-${index + 1}, kita masuk ke bagian berikutnya dari ${topic}. Di sini, pola yang terlihat sederhana mulai menunjukkan sebab dan akibat yang lebih mudah dipahami.`;
  const context = `Kuncinya adalah membaca urutan peristiwa: siapa yang punya pilihan, informasi apa yang mereka abaikan, dan bagaimana keputusan itu menciptakan akibat baru.`;
  const close = index === total - 1
    ? `Dari sini, pelajarannya jelas: fakta besar sering muncul dari detail kecil yang terus berulang sampai akhirnya tidak bisa diabaikan.`
    : `Bagian ini menjadi pijakan untuk memahami bab berikutnya, karena satu detail saja bisa mengubah cara kita melihat keseluruhan cerita.`;
  const apiNote = errorMsg ? "" : "";
  return cleanText(`${intro} ${context} ${close} ${apiNote}`, 1200);
}
