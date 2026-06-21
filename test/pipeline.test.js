// Unit test gerbang kesiapan render di src/pipeline.js.
// assertReadyToRender mencegah render jalan saat aset belum lengkap (gagal 409).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadyToRender } from "../src/pipeline.js";

// Bangun item minimal untuk diuji.
function makeItem({ scenes, clips = [], images = [], sceneAudio = [] }) {
  return { plan: { scenes }, assets: { clips, images, sceneAudio } };
}

test("assertReadyToRender: lolos saat tiap scene punya gambar + ada audio", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: klip video memenuhi syarat media (tanpa gambar)", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    clips: [{ sceneIndex: 0, path: "/clip-0.mp4" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: scene 'reaction' tidak butuh media sendiri", () => {
  const item = makeItem({
    scenes: [
      { index: 0, sceneType: "image" },
      { index: 1, sceneType: "reaction" } // tanpa klip/gambar, tetap boleh
    ],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: gagal 409 jika scene wajib tak punya media", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [], // tidak ada media untuk scene 0
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.throws(() => assertReadyToRender(item), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test("assertReadyToRender: entri media dengan path kosong dianggap belum ada → 409", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: null }], // path null = belum siap
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.throws(() => assertReadyToRender(item), (err) => err.status === 409);
});

test("assertReadyToRender: gagal 409 jika tidak ada audio TTS sama sekali", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [] // belum ada audio
  });
  assert.throws(() => assertReadyToRender(item), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});
