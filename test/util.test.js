// Unit test fungsi murni di src/util.js — pakai test runner bawaan Node (node:test).
// Jalankan: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createId,
  clamp,
  cleanText,
  slugify,
  safeFilename,
  splitLines,
  alignCaptionsToSource,
  normalizeTtsText
} from "../src/util.js";

test("clamp membatasi nilai ke rentang [min, max]", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);   // di bawah min → min
  assert.equal(clamp(50, 0, 10), 10);  // di atas max → max
});

test("createId menghasilkan id dengan prefix + 12 hex", () => {
  assert.match(createId("tau"), /^tau_[0-9a-f]{12}$/);
  assert.match(createId("q"), /^q_[0-9a-f]{12}$/);
  assert.match(createId(), /^tau_[0-9a-f]{12}$/); // prefix default
});

test("cleanText merapatkan spasi dan menangani input kosong", () => {
  assert.equal(cleanText("  a   b  "), "a b");
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
});

test("cleanText memotong di batas kata (tidak memotong tengah kata)", () => {
  // panjang > max → potong, lalu buang kata terakhir yang kepotong
  assert.equal(cleanText("satu dua tiga", 7), "satu");
  assert.equal(cleanText("halo", 100), "halo"); // di bawah max → utuh
});

test("slugify membuat slug aman, fallback ke 'banyaktau'", () => {
  assert.equal(slugify("Hello World!"), "hello-world");
  assert.equal(slugify("  Judul   Keren  "), "judul-keren");
  assert.equal(slugify(""), "banyaktau");      // kosong → fallback
  assert.equal(slugify("!!!"), "banyaktau");   // tanpa alnum → fallback
});

test("safeFilename = slug dipotong maksimum 70 karakter", () => {
  assert.equal(safeFilename("Hello World"), "hello-world");
  const long = safeFilename("a".repeat(200));
  assert.ok(long.length <= 70);
});

test("splitLines membungkus baris sesuai maxChars", () => {
  assert.deepEqual(splitLines("satu dua tiga empat", 9), ["satu dua", "tiga", "empat"]);
});

test("splitLines membatasi jumlah baris ke maxLines", () => {
  assert.deepEqual(splitLines("a b c d e f g h", 1, 2), ["a", "b"]);
});

test("alignCaptionsToSource: input kosong/segmen invalid → []", () => {
  assert.deepEqual(alignCaptionsToSource("", [{ start: 0, end: 1 }]), []);
  assert.deepEqual(alignCaptionsToSource("a b", []), []);
  assert.deepEqual(alignCaptionsToSource("a b", [{ start: 2, end: 1 }]), []); // end <= start
});

test("alignCaptionsToSource: satu segmen menampung seluruh teks sumber", () => {
  const out = alignCaptionsToSource("satu dua tiga empat", [{ start: 0, end: 4 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "satu dua tiga empat");
  assert.equal(out[0].start, 0);
  assert.equal(out[0].end, 4);
});

test("alignCaptionsToSource: tidak ada kata yang hilang/terduplikasi, segmen terakhir ambil sisa", () => {
  const out = alignCaptionsToSource("a b c d e", [
    { start: 0, end: 1 },
    { start: 1, end: 2 }
  ]);
  assert.equal(out.length, 2);
  // gabungan semua teks segmen harus sama persis dengan sumber
  assert.equal(out.map((s) => s.text).join(" "), "a b c d e");
  assert.equal(out[0].start, 0);
  assert.equal(out[out.length - 1].end, 2);
});

test("normalizeTtsText mengubah angka jadi kata Bahasa Indonesia", () => {
  assert.equal(normalizeTtsText("5"), "lima");
  assert.equal(normalizeTtsText("10"), "sepuluh");
  assert.equal(normalizeTtsText("ada 3 kucing"), "ada tiga kucing");
});

test("normalizeTtsText mengembangkan simbol & singkatan", () => {
  assert.equal(normalizeTtsText("100%"), "seratus persen");
  assert.equal(normalizeTtsText("AI"), "kecerdasan buatan");
  assert.equal(normalizeTtsText("vs"), "versus");
  assert.equal(normalizeTtsText("5 km/jam"), "lima kilometer per jam");
});

test("normalizeTtsText merapatkan spasi & menangani input kosong", () => {
  assert.equal(normalizeTtsText(""), "");
  assert.equal(normalizeTtsText("  halo    dunia  "), "halo dunia");
});
