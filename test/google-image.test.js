import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  cleanSearchQuery,
  isGoogleImageApiAvailable,
  searchGoogleImages,
  fetchGoogleImageUrl,
  downloadImageWithCandidates
} from "../src/google-image.js";
import { isGoogleLogo } from "../src/news-research.js";

test("cleanSearchQuery: membersihkan tag html, quotes, dan spasi berlebih", () => {
  assert.equal(cleanSearchQuery('<b>"Berita Terkini"</b> Mengenai Danau   Toba'), "Berita Terkini Mengenai Danau Toba");
  assert.equal(cleanSearchQuery(""), "");
  assert.equal(cleanSearchQuery(null), "");
});

test("isGoogleLogo: menerima thumbnail Google Images dan menolak logo Google", () => {
  // Google Images proxy thumbnail sah
  assert.equal(isGoogleLogo("https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR7..."), false);
  // Logo branding Google ditolak
  assert.equal(isGoogleLogo("https://gstatic.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png"), true);
  assert.equal(isGoogleLogo("https://lh3.googleusercontent.com/J69..."), true);
  assert.equal(isGoogleLogo("https://news.google.com/favicon.ico"), true);
});

test("isGoogleImageApiAvailable: mendeteksi ketersediaan API", () => {
  const origCseKey = process.env.GOOGLE_CSE_KEY;
  const origCseCx = process.env.GOOGLE_CSE_CX;
  const origSerper = process.env.SERPER_API_KEY;
  const origSerpApi = process.env.SERPAPI_API_KEY;

  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_CX;
  delete process.env.SERPER_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  assert.equal(isGoogleImageApiAvailable(), false);

  process.env.GOOGLE_CSE_KEY = "test_key";
  process.env.GOOGLE_CSE_CX = "test_cx";
  assert.equal(isGoogleImageApiAvailable(), true);

  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_CX;
  process.env.SERPER_API_KEY = "test_serper";
  assert.equal(isGoogleImageApiAvailable(), true);

  // Restore
  if (origCseKey) process.env.GOOGLE_CSE_KEY = origCseKey; else delete process.env.GOOGLE_CSE_KEY;
  if (origCseCx) process.env.GOOGLE_CSE_CX = origCseCx; else delete process.env.GOOGLE_CSE_CX;
  if (origSerper) process.env.SERPER_API_KEY = origSerper; else delete process.env.SERPER_API_KEY;
  if (origSerpApi) process.env.SERPAPI_API_KEY = origSerpApi; else delete process.env.SERPAPI_API_KEY;
});

test("searchGoogleImages: memfilter SVG/logo dan memetakan kandidat Google CSE", async () => {
  const origKey = process.env.GOOGLE_CSE_KEY;
  const origCx = process.env.GOOGLE_CSE_CX;
  process.env.GOOGLE_CSE_KEY = "dummy_key";
  process.env.GOOGLE_CSE_CX = "dummy_cx";

  const mockFetch = async (urlStr) => {
    const url = new URL(urlStr);
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.searchParams.get("searchType"), "image");
    assert.equal(url.searchParams.get("key"), "dummy_key");
    assert.equal(url.searchParams.get("cx"), "dummy_cx");

    return {
      ok: true,
      json: async () => ({
        items: [
          {
            title: "Logo Google",
            link: "https://gstatic.com/images/branding/googlelogo/1x/logo.png"
          },
          {
            title: "Icon SVG",
            link: "https://example.com/icon.svg"
          },
          {
            title: "Foto Berita Danau Toba",
            link: "https://asset.kompas.com/crops/123/danau-toba.jpg",
            displayLink: "kompas.com",
            image: {
              contextLink: "https://travel.kompas.com/read/123",
              thumbnailLink: "https://encrypted-tbn0.gstatic.com/images?q=tbn:sample",
              width: 1200,
              height: 800
            }
          }
        ]
      })
    };
  };

  const results = await searchGoogleImages("Danau Toba", { fetchImpl: mockFetch });
  assert.equal(results.length, 1);
  assert.equal(results[0].imageUrl, "https://asset.kompas.com/crops/123/danau-toba.jpg");
  assert.equal(results[0].source, "kompas.com");
  assert.equal(results[0].thumbnail, "https://encrypted-tbn0.gstatic.com/images?q=tbn:sample");
  assert.equal(results[0].width, 1200);

  if (origKey) process.env.GOOGLE_CSE_KEY = origKey; else delete process.env.GOOGLE_CSE_KEY;
  if (origCx) process.env.GOOGLE_CSE_CX = origCx; else delete process.env.GOOGLE_CSE_CX;
});

test("downloadImageWithCandidates: fallback ke kandidat berikutnya atau thumbnail bila hotlink diblokir (403)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "google-img-test-"));
  const destFile = path.join(tmpDir, "test-news.jpg");

  let reqCount = 0;
  const mockFetch = async (url) => {
    reqCount++;
    if (url === "https://blocked-cdn.com/foto.jpg") {
      return { ok: false, status: 403 }; // 403 Forbidden hotlink protection
    }
    if (url === "https://encrypted-tbn0.gstatic.com/images?q=tbn:ok") {
      const { Readable } = await import("node:stream");
      return {
        ok: true,
        status: 200,
        body: Readable.from([Buffer.from("FAKE_IMAGE_BYTES")])
      };
    }
    return { ok: false, status: 404 };
  };

  const candidates = [
    {
      imageUrl: "https://blocked-cdn.com/foto.jpg",
      thumbnail: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ok",
      title: "Berita Penting",
      source: "media.com"
    }
  ];

  const result = await downloadImageWithCandidates(candidates, destFile, { fetchImpl: mockFetch });
  assert.equal(result.success, true);
  assert.equal(result.url, "https://encrypted-tbn0.gstatic.com/images?q=tbn:ok");

  const written = await fs.readFile(destFile, "utf8");
  assert.equal(written, "FAKE_IMAGE_BYTES");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("searchGoogleImages: Round-Robin rotasi kunci Serper dan auto-failover saat kredit habis", async () => {
  const origSerper = process.env.SERPER_API_KEY;
  const origCseKey = process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_KEY;
  process.env.SERPER_API_KEY = "key_habis,key_aktif";

  const calls = [];
  const mockFetch = async (urlStr, init) => {
    const key = init?.headers?.["X-API-KEY"];
    calls.push(key);
    if (key === "key_habis") {
      return { ok: false, status: 403 }; // Kredit habis
    }
    return {
      ok: true,
      json: async () => ({
        images: [
          {
            imageUrl: "https://media.com/foto.jpg",
            title: "Foto Berita",
            source: "media.com"
          }
        ]
      })
    };
  };

  const res = await searchGoogleImages("Berita Baru", { fetchImpl: mockFetch });
  assert.equal(res.length, 1);
  assert.equal(res[0].imageUrl, "https://media.com/foto.jpg");
  assert.ok(calls.includes("key_habis"));
  assert.ok(calls.includes("key_aktif"));

  if (origSerper) process.env.SERPER_API_KEY = origSerper; else delete process.env.SERPER_API_KEY;
  if (origCseKey) process.env.GOOGLE_CSE_KEY = origCseKey; else delete process.env.GOOGLE_CSE_KEY;
});
