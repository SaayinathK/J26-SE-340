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
function mockBusinessContext(profile, entries = []) {
  llm.callLLM.mockResolvedValue({output:JSON.stringify({content_type:'meta_ad',sub_type:'awareness',funnel_stage:'tofu'})});
  llm.getEmbedding.mockResolvedValue([1]);
  db.query.mockImplementation(async (sql, params, scope) => {
    expect(scope).toBe(tenant);
    if (sql.includes('FROM business_settings')) return {rows:profile ? [profile] : []};
    if (sql.includes('FROM knowledge_base') && !sql.includes("type = 'brand_voice'")) return {rows:entries};
    return {rows:[]};
  });
}
test.each([undefined, '', '   ', null])('profile-only automatic generation accepts brief %p', async brief => {
  mockBusinessContext({business_name:'Acme',offer_name:'Workshop',target_audience:'Founders',brand_voice:'Friendly'});
  const ctx = await engine.buildContext(tenant, 'meta_ad', brief);
  expect(ctx.missing_fields).toEqual([]);
  expect(ctx.brief_source).toBe('automatic');
  expect(ctx.brief).toContain('Facebook and Instagram campaign');
  expect(llm.getEmbedding).toHaveBeenCalledWith(expect.stringContaining('Business: Acme'));
  expect(ctx.business_profile).toContain('Brand Voice: Friendly');
  expect(ctx.kb_entries).toEqual([]);
});
test('short optional directions are preserved alongside business context', async () => {
  mockBusinessContext({business_name:'Acme'});
  const ctx = await engine.buildContext(tenant, 'social_post', '  Be funny  ');
  expect(ctx.brief).toBe('Be funny');
  expect(ctx.brief_source).toBe('custom');
  expect(ctx.missing_fields).toEqual([]);
  expect(llm.getEmbedding).toHaveBeenCalledWith(expect.stringContaining('Be funny\n\nCLIENT BUSINESS PROFILE:'));
});
test.each([null, {business_name:'   ',brand_voice:'   '}])('empty profiles ask for setup instead of accepting an ungrounded generation', async profile => {
  mockBusinessContext(profile);
  const ctx = await engine.buildContext(tenant,'meta_ad');
  expect(ctx.missing_fields).toContain('business_profile');
  expect(ctx.missing_fields).not.toContain('brief');
});
test('automatic Meta campaign skips the intent LLM and carries tenant-scoped cache identity',async()=>{
 mockBusinessContext({business_name:'Acme'});
 const ctx=await engine.buildContext(tenant,'meta_ad');
 expect(llm.callLLM).not.toHaveBeenCalled();
 expect(ctx.intent).toMatchObject({content_type:'meta_ad',sub_type:'awareness',funnel_stage:'tofu'});
 expect(ctx.tenant_id).toBe(tenant);
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('string_agg'),[tenant],tenant);
});
test('custom Meta instructions still get classified',async()=>{
 mockBusinessContext({business_name:'Acme'});
 await engine.buildContext(tenant,'meta_ad','Sell workshop tickets');
 expect(llm.callLLM).toHaveBeenCalledTimes(1);
});
