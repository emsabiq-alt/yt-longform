import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, paths } from "../src/config.js";
import {
  buildLongformStoryboard,
  createLongformDraft,
  normalizeVisualSegments
} from "../src/longform-story-engine.js";
import { scorePexelsCandidate } from "../src/pexels.js";

test("normalizeVisualSegments mempertahankan dan membersihkan intent Pexels dari AI", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "wheelchair user entering an elevator",
      visualKeywords: "wheelchair elevator entrance",
      pexelsQuery: "  wheelchair user entering elevator!!!  ",
      mustMatchTerms: [" Wheelchair ", "ELEVATOR", "documentary"]
    },
    {
      imagePrompt: "elevator buttons reflected in a mirror",
      visualKeywords: "elevator buttons mirror",
      pexelsQuery: "elevator mirror / buttons panel",
      mustMatchTerms: ["Elevator", "Buttons"]
    }
  ], "fallback image", "fallback keywords", "accessible elevator", 0);

  assert.equal(segments[0].pexelsQuery, "wheelchair user entering elevator");
  assert.deepEqual(segments[0].mustMatchTerms, ["wheelchair", "elevator", "user"]);
  assert.equal(segments[1].pexelsQuery, "elevator mirror buttons panel");
  assert.deepEqual(segments[1].mustMatchTerms, ["elevator", "buttons", "mirror"]);
});

test("intent hasil normalisasi tetap menjadi gerbang relevansi kandidat Pexels", () => {
  const [segment] = normalizeVisualSegments([
    {
      imagePrompt: "wheelchair user entering an elevator",
      visualKeywords: "wheelchair elevator entrance",
      pexelsQuery: "wheelchair user entering elevator",
      mustMatchTerms: ["wheelchair", "elevator"]
    },
    {
      imagePrompt: "elevator buttons",
      visualKeywords: "elevator buttons",
      pexelsQuery: "elevator buttons",
      mustMatchTerms: ["elevator"]
    }
  ], "fallback image", "fallback keywords", "accessible elevator", 0);
  const scored = scorePexelsCandidate({
    id: 91,
    duration: 12,
    url: "https://www.pexels.com/video/wheelchair-user-ramp-91/",
    video_files: [{
      file_type: "video/mp4",
      link: "https://videos.pexels.com/91.mp4",
      width: 1920,
      height: 1080,
      quality: "hd"
    }]
  }, {
    query: segment.pexelsQuery,
    mustMatchTerms: segment.mustMatchTerms,
    minDurationSec: 8,
    minRelevance: 0.3
  });

  assert.deepEqual(segment.mustMatchTerms, ["wheelchair", "elevator", "user"]);
  assert.equal(scored.eligible, false);
  assert.equal(scored.rejectionReason, "must-match");
});

test("normalizeVisualSegments menurunkan intent lama dari visualKeywords", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "workers inspect an oil refinery pipeline",
      visualKeywords: "oil refinery workers inspecting pipeline"
    },
    {
      imagePrompt: "oil refinery pipe detail",
      visualKeywords: "oil refinery pipeline detail"
    }
  ], "fallback image", "fallback keywords", "oil refinery", 0);

  assert.equal(segments[0].pexelsQuery, "oil refinery workers inspecting pipeline");
  assert.deepEqual(segments[0].mustMatchTerms, ["oil", "refinery", "workers"]);
  assert.equal(segments[1].pexelsQuery, "oil refinery pipeline detail");
  assert.deepEqual(segments[1].mustMatchTerms, ["oil", "refinery", "pipeline"]);
});

