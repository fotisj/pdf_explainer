const crypto = require('crypto');
const OpenAI = require('openai');
const aiConfig = require('../config/aiConfig.js');
const openrouterModels = require('../utils/openrouterModels.js');

let apiKey = null;
let model = aiConfig.defaultModel;
let client = null;
// Free-form text the user adds in Settings; appended to the built-in system prompt.
let systemPromptAddition = '';

function setSystemPromptAddition(text) {
  systemPromptAddition = typeof text === 'string' ? text.trim() : '';
}

function buildSystemPrompt() {
  if (!systemPromptAddition) return aiConfig.systemPrompt;
  return `${aiConfig.systemPrompt}\n\nAdditional instructions from the user:\n${systemPromptAddition}`;
}

function updateSettings(newApiKey, newModel) {
  if (typeof newApiKey === 'string') apiKey = newApiKey;
  if (typeof newModel === 'string' && newModel.trim()) model = newModel.trim();
  client = apiKey
    ? new OpenAI({
        apiKey,
        baseURL: aiConfig.baseURL,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/adrirubio/ai-pdf-reader',
          'X-Title': 'PDF Explainer',
        },
      })
    : null;
}

function getModel() {
  return model;
}

// Hashed rather than sent raw so a local file path (which may embed the OS username) never
// leaves the machine; OpenRouter only needs a stable, opaque per-document id for sticky routing.
function sessionIdFor(documentPath) {
  if (!documentPath) return undefined;
  return crypto.createHash('sha256').update(documentPath).digest('hex').slice(0, 32);
}

function needsExplicitCacheControl(modelId) {
  return aiConfig.explicitCachePrefixes.some((prefix) => modelId.startsWith(prefix));
}

function buildDocumentBlock(documentText) {
  if (!documentText) return null;
  const block = { type: 'text', text: `Full text of the paper, for context:\n\n${documentText}` };
  if (needsExplicitCacheControl(model)) {
    block.cache_control = { type: 'ephemeral', ttl: '1h' };
  }
  return block;
}

function errorMessageFor(error) {
  // OpenRouter reports both thrown HTTP errors (`.status`) and in-band mid-stream errors
  // (a `{code, message}` object with no `choices`, see streamChatCompletion) via different
  // fields, so check both.
  const statusCode = typeof error?.status === 'number' ? error.status : (typeof error?.code === 'number' ? error.code : undefined);
  if (statusCode === 401) return 'OpenRouter rejected the API key. Check it in Settings.';
  if (statusCode === 429) return 'Rate limited by OpenRouter. Please try again shortly.';
  if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
    return `Connection error: could not reach OpenRouter. (${error.message})`;
  }
  return error?.message || 'Unknown error contacting OpenRouter.';
}

async function streamChatCompletion(wireMessages, documentPath, streamId, onChunk) {
  if (!client) {
    onChunk({ streamId, type: 'error', content: 'No OpenRouter API key configured. Set one in Settings.' });
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: wireMessages,
      stream: true,
      temperature: 0.5,
      max_tokens: 4096,
      session_id: sessionIdFor(documentPath),
    });

    let receivedContent = false;
    let finishReason = null;
    for await (const chunk of stream) {
      // OpenRouter sometimes reports a mid-stream failure (bad/unavailable model, provider
      // error, out of credits...) as an in-band `{error: {...}}` chunk with no `choices`,
      // rather than throwing an HTTP error — surface it instead of silently ending the stream.
      if (chunk.error) {
        onChunk({ streamId, type: 'error', content: errorMessageFor(chunk.error) });
        return;
      }
      const piece = chunk.choices?.[0]?.delta?.content || '';
      if (piece) {
        receivedContent = true;
        onChunk({ streamId, type: 'content', content: piece });
      }
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) {
        finishReason = reason;
        break;
      }
    }

    if (!receivedContent) {
      onChunk({
        streamId,
        type: 'error',
        content: 'The model returned no response. This can happen when OpenRouter or the underlying provider rejects the request without an explicit error — try a different model.',
      });
    } else if (finishReason === 'length') {
      onChunk({ streamId, type: 'content', content: "\n\n*(Response was cut off — it hit the model's output length limit.)*" });
    }
  } catch (error) {
    onChunk({ streamId, type: 'error', content: errorMessageFor(error) });
  }
}

