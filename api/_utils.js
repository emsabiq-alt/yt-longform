import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";

const STATE_FILES = ["items.json", "queue.json"];

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendJson(res, 405, { error: `Method ${req.method} tidak didukung.` });
  return false;
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    const rawBody = req.body.trim();
    return rawBody ? JSON.parse(rawBody) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function clean(value) {
  return String(value || "").trim();
}

export function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function boolInput(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

// ---------------- Auth ----------------
export function requireAuth(req, res) {
  const expected = clean(process.env.AUTO_DASHBOARD_PIN);
  if (!expected) {
    sendJson(res, 403, { error: "AUTO_DASHBOARD_PIN belum diset di Vercel Environment." });
    return false;
  }
  const provided = clean(
    req.headers["x-dashboard-pin"]
      || queryValue(req, "pin")
      || cookieValue(req.headers.cookie || "", "yt_dashboard_pin")
  );
  if (provided === expected) return true;
  sendJson(res, 401, { error: "PIN dashboard tidak valid atau belum diisi." });
  return false;
}

export function setPinCookie(res, pin) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `yt_dashboard_pin=${encodeURIComponent(pin)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

export function clearPinCookie(res) {
  res.setHeader("Set-Cookie", "yt_dashboard_pin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

// ---------------- State (read from hosting, write via SFTP) ----------------
export async function readState() {
  const entries = await Promise.all(STATE_FILES.map(async (file) => [file.replace(/\.json$/, ""), await readStateFile(file)]));
  return Object.fromEntries(entries);
}

export async function readStateFile(file) {
  const fromRemote = await readStateFileFromPublicBaseUrl(file);
  if (fromRemote !== null) return fromRemote;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", file), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function readStateFileFromPublicBaseUrl(file) {
  const baseUrl = cleanBaseUrl(process.env.PUBLIC_BASE_URL);
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}/state/${encodeURIComponent(file)}?v=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (file === "items.json" && data && !Array.isArray(data) && Array.isArray(data.items)) return data.items;
    return data;
  } catch {
    return null;
  }
}

export async function uploadStateFile(file, data) {
  const cfg = remoteConfig();
  if (!["ftp", "sftp"].includes(cfg.driver)) return { skipped: true };
  const missing = remoteMissingEnv(cfg);
  if (missing.length) throw new Error(`${cfg.label} env belum lengkap untuk update state: ${missing.join(", ")}`);

  const raw = `${JSON.stringify(data, null, 2)}\n`;
  await withRemoteRetry(async () => {
    if (cfg.driver === "sftp") {
      const client = new SftpClient();
      try {
        await client.connect({
          host: cfg.host, port: cfg.port, username: cfg.user,
          password: cfg.password || undefined,
          readyTimeout: Math.max(cfg.stateTimeoutMs, 30000),
          keepaliveInterval: 10000, keepaliveCountMax: 12
        });
        const stateDir = path.posix.join(cfg.remoteDir, "state");
        await client.mkdir(stateDir, true);
        await client.put(Readable.from([Buffer.from(raw, "utf8")]), path.posix.join(stateDir, file));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }
    const client = new FtpClient(cfg.stateTimeoutMs);
    try {
      await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: false });
      await client.ensureDir(path.posix.join(cfg.remoteDir, "state"));
      await client.uploadFrom(Readable.from([Buffer.from(raw, "utf8")]), file);
    } finally {
      client.close();
    }
  });
  return { skipped: false };
}

// ---------------- Config summary ----------------
export function configSummary() {
  return {
    publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
    timezone: clean(process.env.YT_TIME_ZONE || "Asia/Bangkok"),
    uploadDriver: clean(process.env.UPLOAD_DRIVER || "sftp"),
    durationSec: Number(process.env.YT_DURATION_SEC || 360),
    sceneCount: Number(process.env.YT_SCENE_COUNT || 14),
    dailyGenerateLimit: Number(process.env.YT_DAILY_GENERATE_LIMIT || 1),
    youtubeEnabled: boolEnv("YOUTUBE_UPLOAD_ENABLED", true),
    youtubeDailyUploadLimit: Number(process.env.YOUTUBE_DAILY_UPLOAD_LIMIT || 2),
    youtubePrivacy: clean(process.env.YOUTUBE_PRIVACY_STATUS || "public"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || "cedar"),
    ttsProvider: clean(process.env.YT_TTS_PROVIDER || "elevenlabs"),
    elevenlabsVoiceId: clean(process.env.ELEVENLABS_VOICE_ID || "hgr2kw1PROld0DDezSZ6"),
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    workflow: clean(process.env.DASHBOARD_WORKFLOW_FILE || process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml"),
    repo: githubRepo(),
    vercelDashboard: true
  };
}

// ---------------- GitHub Actions ----------------
export async function getRecentRuns(limit = 6) {
  const token = githubToken();
  if (!token) return [];
  const repo = githubRepo();
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=${limit}`, {
    headers: githubHeaders(token), cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.workflow_runs || []).map((run) => ({
    id: run.id, name: run.name, status: run.status, conclusion: run.conclusion,
    event: run.event, head_branch: run.head_branch, run_attempt: run.run_attempt,
    display_title: run.display_title || run.head_commit?.message || "",
    created_at: run.created_at, updated_at: run.updated_at, html_url: run.html_url
  }));
}

