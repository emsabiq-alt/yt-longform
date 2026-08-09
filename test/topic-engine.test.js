import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { parseDeepSeekJson } from "../src/deepseek.js";
import { fallbackTitle, generateViralTitle, pickBestTitle } from "../src/title-engine.js";
import { isSpaceQuotaDue } from "../src/topic-engine.js";

const space = () => ({ category: "luar angkasa" });
const other = () => ({ category: "teknologi" });

test("isSpaceQuotaDue: memprioritaskan space saat arsip masih kosong", () => {
  assert.equal(isSpaceQuotaDue([]), true);
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
