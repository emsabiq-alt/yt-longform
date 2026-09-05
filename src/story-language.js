import { cleanText } from "./util.js";

const TERM_REPLACEMENTS = [
  [/\befek domino\b/gi, "rangkaian akibat"],
  [/\blanskap urban\b/gi, "wajah kota"],
  [/\btatanan sosial\b/gi, "cara hidup masyarakat"],
  [/\bparadoks modern\b/gi, "hal yang terlihat bertentangan hari ini"],
  [/\bparadoks\b/gi, "hal yang terlihat bertentangan"],
  [/\bmekanisme\b/gi, "cara kerja"],
  [/\bimplikasi\b/gi, "arti"],
  [/\bkonsekuensi\b/gi, "akibat"],
  [/\bhipotesis\b/gi, "dugaan awal"],
  [/\banalisis\b/gi, "penjelasan"],
  [/\banalitis\b/gi, "jelas dan masuk akal"],
  [/\bargumen\b/gi, "alasan"],
  [/\bsintesis\b/gi, "kesimpulan seimbang"],
  [/\bobservasi\b/gi, "pengamatan"],
  [/\bperspektif\b/gi, "cara melihat"],
  [/\bfenomena\b/gi, "kejadian"],
  [/\bsistemik\b/gi, "menyebar ke banyak bagian"],
  [/\bgeopolitik\b/gi, "hubungan antar negara"],
  [/\bfundamental\b/gi, "paling dasar"],
  [/\bkompleks\b/gi, "rumit"],
  [/\bdilema\b/gi, "pilihan sulit"],
  [/\bklimaks\b/gi, "bagian paling penting"],
  [/\bbabak\b/gi, "bagian"],
  [/\btesis\b/gi, "gagasan utama"],
  [/\besai dokumenter\b/gi, "cerita pengetahuan"],
  [/\btransformasi\b/gi, "perubahan besar"],
  [/\btransisi\b/gi, "perubahan bertahap"],
  [/\bkonteks\b/gi, "latar belakang"],
  [/\babstrak\b/gi, "sulit dibayangkan"]
];

const GENERIC_SCREEN_TEXT = /^(pertanyaan besar|awal cerita|titik buta|data penting|konflik inti|efek domino|pembalikan|pelajaran|hook dan konteks|akar masalah|analisis utama|dampak dan pembalikan|kesimpulan|ringkasan inti|babak\s+\d+)(\s+\d+)?$/i;

const SCREEN_FALLBACKS = [
  "Awal Masalahnya",
  "Fakta yang Terlewat",
  "Bukti Mulai Terlihat",
  "Hal yang Berubah",
  "Angka yang Mengejutkan",
  "Pilihan yang Mengubah Arah",
  "Akibatnya Mulai Terasa",
  "Hal yang Sering Keliru",
  "Petunjuk Terakhir",
  "Yang Perlu Diingat"
];

const CHAPTERS = [
  "Pembuka",
  "Awal Masalah",
  "Bukti Baru",
  "Akibatnya",
  "Penutup"
];

const PURPOSES = [
  "Membuat penonton langsung paham pertanyaan utamanya.",
  "Menjelaskan awal cerita dengan contoh yang mudah dibayangkan.",
  "Menambah fakta baru agar alurnya maju.",
  "Menunjukkan akibat yang mulai terlihat.",
  "Menutup cerita dengan pelajaran yang mudah diingat."
];

const STOPWORDS = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "ini", "itu", "adalah", "dengan",
  "untuk", "pada", "dalam", "karena", "sebagai", "bisa", "akan", "saat", "kita",
  "mereka", "sebuah", "satu", "bagaimana", "mengapa", "kenapa", "apa", "lalu",
  "namun", "tetapi", "sementara", "tersebut", "jadi", "mulai"
]);

export function simplifyForLayAudience(value, max = 2000) {
  let text = cleanText(value || "", max || 2000);
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return cleanText(text, max || 2000);
}

export function isGenericStoryboardText(value) {
  return GENERIC_SCREEN_TEXT.test(cleanText(value || "", 120));
}

export function dedupeSentences(value, max = 2000) {
  const text = simplifyForLayAudience(value, max);
  const sentences = text.match(/[^.!?]+[.!?]?/g) || (text ? [text] : []);
  const kept = [];
  const fingerprints = [];

  for (const raw of sentences) {
    const sentence = cleanText(raw, 500);
    if (!sentence) continue;
    const fingerprint = textFingerprint(sentence);
    if (!fingerprint) continue;
    const repeated = fingerprints.some((known) => known === fingerprint || jaccard(known, fingerprint) >= 0.78);
    if (repeated) continue;
    fingerprints.push(fingerprint);
    kept.push(sentence);
  }

  return cleanText(kept.join(" "), max);
}

