const imageUsd = {
  "1024x1024": { low: 0.005, medium: 0.011, high: 0.036 },
  "1024x1536": { low: 0.006, medium: 0.015, high: 0.05 },
  "1536x1024": { low: 0.006, medium: 0.015, high: 0.05 }
};

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function estimateImageUsd(size, quality) {
  return imageUsd[size]?.[quality] ?? imageUsd["1024x1536"].low;
}

export function estimateTtsUsd(chars, provider, pricing) {
  const count = Math.max(0, Number(chars || 0));
  if (provider === "elevenlabs") return roundUsd((count / 1000) * pricing.elevenlabsTtsUsdPer1KChars);
  return roundUsd((count / 1_000_000) * pricing.openaiTtsUsdPer1MChars);
}

export function estimateVideoUsd(seconds, pricing) {
  return roundUsd(Math.max(0, Number(seconds || 0)) * pricing.videoUsdPerSecond);
}

export function estimateTotalCost({ promptText, outputText, sceneCount, imageSize, imageQuality, narrationChars, ttsProvider, pricing }) {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateTokens(outputText);
  const storyUsd = (inputTokens / 1_000_000) * pricing.storyInputUsdPer1MTokens
    + (outputTokens / 1_000_000) * pricing.storyOutputUsdPer1MTokens;
  const imageUnitUsd = estimateImageUsd(imageSize, imageQuality);
  const imageTotalUsd = sceneCount * imageUnitUsd;
  const ttsUsd = estimateTtsUsd(narrationChars, ttsProvider, pricing);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    storyUsd: roundUsd(storyUsd),
    imageUnitUsd: roundUsd(imageUnitUsd),
    imageUsd: roundUsd(imageTotalUsd),
    ttsUsd,
    totalUsd: roundUsd(storyUsd + imageTotalUsd + ttsUsd)
  };
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(5));
}
