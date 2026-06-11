import dotenv from "dotenv";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function clean(value) {
  return String(value || "").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function bool(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (!cleaned) return false;
  return !["0", "false", "no", "off"].includes(cleaned);
}

function boolDefault(value, fallback) {
  const cleaned = String(value ?? "").trim();
  return cleaned ? bool(cleaned) : fallback;
}

function trimSlash(value) {
  return clean(value).replace(/\/+$/g, "");
}

/**
 * Parse "kategori:PLAYLIST_ID,kategori2:PLAYLIST_ID2" → Map
 * Contoh env: YOUTUBE_PLAYLISTS=sains:PLxxxxxxx,sejarah:PLyyyyyyy
 */
function parsePlaylistMap(value) {
  const map = new Map();
  const pairs = clean(value).split(",").map((p) => p.trim()).filter(Boolean);
  for (const pair of pairs) {
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    const category = pair.slice(0, sep).trim().toLowerCase();
    const playlistId = pair.slice(sep + 1).trim();
    if (category && playlistId) map.set(category, playlistId);
  }
  return map;
}

export const paths = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  generatedDir: path.join(rootDir, "generated"),
  imageDir: path.join(rootDir, "generated", "images"),
  audioDir: path.join(rootDir, "generated", "audio"),
  thumbnailDir: path.join(rootDir, "generated", "thumbnails"),
  videoDir: path.join(rootDir, "generated", "videos"),
  clipsDir: path.join(rootDir, "generated", "clips"),
  workDir: path.join(rootDir, "generated", "work"),
  publicDir: path.join(rootDir, "public")
};

