import { test } from "node:test";
import assert from "node:assert/strict";
import { requestKnowledgeJson } from "../src/openai.js";
import { config } from "../src/config.js";

const chatBody = (payload) => JSON.stringify({
  choices: [{ message: { content: JSON.stringify(payload) } }]
});

// Retry-After: 0 membuat jeda retry 0ms, jadi test tidak menunggu detik nyata.
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === "function") return next();
    return next;
  };
  return calls;
}

function tooManyRequests() {
  return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
    status: 429,
    headers: { "Retry-After": "0" }
  });
}

async function withStub(responses, fn) {
  const originalFetch = globalThis.fetch;
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  const calls = stubFetch(responses);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
    config.openai.apiKey = originalKey;
  }
}

test("openAiFetch: 429 dicoba ulang lalu sukses", async () => {
  await withStub(
    [tooManyRequests, tooManyRequests, () => new Response(chatBody({ ok: 1 }), { status: 200 })],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 1 });
      assert.equal(calls.length, 3);
    }
  );
});

test("openAiFetch: 5xx dicoba ulang lalu sukses", async () => {
  await withStub(
    [
      () => new Response("upstream down", { status: 503, headers: { "Retry-After": "0" } }),
      () => new Response(chatBody({ ok: 2 }), { status: 200 })
    ],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 2 });
      assert.equal(calls.length, 2);
    }
  );
});

test("openAiFetch: 429 terus-menerus berhenti di 3 percobaan, bukan loop", async () => {
  await withStub([tooManyRequests], async (calls) => {
    await assert.rejects(() => requestKnowledgeJson("prompt"), /Rate limit reached/);
    assert.equal(calls.length, 3);
  });
});

test("openAiFetch: 400 tidak dicoba ulang", async () => {
  await withStub(
    [() => new Response(JSON.stringify({ error: { message: "invalid prompt" } }), { status: 400 })],
    async (calls) => {
      await assert.rejects(() => requestKnowledgeJson("prompt"), /invalid prompt/);
      assert.equal(calls.length, 1);
    }
  );
});

// Timeout tidak di-retry: request yang sudah diproses server tetap ditagih.
test("openAiFetch: timeout gagal cepat dengan pesan jelas", async () => {
  await withStub(
    [() => { const error = new Error("aborted"); error.name = "TimeoutError"; throw error; }],
    async (calls) => {
      await assert.rejects(() => requestKnowledgeJson("prompt"), /tidak merespons dalam 120s/);
      assert.equal(calls.length, 1);
    }
  );
});

test("openAiFetch: error jaringan dicoba ulang", async () => {
  let attempts = 0;
  await withStub(
    [() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return new Response(chatBody({ ok: 3 }), { status: 200 });
    }],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 3 });
      assert.equal(calls.length, 2);
    }
  );
});