/**
 * Runs (or continues) one marked-passage conversation.
 *
 * @param {object} payload
 * @param {Array<{role: 'user'|'assistant', text?: string, imageDataUrl?: string}>} payload.turns
 *   turns[0] is the user's (editable, already user-approved) prompt for the marked passage,
 *   plus an image if a region was marked; any further turns are plain follow-up text. The full
 *   array is resent every call (APIs are stateless) —
 *   documentText and turns[0] stay byte-identical across calls so provider-side prompt caching
 *   (see aiConfig.explicitCachePrefixes) can discount reprocessing that unchanged prefix.
 * @param {string} [payload.documentText] Full extracted text of the PDF, for grounding context.
 * @param {string} [payload.documentPath] Used only to derive a stable, hashed session id.
 * @param {string} streamId
 * @param {(chunk: {streamId: string, type: 'content'|'error', content: string}) => void} onChunk
 */
async function converseAndStream({ turns, documentText, documentPath }, streamId, onChunk) {
  if (!Array.isArray(turns) || turns.length === 0) {
    onChunk({ streamId, type: 'error', content: 'Nothing to send.' });
    return;
  }

  const [first, ...rest] = turns;

  if (first.imageDataUrl) {
    const info = await openrouterModels.getModelInfo(model).catch(() => null);
    if (info && info.supportsImages === false) {
      onChunk({
        streamId,
        type: 'error',
        content: `The selected model (${model}) doesn't support image input. Pick a vision-capable model in Settings to explain a marked region.`,
      });
      return;
    }
  }

  const firstContent = [];
  const documentBlock = buildDocumentBlock(documentText);
  if (documentBlock) firstContent.push(documentBlock);

  // first.text is already the user's fully composed prompt (they got a chance to edit it in the
  // UI before sending), so it's sent as-is rather than wrapped in another instruction template.
  if (first.text) {
    firstContent.push({ type: 'text', text: first.text });
  }
  if (first.imageDataUrl) {
    if (first.text) {
      firstContent.push({ type: 'text', text: '(Image of the marked region follows.)' });
    }
    firstContent.push({ type: 'image_url', image_url: { url: first.imageDataUrl } });
  }
  if (firstContent.length === 0) {
    onChunk({ streamId, type: 'error', content: 'Nothing was selected to explain.' });
    return;
  }

  const wireMessages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: firstContent },
    ...rest.map((turn) => ({ role: turn.role, content: turn.text || '' })),
  ];

  await streamChatCompletion(wireMessages, documentPath, streamId, onChunk);
}

/**
 * One-shot (non-streaming) call that condenses an already-had conversation into a short
 * standalone abstract, suitable for saving as a PDF annotation note in place of the raw
 * last reply. Takes the same turns shape as converseAndStream.
 *
 * @param {object} payload
 * @param {Array<{role: 'user'|'assistant', text?: string, imageDataUrl?: string}>} payload.turns
 * @param {string} [payload.documentText]
 * @param {string} [payload.documentPath]
 * @returns {Promise<{success: true, text: string} | {success: false, error: string}>}
 */
async function summarizeConversation({ turns, documentText, documentPath }) {
  if (!client) {
    return { success: false, error: 'No OpenRouter API key configured. Set one in Settings.' };
  }
  if (!Array.isArray(turns) || turns.length === 0) {
    return { success: false, error: 'Nothing to summarize.' };
  }

  const [first, ...rest] = turns;

  const firstContent = [];
  const documentBlock = buildDocumentBlock(documentText);
  if (documentBlock) firstContent.push(documentBlock);
  if (first.text) firstContent.push({ type: 'text', text: first.text });
  if (first.imageDataUrl) {
    if (first.text) firstContent.push({ type: 'text', text: '(Image of the marked region follows.)' });
    firstContent.push({ type: 'image_url', image_url: { url: first.imageDataUrl } });
  }

  const wireMessages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: firstContent },
    ...rest.map((turn) => ({ role: turn.role, content: turn.text || '' })),
    { role: 'user', content: aiConfig.abstractPrompt },
  ];

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: wireMessages,
      temperature: 0.3,
      max_tokens: 300,
      session_id: sessionIdFor(documentPath),
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) return { success: false, error: 'The model returned an empty response.' };
    return { success: true, text };
  } catch (error) {
    return { success: false, error: errorMessageFor(error) };
  }
}

module.exports = { updateSettings, getModel, converseAndStream, summarizeConversation, setSystemPromptAddition, buildSystemPrompt };