export function ensureProjectDirs() {
  for (const dir of Object.values(paths)) {
    if (String(dir).startsWith(rootDir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export const config = {
  port: Math.max(1, Math.floor(numberEnv("PORT", 3050))),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
  dashboardPin: clean(process.env.AUTO_DASHBOARD_PIN || "123456"),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: trimSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    imageSize: clean(process.env.IMAGE_SIZE || "1536x1024"),
    imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || process.env.TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || process.env.TTS_VOICE || "cedar"),
    transcribeModel: clean(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1")
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: clean(process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"),
    voiceId: clean(process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku")
  },
  youtube: {
    enabled: bool(process.env.YOUTUBE_UPLOAD_ENABLED),
    clientId: clean(process.env.YOUTUBE_CLIENT_ID),
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || "",
    privacyStatus: clean(process.env.YOUTUBE_PRIVACY_STATUS || "public"),
    categoryId: clean(process.env.YOUTUBE_CATEGORY_ID || "27"),
    tags: clean(process.env.YOUTUBE_TAGS || "BanyakTau,Edukasi,Pengetahuan,Sains,Sejarah,Teknologi")
      .split(",").map((tag) => clean(tag)).filter(Boolean),
    customThumbnailEnabled: boolDefault(process.env.YOUTUBE_CUSTOM_THUMBNAIL_ENABLED, true),
    thumbnailUploadAttempts: Math.min(3, Math.max(1, numberEnv("YOUTUBE_THUMBNAIL_UPLOAD_ATTEMPTS", 1))),
    dailyUploadLimit: Math.max(0, numberEnv("YOUTUBE_DAILY_UPLOAD_LIMIT", 2)),
    defaultPlaylistId: clean(process.env.YOUTUBE_DEFAULT_PLAYLIST_ID),
    playlists: parsePlaylistMap(process.env.YOUTUBE_PLAYLISTS || "")
  },
  pricing: {
    storyInputUsdPer1MTokens: numberEnv("STORY_INPUT_USD_PER_1M_TOKENS", 0.4),
    storyOutputUsdPer1MTokens: numberEnv("STORY_OUTPUT_USD_PER_1M_TOKENS", 1.6),
    openaiTtsUsdPer1MChars: numberEnv("OPENAI_TTS_USD_PER_1M_CHARS", numberEnv("TTS_USD_PER_1M_CHARS", 15)),
    elevenlabsTtsUsdPer1KChars: numberEnv("ELEVENLABS_TTS_USD_PER_1K_CHARS", 0.1),
    videoUsdPerSecond: 0
  },
  render: {
    fontTitle: clean(process.env.RENDER_TITLE_FONT || "Bebas Neue"),
    fontBody: clean(process.env.RENDER_BODY_FONT || "Segoe UI Semibold"),
    fontMono: clean(process.env.RENDER_MONO_FONT || "Cascadia Code"),
    speechTempo: Math.min(1.3, Math.max(0.9, numberEnv("SPEECH_TEMPO", 1.0)))
  },
  automation: {
    timeZone: clean(process.env.YT_TIME_ZONE || "Asia/Bangkok"),
    dailyGenerateLimit: Math.max(0, numberEnv("YT_DAILY_GENERATE_LIMIT", 1)),
    durationSec: Math.max(300, numberEnv("YT_DURATION_SEC", 360)),
    sceneCount: Math.max(8, numberEnv("YT_SCENE_COUNT", 14)),
    workflowFile: clean(process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml"),
    strictRemote: bool(process.env.YT_STRICT_REMOTE)
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || "",
    preferVideo: boolDefault(process.env.PEXELS_PREFER_VIDEO, true),
    minDurationSec: Math.max(3, numberEnv("PEXELS_MIN_DURATION_SEC", 8)),
    maxResultsPerScene: Math.max(1, Math.min(15, numberEnv("PEXELS_MAX_RESULTS", 5)))
  },
  thumbnail: {
    enabled: boolDefault(process.env.THUMBNAIL_GENERATION_ENABLED, true)
  }
};

export function publicConfig() {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    providers: {
      openai: Boolean(config.openai.apiKey),
      openaiBaseUrl: config.openai.baseUrl,
      elevenlabs: Boolean(config.elevenlabs.apiKey),
      storyModel: config.openai.storyModel,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize,
      imageQuality: config.openai.imageQuality,
      openaiTtsModel: config.openai.ttsModel,
      openaiTtsVoice: config.openai.ttsVoice,
      openaiTranscribeModel: config.openai.transcribeModel,
      elevenlabsModel: config.elevenlabs.model,
      elevenlabsVoiceId: config.elevenlabs.voiceId,
      youtubeUploadEnabled: config.youtube.enabled,
      youtubeClientIdSet: bool(config.youtube.clientId),
      youtubeRefreshTokenSet: bool(config.youtube.refreshToken),
      pexels: Boolean(config.pexels.apiKey),
      pexelsPreferVideo: config.pexels.preferVideo
    },
    render: config.render,
    automation: config.automation,
    dashboard: {
      productionMode: "longform-youtube-only",
      pinRequired: true
    }
  };
}

export async function updateRuntimeSettings(input = {}) {
  const updates = {};
  const map = {
    openaiApiKey: "OPENAI_API_KEY",
    openaiBaseUrl: "OPENAI_BASE_URL",
    storyModel: "STORY_MODEL",
    imageModel: "IMAGE_MODEL",
    openaiTtsVoice: "OPENAI_TTS_VOICE",
    openaiTtsModel: "OPENAI_TTS_MODEL",
    openaiTranscribeModel: "OPENAI_TRANSCRIBE_MODEL",
    elevenlabsApiKey: "ELEVENLABS_API_KEY",
    elevenlabsModel: "ELEVENLABS_MODEL",
    elevenlabsVoiceId: "ELEVENLABS_VOICE_ID",
    pexelsApiKey: "PEXELS_API_KEY"
  };
  for (const [key, envName] of Object.entries(map)) {
    const value = key.endsWith("ApiKey") || key.endsWith("Url") ? trimSlash(input[key]) : clean(input[key]);
    if (value) updates[envName] = value;
  }
  const speechTempo = Number(input.speechTempo);
  if (Number.isFinite(speechTempo)) updates.SPEECH_TEMPO = String(Math.min(1.3, Math.max(0.9, speechTempo)));

  if (Object.keys(updates).length) {
    await writeEnvUpdates(updates);
    applyConfigUpdates(updates);
  }
  return publicConfig();
}

async function writeEnvUpdates(updates) {
  const envPath = path.join(rootDir, ".env");
  let lines = [];
  try {
    lines = (await fsp.readFile(envPath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const name = match[1];
    if (!(name in updates)) return line;
    seen.add(name);
    return `${name}=${updates[name]}`;
  });
  for (const [name, value] of Object.entries(updates)) {
    if (!seen.has(name)) next.push(`${name}=${value}`);
  }
  await fsp.writeFile(envPath, `${next.filter((line, index, arr) => index < arr.length - 1 || line).join("\n")}\n`);
}

function applyConfigUpdates(updates) {
  for (const [name, value] of Object.entries(updates)) process.env[name] = value;
  if (updates.OPENAI_API_KEY !== undefined) config.openai.apiKey = updates.OPENAI_API_KEY;
  if (updates.OPENAI_BASE_URL !== undefined) config.openai.baseUrl = trimSlash(updates.OPENAI_BASE_URL);
  if (updates.STORY_MODEL !== undefined) config.openai.storyModel = updates.STORY_MODEL;
  if (updates.IMAGE_MODEL !== undefined) config.openai.imageModel = updates.IMAGE_MODEL;
  if (updates.OPENAI_TTS_MODEL !== undefined) config.openai.ttsModel = updates.OPENAI_TTS_MODEL;
  if (updates.OPENAI_TTS_VOICE !== undefined) config.openai.ttsVoice = updates.OPENAI_TTS_VOICE;
  if (updates.OPENAI_TRANSCRIBE_MODEL !== undefined) config.openai.transcribeModel = updates.OPENAI_TRANSCRIBE_MODEL;
  if (updates.ELEVENLABS_API_KEY !== undefined) config.elevenlabs.apiKey = updates.ELEVENLABS_API_KEY;
  if (updates.ELEVENLABS_MODEL !== undefined) config.elevenlabs.model = updates.ELEVENLABS_MODEL;
  if (updates.ELEVENLABS_VOICE_ID !== undefined) config.elevenlabs.voiceId = updates.ELEVENLABS_VOICE_ID;
  if (updates.SPEECH_TEMPO !== undefined) config.render.speechTempo = Number(updates.SPEECH_TEMPO);
  if (updates.PEXELS_API_KEY !== undefined) config.pexels.apiKey = updates.PEXELS_API_KEY;
}