test("segmen fallback generik aman dan tidak meminta video Pexels", () => {
  const segments = normalizeVisualSegments(
    null,
    "cinematic educational illustration",
    "business meeting office",
    "fallback topic",
    0,
    { allowScenePexelsIntent: false }
  );

  assert.equal(segments.length, 3);
  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("query eksplisit yang hanya berisi istilah generik tidak meminta video Pexels", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "generic documentary frame",
      visualKeywords: "unrelated concrete compatibility keywords",
      pexelsQuery: "documentary footage wide camera angle",
      mustMatchTerms: ["documentary"]
    },
    {
      imagePrompt: "generic professional activity",
      visualKeywords: "another compatibility keyword",
      pexelsQuery: "people working professional",
      mustMatchTerms: "people, professional"
    }
  ], "fallback image", "fallback keywords", "fallback topic", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("bentuk plural istilah generik tetap ditolak untuk query dan must-match", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "generic documentary frame",
      visualKeywords: "generic compatibility keywords",
      pexelsQuery: "documentary videos",
      mustMatchTerms: ["videos"]
    },
    {
      imagePrompt: "generic cinematic frame",
      visualKeywords: "another compatibility keyword",
      pexelsQuery: "cinematic shots",
      mustMatchTerms: ["shots"]
    }
  ], "fallback image", "fallback keywords", "fallback topic", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("frasa close ups saja tetap dianggap query generik", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "generic close-up frame",
      visualKeywords: "elevator control panel",
      pexelsQuery: "close ups",
      mustMatchTerms: ["ups"]
    },
    {
      imagePrompt: "generic cinematic close-up frame",
      visualKeywords: "oil refinery",
      pexelsQuery: "cinematic close ups",
      mustMatchTerms: ["ups"]
    }
  ], "fallback image", "fallback keywords", "industrial systems", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("bentuk closeup tanpa spasi ditolak secara case-insensitive bila tetap generik", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "generic closeup frame",
      visualKeywords: "elevator control panel",
      pexelsQuery: "CLOSEUP",
      mustMatchTerms: ["CLOSEUP"]
    },
    {
      imagePrompt: "generic plural closeup frame",
      visualKeywords: "oil refinery",
      pexelsQuery: "CloseUps",
      mustMatchTerms: ["CloseUps"]
    },
    {
      imagePrompt: "generic cinematic closeup frame",
      visualKeywords: "wheelchair elevator",
      pexelsQuery: "cinematic CLOSEUPS",
      mustMatchTerms: ["CLOSEUPS"]
    }
  ], "fallback image", "fallback keywords", "industrial systems", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("closeup tetap boleh menjadi modifier bila query memiliki subjek konkret", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "elevator buttons closeup",
      visualKeywords: "elevator control panel",
      pexelsQuery: "closeup elevator buttons",
      mustMatchTerms: ["closeup", "elevator"]
    },
    {
      imagePrompt: "oil refinery cinematic closeups",
      visualKeywords: "oil refinery",
      pexelsQuery: "cinematic closeups oil refinery",
      mustMatchTerms: ["closeups", "oil"]
    }
  ], "fallback image", "fallback keywords", "industrial systems", 0);

  assert.equal(segments[0].pexelsQuery, "closeup elevator buttons");
  assert.deepEqual(segments[0].mustMatchTerms, ["elevator", "buttons"]);
  assert.equal(segments[1].pexelsQuery, "cinematic closeups oil refinery");
  assert.deepEqual(segments[1].mustMatchTerms, ["oil", "refinery"]);
});

test("query eksplisit non-string ditolak, bukan diubah menjadi teks", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "boolean query fallback",
      visualKeywords: "oil refinery",
      pexelsQuery: true,
      mustMatchTerms: ["oil"]
    },
    {
      imagePrompt: "object query fallback",
      visualKeywords: "elevator control panel",
      pexelsQuery: { subject: "elevator" },
      mustMatchTerms: ["elevator"]
    },
    {
      imagePrompt: "array query fallback",
      visualKeywords: "wheelchair elevator",
      pexelsQuery: ["wheelchair", "elevator"],
      mustMatchTerms: ["wheelchair"]
    }
  ], "fallback image", "fallback keywords", "industrial systems", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("query eksplisit yang hanya berisi stopword tidak meminta video Pexels", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "empty language query",
      visualKeywords: "oil refinery",
      pexelsQuery: "the and of with",
      mustMatchTerms: ["oil"]
    },
    {
      imagePrompt: "punctuation and stopword query",
      visualKeywords: "elevator control panel",
      pexelsQuery: " -- in / to ; the -- ",
      mustMatchTerms: ["elevator"]
    }
  ], "fallback image", "fallback keywords", "industrial systems", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("query nama khusus konkret tetap dipertahankan bersama stopword internal", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "Statue of Liberty at sunset",
      visualKeywords: "Statue of Liberty",
      pexelsQuery: "Statue of Liberty New York",
      mustMatchTerms: ["New", "York"]
    },
    {
      imagePrompt: "Bank of America office tower",
      visualKeywords: "Bank of America",
      pexelsQuery: "Bank of America headquarters",
      mustMatchTerms: ["Bank", "America"]
    }
  ], "fallback image", "fallback keywords", "American landmarks", 0);

  assert.equal(segments[0].pexelsQuery, "Statue of Liberty New York");
  assert.deepEqual(segments[0].mustMatchTerms, ["new", "york", "statue"]);
  assert.equal(segments[1].pexelsQuery, "Bank of America headquarters");
  assert.deepEqual(segments[1].mustMatchTerms, ["bank", "america", "headquarters"]);
});

