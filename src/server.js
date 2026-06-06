import express from "express";
import { ensureProjectDirs, paths, publicConfig, updateRuntimeSettings, config } from "./config.js";
import {
  assertReadyToRender,
  ensureImages,
  ensureLongformSceneAudio,
  ensureThumbnail,
  ffmpegAvailable,
  generateFullItem,
  renderAndPersist
} from "./pipeline.js";
import { listItems, saveItem, getItem } from "./storage.js";
import { createLongformDraft } from "./longform-story-engine.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, config: publicConfig(), tools: { ffmpeg: ffmpegAvailable() } });
});

app.use("/api", requireDashboardPin);

app.get("/api/state", async (_req, res, next) => {
  try {
    res.json({ config: publicConfig(), items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/items", async (_req, res, next) => {
  try {
    res.json({ items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/items/:id", async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Item tidak ditemukan." });
      return;
    }
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    res.json({ config: await updateRuntimeSettings(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/full", async (req, res, next) => {
  try {
    res.json(await generateFullItem(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const item = await createLongformDraft(req.body || {});
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/render", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    const warnings = [];
    if (req.body?.ensureAssets !== false) {
      await ensureImages(item, { warnings, strict: true });
      await ensureLongformSceneAudio(item, { provider: req.body?.provider || item.input.ttsProvider, warnings, strict: true });
      await ensureThumbnail(item, { warnings });
    }
    assertReadyToRender(item);
    await renderAndPersist(item);
    res.json({ item, warnings });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

app.listen(config.port, () => {
  console.log(`YT Longform Studio running at http://localhost:${config.port}`);
});

async function requireItem(id) {
  const item = await getItem(id);
  if (!item) {
    const error = new Error("Item tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return item;
}

function requireDashboardPin(req, res, next) {
  const expected = String(config.dashboardPin || "123456").trim();
  const provided = String(req.headers["x-dashboard-pin"] || req.query.pin || "").trim();
  if (!expected || provided === expected) return next();
  res.status(401).json({ error: "PIN dashboard tidak valid." });
}
