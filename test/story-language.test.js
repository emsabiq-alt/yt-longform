import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeSentences,
  isGenericStoryboardText,
  polishPlanForLayAudience,
  simplifyForLayAudience
} from "../src/story-language.js";

test("simplifyForLayAudience mengganti istilah kaku menjadi bahasa awam", () => {
  const text = simplifyForLayAudience("Efek domino ini punya implikasi dan mekanisme yang kompleks.");
  assert.equal(text, "rangkaian akibat ini punya arti dan cara kerja yang rumit.");
});

test("dedupeSentences membuang kalimat yang sama atau terlalu mirip", () => {
  const text = dedupeSentences("Madu bisa awet lama. Madu bisa awet lama. Itulah sebabnya madu sering ditemukan masih layak.");
  assert.equal(text, "Madu bisa awet lama. Itulah sebabnya madu sering ditemukan masih layak.");
});

test("isGenericStoryboardText mengenali label storyboard yang terlalu umum", () => {
  assert.equal(isGenericStoryboardText("Pertanyaan Besar 1"), true);
  assert.equal(isGenericStoryboardText("Efek Domino 6"), true);
  assert.equal(isGenericStoryboardText("Kenapa Madu Awet Lama"), false);
});

test("polishPlanForLayAudience membuat screenText non-summary unik dan lebih konkret", () => {
  const plan = {
    title: "Kenapa Efek Domino dari Madu Begitu Besar",
    hook: "Apa implikasi dari madu yang tidak basi?",
    summary: "Madu awet lama karena kadar airnya rendah. Madu awet lama karena kadar airnya rendah.",
    importantPoints: [
      "Implikasi utama madu ada pada cara penyimpanannya.",
      "Implikasi utama madu ada pada cara penyimpanannya."
    ],
    factCheckNote: "Periksa mekanisme ilmiahnya.",
    scenes: [
      {
        index: 1,
        sceneType: "image",
        narration: "Madu bisa awet lama karena kadar airnya rendah dan lingkungannya tidak ramah bagi mikroba.",
        screenText: "Pertanyaan Besar",
        chapter: "Analisis utama",
        beatPurpose: "Membuka data, sejarah, atau mekanisme penyebab.",
        visualSegments: [{ narrativeContext: "mekanisme madu awet" }]
      },
      {
        index: 2,
        sceneType: "image",
        narration: "Lebah juga menambahkan enzim yang membantu menjaga madu tetap stabil lebih lama.",
        screenText: "Pertanyaan Besar",
        chapter: "Analisis utama",
        beatPurpose: "Membuka data, sejarah, atau mekanisme penyebab.",
        visualSegments: [{ narrativeContext: "implikasi enzim lebah" }]
      },
      {
        index: 3,
        sceneType: "summary",
        narration: "Intinya, madu awet karena air rendah, sifat asam, dan bantuan enzim lebah.",
        screenText: "Ringkasan Inti",
        chapter: "Kesimpulan",
        beatPurpose: "Menutup cerita."
      }
    ]
  };

  const polished = polishPlanForLayAudience(plan, { topic: "madu" });
  const screenTexts = polished.scenes
    .filter((scene) => scene.sceneType !== "summary")
    .map((scene) => scene.screenText);

  assert.deepEqual(new Set(screenTexts).size, screenTexts.length);
  assert.ok(screenTexts.every((text) => !isGenericStoryboardText(text)));
  assert.doesNotMatch(JSON.stringify(polished), /efek domino|implikasi|mekanisme|Analisis utama/i);
});