export async function getRunJobs(runId) {
  const token = githubToken();
  if (!token || !runId) return [];
  const repo = githubRepo();
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=30`, {
    headers: githubHeaders(token), cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.jobs || []).map((job) => ({
    id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
    started_at: job.started_at, completed_at: job.completed_at, html_url: job.html_url,
    steps: (job.steps || []).map((step) => ({
      name: step.name, status: step.status, conclusion: step.conclusion,
      number: step.number, started_at: step.started_at, completed_at: step.completed_at
    }))
  }));
}

export async function dispatchWorkflow(inputs) {
  const token = githubToken();
  if (!token) throw new Error("GH_REPO_SECRET_TOKEN belum diset di Vercel Environment.");
  const repo = githubRepo();
  const workflow = clean(process.env.DASHBOARD_WORKFLOW_FILE || process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml");
  const ref = clean(process.env.DASHBOARD_GITHUB_REF || "main");
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ ref, inputs }) }
  );
  if (response.status === 204) return { ok: true, repo, workflow, ref };
  let detail = "";
  try { detail = JSON.stringify(await response.json()); } catch { detail = await response.text(); }
  throw new Error(`Gagal trigger workflow (${response.status}): ${detail.slice(0, 500)}`);
}

// ---------------- Queue helpers ----------------
export function buildQueueItem(input) {
  const now = new Date().toISOString();
  return {
    id: input.id || makeId("q"),
    topic: clean(input.topic),
    category: clean(input.category || "random"),
    formatType: clean(input.formatType || input.format_type || ""),
    durationSec: Number(input.durationSec || process.env.YT_DURATION_SEC || 360),
    sceneCount: Number(input.sceneCount || process.env.YT_SCENE_COUNT || 14),
    ttsProvider: clean(input.ttsProvider || "openai"),
    ttsVoice: clean(input.ttsVoice || process.env.OPENAI_TTS_VOICE || "cedar"),
    imageQuality: clean(input.imageQuality || "low"),
    priority: Number(input.priority || 1),
    status: clean(input.status || "pending"),
    notes: clean(input.notes || ""),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

export function upsertById(items, item) {
  const list = Array.isArray(items) ? [...items] : [];
  const index = list.findIndex((entry) => entry?.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = { ...list[index], ...item };
  return list;
}

export function removeById(items, id) {
  return (Array.isArray(items) ? items : []).filter((entry) => entry?.id !== id);
}

export function makeId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(2).toString("hex");
  return `${prefix}_${stamp}_${random}`;
}

export function check(name, ok, detail = "", required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

// ---------------- Remote config ----------------
export function remoteConfig() {
  const driver = clean(process.env.UPLOAD_DRIVER || "sftp").toLowerCase();
  const prefix = driver === "sftp" ? "SFTP" : "FTP";
  const fallbackPrefix = prefix === "SFTP" ? "FTP" : "SFTP";
  const names = (suffix) => [`${prefix}_${suffix}`, `${fallbackPrefix}_${suffix}`];
  const defaultPort = driver === "sftp" ? 65002 : 21;
  return {
    driver,
    label: driver === "sftp" ? "SFTP" : "FTP",
    prefix,
    host: clean(firstEnv(names("HOST"))),
    port: numberEnvFrom(driver === "sftp" ? ["SFTP_PORT"] : names("PORT"), defaultPort),
    user: clean(firstEnv(names("USER"))),
    password: firstEnv(names("PASSWORD")),
    remoteDir: clean(firstEnv(names("REMOTE_DIR"), "/public_html/yt")),
    stateTimeoutMs: numberEnvFrom(names("STATE_TIMEOUT_SECONDS"), 180) * 1000,
    retries: Math.max(1, numberEnvFrom(names("UPLOAD_RETRIES"), 4))
  };
}

export function remoteMissingEnv(cfg) {
  const missing = [];
  if (!cfg.host) missing.push(`${cfg.prefix}_HOST`);
  if (!cfg.user) missing.push(`${cfg.prefix}_USER`);
  if (!cfg.password) missing.push(`${cfg.prefix}_PASSWORD`);
  if (!cfg.remoteDir) missing.push(`${cfg.prefix}_REMOTE_DIR`);
  return missing;
}

async function withRemoteRetry(task) {
  const cfg = remoteConfig();
  const attempts = cfg.retries;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const retriable = !/\b(530|550|553)\b|auth|authentication|permission denied|login incorrect/i.test(message)
        && /timeout|timed out|closed|socket|econn|etimedout|econnreset|econnrefused|epipe|421|425|426|450|451/i.test(message);
      if (attempt >= attempts || !retriable) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1500 * attempt)));
    }
  }
  throw lastError;
}

// ---------------- internals ----------------
function githubRepo() {
  return clean(process.env.DASHBOARD_GITHUB_REPO || process.env.GITHUB_REPOSITORY || "emsabiq/yt-longform");
}

function githubToken() {
  return clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "yt-longform-dashboard"
  };
}

function firstEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function numberEnvFrom(names, fallback) {
  const value = Number(firstEnv(names));
  return Number.isFinite(value) ? value : fallback;
}

function cleanBaseUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

function queryValue(req, name) {
  try {
    return new URL(req.url, "https://dashboard.local").searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function cookieValue(raw, name) {
  for (const part of String(raw || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
