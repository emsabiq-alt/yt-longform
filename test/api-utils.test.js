// Unit test fungsi murni di api/_utils.js — validasi input, auth helper, queue helper.
// Jalankan: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clean,
  clampStr,
  clampNum,
  boolInput,
  safeEqual,
  issueSessionToken,
  buildQueueItem,
  upsertById,
  removeById,
  makeId,
  check,
  remoteMissingEnv
} from "../api/_utils.js";

test("clean: trim string, null/undefined → ''", () => {
  assert.equal(clean("  hi  "), "hi");
  assert.equal(clean(null), "");
  assert.equal(clean(undefined), "");
});

test("clampStr: trim lalu potong ke panjang maksimum", () => {
  assert.equal(clampStr("  hello  "), "hello");
  assert.equal(clampStr("abcdef", 3), "abc");
  assert.equal(clampStr(null), "");
});

test("clampNum: jaga nilai dalam rentang, fallback saat bukan angka", () => {
  assert.equal(clampNum(5, 0, 10, 1), 5);
  assert.equal(clampNum(-5, 0, 10, 1), 0);    // di bawah min
  assert.equal(clampNum(50, 0, 10, 1), 10);   // di atas max
  assert.equal(clampNum("8", 0, 10, 1), 8);   // string numerik diterima
  assert.equal(clampNum("abc", 0, 10, 7), 7); // NaN → fallback
  assert.equal(clampNum(undefined, 0, 10, 3), 3);
});

test("boolInput: parsing nilai truthy/falsey + fallback", () => {
  for (const v of [true, "true", "1", "yes", "on", "YES"]) assert.equal(boolInput(v), true);
  for (const v of [false, "false", "0", "no", "nope"]) assert.equal(boolInput(v), false);
  assert.equal(boolInput(undefined, true), true); // kosong → fallback
  assert.equal(boolInput("", true), true);
  assert.equal(boolInput(null), false);           // fallback default
});

test("safeEqual: benar untuk sama, salah untuk beda (termasuk beda panjang)", () => {
  assert.equal(safeEqual("rahasia", "rahasia"), true);
  assert.equal(safeEqual("rahasia", "rahasiaX"), false); // beda panjang tetap aman
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("issueSessionToken: format v1.<exp>.<sig> dengan kedaluwarsa ~30 hari ke depan", () => {
  const token = issueSessionToken();
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "v1");
  const exp = Number(parts[1]);
  assert.ok(Number.isFinite(exp));
  const days = (exp - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29 && days <= 30, `expected ~30 hari, dapat ${days}`);
  assert.ok(parts[2].length > 0); // ada signature
});

test("buildQueueItem: durasi di-clamp ke rentang [300, 900]", () => {
  assert.equal(buildQueueItem({ durationSec: 100 }).durationSec, 300);  // dinaikkan ke min
  assert.equal(buildQueueItem({ durationSec: 5000 }).durationSec, 900); // dipotong ke max
  assert.equal(buildQueueItem({ durationSec: 420 }).durationSec, 420);  // di dalam rentang
});

test("buildQueueItem: sceneCount di-clamp ke atas 60, nilai falsy (0) → default", () => {
  assert.equal(buildQueueItem({ sceneCount: 100 }).sceneCount, 60); // dipotong ke max
  assert.equal(buildQueueItem({ sceneCount: 30 }).sceneCount, 30);  // di dalam rentang
  // Catatan: 0 itu falsy → `0 || default` jatuh ke 14, bukan di-clamp ke 1.
  assert.equal(buildQueueItem({ sceneCount: 0 }).sceneCount, 14);
});

test("buildQueueItem: ttsProvider hanya 'openai' atau 'elevenlabs'", () => {
  assert.equal(buildQueueItem({ ttsProvider: "openai" }).ttsProvider, "openai");
  assert.equal(buildQueueItem({ ttsProvider: "elevenlabs" }).ttsProvider, "elevenlabs");
  assert.equal(buildQueueItem({ ttsProvider: "tidak-dikenal" }).ttsProvider, "elevenlabs"); // default
});

test("buildQueueItem: trim topik, hormati id yang diberikan, auto-id kalau kosong", () => {
  assert.equal(buildQueueItem({ topic: "  Lubang Hitam  " }).topic, "Lubang Hitam");
  assert.equal(buildQueueItem({ id: "id-manual" }).id, "id-manual");
  assert.match(buildQueueItem({}).id, /^q_/);
  // createdAt & updatedAt berupa ISO timestamp
  const item = buildQueueItem({});
  assert.ok(!Number.isNaN(Date.parse(item.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(item.updatedAt)));
});

test("upsertById: insert item baru, merge item yang sudah ada, tanpa mutasi sumber", () => {
  const base = [{ id: "a", x: 1, y: 2 }];
  const inserted = upsertById(base, { id: "b", x: 9 });
  assert.deepEqual(inserted, [{ id: "a", x: 1, y: 2 }, { id: "b", x: 9 }]);

  const updated = upsertById(base, { id: "a", x: 99 });
  assert.deepEqual(updated, [{ id: "a", x: 99, y: 2 }]); // x ditimpa, y dipertahankan
  assert.deepEqual(base, [{ id: "a", x: 1, y: 2 }]);      // sumber tidak berubah

  assert.deepEqual(upsertById(null, { id: "a" }), [{ id: "a" }]); // non-array → []
});

test("removeById: buang berdasarkan id, aman untuk non-array", () => {
  assert.deepEqual(removeById([{ id: "a" }, { id: "b" }], "a"), [{ id: "b" }]);
  assert.deepEqual(removeById([], "a"), []);
  assert.deepEqual(removeById(null, "x"), []);
});

test("makeId: format <prefix>_<14 digit>_<4 hex>", () => {
  assert.match(makeId("q"), /^q_\d{14}_[0-9a-f]{4}$/);
  assert.match(makeId("item"), /^item_\d{14}_[0-9a-f]{4}$/);
});

test("check: bungkus hasil cek dengan default yang benar", () => {
  assert.deepEqual(check("x", 1), { name: "x", ok: true, detail: "", required: true });
  assert.deepEqual(check("y", 0, "gagal", false), { name: "y", ok: false, detail: "gagal", required: false });
});

test("remoteMissingEnv: deteksi env wajib yang kosong; privateKey menggantikan password", () => {
  const allMissing = remoteMissingEnv({
    prefix: "SFTP", host: "", user: "", password: "", privateKey: "", remoteDir: ""
  });
  assert.deepEqual(allMissing, ["SFTP_HOST", "SFTP_USER", "SFTP_PASSWORD", "SFTP_REMOTE_DIR"]);

  // privateKey terisi → PASSWORD tidak dianggap kurang
  const withKey = remoteMissingEnv({
    prefix: "SFTP", host: "h", user: "u", password: "", privateKey: "kunci", remoteDir: "/d"
  });
  assert.deepEqual(withKey, []);
});
