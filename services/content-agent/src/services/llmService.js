async function ollama(path, body) {
  const response = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }), signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) throw Object.assign(new Error(`Ollama returned ${response.status}`), { status: 502 });
  const data = await response.json();
  if (data.error) throw Object.assign(new Error(data.error), { status: 502 });
  return data;
}
async function callLLM({ model, prompt, maxTokens = 1024 }) {
  const data = await ollama('/api/generate', { model, prompt, format: 'json', options: { num_predict: maxTokens, temperature: 0.2 } });
  if (typeof data.response !== 'string') throw new Error('Ollama returned no text');
  return { output: data.response, tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0) };
}
async function getEmbedding(text) {
  const data = await ollama('/api/embeddings', { model: process.env.EMBEDDING_MODEL || 'nomic-embed-text', prompt: text });
  if (!Array.isArray(data.embedding) || data.embedding.length !== 768 || !data.embedding.every(Number.isFinite)) throw new Error('Expected a finite 768-dimensional embedding');
  return data.embedding;
}
module.exports = { callLLM, getEmbedding };
