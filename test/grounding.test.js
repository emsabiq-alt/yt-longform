// Unit test fungsi murni grounding Wikipedia (tanpa jaringan):
// - buildSearchQuery: membersihkan pertanyaan jadi query pencarian.
// - buildSourcesBlock & buildDescription: atribusi sumber CC BY-SA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchQuery } from "../src/wikipedia.js";
import { buildSourcesBlock, buildDescription } from "../src/youtube-meta.js";

test("buildSearchQuery: membuang kata tanya di awal", () => {
  assert.equal(buildSearchQuery("Kenapa madu tidak pernah basi?"), "madu tidak pernah basi");
  assert.equal(buildSearchQuery("Mengapa langit malam gelap"), "langit malam gelap");
  assert.equal(buildSearchQuery("Bagaimana kompas tahu arah utara"), "kompas tahu arah utara");
});

test("buildSearchQuery: kuat terhadap input kosong/aneh", () => {
  assert.equal(buildSearchQuery(""), "");
  // Bila strip menyisakan kosong, fallback ke topik asli agar query tak pernah kosong.
  assert.equal(buildSearchQuery("   apa   "), "apa");
  // Frasa dengan kata non-tanya tetap dipertahankan.
  assert.equal(buildSearchQuery("Apa itu fotosintesis"), "itu fotosintesis");
});

test("buildSourcesBlock: menyusun atribusi saat ada sumber", () => {
  const item = {
    plan: {
      sources: [
        { title: "Madu", url: "https://id.wikipedia.org/wiki/Madu" },
        { title: "Lebah madu", url: "https://id.wikipedia.org/wiki/Lebah_madu" }
      ]
    }
  };
  const block = buildSourcesBlock(item);
  assert.match(block, /Sumber & referensi fakta:/);
  assert.match(block, /https:\/\/id\.wikipedia\.org\/wiki\/Madu/);
  assert.match(block, /CC BY-SA/);
});

test("buildSourcesBlock: kosong saat tidak ada sumber & dedup URL", () => {
  assert.equal(buildSourcesBlock({ plan: {} }), "");
  const dup = {
    plan: {
      sources: [
        { title: "Madu", url: "https://id.wikipedia.org/wiki/Madu" },
        { title: "Madu (duplikat)", url: "https://id.wikipedia.org/wiki/Madu" }
      ]
    }
  };
  const block = buildSourcesBlock(dup);
  const occurrences = block.split("https://id.wikipedia.org/wiki/Madu").length - 1;
  assert.equal(occurrences, 1);
});

test("buildDescription: menyertakan blok sumber bila plan.sources ada", () => {
  const withSource = buildDescription({
    title: "Rahasia Madu",
    plan: {
      hook: "Madu bisa awet ribuan tahun.",
      summary: "Pembahasan tentang kenapa madu tidak basi.",
      importantPoints: ["Kadar air rendah", "pH asam"],
      sources: [{ title: "Madu", url: "https://id.wikipedia.org/wiki/Madu" }]
    },
    input: { category: "makanan dan dapur" }
  });
  assert.match(withSource, /CC BY-SA/);

  const withoutSource = buildDescription({
    title: "Rahasia Madu",
    plan: {
      hook: "Madu bisa awet ribuan tahun.",
      summary: "Pembahasan tentang kenapa madu tidak basi.",
      importantPoints: ["Kadar air rendah"]
    },
    input: { category: "makanan dan dapur" }
  });
  assert.doesNotMatch(withoutSource, /Sumber & referensi fakta/);
});
