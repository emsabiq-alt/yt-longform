import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { registerFont, decodeJPEGFromStream, encodeJPEGToStream } from "pureimage";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";
import { requestKnowledgeJson } from "./openai.js";

/**
 * Menggambar teks judul di atas thumbnail menggunakan pureimage.
 * Menghasilkan teks putih tebal dengan outline hitam tebal di tengah atas (seperti contoh).
 */
async function applyTextOverlay(filePath, text) {
  if (!text) return;
  
  console.log(`[Thumbnail] Menempelkan teks overlay lokal: "${text}"`);
  
  // Register & load font Bebas Neue dari assets
  const fontPath = path.join(paths.fontDir, "BebasNeue-Regular.ttf");
  const font = registerFont(fontPath, "Bebas Neue");
  await font.load();
  
  // Decode gambar JPEG hasil kompresi/optimasi
  let bitmap;
  const readStream = createReadStream(filePath);
  try {
    bitmap = await decodeJPEGFromStream(readStream);
  } finally {
    readStream.close();
  }
  
  const ctx = bitmap.getContext("2d");
  const width = bitmap.width;
  
  ctx.font = "80pt 'Bebas Neue'";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  
  // Split teks menjadi beberapa baris jika terlalu panjang
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let currentLine = "";
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    // Pada font 80pt dan lebar 1280px, batas aman baris sekitar 15 karakter
    if (testLine.length > 15) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  // Maksimal 2 baris agar komposisi visual tetap bersih
  const finalLines = lines.slice(0, 2);
  
  const lineHeight = 95;
  const lineGap = 15;
  
  // Y start coordinate (kita posisikan di atas agar mirip gaya contoh yang diberikan)
  let currentY = 55;
  
  for (const line of finalLines) {
    const x = width / 2;
    const y = currentY;
    
    // 1. Gambar stroke outline hitam tebal (strokeText) agar teks pop-out di semua background
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    ctx.strokeText(line, x, y);
    
    // 2. Gambar fill teks putih bersih (fillText)
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, x, y);
    
    currentY += lineHeight + lineGap;
  }
  
  // Encode kembali ke file JPEG dengan quality 95
  const writeStream = createWriteStream(filePath);
  try {
    await encodeJPEGToStream(bitmap, writeStream, 95);
  } finally {
    writeStream.close();
  }
  console.log(`[Thumbnail] Sukses menggambar teks overlay di: ${filePath}`);
}


export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });

  const style = config.thumbnail?.style || "cinematic";
  console.log(`[Thumbnail] Menghasilkan prompt thumbnail (${style}) untuk: "${item.title}"...`);

  const isVector = style === "vector";

  const promptText = isVector
    ? `Pahami topik video berikut: "${item.title}".
Kategori: "${item.input?.category || 'umum'}".
Ringkasan naskah: "${item.plan?.summary || item.plan?.hook || ''}".
Buat rincian visual untuk prompt gambar DALL-E 3 pembuat thumbnail YouTube bergaya premium infografis 2D flat vector (seperti Kurzgesagt atau Kok Bisa).
Kembalikan JSON dengan struktur berikut:
{
  "judul": "Teks judul singkat bahasa Indonesia, maksimal 2-3 kata, kapital semua (misal: 'POSISI TIDUR', 'DARURAT ENERGI')",
  "temaUtama": "Deskripsi singkat subjek/karakter kartun lucu minimalis & latar belakang datar berwarna cerah (bahasa Inggris, cth: 'three cute simple cartoon characters sleeping in bed')",
  "elemenVisual": [
    "Elemen visual detail 1 (bahasa Inggris, cth: 'sleeping zZz symbols floating in the air')",
    "Elemen visual detail 2 (bahasa Inggris, cth: 'soft warm lamp glow spotlight from the top')",
    "Elemen visual detail 3 (bahasa Inggris, cth: 'simple clean outlines on characters')",
    "Elemen visual detail 4 (bahasa Inggris, cth: 'flat solid color background')",
    "Elemen visual detail 5 (bahasa Inggris, cth: 'high visual contrast')"
  ]
}`
    : `Pahami topik video berikut: "${item.title}".
Kategori: "${item.input?.category || 'umum'}".
Ringkasan naskah: "${item.plan?.summary || item.plan?.hook || ''}".
Buat rincian visual untuk prompt gambar DALL-E 3 pembuat thumbnail YouTube bergaya premium investigasi dokumenter misteri.
Kembalikan JSON dengan struktur berikut:
{
  "judul": "Teks judul singkat bahasa Indonesia, MAKSIMAL 2-3 KATA SAJA, kapital semua (misal: 'BATAS ENERGI', 'PANAS BUMI', 'AWAL MISTERI')",
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
    visualDetails = isVector
      ? {
          judul: "HAL KECIL",
          temaUtama: `flat vector illustration of ${item.title}`,
          elemenVisual: [
            "2d flat design",
            "minimalist cartoon characters",
            "simple shapes",
            "vibrant colors",
            "clean outlines"
          ]
        }
      : {
          judul: "MISTERI",
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

  const judul = visualDetails.judul || "MISTERI";
  const temaUtama = visualDetails.temaUtama || (isVector ? `flat vector illustration of ${item.title}` : `cinematic illustration of ${item.title}`);
  const ev = visualDetails.elemenVisual || [];
  const ev1 = ev[0] || (isVector ? "flat 2d graphics" : "cinematic lighting");
  const ev2 = ev[1] || (isVector ? "vibrant colors" : "high contrast details");
  const ev3 = ev[2] || (isVector ? "cute minimal style" : "mysterious smoke");
  const ev4 = ev[3] || (isVector ? "clean outlines" : "dust particles");
  const ev5 = ev[4] || (isVector ? "soft background vignette" : "glowing accent highlights");

  const dallEPrompt = isVector
    ? `Create a flat 2D vector illustration style YouTube thumbnail in 16:9 aspect ratio. The style should be clean, cute, minimalist graphic design, similar to Kurzgesagt or Kok Bisa explainer channels.

