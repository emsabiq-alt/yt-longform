/**
 * api/research.js
 * Cari fakta dari Google News berdasarkan query manual dari user.
 * Berbeda dari /api/trends: tidak pakai scoring/dedup, langsung cari
 * artikel relevan dan scrape isinya untuk dijadikan bahan video.
 */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: `Method ${req.method} tidak didukung.` });

  const pin = String(req.headers["x-dashboard-pin"] || "").trim();
  if (!process.env.AUTO_DASHBOARD_PIN || pin !== process.env.AUTO_DASHBOARD_PIN) {
    return res.status(process.env.AUTO_DASHBOARD_PIN ? 401 : 403).json({ error: "PIN tidak valid." });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== "string" || query.trim().length < 5) {
    return res.status(400).json({ error: "Query minimal 5 karakter." });
  }

  try {
    const q = query.trim().slice(0, 200);

    // Cari di Google News RSS
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:30d")}&hl=id&gl=ID&ceid=ID%3Aid`;
    const rssRes = await fetch(rssUrl, {
      headers: { "User-Agent": "yt-longform-studio/1.0" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!rssRes.ok) throw new Error(`Google News RSS HTTP ${rssRes.status}`);

    const xml = await rssRes.text();
    const rawItems = parseRss(xml);
    if (!rawItems.length) {
      return res.status(200).json({ query: q, articles: [], message: "Tidak ada berita ditemukan untuk topik ini." });
    }

    // Ambil top 8 artikel dan scrape isinya + og:image secara paralel
    const top = rawItems.slice(0, 8);
    await Promise.allSettled(top.map(async (item) => {
      if (!item.url) return;
      const scraped = await scrapeArticle(item.url);
      item.excerpt = scraped?.excerpt || null;
      item.imageUrl = scraped?.imageUrl || null;
    }));

    return res.status(200).json({
      query: q,
      fetchedAt: new Date().toISOString(),
      articles: top
    });
  } catch (err) {
    console.error("[api/research]", err);
    return res.status(502).json({ error: "Gagal mencari berita. Coba lagi." });
  }
}

function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const rawTitle = textTag(match[1], "title").replace(/ - [^-]{2,40}$/, "").trim();
    const url = textTag(match[1], "link");
    const publishedAt = textTag(match[1], "pubDate");
    const source = textTag(match[1], "source") || detectSource(url);
    const day = (() => { try { return new Date(publishedAt).toISOString().slice(0, 10); } catch { return ""; } })();
    return { title: rawTitle, outlet: source, url, publishedAt, day };
  }).filter((it) => it.title && it.title.length > 8);
}

function textTag(xml, tag) {
  return String(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function detectSource(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

async function scrapeArticle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
      },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();

    // Ekstrak og:image
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    const imageUrl = imgMatch?.[1]?.trim() || null;

    // Ekstrak teks artikel
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside|figure|figcaption|form|button|iframe|noscript|menu)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ").trim();
    const excerpt = clean.length >= 100 ? clean.slice(0, 700).trim() : null;

    return { excerpt, imageUrl };
  } catch {
    return null;
  }
}
