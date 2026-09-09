const MEDIA = ["kompas.com", "detik.com", "cnnindonesia.com", "tempo.co", "antaranews.com", "liputan6.com"];
const CRITERIA = { minimumArticles: 5, minimumSources: 3, minimumDays: 3 };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: `Method ${req.method} tidak didukung.` });
  try {
    const pin = String(req.headers["x-dashboard-pin"] || "").trim();
    if (!process.env.AUTO_DASHBOARD_PIN || pin !== process.env.AUTO_DASHBOARD_PIN) {
      return res.status(process.env.AUTO_DASHBOARD_PIN ? 401 : 403).json({ error: "PIN dashboard tidak valid atau belum diisi." });
    }
    const feeds = await Promise.allSettled(MEDIA.map(async (domain) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${domain} when:7d`)}&hl=id&gl=ID&ceid=ID%3Aid`;
      const response = await fetch(url, { headers: { "User-Agent": "yt-longform-studio/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
      return parseFeed(await response.text(), domain);
    }));
    const items = feeds.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (!items.length) throw new Error("semua feed Google News gagal");
    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      criteria: CRITERIA,
      media: MEDIA,
      topics: findTopics(items)
    });
  } catch (error) {
    console.error("[api/trends]", error);
    res.status(502).json({ error: "Gagal mengambil tren berita." });
  }
}

function text(xml, tag) {
  return String(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

function parseFeed(xml, source) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const publishedAt = text(match[1], "pubDate");
    const title = text(match[1], "title").replace(/ - [^-]+$/, "");
    return { title, source, url: text(match[1], "link"), publishedAt, day: new Date(publishedAt).toISOString().slice(0, 10) };
  }).filter((item) => item.title && item.day);
}

function findTopics(items) {
  const stop = new Set("yang dan atau dari untuk pada dalam dengan ini itu saat hari terbaru update indonesia".split(" "));
  const phrases = new Map();
  for (const item of items) {
    const words = item.title.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, " ").split(/\s+/).filter((word) => word.length > 1 && !stop.has(word));
    for (let length = 2; length <= 4; length++) for (let start = 0; start <= words.length - length; start++) {
      const phrase = words.slice(start, start + length).join(" ");
      phrases.set(phrase, [...(phrases.get(phrase) || []), item]);
    }
  }
  return [...phrases].map(([phrase, matches]) => {
    const newsItems = [...new Map(matches.map((item) => [item.title, item])).values()];
    return { title: phrase.replace(/\b\w/g, (letter) => letter.toUpperCase()), articles: newsItems.length, sources: new Set(newsItems.map((item) => item.source)).size, days: new Set(newsItems.map((item) => item.day)).size, newsItems: newsItems.slice(0, 12) };
  }).filter((topic) => topic.articles >= CRITERIA.minimumArticles && topic.sources >= CRITERIA.minimumSources && topic.days >= CRITERIA.minimumDays)
    .sort((a, b) => b.articles - a.articles).slice(0, 20);
}