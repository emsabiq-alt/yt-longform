import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";
import { requestKnowledgeJson } from "./openai.js";

export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });

  console.log(`[Thumbnail] Menghasilkan prompt thumbnail dramatis untuk: "${item.title}"...`);

  const promptText = `Pahami topik video berikut: "${item.title}".
Kategori: "${item.input?.category || 'umum'}".
Ringkasan naskah: "${item.plan?.summary || item.plan?.hook || ''}".
Buat rincian visual untuk prompt gambar DALL-E 3 pembuat thumbnail YouTube bergaya premium investigasi dokumenter misteri.
Kembalikan JSON dengan struktur berikut:
{
  "judul": "Teks judul singkat bahasa Indonesia, maksimal 5-6 kata, kapital semua, membagi kata kunci utama untuk kontras (misal: 'MISTERI AWAL KEHANCURAN RAJA BISNIS FOTO DUNIA' atau 'MISTERI DI KEDALAMAN SAMUDRA')",
  "temaUtama": "Deskripsi singkat latar belakang atmosfer/tema visual dramatis & sinematik (bahasa Inggris, cth: 'a dark mysterious underwater trench with deep ocean abyss')",
  "elemenVisual": [
    "Elemen visual detail 1 (bahasa Inggris, cth: 'a deep-sea submarine with glowing searchlights')",
    "Elemen visual detail 2 (bahasa Inggris, cth: 'ancient underwater rock formations and cracks')",
    "Elemen visual detail 3 (bahasa Inggris, cth: 'subtle glowing hydrothermal vents in the background')",
    "Elemen visual detail 4 (bahasa Inggris, cth: 'dust particles floating in dark water')",
    "Elemen visual detail 5 (bahasa Inggris, cth: 'dramatic volumetric shafts of light coming from above')"
  ]
}`;

  let visualDetails;
  try {
    visualDetails = await requestKnowledgeJson(promptText);
  } catch (error) {
    console.warn("[Thumbnail] Gagal generate detail prompt via LLM, menggunakan fallback:", error.message);
    visualDetails = {
      judul: String(item.title).toUpperCase(),
      temaUtama: `cinematic illustration of the topic ${item.title}`,
      elemenVisual: [
        "cinematic lighting",
        "detailed atmospheric textures",
        "mysterious elements",
        "dramatic shadows",
        "smoke and particles"
      ]
    };
  }

  const judul = visualDetails.judul || String(item.title).toUpperCase();
  const temaUtama = visualDetails.temaUtama || `cinematic illustration of ${item.title}`;
  const ev = visualDetails.elemenVisual || [];
  const ev1 = ev[0] || "cinematic lighting";
  const ev2 = ev[1] || "high contrast details";
  const ev3 = ev[2] || "mysterious smoke";
  const ev4 = ev[3] || "dust particles";
  const ev5 = ev[4] || "glowing accent highlights";

  const dallEPrompt = `Create a dramatic cinematic YouTube thumbnail in 16:9 aspect ratio with a dark, mysterious, premium investigative documentary style.

Use a strong, clean composition:
- large bold Indonesian headline text on the left or center-left
- detailed cinematic topic illustration on the right
- dark premium background
- high contrast
- strong visual storytelling
- clickable documentary-style look

Title text:
"${judul}"

Typography:
very large bold distressed uppercase letters, sharp and readable, white for the main words, yellow/gold for the strongest emphasis words, dramatic shadow, subtle glow, stacked layout, mobile-readable.

Main visual theme:
${temaUtama}

Visual elements:
- ${ev1}
- ${ev2}
- ${ev3}
- ${ev4}
- ${ev5}

Style direction:
cinematic, mysterious, investigative, educational, premium YouTube thumbnail, dark elegant atmosphere, realistic details, dramatic lighting, smoke, dust particles, textured shadows, glowing accents, strong contrast, polished composition.

Composition:
Make the title dominant and easy to read. Make the topic instantly understandable through symbolic objects and cinematic illustration. Keep the visual clean, dramatic, and professional.

Negative prompt:
no watermark, no logo, no unreadable text, no random letters, no subtitles, no blurry image, no messy composition, no distorted objects, no low quality, no cartoon style, no childish animation, no weak contrast, no flat lighting, no excessive clutter`;

  console.log(`[Thumbnail] Mengirim request gambar DALL-E dengan prompt: "${dallEPrompt.slice(0, 150)}..."`);

  // Kirim request ke OpenAI Images API
  const response = await fetch(`${config.openai.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openai.imageModel || "gpt-image-2",
      prompt: dallEPrompt,
      size: "1792x1024", // 16:9 landscape HD resolution
      quality: config.openai.imageQuality || "low",
      n: 1
    })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const generated = data.data?.[0];
  if (!generated) throw new Error("OpenAI tidak mengembalikan gambar thumbnail.");

  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);
  const rawFilename = `${item.id}-thumbnail-${safeFilename(item.title)}-raw.png`;
  const rawPath = path.join(paths.workDir, rawFilename);

  if (generated.b64_json) {
    await fs.writeFile(rawPath, Buffer.from(generated.b64_json, "base64"));
  } else if (generated.url) {
    const imageRes = await fetch(generated.url);
    if (!imageRes.ok) throw new Error(`Gagal download thumbnail: HTTP ${imageRes.status}`);
    await fs.writeFile(rawPath, Buffer.from(await imageRes.arrayBuffer()));
  } else {
    throw new Error("Format response image thumbnail tidak dikenali.");
  }

  await optimizeImage(rawPath, outputPath);
  await fs.rm(rawPath, { force: true });

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider: "openai-dalle-cinematic"
  };
}

function optimizeImage(inputPath, outputPath) {
  let scaleCrop = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", scaleCrop,
      "-frames:v", "1",
      "-q:v", "4",
      outputPath
    ], { windowsHide: true, cwd: paths.rootDir });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Optimasi gambar thumbnail gagal (${code})`));
    });
  });
}
