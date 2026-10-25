async function ollama(path, body, signal) {
  let response, data;
  const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT_MS || 300000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300000;
  try {
    response = await fetch(`${process.env.OLLAMA_HOST || "http://localhost:11434"}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: false }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === 'TimeoutError' || error.cause?.code === 'UND_ERR_HEADERS_TIMEOUT') {
      throw Object.assign(new Error('The local AI model took too long to respond. Retry with the same campaign settings to resume saved progress.'), {status:504, cause:error});
    }
    throw Object.assign(new Error('Could not read a response from Ollama. Check that Ollama is running, then retry to resume saved progress.'), {status:502, cause:error});
  }
  if (!response.ok)
    throw Object.assign(new Error(`Ollama returned ${response.status}`), {
      status: 502,
    });
  if (data.error) throw Object.assign(new Error(data.error), { status: 502 });
  return data;
}
async function callLLM({ model, prompt, maxTokens = 1024, signal, schema }) {
  const data = await ollama(
    "/api/generate",
    {
      model,
      prompt,
      format: schema || "json",
      keep_alive: "15m",
      options: { num_predict: maxTokens, temperature: 0.2 },
    },
    signal
  );
  if (typeof data.response !== "string")
    throw Object.assign(new Error("Ollama returned no text. Retry generation."), {status:502});
  return {
    output: data.response,
    tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
  };
}
async function getEmbedding(text) {
  const data = await ollama("/api/embeddings", {
    model: process.env.EMBEDDING_MODEL || "nomic-embed-text",
    prompt: text,
  });
  if (
    !Array.isArray(data.embedding) ||
    data.embedding.length !== 768 ||
    !data.embedding.every(Number.isFinite)
  )
    throw new Error("Expected a finite 768-dimensional embedding");
  return data.embedding;
}
module.exports = { callLLM, getEmbedding };