Use a strong, clean composition:
- large bold graphic-design typography of the title text on the top or center-top
- Cute minimalist cartoon characters with simple dot eyes and clean outlines below the text.
- Bold, vibrant, warm color palette with soft gradients.
- A soft spotlight/vignette effect from the top center to focus the viewer's attention.
- High visual contrast.
- Clear visual metaphor representing the main topic.

Title text:
"${judul}"

Typography:
very large bold rounded uppercase letters, clean and readable, white color with a thick black outline, stacked layout.

Main visual theme:
${temaUtama}

Visual elements:
- ${ev1}
- ${ev2}
- ${ev3}
- ${ev4}
- ${ev5}

Style direction:
flat vector illustration, 2D minimalist cartoon, simple shapes, clean digital art, soft lighting, vibrant color scheme, professional graphics, no 3D elements, no realistic details.

Negative prompt:
watermark, logo, subtitles, 3D, realistic, photo, photographic, blurry, dark, messy composition, distorted objects, low quality, detailed human faces, shadows with gradients, realistic textures.`
    : `Create a dramatic, premium cinematic YouTube thumbnail in 16:9 aspect ratio. The style must be realistic, serious, and highly detailed, resembling a professional investigative documentary or Netflix series poster.

Layout & Composition:
- Divide the canvas using the rule of thirds.
- LEFT SIDE: Large, bold, clean typography of the title text, neatly aligned. The background behind the text must be a dark, textured shadow or abstract smoke to make the text extremely readable and pop out.
- RIGHT SIDE: A highly detailed, realistic, and symbolic central subject representing the topic.
- NO overlap between the text and the main subject. Keep the layout clean, balanced, and uncluttered.

Title text to write on the left:
"${judul}"

Typography:
Very large, bold, clean uppercase sans-serif letters. Stacked layout. Main words in solid white, key emphasis word in vibrant yellow/gold. Add a subtle dark drop shadow behind the letters for maximum contrast.

Main visual theme on the right:
${temaUtama}

Visual elements & atmosphere:
- ${ev1}
- ${ev2}
- ${ev3}
- ${ev4}
- ${ev5}
- High-contrast Chiaroscuro lighting with dramatic volumetric rays.
- Realistic textures (metallic, stone, dust, glass).
- A single dominant accent color (like amber, neon yellow, or warning red) popping out from a dark, moody background.

Style direction:
cinematic, mysterious, investigative, educational, premium YouTube thumbnail, dark elegant atmosphere, realistic details, dramatic lighting, smoke, dust particles, textured shadows, glowing accents, strong contrast, polished composition.

Negative prompt:
watermark, logo, subtitles, blurry, messy composition, distorted objects, low quality, cartoon style, childish illustration, drawings, multiple overlapping text, duplicate titles, text overlapping the right-side subject`;

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
