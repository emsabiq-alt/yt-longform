/**
 * Script: Organize YouTube Playlists for BanyakTau
 *
 * Fungsi:
 * 1. Menarik seluruh playlist yang ada di channel YouTube.
 * 2. Menarik seluruh video yang diunggah di channel.
 * 3. Mengambil daftar video yang sudah ada di masing-masing playlist (mencegah duplikat).
 * 4. Mempelajari dan mengklasifikasikan setiap video HANYA dari JUDULNYA (AI + fallback semantik).
 * 5. Membuat playlist kategori otomatis jika belum tersedia.
 * 6. Memasukkan setiap video ke playlist yang sesuai.
 * 7. Menampilkan rekapitulasi lengkap hasil penataan playlist.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.production.local" });
dotenv.config();

import { config } from "../src/config.js";
import { getYoutubeAccessToken } from "../src/youtube-publisher.js";

const PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists";
const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Taksonomi kategori BanyakTau untuk klasifikasi berbasis judul
const CATEGORY_DEFINITIONS = [
  {
    key: "alam_semesta",
    title: "BanyakTau: Alam Semesta & Luar Angkasa",
    description: "Kumpulan video eksplorasi misteri alam semesta, tata surya, planet, galaksi, dan astronomi.",
    keywords: [
      "alam semesta", "tata surya", "luar angkasa", "planet", "bintang", "galaksi", "matahari",
      "bulan", "mars", "jupiter", "saturnus", "meteor", "komet", "asteroid", "lubang hitam",
      "supernova", "antariksa", "astronot", "roket", "nasa", "apollo", "satelit", "teleskop",
      "kosmis", "alien", "hampa udara", "milky way", "bima sakti", "orbit", "gravitasi bumi"
    ]
  },
  {
    key: "fenomena_alam",
    title: "BanyakTau: Fenomena Alam & Bencana Purba",
    description: "Kumpulan video fenomena alam dahsyat, gunung api, letusan purba, tsunami, dan iklim ekstrem.",
    keywords: [
      "gunung", "letusan", "erupsi", "toba", "krakatau", "merapi", "lahar", "gempa",
      "tsunami", "badai", "tornado", "siklon", "petir", "kilat", "banjir", "tanah longsor",
      "gurun", "laut", "samudra", "palung", "kutub", "zaman es", "iklim", "magma", "vulkanik",
      "supervolcano", "kawah", "danau toba", "anak krakatau", "bencana", "bumi"
    ]
  },
  {
    key: "sains",
    title: "BanyakTau: Sains & Eksplorasi Ilmiah",
    description: "Kumpulan video sains, fisika, kimia, biologi, dan fakta ilmiah menarik sehari-hari.",
    keywords: [
      "sains", "fisika", "kimia", "biologi", "sel", "atom", "molekul", "gaya", "magnet",
      "kuantum", "cahaya", "gelombang", "suhu", "panas", "dingin", "es", "air", "gas",
      "tekanan", "evolusi", "dna", "genetika", "bakteri", "virus", "mikroba", "madu",
      "zat", "ilmiah", "eksperimen", "mengapa", "kenapa", "alasan", "bukti", "hukum archimedes"
    ]
  },
  {
    key: "sejarah",
    title: "BanyakTau: Sejarah & Peradaban Dunia",
    description: "Kumpulan video sejarah masa lalu, peradaban kuno, kerajaan, perang, dan jejak arkeologi.",
    keywords: [
      "sejarah", "zaman", "purba", "kuno", "peradaban", "kekaisaran", "kerajaan", "raja",
      "ratu", "kaisar", "firaun", "mesir", "piramida", "romawi", "yunani", "sumeria",
      "dinasti", "perang", "kolonial", "revolusi", "abad", "arkeolog", "fosil", "prasasti",
      "candi", "artefak", "tiongkok", "nusantara", "majapahit", "voc", "masa lalu"
    ]
  },
  {
    key: "misteri",
    title: "BanyakTau: Misteri & Hal Tak Terpecahkan",
    description: "Kumpulan video misteri dunia, fakta ganjil, teka-teki sejarah, dan anomali sains.",
    keywords: [
      "misteri", "teka-teki", "konspirasi", "hilang", "lenyap", "aneh", "belum terpecahkan",
      "rahasia", "tak terduga", "tersembunyi", "segitiga bermuda", "sinyal wow", "atlantis",
      "mitos", "ganjil", "tabu", "rahasia besar", "paradoks", "kutukan", "teori"
    ]
  },
  {
    key: "teknologi",
    title: "BanyakTau: Teknologi & Penemuan Modern",
    description: "Kumpulan video inovasi teknologi canggih, komputer, AI, dan penemuan masa depan.",
    keywords: [
      "teknologi", "penemuan", "diciptakan", "penemu", "komputer", "internet", "microchip",
      "chip", "robot", "ai", "kecerdasan buatan", "mesin", "algoritma", "radar", "baterai",
      "listrik", "nuklir", "inovasi", "kamera", "ponsel", "gadget", "software", "hardware"
    ]
  },
  {
    key: "infrastruktur",
    title: "BanyakTau: Arsitektur & Rekayasa Bangunan",
    description: "Kumpulan video mega struktur, jembatan, terowongan, bendungan, dan keajaiban teknik sipil.",
    keywords: [
      "arsitektur", "infrastruktur", "bangunan", "jembatan", "gedung", "menara", "menara pisa",
      "terowongan", "bendungan", "st. francis", "pipa", "kanal", "konstruksi", "teknik sipil",
      "fondasi", "megastruktur", "roboh", "runtuh", "jalan tol"
    ]
  },
  {
    key: "transportasi",
    title: "BanyakTau: Transportasi & Mesin Raksasa",
    description: "Kumpulan video kapal, pesawat terbang, kereta api, dan kendaraan raksasa penakluk jarak.",
    keywords: [
      "kapal", "perahu", "pesawat", "terbang", "helikopter", "mobil", "kereta", "lokomotif",
      "rel", "sepeda", "kapal selam", "mesin uap", "mesin diesel", "pelabuhan", "bandara",
      "penerbangan", "boeing", "airbus", "titanic"
    ]
  },
  {
    key: "tubuh_manusia",
    title: "BanyakTau: Tubuh Manusia & Misteri Medis",
    description: "Kumpulan video cara kerja organ tubuh, otak, sistem imun, dan keajaiban biologis manusia.",
    keywords: [
      "tubuh", "manusia", "otak", "memori", "tidur", "mimpi", "mata", "telinga", "jantung",
      "darah", "paru-paru", "otot", "tulang", "lambung", "penyakit", "imun", "kekebalan",
      "obat", "vaksin", "racun", "umur", "kematian", "sel kanker", "organ"
    ]
  },
  {
    key: "hewan_ekologi",
    title: "BanyakTau: Dunia Hewan & Kehidupan Liar",
    description: "Kumpulan video keajaiban fauna, strategi bertahan hidup hewan, dan ekosistem alam liar.",
    keywords: [
      "hewan", "binatang", "satwa", "mamalia", "reptil", "burung", "ikan", "paus", "hiu",
      "serangga", "lebah", "semut", "laba-laba", "dinosaurus", "predator", "punah",
      "habitat", "ekosistem", "hutan", "tumbuhan", "pohon", "fauna", "flora"
    ]
  },
  {
    key: "ekonomi_bisnis",
    title: "BanyakTau: Ekonomi, Bisnis & Uang Global",
    description: "Kumpulan video sejarah ekonomi, perputaran uang, perusahaan raksasa, dan krisis moneter.",
    keywords: [
      "ekonomi", "bisnis", "uang", "mata uang", "inflasi", "krisis", "saham", "pasar",
      "bank", "perusahaan", "industri", "perdagangan", "kekayaan", "triliun", "miliarder",
      "utang", "pajak", "kebijakan", "kapitalisme", "moneter"
    ]
  },
  {
    key: "tokoh_dunia",
    title: "BanyakTau: Tokoh & Kisah Pengubah Dunia",
    description: "Kumpulan video biografi singkat tokoh bersejarah, penemu hebat, dan figur legendaris.",
    keywords: [
      "tokoh", "sosok", "biografi", "bj habibie", "habibie", "einstein", "newton", "tesla",
      "da vinci", "galileo", "edison", "presiden", "penjelajah", "kisah hidup"
    ]
  },
  {
    key: "makanan_dapur",
    title: "BanyakTau: Makanan, Dapur & Sains Kuliner",
    description: "Kumpulan video fakta sains di balik makanan, minuman, bumbu dapur, dan cara pengawetan.",
    keywords: [
      "makanan", "kuliner", "dapur", "masak", "bumbu", "rempah", "kopi", "teh", "cokelat",
      "gula", "garam", "roti", "daging", "susu", "keju", "fermentasi", "basi", "awet", "resep"
    ]
  }
];

const DEFAULT_CATEGORY = {
  key: "edukasi_umum",
  title: "BanyakTau: Fakta Menarik & Pengetahuan Umum",
  description: "Kumpulan video edukasi dan fakta menarik dari channel BanyakTau."
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error_description || data?.raw || response.statusText;
    throw new Error(`${detail} [HTTP ${response.status}]`);
  }
  return data;
}

/**
 * 1. Ambil playlist uploads channel
 */
