process.env.JWT_SECRET = 'test-only-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test';
jest.mock('../src/config/db', () => ({ query:jest.fn(), transaction:jest.fn(), validTenant:id=>typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) }));
jest.mock('../src/services/contextEngine', () => ({ TYPES:['meta_ad','funnel_page','email','social_post','vsl'],buildContext:jest.fn() }));
jest.mock('../src/services/contentGenerator', () => ({ generateWithRetry:jest.fn() }));
jest.mock('../src/services/learningService', () => ({ hashPrompt:jest.fn(()=> 'a'.repeat(64)),recordPromptUse:jest.fn(),recordFeedback:jest.fn() }));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const engine = require('../src/services/contextEngine');
const generator = require('../src/services/contentGenerator');
const learning = require('../src/services/learningService');
const app = require('../src/index');
const tenant = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const auth = `Bearer ${jwt.sign({ clientId:tenant },process.env.JWT_SECRET)}`;
const body = { content_type:'meta_ad',brief:'Create a practical workshop campaign for founders' };
const output = { hook:'Plan your campaign',primary_text:'Learn practical campaign planning.',headline:'Campaign foundations',cta:'LEARN MORE' };
let run;
beforeEach(()=>{
  jest.clearAllMocks();
  run = jest.fn(async sql=> {
    if(sql.includes('lower(email)')) return { rows:[] };
    if(sql.includes('SELECT prompt_hash')) return { rows:[{prompt_hash:'a'.repeat(64),agent_type:'meta_ad',sub_type:'awareness',rating:null}] };
    return { rows:[{ id:tenant }] };
  });
  db.transaction.mockImplementation(async (_id,fn)=>fn(run));
  db.query.mockImplementation(async sql => ({ rows:sql.includes('SELECT * FROM generations') ? [{id:generation}] : [{id:tenant,is_active:true,generations_used:0,generations_limit:50}] }));
  engine.buildContext.mockResolvedValue({intent:{content_type:'meta_ad',sub_type:'awareness'},kb_entries:[{entry_id:generation}],brand_voice:'Direct',champion:'',missing_fields:[]});
  generator.generateWithRetry.mockResolvedValue({output,attempts:1,tokensUsed:80,systemPrompt:'System',userPrompt:'User'});
  learning.recordFeedback.mockResolvedValue({total_uses:1,positive_ratings:1});
});
test('register returns 201 and signed token',async()=>{
  const res=await request(app).post('/api/auth/register').send({name:'Test',email:'test@example.com',password:'secure-password'});
  expect(res.status).toBe(201); expect(jwt.verify(res.body.token,process.env.JWT_SECRET).clientId).toBeTruthy();
});
test('login returns signed token',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:tenant,is_active:true,password_hash:await bcrypt.hash('secure-password',4)}]});
  const res=await request(app).post('/api/auth/login').send({email:'test@example.com',password:'secure-password'});
  expect(res.status).toBe(200); expect(jwt.verify(res.body.token,process.env.JWT_SECRET).clientId).toBe(tenant);
});
test('me is protected',async()=>{ expect((await request(app).get('/api/auth/me').set('Authorization',auth)).status).toBe(200); });
test('context returns intent and entries',async()=>{
  const res=await request(app).post('/context/build').set('Authorization',auth).send(body);
  expect(res.status).toBe(200); expect(res.body.context.intent.content_type).toBe('meta_ad'); expect(res.body.context.kb_entries).toHaveLength(1);
});
test('generate returns ad and persists in tenant transaction',async()=>{
  const res=await request(app).post('/content/generate').set('Authorization',auth).send(body);
  expect(res.status).toBe(200); expect(res.body).toMatchObject(output);
  expect(db.transaction).toHaveBeenCalledWith(tenant,expect.any(Function));
  expect(run.mock.calls.find(([sql])=>sql.includes('INSERT INTO generations'))[1][1]).toBe(tenant);
});
test('feedback succeeds',async()=>{
  const res=await request(app).post('/content/feedback').set('Authorization',auth).send({generation_id:generation,feedback:'positive'});
  expect(res.status).toBe(200); expect(res.body.success).toBe(true);
});
test('history returns last generations for authenticated tenant',async()=>{
  const res=await request(app).get('/content/history').set('Authorization',auth);
  expect(res.status).toBe(200); expect(Array.isArray(res.body.history)).toBe(true);
  expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE tenant_id = $1'),[tenant],tenant);
});
test.each(['/context/build','/content/generate','/content/feedback'])('%s rejects missing token',async path=>{ expect((await request(app).post(path).send(body)).status).toBe(401); });
test('rejects invalid JWT',async()=>{ expect((await request(app).get('/content/history').set('Authorization','Bearer invalid')).status).toBe(401); });
test('rejects unsupported format',async()=>{ expect((await request(app).post('/content/generate').set('Authorization',auth).send({...body,content_type:'unknown'})).status).toBe(400); });
test('missing context blocks generation',async()=>{
  engine.buildContext.mockResolvedValue({missing_fields:['brand_voice']});
  expect((await request(app).post('/content/generate').set('Authorization',auth).send(body)).status).toBe(400);
  expect(generator.generateWithRetry).not.toHaveBeenCalled();
});
test('quota race rejects persistence',async()=>{
  run.mockResolvedValue({rows:[]});
  expect((await request(app).post('/content/generate').set('Authorization',auth).send(body)).status).toBe(429);
  expect(learning.recordPromptUse).not.toHaveBeenCalled();
});
test('foreign generation is not found',async()=>{
  run.mockResolvedValue({rows:[]});
  expect((await request(app).post('/content/feedback').set('Authorization',auth).send({generation_id:generation,feedback:'positive'})).status).toBe(404);
});
test('invalid feedback rejected',async()=>{ expect((await request(app).post('/content/feedback').set('Authorization',auth).send({generation_id:generation,feedback:'great'})).status).toBe(400); });
test('validator rejects missing or oversized copy',()=>{
  const {validateAd}=jest.requireActual('../src/services/contentGenerator');
  expect(validateAd(output)).toEqual([]); expect(validateAd({...output,hook:'x'.repeat(126)})).toContain('hook exceeds 125 characters');
  expect(validateAd(null).length).toBe(4);
});
test('retry repairs invalid model output',async()=>{
  const llm=require('../src/services/llmService');
  const spy=jest.spyOn(llm,'callLLM').mockResolvedValueOnce({output:'not json',tokensUsed:2}).mockResolvedValueOnce({output:JSON.stringify(output),tokensUsed:3});
  const actual=jest.requireActual('../src/services/contentGenerator');
  const result=await actual.generateWithRetry({kb_entries:[],intent:{}},body.brief,'meta_ad');
  expect(result.attempts).toBe(2); expect(result.tokensUsed).toBe(5); spy.mockRestore();
});
