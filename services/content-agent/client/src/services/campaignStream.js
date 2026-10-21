export async function readCampaignStream(response, onEvent) {
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', completed;
  function accept(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || 'Campaign generation failed.');
    if (event.type === 'complete') completed = event.data;
    if (event.type !== 'heartbeat') onEvent(event);
  }
  try {
    while (true) {
      const {done, value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream:true});
      let split;
      while ((split = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, split)); buffer = buffer.slice(split + 1); }
      if (done) break;
    }
    if (buffer.trim()) accept(buffer);
    if (!completed?.success || !completed.content_id) throw new Error('Connection ended before the campaign was confirmed saved. Check History before generating again.');
    return completed;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
