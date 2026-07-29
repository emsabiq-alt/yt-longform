import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentDurations } from "../src/longform-render.js";

// Helper: scene 20 detik dengan 4 visualSegments dan caption Whisper per bagian.
// Narasi: pembuka (0-5s), inti a (5-10s), inti b (10-15s), penutup (15-20s).
function makeSyncedScene() {
  return {
    durationSec: 20,
    visualSegments: [
      { narrativeContext: "kapal besi pertama diluncurkan" },
      { narrativeContext: "hukum archimedes menjelaskan gaya angkat" },
      { narrativeContext: "rongga udara di dalam lambung" },
      { narrativeContext: "kapal modern mengangkut ribuan kontainer" }
    ],
    sceneCaptions: [
      { start: 0, end: 5, text: "Saat kapal besi pertama diluncurkan banyak orang yakin benda itu pasti tenggelam" },
      { start: 5, end: 10, text: "Namun hukum Archimedes menjelaskan gaya angkat yang bekerja pada benda di air" },
      { start: 10, end: 15, text: "Kuncinya ada pada rongga udara di dalam lambung yang membuat kepadatan turun" },
      { start: 15, end: 20, text: "Berkat prinsip itu kapal modern mengangkut ribuan kontainer melintasi samudra" }
    ]
  };
}

test("computeSegmentDurations menyelaraskan batas segmen dengan waktu frasa diucapkan", () => {
  const durations = computeSegmentDurations(makeSyncedScene(), 4);
  assert.equal(durations.length, 4);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05, `total harus ~20, dapat ${total}`);
  // Frasa segmen 2 ("hukum archimedes...") mulai ~5.35s (kata ke-2 caption kedua),
  // jadi durasi segmen 1 harus mendekati 5, bukan pembagian rata biasa yang kebetulan sama.
  assert.ok(durations[0] > 4 && durations[0] < 6.5, `durasi segmen 1: ${durations[0]}`);
  assert.ok(durations.every((d) => d > 1), "tiap segmen minimal > 1 detik");
});

test("computeSegmentDurations mengikuti frasa yang tidak di posisi rata", () => {
  const scene = makeSyncedScene();
  // Geser frasa segmen 2 ke caption pertama (awal audio) → segmen 1 jadi pendek.
  scene.visualSegments[1].narrativeContext = "banyak orang yakin";
  const durations = computeSegmentDurations(scene, 4);
  assert.ok(durations[0] < 4, `segmen 1 harus lebih pendek dari pembagian rata, dapat ${durations[0]}`);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05);
});

test("computeSegmentDurations fallback ke pembagian rata tanpa captions", () => {
  const scene = makeSyncedScene();
  scene.sceneCaptions = [];
  const durations = computeSegmentDurations(scene, 4);
  assert.deepEqual(durations, [5, 5, 5, 5]);
});

test("computeSegmentDurations fallback rata saat narrativeContext tidak cocok", () => {
  const scene = makeSyncedScene();
  scene.visualSegments = scene.visualSegments.map(() => ({ narrativeContext: "frasa fiktif zeppelin quantum" }));
  const durations = computeSegmentDurations(scene, 4);
  // Tidak ada frasa yang cocok → semua batas memakai posisi rata.
  assert.deepEqual(durations, [5, 5, 5, 5]);
});

test("computeSegmentDurations menjaga urutan monoton saat frasa tumpang tindih", () => {
  const scene = makeSyncedScene();
  // Segmen 3 memakai frasa yang lebih awal dari segmen 2 → harus dikoreksi monoton.
  scene.visualSegments[2].narrativeContext = "kapal besi pertama diluncurkan";
  const durations = computeSegmentDurations(scene, 4);
  assert.equal(durations.length, 4);
  assert.ok(durations.every((d) => d > 0.5), `semua durasi positif dan wajar: ${durations}`);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05);
});

test("computeSegmentDurations aman untuk 1 segmen dan durasi nol", () => {
  assert.deepEqual(computeSegmentDurations({ durationSec: 12 }, 1), [12]);
  assert.deepEqual(computeSegmentDurations({ durationSec: 0, visualSegments: [] }, 4), [0]);
});
