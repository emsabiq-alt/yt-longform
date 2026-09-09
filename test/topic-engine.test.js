import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { parseDeepSeekJson } from "../src/deepseek.js";
import { fallbackTitle, generateViralTitle, pickBestTitle, titleBonus, DEFAULT_TITLE_PATTERNS } from "../src/title-engine.js";
import { createTrendFallbackIdeas, isSpaceQuotaDue } from "../src/topic-engine.js";
import { parseGoogleTrendsRss, parseTrendTraffic } from "../src/google-trends.js";
import { findSustainedNewsTopics, parseGoogleNewsRss } from "../src/google-news-trends.js";
import { checkFreshness } from "../src/continuity-engine.js";

const space = () => ({ category: "luar angkasa" });
const other = () => ({ category: "teknologi" });

test("isSpaceQuotaDue: memprioritaskan space saat arsip masih kosong", () => {
  assert.equal(isSpaceQuotaDue([]), true);
});

test("Google Trends RSS: memilih trafik terbesar tanpa API key", () => {
  const rss = `<rss><channel>
    <item><title>Tren kecil</title><ht:approx_traffic>500+</ht:approx_traffic></item>
    <item><title><![CDATA[Tren &amp; terbesar]]></title><ht:approx_traffic>2K+</ht:approx_traffic><ht:news_item_title>Berita terkait</ht:news_item_title></item>
  </channel></rss>`;
  assert.equal(parseTrendTraffic("1,000+"), 1000);
  assert.deepEqual(parseGoogleTrendsRss(rss).map((item) => item.title), ["Tren & terbesar", "Tren kecil"]);
});

test("Google News RSS: hanya memilih isu yang bertahan beberapa hari dan media", () => {
  const articles = [
    ["Gunung Anak Krakatau kembali erupsi", "Media A", "Mon, 07 Sep 2026 01:00:00 GMT"],
    ["Aktivitas Gunung Anak Krakatau terus dipantau", "Media B", "Mon, 07 Sep 2026 05:00:00 GMT"],
    ["Dampak erupsi Gunung Anak Krakatau meluas", "Media C", "Tue, 08 Sep 2026 01:00:00 GMT"],
    ["Gunung Anak Krakatau dan sebaran abu vulkanik", "Media D", "Tue, 08 Sep 2026 05:00:00 GMT"],
    ["Status Gunung Anak Krakatau hari ini", "Media E", "Wed, 09 Sep 2026 01:00:00 GMT"],
    ["Skor pertandingan sesaat", "Media A", "Wed, 09 Sep 2026 02:00:00 GMT"]
  ];
  const rss = `<rss><channel>${articles.map(([title, source, date]) =>
    `<item><title>${title}</title><source>${source}</source><pubDate>${date}</pubDate><link>https://example.com</link></item>`
  ).join("")}</channel></rss>`;
  const topics = findSustainedNewsTopics(parseGoogleNewsRss(rss));
  assert.equal(topics[0].title, "Gunung Anak Krakatau");
  assert.equal(topics[0].days, 3);
  assert.equal(topics[0].sources, 5);
  assert.ok(!topics.some((topic) => topic.title.includes("Pertandingan")));
});

test("continuity: tren sama boleh memakai angle baru tetapi bukan judul identik", () => {
  const history = [{ topic: "Sejarah AEK Athena yang Jarang Diketahui", title: "Sejarah AEK Athena yang Jarang Diketahui" }];
  assert.equal(checkFreshness({
    topic: "Mengapa Strategi AEK Athena Sulit Ditebak Lawan",
    title: "Mengapa Strategi AEK Athena Sulit Ditebak Lawan"
  }, history, { allowRepeatedSubject: true }).isFresh, true);
  assert.equal(checkFreshness({
    topic: history[0].topic,
    title: history[0].title
  }, history, { allowRepeatedSubject: true }).isFresh, false);
});

test("fallback tren: tetap membuat beberapa angle terkait tanpa provider AI", () => {
  const ideas = createTrendFallbackIdeas({ title: "AEK Athena F.C.", newsTitle: "Laga Liga Champions" });
  assert.equal(ideas.length, 8);
  assert.ok(ideas.every((idea) => idea.topic.includes("AEK Athena F.C.")));
  assert.equal(new Set(ideas.map((idea) => idea.topic)).size, 8);
  assert.ok(ideas.every((idea) => !/hari ini|viral|mendadak/i.test(idea.topic)));
});

test("isSpaceQuotaDue: mengejar target 70 persen pada rolling window", () => {
  const previousRatio = config.topic.spaceTargetRatio;
  const previousWindow = config.topic.categoryHistoryWindow;
  config.topic.spaceTargetRatio = 0.7;
  config.topic.categoryHistoryWindow = 10;
  try {
    assert.equal(isSpaceQuotaDue([
      space(), space(), space(), space(), space(), space(), space(), other(), other(), other()
    ]), true);
    assert.equal(isSpaceQuotaDue([
      space(), space(), space(), space(), space(), space(), space(), space(), other(), other()
    ]), false);
  } finally {
    config.topic.spaceTargetRatio = previousRatio;
    config.topic.categoryHistoryWindow = previousWindow;
  }
});

test("parseDeepSeekJson: menerima JSON fenced dan teks pembungkus", () => {
  assert.deepEqual(parseDeepSeekJson("Berikut hasilnya:\n```json\n{\"titles\":[\"Kenapa Bintang Bersinar?\"]}\n```"), {
    titles: ["Kenapa Bintang Bersinar?"]
  });
});