test("visualKeywords lama yang hanya generik tidak menjadi intent Pexels", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "generic establishing frame",
      visualKeywords: "wide establishing camera shot"
    },
    {
      imagePrompt: "generic detail frame",
      visualKeywords: "detail texture close up"
    }
  ], "fallback image", "fallback keywords", "fallback topic", 0);

  assert.ok(segments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(segments.every((segment) => segment.mustMatchTerms.length === 0));
});

test("query konkret tetap dipakai dan menurunkan must-match saat istilah suplai generik", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "wide shot of an oil refinery pipeline",
      visualKeywords: "oil refinery pipeline",
      pexelsQuery: "wide camera shot oil refinery pipeline",
      mustMatchTerms: ["documentary footage", "wide angle"]
    },
    {
      imagePrompt: "close view of an elevator control panel",
      visualKeywords: "elevator control panel",
      pexelsQuery: "cinematic close up elevator buttons",
      mustMatchTerms: "documentary, footage, camera angle"
    }
  ], "fallback image", "fallback keywords", "industrial access", 0);

  assert.equal(segments[0].pexelsQuery, "wide camera shot oil refinery pipeline");
  assert.deepEqual(segments[0].mustMatchTerms, ["oil", "refinery", "pipeline"]);
  assert.equal(segments[1].pexelsQuery, "cinematic close up elevator buttons");
  assert.deepEqual(segments[1].mustMatchTerms, ["elevator", "buttons"]);
});

test("mustMatchTerms berbentuk string tetap dinormalisasi", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "workers inspect an oil pipeline",
      visualKeywords: "oil pipeline inspection",
      pexelsQuery: "oil workers inspect pipeline",
      mustMatchTerms: " Oil, PIPELINE, documentary "
    },
    {
      imagePrompt: "technician checks a refinery valve",
      visualKeywords: "refinery valve technician",
      pexelsQuery: "refinery technician checking valve",
      mustMatchTerms: "Refinery, Valve"
    }
  ], "fallback image", "fallback keywords", "oil refinery", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["oil", "pipeline", "workers"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["refinery", "valve", "technician"]);
});

test("mustMatchTerms yang tidak overlap diturunkan ulang dari query", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "oil refinery exterior",
      visualKeywords: "oil refinery",
      pexelsQuery: "oil refinery",
      mustMatchTerms: ["elevator"]
    },
    {
      imagePrompt: "workers inspect refinery pipes",
      visualKeywords: "refinery workers",
      pexelsQuery: "refinery workers inspecting pipes",
      mustMatchTerms: ["worker", "elevator"]
    }
  ], "fallback image", "fallback keywords", "oil industry", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["oil", "refinery"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["workers", "refinery", "inspecting"]);
});

test("mustMatchTerms multiword hanya menyimpan token query yang benar-benar overlap", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "oil refinery exterior",
      visualKeywords: "oil refinery",
      pexelsQuery: "oil refinery",
      mustMatchTerms: ["oil elevator"]
    },
    {
      imagePrompt: "workers inspect refinery pipes",
      visualKeywords: "refinery workers",
      pexelsQuery: "refinery workers inspecting pipes",
      mustMatchTerms: ["worker elevator"]
    }
  ], "fallback image", "fallback keywords", "oil industry", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["oil", "refinery"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["workers", "refinery", "inspecting"]);
});

test("mustMatchTerms valid dipertahankan lalu dilengkapi identitas subjek dari query", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "city buses moving through traffic",
      visualKeywords: "city buses traffic",
      pexelsQuery: "city buses traffic",
      mustMatchTerms: ["city", "bus"]
    },
    {
      imagePrompt: "UPS delivery truck in a city",
      visualKeywords: "UPS delivery truck",
      pexelsQuery: "UPS delivery truck",
      mustMatchTerms: ["UPS"]
    }
  ], "fallback image", "fallback keywords", "urban transport", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["city", "buses", "traffic"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["ups", "delivery", "truck"]);
});

test("pencocokan plural tidak menyamakan news dengan new", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "New York skyline",
      visualKeywords: "New York skyline",
      pexelsQuery: "New York skyline",
      mustMatchTerms: ["news"]
    },
    {
      imagePrompt: "workers outside the Paris headquarters",
      visualKeywords: "Paris workers headquarters",
      pexelsQuery: "Paris workers headquarters",
      mustMatchTerms: ["Paris", "worker"]
    }
  ], "fallback image", "fallback keywords", "international business", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["new", "york", "skyline"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["paris", "workers", "headquarters"]);
});

