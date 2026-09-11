import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureNewsImages, scrapeOgImage } from "../src/news-image.js";

test("ensureNewsImages: memakai fallback gambar scene saat imageUrl tidak ada (Tab Buat)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-test-"));
  const fakeImgPath = path.join(tmpDir, "scene-2.jpg");
  await fs.writeFile(fakeImgPath, "fake image data");

  const item = {
    plan: {
      scenes: [
        { index: 1, sceneType: "image", screenText: "Hook" },
        { index: 2, sceneType: "image", screenText: "Pembahasan utama", mediaSource: { outlet: "Jurnal Sains", headline: "Temuan Baru" } },
        { index: 3, sceneType: "image", screenText: "Penutup" }
      ]
    },
    input: { topic: "Eksplorasi Luar Angkasa" },
    assets: {
      images: [
        { sceneIndex: 2, path: fakeImgPath }
      ]
    }
  };

  try {
    await ensureNewsImages(item);
    assert.equal(item.assets.newsImages.length, 1);
    assert.equal(item.assets.newsImages[0].sceneIndex, 2);
    assert.equal(item.assets.newsImages[0].imagePath, fakeImgPath);
    assert.equal(item.assets.newsImages[0].outlet, "Jurnal Sains");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("ensureNewsImages: memilih kandidat scene otomatis jika mediaSource tidak disertakan", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-auto-"));
  const fakeImg1 = path.join(tmpDir, "scene-1.jpg");
  const fakeImg2 = path.join(tmpDir, "scene-2.jpg");
  await fs.writeFile(fakeImg1, "fake image 1");
  await fs.writeFile(fakeImg2, "fake image 2");

  const item = {
    plan: {
      scenes: [
        { index: 1, sceneType: "image", screenText: "Intro" },
        { index: 2, sceneType: "image", screenText: "Fakta 1" },
        { index: 3, sceneType: "image", screenText: "Fakta 2" }
      ]
    },
    input: { topic: "Teknologi AI" },
    assets: {
      images: [
        { sceneIndex: 1, path: fakeImg1 },
        { sceneIndex: 2, path: fakeImg2 }
      ]
    }
  };

  try {
    await ensureNewsImages(item);
    assert.ok(item.assets.newsImages.length >= 1, "Harus memilih minimal 1 scene kandidat");
    assert.ok(item.assets.newsImages[0].imagePath, "imagePath harus terisi dengan fallback");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
