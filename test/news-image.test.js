import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureNewsImages, scrapeOgImage, applyNewsImageOverlays } from "../src/news-image.js";

test("ensureNewsImages: memakai fallback gambar scene saat imageUrl tidak ada (Tab Buat)", async () => {
  const origSerper = process.env.SERPER_API_KEY;
  const origCseKey = process.env.GOOGLE_CSE_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.GOOGLE_CSE_KEY;

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
    if (origSerper) process.env.SERPER_API_KEY = origSerper;
    if (origCseKey) process.env.GOOGLE_CSE_KEY = origCseKey;
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

test("applyNewsImageOverlays: animasi slide masuk dari bawah, rapat ke batas bawah, dan slide keluar ke bawah", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-anim-"));
  const fakeImg = path.join(tmpDir, "news-pic.jpg");
  const inVideo = path.join(tmpDir, "input.mp4");
  const outVideo = path.join(tmpDir, "output.mp4");
  await fs.writeFile(fakeImg, "dummy image");
  await fs.writeFile(inVideo, "dummy video");

  const item = {
    assets: {
      newsImages: [
        { sceneIndex: 1, outlet: "CNN", headline: "Berita", imagePath: fakeImg }
      ]
    }
  };

  const renderScenes = [
    { index: 1, startSec: 0, endSec: 10 }
  ];

  const capturedCalls = [];
  const mockRunFfmpeg = async (args) => {
    capturedCalls.push(args);
  };

  try {
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg);
    assert.equal(capturedCalls.length, 2, "Harus membuat clip mockup MOV lalu overlay ke MP4");

    // 1. Periksa pembuatan clip mockup:
    // - chromakey diaplikasikan pada template [1:v] TERLEBIH DAHULU sebelum overlay konten
    // - tidak ada filter fade in / fade out
    const clipCall = capturedCalls[0];
    const clipFilter = clipCall[clipCall.indexOf("-filter_complex") + 1];
    assert.ok(clipFilter.includes("chromakey=color="), "Harus memuat chromakey");
    assert.ok(clipFilter.includes("despill=green"), "Harus memuat despill");
    assert.ok(clipFilter.includes("[tmpl_keyed][content]overlay="), "Harus meng-overlay konten ke template yang sudah di-key");
    assert.ok(!clipFilter.includes("fade=t=in"), "TIDAK BOLEH memuat fade in pada mockup");
    assert.ok(!clipFilter.includes("fade=t=out"), "TIDAK BOLEH memuat fade out pada mockup");

    // 2. Periksa overlay ke video utama:
    // - Y position rapat ke batas layar bawah (H - overlay_h)
    // - Menggunakan ekspresi animasi slide masuk dan slide keluar
    const overlayCall = capturedCalls[1];
    const overlayFilter = overlayCall[overlayCall.indexOf("-filter_complex") + 1];
    assert.ok(overlayFilter.includes("H-overlay_h"), "Mockup harus rapat ke batas layar bawah");
    assert.ok(overlayFilter.includes("cos(PI*"), "Animasi harus menggunakan cosine slide easing");
    assert.ok(overlayFilter.includes("overlay=x='(W-overlay_w)/2':y='if(lte(t,"), "Overlay harus menggunakan ekspresi slide dinamis");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

