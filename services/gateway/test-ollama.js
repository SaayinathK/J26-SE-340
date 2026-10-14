require('dotenv').config();

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function test() {
  console.log('Testing embedding...');
  const embedRes = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'email marketing campaign' })
  });
  const embedData = await embedRes.json();
  console.log('Embedding length:', embedData.embedding?.length); // should be 768

  console.log('\nTesting Mistral generation...');
  const genRes = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral:7b-instruct-q4_K_M',
      prompt: 'Write one short marketing email subject line for a fitness brand.',
      stream: false
    })
  });
  const genData = await genRes.json();
  console.log('Generated:', genData.response);
}

test().catch(console.error);