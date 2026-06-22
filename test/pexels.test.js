// Unit test fungsi murni seleksi semantik & relevansi di src/pexels.js.
// Semua fungsi di bawah tidak menyentuh jaringan/disk — aman diuji langsung.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenizeWords,
  scoreSceneVisualConcreteness,
  clipTitleFromVideo,
  clipRelevanceScore
} from "../src/pexels.js";

test("tokenizeWords: lowercase, buang stopword & kata <3 huruf", () => {
  assert.deepEqual(tokenizeWords("US dollar bills"), ["dollar", "bills"]); // "us" (2 huruf) dibuang
  assert.deepEqual(tokenizeWords("oil barrels and the trade"), ["oil", "barrels", "trade"]);
  assert.deepEqual(tokenizeWords(""), []);
  assert.deepEqual(tokenizeWords(null), []);
});

test("scoreSceneVisualConcreteness: scene konkret > scene abstrak", () => {
  const concrete = { visualKeywords: "oil barrels,stock exchange,gold bars" };
  const abstract = { visualKeywords: "economic crisis,currency diversification,global finance history" };
  assert.ok(
    scoreSceneVisualConcreteness(concrete) > scoreSceneVisualConcreteness(abstract),
    "scene konkret harus berskor lebih tinggi"
  );
});

test("scoreSceneVisualConcreteness: tanpa keyword berskor sangat rendah", () => {
  assert.equal(scoreSceneVisualConcreteness({ visualKeywords: "" }), -5);
  assert.equal(scoreSceneVisualConcreteness({}), -5);
});

test("clipTitleFromVideo: ambil slug dari URL Pexels, buang id numerik", () => {
  assert.equal(
    clipTitleFromVideo({ url: "https://www.pexels.com/video/aerial-view-of-a-city-3209828/" }),
    "aerial view of a city"
  );
  assert.equal(clipTitleFromVideo({ url: "" }), "");
});

test("clipRelevanceScore: hitung overlap kata keyword unik di judul klip", () => {
  const tokens = tokenizeWords("oil barrels,global trade");
  const match = { url: "https://www.pexels.com/video/oil-barrels-in-a-refinery-12345/" };
  const noMatch = { url: "https://www.pexels.com/video/sunset-over-mountains-67890/" };
  assert.equal(clipRelevanceScore(tokens, match), 2); // "oil" + "barrels"
  assert.equal(clipRelevanceScore(tokens, noMatch), 0);
  assert.equal(clipRelevanceScore([], match), 0);
});

test("clipRelevanceScore: kata keyword berulang dihitung sekali", () => {
  const tokens = tokenizeWords("dollar dollar dollar");
  const video = { url: "https://www.pexels.com/video/a-stack-of-dollar-bills-111/" };
  assert.equal(clipRelevanceScore(tokens, video), 1);
});