test("fallbackTitle: selalu menghasilkan judul saat input dan plan kosong", () => {
  assert.equal(fallbackTitle({}, { category: "luar angkasa" }), "Kenapa Luar Angkasa Masih Menyimpan Banyak Misteri");
  assert.match(fallbackTitle({}, {}), /Fakta Menarik/);
});

test("generateViralTitle: fallback lokal tetap tersedia tanpa provider AI", async () => {
  const previousOpenAiKey = config.openai.apiKey;
  const previousDeepSeekKey = config.deepseek.apiKey;
  config.openai.apiKey = "";
  config.deepseek.apiKey = "";
  try {
    const title = await generateViralTitle({}, { category: "luar angkasa" });
    assert.equal(title, "Kenapa Luar Angkasa Masih Menyimpan Banyak Misteri");
  } finally {
    config.openai.apiKey = previousOpenAiKey;
    config.deepseek.apiKey = previousDeepSeekKey;
  }
});

test("pickBestTitle: memakai qualityScore dari kandidat DeepSeek", () => {
  const title = pickBestTitle([
    { title: "Kenapa Madu Tidak Pernah Basi", qualityScore: 93 },
    { title: "Bagaimana Kompas Menunjuk Utara", qualityScore: 71 }
  ]);
  assert.equal(title, "Kenapa Madu Tidak Pernah Basi");
});

test("DEFAULT_TITLE_PATTERNS: contoh di prompt patuh pada aturan yang diminta ke AI", () => {
  for (const example of DEFAULT_TITLE_PATTERNS) {
    assert.ok(example.length <= 65, `contoh "${example}" (${example.length} char) melebihi batas potong YouTube`);
  }
  const questionOpeners = DEFAULT_TITLE_PATTERNS
    .filter((example) => /^(kenapa|mengapa|bagaimana)\b/i.test(example));
  assert.ok(
    questionOpeners.length <= DEFAULT_TITLE_PATTERNS.length / 2,
    `contoh judul masih didominasi pertanyaan (${questionOpeners.length}/${DEFAULT_TITLE_PATTERNS.length})`
  );
});

test("titleBonus: judul dengan angka, ketegangan, dan subjek dinilai lebih tinggi", () => {
  const rich = titleBonus("Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman", ["madu"], new Set());
  const bland = titleBonus("Penjelasan Lengkap Soal Pengawetan Alami", ["madu"], new Set());
  assert.ok(rich > bland, `bonus judul berdetail (${rich}) harus di atas judul kabur (${bland})`);
});

test("pickBestTitle: detail terukur mengalahkan skor AI yang lebih tinggi tapi kabur", () => {
  const title = pickBestTitle([
    { title: "Alasan Madu Bertahan Sangat Lama di Dalam Wadah Tertutup", qualityScore: 88 },
    { title: "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan", qualityScore: 80 }
  ], { subject: "madu" });
  assert.equal(title, "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan");
});

test("pickBestTitle: pembuka yang sama dengan video terakhir dihindari", () => {
  const recentOpeners = new Set(["kenapa madu"]);
  const title = pickBestTitle([
    { title: "Kenapa Madu Tidak Pernah Basi Meski Disimpan Ribuan Tahun", qualityScore: 90 },
    { title: "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan", qualityScore: 82 }
  ], { subject: "madu", recentOpeners });
  assert.equal(title, "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan");
});
