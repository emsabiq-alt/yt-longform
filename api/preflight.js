import {
  check,
  clean,
  configSummary,
  getRecentRuns,
  methodAllowed,
  readState,
  remoteConfig,
  remoteMissingEnv,
  requireAuth,
  sendJson
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const state = await readState();
    const runs = await getRecentRuns(1);
    const remote = remoteConfig();
    const missingRemote = remoteMissingEnv(remote);
    const cfg = configSummary();

    const checks = [
      check("Dashboard PIN", Boolean(clean(process.env.AUTO_DASHBOARD_PIN)), "PIN aktif"),
      check("PUBLIC_BASE_URL", Boolean(cfg.publicBaseUrl), cfg.publicBaseUrl || "belum diset"),
      check(`${remote.label} credential`, missingRemote.length === 0, missingRemote.length ? `missing: ${missingRemote.join(", ")}` : "untuk update queue & state"),
      check("Workflow token", Boolean(clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN)), "untuk tombol Generate"),
      check("YouTube upload", cfg.youtubeEnabled, cfg.youtubeEnabled ? `limit ${cfg.youtubeDailyUploadLimit}/hari` : "YOUTUBE_UPLOAD_ENABLED=false", false),
      check("state/items.json", Array.isArray(state.items), `${(state.items || []).length} video terbaca`),
      check("Workflow API", runs.length > 0, runs[0]?.html_url || "belum ada run terbaca", false),
      check("Repo & workflow", true, `${cfg.repo} · ${cfg.workflow}`)
    ];

    sendJson(res, 200, { checks, config: cfg });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
