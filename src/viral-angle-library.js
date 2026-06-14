/**
 * Viral Angle Library - kemasan sudut pandang lintas kategori.
 * Dipakai untuk membuat ide, judul, dan hook terasa lebih klik-able
 * tanpa mengorbankan fakta longform edukasi.
 */

export const VIRAL_ANGLES = [
  {
    id: "hidden-cause",
    label: "penyebab tersembunyi",
    premise: "Bingkai topik sebagai akibat besar yang ternyata digerakkan oleh penyebab kecil atau jarang dibahas.",
    titlePatterns: [
      "Penyebab Tersembunyi di Balik {topic}",
      "Hal Kecil yang Mengubah {topic}",
      "Yang Diam-diam Membentuk {topic}"
    ],
    hookMoves: [
      "Buka dengan akibat besar yang sudah dikenal, lalu ungkap bahwa pemicunya bukan hal yang biasanya disebut.",
      "Mulai dari detail kecil yang terlihat sepele, lalu hubungkan ke dampak besar."
    ]
  },
  {
    id: "costly-mistake",
    label: "kesalahan mahal",
    premise: "Bingkai topik sebagai keputusan, asumsi, atau kelalaian yang memicu kerugian besar.",
    titlePatterns: [
      "Kesalahan Kecil yang Menghancurkan {topic}",
      "Keputusan yang Membuat {topic} Berubah Selamanya",
      "Harga Mahal dari Satu Pilihan Salah"
    ],
    hookMoves: [
      "Buka dengan momen keputusan, lalu tunjukkan akibatnya lebih besar dari yang terlihat.",
      "Kontraskan pilihan yang tampak masuk akal saat itu dengan dampak buruk yang muncul kemudian."
    ]
  },
  {
    id: "domino-effect",
    label: "efek domino",
    premise: "Bingkai topik sebagai rangkaian sebab-akibat: satu peristiwa kecil menyalakan perubahan panjang.",
    titlePatterns: [
      "Satu Peristiwa Kecil yang Mengubah Dunia",
      "Efek Domino yang Dimulai dari {topic}",
      "Bagaimana {topic} Memicu Perubahan Besar"
    ],
    hookMoves: [
      "Buka dari kejadian kecil yang tampak lokal, lalu tarik ke dampak global atau jangka panjang.",
      "Tampilkan rantai tiga akibat cepat agar penonton merasa harus mengikuti alurnya."
    ]
  },
  {
    id: "misunderstood-truth",
    label: "miskonsepsi besar",
    premise: "Bingkai topik sebagai sesuatu yang sering dipahami keliru, tetapi hindari template berulang.",
    titlePatterns: [
      "Hal yang Keliru Dipahami Tentang {topic}",
      "Fakta yang Membalik Cara Kita Melihat {topic}",
      "Ternyata {topic} Tidak Sesederhana Itu"
    ],
    hookMoves: [
      "Buka dengan keyakinan umum yang familiar, lalu patahkan dengan bukti spesifik.",
      "Sebutkan miskonsepsi secara konkret, bukan memakai frasa generik seperti 'semua orang salah'."
    ]
  },
  {
    id: "forbidden-record",
    label: "catatan yang hilang",
    premise: "Bingkai topik sebagai kisah dokumen, bukti, atau detail penting yang lama hilang/diabaikan.",
    titlePatterns: [
      "Catatan Hilang yang Mengubah Cerita {topic}",
      "Petunjuk yang Lama Diabaikan Sejarah",
      "Bukti Kecil yang Membuka Rahasia Lama"
    ],
    hookMoves: [
      "Buka dengan pertanyaan: kenapa bukti penting ini lama tidak dibahas?",
      "Mulai dari dokumen, artefak, rekaman, atau saksi kecil yang mengubah tafsir besar."
    ]
  },
  {
    id: "industry-secret",
    label: "rahasia industri",
    premise: "Bingkai topik sebagai mekanisme tersembunyi di balik produk, pasar, teknologi, atau kebiasaan massal.",
    titlePatterns: [
      "Rahasia Industri di Balik {topic}",
      "Cara {topic} Diam-diam Mengubah Kebiasaan Kita",
      "Mesin Tersembunyi di Balik {topic}"
    ],
    hookMoves: [
      "Buka dari kebiasaan sehari-hari penonton, lalu tarik ke sistem besar di baliknya.",
      "Tunjukkan bahwa yang terlihat sederhana sebenarnya diatur oleh desain, pasar, atau insentif."
    ]
  },
  {
    id: "underdog-force",
    label: "yang diremehkan",
    premise: "Bingkai topik sebagai tokoh, benda, tempat, atau ide kecil yang punya pengaruh jauh lebih besar dari reputasinya.",
    titlePatterns: [
      "Benda Kecil yang Mengubah Sejarah",
      "Tokoh yang Diremehkan Tapi Mengubah Arah {topic}",
      "Kekuatan Diam-diam di Balik {topic}"
    ],
    hookMoves: [
      "Buka dengan sesuatu yang tampak tidak penting, lalu ungkap kontribusinya yang menentukan.",
      "Bandingkan reputasi kecilnya dengan dampak besar yang ditinggalkan."
    ]
  },
  {
    id: "before-after",
    label: "sebelum dan sesudah",
    premise: "Bingkai topik sebagai batas waktu: sebelum kejadian ini dunia berjalan berbeda, setelahnya aturan berubah.",
    titlePatterns: [
      "Sebelum {topic}, Dunia Berjalan Berbeda",
      "Momen yang Membelah Sejarah {topic}",
      "Setelah Ini, Tidak Ada yang Sama Lagi"
    ],
    hookMoves: [
      "Buka dengan perbandingan tajam antara keadaan sebelum dan sesudah.",
      "Tunjukkan satu kebiasaan lama yang mendadak tidak relevan setelah peristiwa utama."
    ]
  },
  {
    id: "unexplained-gap",
    label: "celah yang sulit dijelaskan",
    premise: "Bingkai topik sebagai pertanyaan faktual yang belum punya jawaban sederhana atau masih diperdebatkan.",
    titlePatterns: [
      "Celah Aneh yang Sulit Dijelaskan",
      "Pertanyaan Besar yang Masih Mengganggu Ilmuwan",
      "Bagian dari {topic} yang Masih Membingungkan"
    ],
    hookMoves: [
      "Buka dengan fakta yang seharusnya mudah dijelaskan, tetapi ternyata tidak.",
      "Tampilkan dua penjelasan yang saling bersaing sebelum masuk ke bukti."
    ]
  },
  {
    id: "dangerous-incentive",
    label: "insentif berbahaya",
    premise: "Bingkai topik sebagai sistem yang mendorong orang/perusahaan/negara membuat pilihan berisiko.",
    titlePatterns: [
      "Insentif Berbahaya di Balik {topic}",
      "Kenapa Sistem Ini Mendorong Keputusan Buruk",
      "Saat Aturan Membuat Masalah Makin Besar"
    ],
    hookMoves: [
      "Buka dengan aktor yang tampak salah, lalu jelaskan insentif sistem yang mendorongnya.",
      "Tunjukkan bahwa masalahnya bukan sekadar orang jahat, tapi aturan main yang keliru."
    ]
  }
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function getViralAngleById(id) {
  return VIRAL_ANGLES.find((angle) => angle.id === id) || null;
}

export function pickViralAngle(history = []) {
  const recentIds = new Set(
    history
      .slice(0, 5)
      .map((item) => item.viralAngleId || item.input?.viralAngleId || "")
      .filter(Boolean)
  );
  const candidates = VIRAL_ANGLES.filter((angle) => !recentIds.has(angle.id));
  return pick(candidates.length ? candidates : VIRAL_ANGLES);
}

export function viralAngleSummary(angle) {
  if (!angle) return "";
  return [
    `${angle.label}: ${angle.premise}`,
    `Contoh judul: ${angle.titlePatterns.join(" | ")}`,
    `Gerak hook: ${angle.hookMoves.join(" ")}`
  ].join("\n");
}

export function viralAnglePromptList(angles = VIRAL_ANGLES) {
  return angles
    .map((angle) => `- ${angle.label}: ${angle.premise}`)
    .join("\n");
}
