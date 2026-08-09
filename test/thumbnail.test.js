import test from "node:test";
import assert from "node:assert/strict";
import { rankStoryboardImages } from "../src/thumbnail.js";

test("rankStoryboardImages: memilih gambar storyboard yang paling sesuai dengan judul", () => {
  const ranked = rankStoryboardImages({
    title: "Kenapa Madu Tidak Pernah Basi",
    input: { topic: "madu tidak basi" },
    plan: {
      scenes: [
        { index: 0, imagePrompt: "deep ocean trench at night", visualSegments: [] },
        {
          index: 3,
          imagePrompt: "ancient honey jars and honeycomb close up",
          screenText: "Madu tidak pernah basi",
          visualSegments: []
        }
      ]
    },
    assets: {
      images: [
        { sceneIndex: 0, segmentIndex: 0, path: "/images/ocean.jpg", provider: "openai", prompt: "deep ocean" },
        { sceneIndex: 3, segmentIndex: 0, path: "/images/honey.jpg", provider: "openai", prompt: "honey jars" }
      ]
    }
  });

  assert.equal(ranked[0].image.path, "/images/honey.jpg");
  assert.ok(ranked[0].score > ranked[1].score);
});
