import { clampStr, clean, dispatchWorkflow, makeId, methodAllowed, readBody, requireAuth, sendError, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const body = await readBody(req);
    const ttsProvider = clean(body.ttsProvider || "elevenlabs").toLowerCase() === "openai"
      ? "openai"
      : "elevenlabs";
    const defaultTtsVoice = ttsProvider === "elevenlabs"
      ? process.env.ELEVENLABS_VOICE_ID || "wUrGnU2Kx934kbDdOWDo"
      : process.env.OPENAI_TTS_VOICE || "cedar";
    const inputs = {
      topic: clampStr(body.topic || "", 300),
      category: clampStr(body.category || "random", 80),
      format_type: clampStr(body.formatType || body.format_type || "", 40),
      duration: clampStr(body.durationSec || body.duration || process.env.YT_DURATION_SEC || "360", 6),
      scenes: clampStr(body.sceneCount || body.scenes || process.env.YT_SCENE_COUNT || "14", 4),
      tts_provider: ttsProvider,
      tts_voice: clampStr(body.ttsVoice || defaultTtsVoice, 80),
      image_quality: clampStr(body.imageQuality || "low", 20),
      resolution: clampStr(body.resolution || "720p", 10),
      force: body.force === true || body.force === "true" ? "true" : "false"
    };

    const dispatch = await dispatchWorkflow(inputs);
    sendJson(res, 200, {
      id: makeId("run"),
      status: "queued",
      startedAt: new Date().toISOString(),
      result: { status: "workflow_dispatch_queued", ...dispatch },
      logs: [{ at: new Date().toISOString(), level: "system", text: "Workflow ter-trigger. Refresh beberapa detik lagi untuk memantau progres." }]
    });
  } catch (error) {
    sendError(res, error, 400);
  }
}
