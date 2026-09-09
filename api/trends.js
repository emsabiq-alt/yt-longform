import { fetchSustainedNewsTopics, SUSTAINED_NEWS_CRITERIA, SUSTAINED_NEWS_MEDIA } from "../src/google-news-trends.js";
import { methodAllowed, requireAuth, sendError, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"]) || !requireAuth(req, res)) return;
  try {
    sendJson(res, 200, {
      fetchedAt: new Date().toISOString(),
      criteria: SUSTAINED_NEWS_CRITERIA,
      media: SUSTAINED_NEWS_MEDIA,
      topics: await fetchSustainedNewsTopics()
    });
  } catch (error) {
    sendError(res, error, 502);
  }
}