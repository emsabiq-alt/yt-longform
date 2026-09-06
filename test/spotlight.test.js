import { test } from "node:test";
import assert from "node:assert/strict";
import { planSceneSpotlights, normalizeSpotlight, spotlightDialogueLines } from "../src/spotlight.js";
import { buildWordTimeline, findPhraseTime, tokenizeMatchText } from "../src/word-timeline.js";
import { polishPlanForLayAudience } from "../src/story-language.js";

function words(list, start = 0, step = 0.5) {
  return list.map((word, i) => ({ word, start: start + i * step, end: start + (i + 1) * step }));
}

function scene(overrides = {}) {
  return {
    index: 1,
    sceneType: "image",
    startSec: 0,
    durationSec: 20,
    sceneCaptions: [{
      start: 0,
      end: 5,
      text: "kecepatan suara mencapai seribu dua ratus kilometer per jam di udara",
      words: words(["kecepatan", "suara", "mencapai", "seribu", "dua", "ratus", "kilometer", "per", "jam", "di", "udara"])
    }],
    spotlight: { type: "keypoint", label: "1.200 km/jam", sublabel: "kecepatan suara", phrase: "seribu dua ratus kilometer" },
    ...overrides
  };
}

test("buildWordTimeline memakai timestamp kata asli bila tersedia", () => {
  const timeline = buildWordTimeline([{
    start: 0,
    end: 10,
    text: "satu dua tiga",
    words: [{ word: "satu", start: 0.2, end: 0.4 }, { word: "dua", start: 4.0, end: 4.3 }, { word: "tiga", start: 9.1, end: 9.4 }]
  }]);
  assert.deepEqual(timeline.map((entry) => entry.token), ["satu", "dua", "tiga"]);
  // Interpolasi rata akan menaruh "dua" di detik 3.33; timestamp asli 4.0.
  assert.equal(timeline[1].time, 4.0);
});

test("buildWordTimeline jatuh ke interpolasi saat tidak ada timestamp kata", () => {
  const timeline = buildWordTimeline([{ start: 0, end: 3, text: "satu dua tiga" }]);
  assert.equal(timeline.length, 3);
  assert.equal(timeline[1].time, 1);
});

test("spotlight ditempatkan pada waktu frasa benar-benar diucapkan", () => {
  const placed = planSceneSpotlights([scene()]);
  assert.equal(placed.length, 1);
  // "seribu" mulai di detik 1.5 (kata ke-4), dikurangi lead-in 0.12.
  assert.ok(Math.abs(placed[0].startSec - 1.38) < 0.01, `startSec=${placed[0].startSec}`);
  assert.ok(placed[0].score >= 0.6);
});

test("spotlight dibatalkan saat frasa tidak ada di audio", () => {
  const placed = planSceneSpotlights([scene({
    spotlight: { type: "keypoint", label: "X", phrase: "gravitasi bulan menarik lautan" }
  })]);
  assert.deepEqual(placed, []);
});

test("kuota per video dan jarak minimum ditegakkan", () => {
  const many = Array.from({ length: 6 }, (_, i) => scene({
    index: i + 1,
    startSec: i * 30,
    durationSec: 30
  }));
  const placed = planSceneSpotlights(many);
  assert.ok(placed.length <= 4, `terlalu banyak kartu: ${placed.length}`);
  for (let i = 1; i < placed.length; i += 1) {
    assert.ok(placed[i].startSec - placed[i - 1].startSec >= 25);
  }
});

test("scene reaction dan summary tidak pernah dapat kartu", () => {
  assert.deepEqual(planSceneSpotlights([scene({ sceneType: "reaction" }), scene({ sceneType: "summary" })]), []);
});

test("kartu dipotong di akhir scene, bukan menyeberang", () => {
  const placed = planSceneSpotlights([scene({ durationSec: 4 })]);
  assert.equal(placed.length, 1);
  assert.ok(placed[0].endSec <= 4 + 1e-6, `endSec=${placed[0].endSec}`);
});

test("kartu dibatalkan bila sisa scene terlalu pendek untuk dibaca", () => {
  assert.deepEqual(planSceneSpotlights([scene({ durationSec: 2.6 })]), []);
});

test("normalizeSpotlight menolak data tanpa label atau frasa", () => {
  assert.equal(normalizeSpotlight({ label: "A" }), null);
  assert.equal(normalizeSpotlight({ phrase: "satu dua tiga" }), null);
  assert.equal(normalizeSpotlight({ label: "A", phrase: "satu dua", type: "aneh" }).type, "keypoint");
});

test("baris ASS memakai style Spotlight dan waktu kartu", () => {
  const lines = spotlightDialogueLines(
    [{ startSec: 1, endSec: 4, label: "Label", sublabel: "Sub", type: "keypoint" }],
    (start, end, style, text) => `${style}|${start}|${end}|${text}`,
    (value) => value
  );
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.startsWith("Spotlight")));
  assert.ok(lines.some((line) => line.includes("Label")));
});

test("spotlight dibuang bila narasi final tidak lagi memuat frasanya", () => {
  const polished = polishPlanForLayAudience({
    title: "T",
    scenes: [{
      sceneType: "image",
      narration: "Air laut menutupi sebagian besar permukaan bumi.",
      screenText: "Lautan",
      spotlight: { type: "keypoint", label: "X", phrase: "kecepatan cahaya di ruang hampa" }
    }]
  }, { topic: "bumi" });
  assert.equal(polished.scenes[0].spotlight, null);
});

test("findPhraseTime memberi skor penuh untuk frasa yang cocok persis", () => {
  const timeline = buildWordTimeline([{ start: 0, end: 3, text: "alpha beta gamma delta" }]);
  const match = findPhraseTime(timeline, tokenizeMatchText("beta gamma"));
  assert.equal(match.score, 1);
});
