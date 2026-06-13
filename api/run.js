import { clean, dispatchWorkflow, makeId, methodAllowed, readBody, requireAuth, sendJson } from "./_utils.js";

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
      topic: clean(body.topic || ""),
      category: clean(body.category || "random"),
      format_type: clean(body.formatType || body.format_type || ""),
      duration: clean(body.durationSec || body.duration || process.env.YT_DURATION_SEC || "360"),
      scenes: clean(body.sceneCount || body.scenes || process.env.YT_SCENE_COUNT || "14"),
      tts_provider: ttsProvider,
      tts_voice: clean(body.ttsVoice || defaultTtsVoice),
      image_quality: clean(body.imageQuality || "low"),
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
    sendJson(res, 400, { error: error.message });
  }
}