test("normalizer dan scorer menjaga identitas subjek query panjang", () => {
  const segments = normalizeVisualSegments([
    {
      imagePrompt: "electric bus drivers in city traffic",
      visualKeywords: "electric bus drivers city traffic",
      pexelsQuery: "electric bus drivers city traffic",
      mustMatchTerms: ["electric"]
    },
    {
      imagePrompt: "oil refinery workers",
      visualKeywords: "oil refinery workers",
      pexelsQuery: "oil refinery workers",
      mustMatchTerms: ["oil"]
    },
    {
      imagePrompt: "New York skyline",
      visualKeywords: "New York skyline",
      pexelsQuery: "New York skyline",
      mustMatchTerms: ["New"]
    }
  ], "fallback image", "fallback keywords", "infrastructure", 0);

  assert.deepEqual(segments[0].mustMatchTerms, ["electric", "bus", "drivers"]);
  assert.deepEqual(segments[1].mustMatchTerms, ["oil", "refinery", "workers"]);
  assert.deepEqual(segments[2].mustMatchTerms, ["new", "york", "skyline"]);

  const score = (slug, segment) => scorePexelsCandidate({
    id: 1,
    duration: 12,
    url: `https://www.pexels.com/video/${slug}-1/`,
    video_files: [{
      file_type: "video/mp4",
      link: "https://videos.pexels.com/1.mp4",
      width: 1920,
      height: 1080,
      quality: "hd"
    }]
  }, {
    query: segment.pexelsQuery,
    mustMatchTerms: segment.mustMatchTerms,
    minDurationSec: 8,
    minRelevance: 0.3
  });

  assert.equal(score("electric-guitar-player-in-city", segments[0]).eligible, false);
  assert.equal(score("electric-bus-drivers-in-city-traffic", segments[0]).eligible, true);
  assert.equal(score("oil-painting-workers", segments[1]).eligible, false);
  assert.equal(score("oil-refinery-workers", segments[1]).eligible, true);
  assert.equal(score("new-jersey-skyline", segments[2]).eligible, false);
  assert.equal(score("new-york-skyline", segments[2]).eligible, true);
});

test("fallback offline sebenarnya tidak meneruskan keyword generik ke Pexels", async (t) => {
  const originalApiKey = config.openai.apiKey;
  const originalGeneratedDir = paths.generatedDir;
  const temporaryGeneratedDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-longform-story-"));
  t.after(async () => {
    config.openai.apiKey = originalApiKey;
    paths.generatedDir = originalGeneratedDir;
    await fs.rm(temporaryGeneratedDir, { recursive: true, force: true });
  });
  config.openai.apiKey = "";
  paths.generatedDir = temporaryGeneratedDir;

  const draft = await createLongformDraft({
    topic: "Sejarah lift modern",
    category: "teknologi",
    durationSec: 300,
    sceneCount: 10,
    formatType: "dokumenter_klasik"
  });
  const visualSegments = draft.plan.scenes.flatMap((scene) => scene.visualSegments || []);

  assert.equal(draft.source, "offline");
  assert.ok(visualSegments.length > 0);
  assert.ok(visualSegments.every((segment) => segment.pexelsQuery === ""));
  assert.ok(visualSegments.every((segment) => segment.mustMatchTerms.length === 0));
  assert.ok(draft.assets.storyboard.path.startsWith(temporaryGeneratedDir));
});

test("longformStoryboard mempertahankan intent Pexels per segmen", () => {
  const visualSegments = [{
    imagePrompt: "workers inspect an oil pipeline",
    visualKeywords: "oil pipeline inspection",
    pexelsQuery: "oil workers inspect pipeline",
    mustMatchTerms: ["oil", "pipeline"],
    narrativeContext: "inspection process"
  }];
  const storyboard = buildLongformStoryboard({
    scenes: [{
      index: 1,
      sceneType: "image",
      durationSec: 20,
      screenText: "Pipeline Inspection",
      beatPurpose: "Explain inspection",
      visualKeywords: "oil pipeline inspection",
      imagePrompt: "workers inspect an oil pipeline",
      visualSegments,
      narration: "Workers inspect the pipeline."
    }]
  });

  assert.deepEqual(storyboard[0].visualSegments, visualSegments);
});
