const FEED_URL = "https://trends.google.com/trending/rss?geo=ID";

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

export function parseTrendTraffic(value = "") {
  const normalized = String(value).toUpperCase().replace(/,/g, "").replace(/\s+/g, "");
  const amount = Number.parseFloat(normalized) || 0;
  if (normalized.includes("M")) return amount * 1_000_000;
  if (normalized.includes("K")) return amount * 1_000;
  return amount;
}

export function parseGoogleTrendsRss(xml = "") {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const item = match[1];
      const title = tag(item, "title");
      const approxTraffic = tag(item, "ht:approx_traffic");
      return {
        title,
        approxTraffic,
        traffic: parseTrendTraffic(approxTraffic),
        publishedAt: tag(item, "pubDate"),
        newsTitle: tag(item, "ht:news_item_title"),
        newsSource: tag(item, "ht:news_item_source"),
        newsUrl: tag(item, "ht:news_item_url")
      };
    })
    .filter((item) => item.title && item.traffic > 0)
    .sort((a, b) => b.traffic - a.traffic);
}

export async function fetchGoogleTrends(fetchImpl = fetch) {
  const response = await fetchImpl(FEED_URL, {
    headers: { "User-Agent": "yt-longform-studio/1.0" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Google Trends HTTP ${response.status}`);
  return parseGoogleTrendsRss(await response.text());
}

export async function fetchTopGoogleTrend(fetchImpl = fetch) {
  return (await fetchGoogleTrends(fetchImpl))[0] || null;
}