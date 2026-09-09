const FEED_URL = "https://news.google.com/rss/search?q=%28%22gunung%20api%22%20OR%20erupsi%20OR%20gempa%20OR%20tsunami%20OR%20banjir%20OR%20longsor%20OR%20kebakaran%20OR%20penemuan%20OR%20penelitian%20OR%20arkeologi%20OR%20NASA%20OR%20teknologi%20OR%20kesehatan%20OR%20lingkungan%29%20when%3A7d&hl=id&gl=ID&ceid=ID%3Aid";

const STOP_WORDS = new Set([
  "yang", "dan", "atau", "dari", "untuk", "pada", "dalam", "dengan", "ini", "itu", "saat", "kini",
  "hari", "terbaru", "update", "akibat", "soal", "jadi", "akan", "telah", "masih", "kembali", "indonesia",
  "karena", "sebagai", "oleh", "tentang", "setelah", "hingga", "warga", "waspada", "resmi", "begini", "berikut"
]);

const GENERIC_WORDS = new Set([
  "aktivitas", "api", "bencana", "dampak", "erupsi", "gempa", "guncang", "gunung", "kebakaran", "longsor",
  "penelitian", "penemuan", "teknologi", "tsunami", "banjir", "terjadi", "terus", "wilayah"
]);

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(
      code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10)
    ))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tag(xml, name) {
  return decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

function normalizedWords(title) {
  return title.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, " ").split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function titleCase(value) {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function parseGoogleNewsRss(xml = "") {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const publishedAt = tag(item, "pubDate");
    return {
      title: tag(item, "title"),
      source: tag(item, "source") || "Media Nasional",
      url: tag(item, "link"),
      publishedAt,
      day: Number.isNaN(Date.parse(publishedAt)) ? "" : new Date(publishedAt).toISOString().slice(0, 10)
    };
  }).filter((item) => item.title && item.day);
}

export function findSustainedNewsTopics(items = [], options = {}) {
  const minimumArticles = options.minimumArticles || 5;
  const minimumSources = options.minimumSources || 3;
  const minimumDays = options.minimumDays || 3;
  const phrases = new Map();

  for (const item of items) {
    const words = normalizedWords(item.title);
    for (let length = 2; length <= 4; length++) {
      for (let start = 0; start <= words.length - length; start++) {
        const phrase = words.slice(start, start + length).join(" ");
        if (words.slice(start, start + length).every((word) => GENERIC_WORDS.has(word))) continue;
        const matches = phrases.get(phrase) || [];
        matches.push(item);
        phrases.set(phrase, matches);
      }
    }
  }

  const candidates = [...phrases].map(([phrase, matches]) => {
    const unique = [...new Map(matches.map((item) => [item.title, item])).values()];
    const sources = new Set(unique.map((item) => item.source));
    const days = new Set(unique.map((item) => item.day));
    return {
      phrase,
      title: titleCase(phrase),
      articles: unique.length,
      sources: sources.size,
      days: days.size,
      publishedAt: unique.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]?.publishedAt || "",
      newsTitle: unique[0]?.title || "",
      newsSource: unique[0]?.source || "",
      newsUrl: unique[0]?.url || "",
      newsItems: unique.slice(0, 12)
    };
  }).filter((topic) => topic.articles >= minimumArticles && topic.sources >= minimumSources && topic.days >= minimumDays);

  for (const topic of candidates) {
    const longer = candidates
      .filter((other) => other.phrase !== topic.phrase && ` ${other.phrase} `.includes(` ${topic.phrase} `))
      .filter((other) => other.days >= topic.days && other.sources >= topic.sources * 0.5 && other.articles >= topic.articles * 0.35)
      .sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length)[0];
    if (longer) topic.canonicalPhrase = longer.phrase;
  }

  return candidates
    .filter((topic) => !topic.canonicalPhrase)
    .sort((a, b) => (b.days * 100 + b.sources * 10 + Math.min(b.articles, 30)) -
      (a.days * 100 + a.sources * 10 + Math.min(a.articles, 30)));
}

export async function fetchSustainedNewsTopics(fetchImpl = fetch) {
  const response = await fetchImpl(FEED_URL, {
    headers: { "User-Agent": "yt-longform-studio/1.0" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  return findSustainedNewsTopics(parseGoogleNewsRss(await response.text()));
}

export async function fetchTopSustainedNewsTopic(fetchImpl = fetch) {
  return (await fetchSustainedNewsTopics(fetchImpl))[0] || null;
}