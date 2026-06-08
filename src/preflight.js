import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, paths } from "./config.js";
import { remoteConfig, remoteEnabled } from "./remote.js";

export async function runPreflight() {
  const checks = [];
  checks.push(checkCommand("ffmpeg"));
  checks.push(checkCommand("ffprobe"));
  checks.push(checkValue("OPENAI_API_KEY", Boolean(config.openai.apiKey), "Story, gambar, TTS, dan transkripsi butuh key ini."));
  checks.push(checkValue("PEXELS_API_KEY", Boolean(config.pexels?.apiKey), "Video B-roll Pexels butuh key ini. Tanpa key, semua scene pakai gambar DALL-E."));
  checks.push(checkValue("PUBLIC_BASE_URL", Boolean(config.publicBaseUrl || process.env.PUBLIC_BASE_URL), "Butuh base URL publik untuk preview asset dan upload YouTube fetchable."));

  const remote = remoteConfig();
  checks.push(checkValue("UPLOAD_DRIVER", remoteEnabled(), `Driver aktif: ${remote.driver}`));
  if (remoteEnabled()) {
    checks.push(checkValue(`${remote.prefix}_HOST`, Boolean(remote.host), "Host upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_USER`, Boolean(remote.user), "User upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_PASSWORD`, Boolean(remote.password), "Password upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_REMOTE_DIR`, Boolean(remote.remoteDir), "Folder remote wajib ada."));
  }

  if (config.youtube.enabled) {
    checks.push(checkValue("YOUTUBE_CLIENT_ID", Boolean(config.youtube.clientId), "OAuth Client ID YouTube wajib diisi."));
    checks.push(checkValue("YOUTUBE_CLIENT_SECRET", Boolean(config.youtube.clientSecret), "OAuth Client Secret YouTube wajib diisi."));
    checks.push(checkValue("YOUTUBE_REFRESH_TOKEN", Boolean(config.youtube.refreshToken), "Refresh token YouTube wajib diisi."));
  }

  checks.push(await checkFile("background_music", path.join(paths.rootDir, "assets", "music", "Marimba Curiosity Case (5 Minute Version).mp3")));

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    summary: failed.length ? `${failed.length} preflight check gagal.` : "Preflight aman."
  };
}

function checkCommand(name) {
  const result = spawnSync(name, ["-version"], { encoding: "utf8", windowsHide: true });
  return { name, ok: result.status === 0, detail: result.status === 0 ? firstLine(result.stdout || result.stderr) : `${name} tidak tersedia.` };
}

function checkValue(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

async function checkFile(name, filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { name, ok: stat.isFile(), detail: `${Math.round(stat.size / 1024)} KB` };
  } catch {
    return { name, ok: false, detail: `${filePath} tidak ditemukan.` };
  }
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