export function polishPlanForLayAudience(plan, input = {}) {
  const sceneCount = Array.isArray(plan?.scenes) ? plan.scenes.length : 0;
  const usedScreen = new Set();
  const usedPurpose = new Set();
  // Judul bab = screenText scene pertama di tiap bagian, supaya daftar bab
  // YouTube berisi frasa konkret, bukan label generik "Awal Masalah".
  const chapterTitles = new Map();
  const usedChapter = new Set();

  const polished = {
    ...plan,
    title: simplifyForLayAudience(plan?.title || input.topic || "", 100),
    hook: simplifyForLayAudience(plan?.hook || "", 160),
    summary: dedupeSentences(plan?.summary || "", 700),
    importantPoints: uniqueTextList(plan?.importantPoints || [], 8, 220),
    factCheckNote: simplifyForLayAudience(plan?.factCheckNote || "", 300)
  };

  polished.scenes = (plan?.scenes || []).map((scene, index) => {
    const sceneType = scene?.sceneType || "image";
    const next = {
      ...scene,
      narration: sceneType === "reaction"
        ? simplifyForLayAudience(scene?.narration || "", 180)
        : dedupeSentences(scene?.narration || "", 1600),
      reactionCue: simplifyForLayAudience(scene?.reactionCue || "", 120)
    };

    next.screenText = sceneType === "summary"
      ? "Ringkasan Inti"
      : uniqueScreenText(next, index, input, usedScreen);
    // Bucket posisi menjamin bab kontigu; labelnya diambil dari scene pembuka
    // bucket itu — pakai chapter dari AI bila spesifik, kalau tidak screenText.
    const section = audienceChapterName(index, sceneCount);
    if (!chapterTitles.has(section)) {
      // Kegenerikan diperiksa pada teks mentah: simplifyForLayAudience mengubah
      // "Analisis utama" menjadi "penjelasan utama" yang lolos dari filter.
      const raw = cleanText(scene?.chapter || "", 74).replace(/[.!?]+$/g, "").trim();
      const fromAi = isGenericStoryboardText(raw) ? "" : simplifyForLayAudience(raw, 74);
      // screenText scene reaction/summary bukan judul bab yang bermakna
      // ("Ringkasan Inti"), jadi bucket-nya memakai nama bagian.
      const own = sceneType === "image" ? next.screenText : section;
      const label = [fromAi, own, `${section} ${index + 1}`]
        .find((value) => value && !usedChapter.has(textKey(value)));
      usedChapter.add(textKey(label));
      chapterTitles.set(section, label);
    }
    next.chapter = chapterTitles.get(section);
    next.beatPurpose = uniqueBeatPurpose(index, sceneCount, sceneType, next, usedPurpose);

    if (Array.isArray(scene?.visualSegments)) {
      next.visualSegments = scene.visualSegments.map((segment) => ({
        ...segment,
        narrativeContext: simplifyForLayAudience(segment?.narrativeContext || "", 200)
      }));
    }

    return next;
  });

  return polished;
}

/**
 * Bab murni dari posisi scene, jadi urutannya selalu kontigu (maksimal 5 bab).
 * Reaction dan summary sengaja TIDAK dikecualikan: label khusus untuk keduanya
 * memecah satu bab menjadi beberapa entri berlabel sama di daftar bab YouTube.
 */
export function audienceChapterName(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.16) return CHAPTERS[0];
  if (position <= 0.42) return CHAPTERS[1];
  if (position <= 0.68) return CHAPTERS[2];
  if (position <= 0.88) return CHAPTERS[3];
  return CHAPTERS[4];
}

function uniqueScreenText(scene, index, input, used) {
  const raw = scene?.screenText || "";
  const fromNarration = headlineFromText(scene?.narration || "", input.topic || "", index);
  let candidate = simplifyForLayAudience(raw, 90).replace(/[.!?]+$/g, "").trim();

  if (!candidate || isGenericStoryboardText(candidate) || used.has(textKey(candidate))) {
    candidate = fromNarration;
  }

  if (!candidate || isGenericStoryboardText(candidate) || used.has(textKey(candidate))) {
    candidate = SCREEN_FALLBACKS[index % SCREEN_FALLBACKS.length];
  }

  if (used.has(textKey(candidate))) {
    candidate = `${candidate} ${index + 1}`;
  }

  candidate = cleanText(candidate, 74);
  used.add(textKey(candidate));
  return candidate;
}

function uniqueBeatPurpose(index, total, sceneType, scene, used) {
  const fallback = sceneType === "reaction"
    ? "Memberi jeda penasaran sebelum fakta berikutnya."
    : sceneType === "summary"
      ? PURPOSES[4]
      : PURPOSES[Math.min(PURPOSES.length - 1, Math.floor(((index + 1) / Math.max(1, total)) * PURPOSES.length))];
  let purpose = simplifyForLayAudience(scene?.beatPurpose || fallback, 180);

  if (!purpose || used.has(textKey(purpose))) {
    purpose = fallback;
  }
  if (used.has(textKey(purpose))) {
    purpose = `${fallback.replace(/[.!?]+$/g, "")} untuk scene ${index + 1}.`;
  }

  used.add(textKey(purpose));
  return purpose;
}

function uniqueTextList(values, limit, max) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = simplifyForLayAudience(value, max).replace(/[.!?]+$/g, "");
    const key = textKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(/[.!?]$/.test(text) ? text : `${text}.`);
    if (out.length >= limit) break;
  }
  return out.length ? out : ["Poin utama dibuat sederhana agar mudah dipahami."];
}

function headlineFromText(value, topic, index) {
  const source = simplifyForLayAudience(value || topic || "", 500)
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[()"]/g, "");
  const first = source.match(/^[^.!?]+/)?.[0] || source;
  const words = first
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word.toLowerCase()));

  const picked = words.slice(0, 6);
  if (!picked.length) return SCREEN_FALLBACKS[index % SCREEN_FALLBACKS.length];
  return titleCase(cleanText(picked.join(" "), 74));
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function textFingerprint(value) {
  const words = cleanText(value, 500)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return [...new Set(words)].sort().join(" ");
}

function textKey(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function jaccard(a, b) {
  const left = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const right = new Set(String(b || "").split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}