async function getUploadsPlaylistId(accessToken) {
  const url = new URL(CHANNELS_URL);
  url.searchParams.set("part", "contentDetails,snippet");
  url.searchParams.set("mine", "true");
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const channel = data.items?.[0];
  if (!channel) throw new Error("Channel YouTube tidak ditemukan untuk token ini.");
  console.log(`\n📺 Channel: "${channel.snippet?.title}" (ID: ${channel.id})`);
  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("Uploads playlist tidak ditemukan.");
  return uploadsId;
}

/**
 * 2. Ambil seluruh playlist yang dimiliki channel
 */
async function getAllPlaylists(accessToken) {
  const playlists = [];
  let pageToken = "";
  do {
    const url = new URL(PLAYLISTS_URL);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const pl of data.items || []) {
      playlists.push({
        id: pl.id,
        title: pl.snippet?.title || "",
        description: pl.snippet?.description || "",
        itemCount: pl.contentDetails?.itemCount || 0
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return playlists;
}

/**
 * 3. Ambil seluruh video yang diunggah ke channel
 */
async function getAllUploadedVideos(accessToken, uploadsPlaylistId) {
  const videos = [];
  let pageToken = "";
  do {
    const url = new URL(PLAYLIST_ITEMS_URL);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (videoId) {
        videos.push({
          id: videoId,
          title: item.snippet?.title || "",
          publishedAt: item.snippet?.publishedAt || ""
        });
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return videos;
}

/**
 * 4. Ambil video-video yang SUDAH ada di masing-masing playlist (menghindari duplikasi)
 */
async function getPlaylistItemsMap(accessToken, playlists) {
  const map = new Map(); // playlistId -> Set<videoId>

  for (const pl of playlists) {
    const videoSet = new Set();
    let pageToken = "";
    do {
      const url = new URL(PLAYLIST_ITEMS_URL);
      url.searchParams.set("part", "contentDetails");
      url.searchParams.set("playlistId", pl.id);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      try {
        const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        for (const item of data.items || []) {
          const vId = item.contentDetails?.videoId;
          if (vId) videoSet.add(vId);
        }
        pageToken = data.nextPageToken || "";
      } catch (err) {
        console.warn(`[Warn] Gagal fetch item playlist ${pl.id} ("${pl.title}"): ${err.message}`);
        break;
      }
    } while (pageToken);

    map.set(pl.id, videoSet);
    await sleep(200);
  }

  return map;
}

/**
 * 5. Buat playlist baru di YouTube
 */
async function createPlaylist(accessToken, title, description) {
  const res = await fetch(`${PLAYLISTS_URL}?part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      snippet: {
        title,
        description: description || `Kumpulan video edukasi dari BanyakTau.`
      },
      status: {
        privacyStatus: "public"
      }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`Gagal buat playlist "${title}": ${msg}`);
  }
  return { id: data.id, title: data.snippet.title, description: data.snippet.description, itemCount: 0 };
}

/**
 * 6. Klasifikasi judul video menggunakan OpenAI (jika key tersedia)
 */
async function classifyVideosWithAi(videos, playlists) {
  if (!config.openai.apiKey) return null;

  try {
    const playlistOptions = playlists.map((p) => `- ID: "${p.id}", Judul: "${p.title}"`).join("\n");
    const videoEntries = videos.map((v) => `- ID: "${v.id}", Judul: "${v.title}"`).join("\n");

    const prompt = `Berikut adalah daftar playlist yang tersedia di channel YouTube BanyakTau:
${playlistOptions}

Berikut adalah daftar video yang diunggah (ID dan Judul):
${videoEntries}

Tugas:
Analisis HANYA BERDASARKAN JUDUL setiap video, dan tentukan 1 playlist yang PALING RELEVAN DAN TEPAT untuk video tersebut.
Jika sebuah video sangat ambigu, pilih playlist yang paling masuk akal.

Kembalikan HANYA format JSON valid tanpa markdown, dengan struktur:
{
  "classifications": [
    { "videoId": "ID_VIDEO", "playlistId": "ID_PLAYLIST", "reason": "alasan singkat 3-5 kata" }
  ]
}`;

    const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.storyModel || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Kamu adalah asisten kurator channel YouTube edukasi BanyakTau. Tugasmu mengorganisir video ke dalam playlist yang paling cocok hanya dari membaca judulnya." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!res.ok) {
      console.warn(`[AI] OpenAI classification request gagal (${res.status}), fallback ke aturan semantik.`);
      return null;
    }

    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(parsed.classifications) && parsed.classifications.length > 0) {
      const mapping = new Map();
      for (const item of parsed.classifications) {
        if (item.videoId && item.playlistId) {
          mapping.set(item.videoId, item.playlistId);
        }
      }
      return mapping;
    }
  } catch (err) {
    console.warn(`[AI] Error selama klasifikasi AI: ${err.message}, fallback ke aturan semantik.`);
  }
  return null;
}

/**
 * 7. Klasifikasi judul video berbasis taksonomi kata kunci semantik (fallback)
 */
function classifyVideoByKeywords(title, playlists) {
  const cleanTitle = title.toLowerCase();

  // Hitung kecocokan skor per kategori taksonomi
  let bestCategory = null;
  let highestScore = 0;

  for (const cat of CATEGORY_DEFINITIONS) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (cleanTitle.includes(kw)) {
        score += kw.length > 6 ? 3 : 2;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestCategory = cat;
    }
  }

  // Cari playlist yang cocok dengan kategori terbaik
  if (bestCategory && highestScore > 0) {
    const matched = playlists.find((p) => {
      const pTitle = p.title.toLowerCase();
      return pTitle.includes(bestCategory.key)
        || pTitle.includes(bestCategory.title.toLowerCase().replace("banyaktau: ", ""))
        || bestCategory.keywords.some((kw) => pTitle.includes(kw) && kw.length > 4);
    });
    if (matched) return { playlist: matched, score: highestScore, categoryName: bestCategory.title };
  }

  // Fallback: cari playlist apa pun yang judulnya mengandung kata dari judul video
  for (const p of playlists) {
    const pTitle = p.title.toLowerCase().replace(/banyaktau:\s*/g, "");
    const words = pTitle.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => cleanTitle.includes(w))) {
      return { playlist: p, score: 1, categoryName: p.title };
    }
  }

  // Fallback ke playlist umum/edukasi
  const defaultPl = playlists.find((p) => /umum|edukasi|banyaktau/i.test(p.title)) || playlists[0];
  return { playlist: defaultPl, score: 0, categoryName: defaultPl?.title || "Umum" };
}

/**
 * 8. Tambahkan video ke playlist
 */
async function insertVideoToPlaylist(accessToken, playlistId, videoId) {
  const url = new URL(PLAYLIST_ITEMS_URL);
  url.searchParams.set("part", "snippet");

  const body = {
    snippet: {
      playlistId,
      resourceId: {
        kind: "youtube#video",
        videoId
      }
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || res.statusText;
    throw new Error(`Insert gagal: ${msg} [HTTP ${res.status}]`);
  }
}

/**
 * MAIN EXECUTION
 */
async function main() {
  console.log("==========================================================");
  console.log("🚀 MEMULAI PENATAAN PLAYLIST YOUTUBE BANYAKTAU");
  console.log("==========================================================");

  const accessToken = await getYoutubeAccessToken();
  console.log("🔑 Access token YouTube berhasil diverifikasi.");

  // 1. Ambil channel info & uploads playlist
  const uploadsPlaylistId = await getUploadsPlaylistId(accessToken);

  // 2. Ambil playlist yang saat ini ada di YouTube
  let playlists = await getAllPlaylists(accessToken);
  console.log(`\n📂 Ditemukan ${playlists.length} playlist yang sudah ada:`);
  playlists.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.id}] "${p.title}" (${p.itemCount} video)`);
  });

  // 3. Jika playlist sangat sedikit (< 3), buat playlist kategori utama BanyakTau agar rapi
  const existingTitles = new Set(playlists.map((p) => p.title.toLowerCase().trim()));
  const missingCoreCategories = CATEGORY_DEFINITIONS.filter(
    (cat) => !existingTitles.has(cat.title.toLowerCase().trim())
      && !Array.from(existingTitles).some((t) => t.includes(cat.key) || t.includes(cat.title.toLowerCase().replace("banyaktau: ", "")))
  );

  if (missingCoreCategories.length > 0) {
    console.log(`\n🛠️  Menyiapkan ${missingCoreCategories.length} playlist kategori baru agar terorganisir rapi:`);
    for (const cat of missingCoreCategories) {
      try {
        const created = await createPlaylist(accessToken, cat.title, cat.description);
        console.log(`  ✨ Berhasil membuat playlist: "${created.title}" [${created.id}]`);
        playlists.push(created);
        existingTitles.add(created.title.toLowerCase().trim());
        await sleep(500); // safety gap
      } catch (err) {
        console.warn(`  ⚠️ Gagal membuat playlist "${cat.title}": ${err.message}`);
      }
    }
  }

  // 4. Ambil seluruh video yang diunggah
  const videos = await getAllUploadedVideos(accessToken, uploadsPlaylistId);
  console.log(`\n🎬 Ditemukan total ${videos.length} video yang diunggah di channel:`);
  videos.forEach((v, idx) => {
    console.log(`  ${idx + 1}. [${v.id}] "${v.title}"`);
  });

  if (videos.length === 0) {
    console.log("\nTidak ada video di channel. Proses selesai.");
    return;
  }

  // 5. Cek isi masing-masing playlist saat ini
  console.log(`\n🔍 Memeriksa item yang sudah ada di setiap playlist...`);
  const playlistItemsMap = await getPlaylistItemsMap(accessToken, playlists);
  console.log("✅ Data item playlist selesai dipetakan.");

  // 6. Klasifikasi video berdasarkan judul
  console.log(`\n🧠 Mempelajari judul video untuk menentukan playlist terbaik...`);
  let aiMappings = await classifyVideosWithAi(videos, playlists);
  if (aiMappings) {
    console.log(`🤖 Klasifikasi AI berhasil memetakan ${aiMappings.size} video.`);
  } else {
    console.log(`💡 Menggunakan klasifikasi taksonomi semantik cerdas berdasarkan kata kunci judul.`);
  }

  // 7. Masukkan video ke playlist masing-masing
  console.log(`\n📥 Memulai penempatan video ke dalam playlist:`);
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    let targetPlaylistId = aiMappings ? aiMappings.get(video.id) : null;
    let targetPlaylist = playlists.find((p) => p.id === targetPlaylistId);

    if (!targetPlaylist) {
      const result = classifyVideoByKeywords(video.title, playlists);
      targetPlaylist = result.playlist;
      targetPlaylistId = targetPlaylist?.id;
    }

    if (!targetPlaylist) {
      console.warn(`  [${i + 1}/${videos.length}] ❌ Video "${video.title}" tidak menemukan playlist yang cocok.`);
      totalFailed++;
      continue;
    }

    // Cek apakah video sudah ada di playlist target
    const currentItems = playlistItemsMap.get(targetPlaylist.id) || new Set();
    if (currentItems.has(video.id)) {
      console.log(`  [${i + 1}/${videos.length}] ⏭️  [SUDAH ADA] "${video.title}" → "${targetPlaylist.title}"`);
      totalSkipped++;
      continue;
    }

    // Tambahkan ke playlist
    try {
      await insertVideoToPlaylist(accessToken, targetPlaylist.id, video.id);
      currentItems.add(video.id);
      playlistItemsMap.set(targetPlaylist.id, currentItems);
      console.log(`  [${i + 1}/${videos.length}] ✅ [DITAMBAHKAN] "${video.title}" → "${targetPlaylist.title}"`);
      totalAdded++;
      await sleep(600); // safety rate-limit YouTube API
    } catch (err) {
      console.error(`  [${i + 1}/${videos.length}] ⚠️  [GAGAL] "${video.title}" → "${targetPlaylist.title}": ${err.message}`);
      totalFailed++;
    }
  }

  // 8. Cetak Rekapitulasi Akhir
  console.log("\n==========================================================");
  console.log("📊 REKAPITULASI PENATAAN PLAYLIST");
  console.log("==========================================================");
  console.log(`Total video diperiksa    : ${videos.length}`);
  console.log(`Video baru dimasukkan    : ${totalAdded}`);
  console.log(`Video sudah ada (skip)   : ${totalSkipped}`);
  console.log(`Gagal dimasukkan         : ${totalFailed}`);
  console.log("----------------------------------------------------------");
  console.log("📋 Struktur Playlist Akhir:");
  for (const pl of playlists) {
    const count = (playlistItemsMap.get(pl.id) || new Set()).size;
    console.log(`  - "${pl.title}": ${count} video`);
  }
  console.log("==========================================================");
  console.log("🎉 Penataan playlist selesai dengan sukses!");
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err);
  process.exit(1);
});
