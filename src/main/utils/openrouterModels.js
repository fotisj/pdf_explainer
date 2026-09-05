// Fetches and caches OpenRouter's public model catalog so we can tell the user (and ourselves)
// whether a given model supports image input and prompt caching, instead of hardcoding a list
// that would go stale as OpenRouter adds/changes models.
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache = { models: null, fetchedAt: 0 };
let inFlight = null;

function toModelInfo(raw) {
  const inputModalities = raw.architecture?.input_modalities || [];
  const pricing = raw.pricing || {};
  return {
    id: raw.id,
    name: raw.name || raw.id,
    contextLength: raw.context_length || raw.top_provider?.context_length || null,
    supportsImages: Array.isArray(inputModalities) && inputModalities.includes('image'),
    supportsCaching: Boolean(pricing.input_cache_read || pricing.input_cache_write),
  };
}

async function fetchModels() {
  const now = Date.now();
  if (cache.models && now - cache.fetchedAt < CACHE_TTL_MS) return cache.models;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetch(MODELS_URL);
    if (!response.ok) throw new Error(`OpenRouter models request failed: ${response.status}`);
    const json = await response.json();
    const models = (json.data || []).map(toModelInfo);
    cache = { models, fetchedAt: Date.now() };
    return models;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function listModels() {
  try {
    return await fetchModels();
  } catch (error) {
    console.error('Failed to fetch OpenRouter model list:', error);
    return cache.models || [];
  }
}

async function getModelInfo(modelId) {
  if (!modelId) return null;
  const models = await listModels();
  return models.find((m) => m.id === modelId) || null;
}

module.exports = { listModels, getModelInfo };
