jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/services/llmService', () => ({ callLLM: jest.fn(), getEmbedding: jest.fn() }));
const db = require('../src/config/db');
const llm = require('../src/services/llmService');
const engine = require('../src/services/contextEngine');
const { buildPrompt } = require('../src/services/contentGenerator');
const tenant = '11111111-1111-4111-8111-111111111111';
beforeEach(() => jest.resetAllMocks());
test('context includes profile and approved examples in the generation prompt', async () => {
  llm.callLLM.mockResolvedValue({ output: JSON.stringify({ content_type: 'meta_ad', sub_type: 'awareness', funnel_stage: 'tofu' }) });
  llm.getEmbedding.mockResolvedValue([1]);
  db.query.mockImplementation(async (sql, params, scope) => {
    expect(scope).toBe(tenant);
    if (sql.includes('FROM business_settings')) return { rows: [{ business_name: 'Acme', offer_price: '$25', target_audience: 'Founders' }] };
    if (sql.includes('FROM generations')) {
      expect(sql).toContain('agent_type = $2');
      expect(sql).toContain("rating = 'positive'");
      expect(params).toEqual([tenant, 'meta_ad', 3]);
      return { rows: [{ output: '{"headline":"Approved"}', input_params: { brief: 'Previous brief' } }, { output: 'invalid' }] };
    }
    if (sql.includes("type = 'brand_voice'")) return { rows: [{ text: 'Direct' }] };
    if (sql.includes('FROM knowledge_base')) return { rows: [{ entry_id: '1' }, { entry_id: '2' }] };
    return { rows: [] };
  });
  const ctx = await engine.buildContext(tenant, 'meta_ad', 'Write a Facebook ad for my event');
  expect(ctx.business_profile).toContain('Business: Acme');
  expect(ctx.business_profile).toContain('Price: $25');
  expect(ctx.business_profile).toContain('Target Audience: Founders');
  expect(ctx.past_examples).toContain('Previous brief');
  expect(ctx.past_examples).not.toContain('EXAMPLE 2');
  expect(ctx.missing_fields).toEqual([]);
  const prompt = JSON.parse(buildPrompt(ctx, 'Brief', 'meta_ad').userPrompt);
  expect(prompt.business_profile).toBe(ctx.business_profile);
  expect(prompt.past_examples).toBe(ctx.past_examples);
});
test('optional context is empty for missing rows or unavailable queries', async () => {
  db.query.mockResolvedValue({ rows: [] });
  expect(await engine.getBusinessProfile(tenant)).toBe('');
  expect(await engine.getBestPastGenerations(tenant, 'email')).toBe('');
  db.query.mockRejectedValue(new Error('unavailable'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await engine.getBusinessProfile(tenant)).toBe('');
    expect(await engine.getBestPastGenerations(tenant, 'email')).toBe('');
  } finally { log.mockRestore(); }
});
