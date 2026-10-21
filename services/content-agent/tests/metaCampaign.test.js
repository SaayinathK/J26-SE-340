jest.mock('../src/services/llmService',()=>({callLLM:jest.fn()}));
const llm=require('../src/services/llmService');
const {generateWithRetry}=require('../src/services/contentGenerator');
const {validateMetaCampaign,validateCreative,clearPersonaCache}=require('../src/services/metaCampaignService');
const personas=Array.from({length:3},(_,i)=>({name:`Audience ${i+1}`,description:`Audience goal ${i+1}`,pain_points:['First obstacle','Second obstacle','Third obstacle']}));
const creative = i => ({hooks:Array.from({length:10},(_,n)=>`Persona ${i} hook angle ${n+1}?`),body_copies:Array.from({length:3},(_,n)=>({body:`Body angle ${n+1} for audience ${i}`,primary_text:`Primary text ${n+1}`,headline:`Headline ${n+1}`,cta:'LEARN MORE'}))});
const response=output=>({output:JSON.stringify(output),tokensUsed:5});
beforeEach(()=>{jest.resetAllMocks();clearPersonaCache();});
test('Meta generation produces three personas with 30 hooks and 9 complete copy options',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas}));
 personas.forEach((p,i)=>llm.callLLM.mockResolvedValueOnce(response(creative(i))));
 const result=await generateWithRetry({business_profile:'Business: Acme',kb_entries:[]},'Optional direction','meta_ad');
 expect(result.output.schema_version).toBe(2);
 expect(validateMetaCampaign(result.output)).toEqual([]);
 expect(result.output.personas).toHaveLength(3);
 expect(result.output.personas.every(p=>p.inferred&&p.hooks.length===10&&p.body_copies.length===3)).toBe(true);
 expect(result.tokensUsed).toBe(20); expect(result.attempts).toBe(4);
 expect(llm.callLLM.mock.calls[1][0].prompt).toContain('Audience 1');
 expect(llm.callLLM.mock.calls[1][0].prompt).not.toContain('Audience 2');
});
test('retries only the failing persona and counts all model usage',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas})).mockResolvedValueOnce(response({hooks:['only one']})).mockResolvedValueOnce(response(creative(0))).mockResolvedValueOnce(response(creative(1))).mockResolvedValueOnce(response(creative(2)));
 const result=await generateWithRetry({},'', 'meta_ad');
 expect(result.attempts).toBe(5);expect(result.tokensUsed).toBe(25);
 expect(llm.callLLM.mock.calls[2][0].prompt).toContain('Return exactly 10 nonempty hooks');
});
test('invalid persona planning fails rather than returning a single ad or partial campaign',async()=>{
 llm.callLLM.mockResolvedValue(response({hook:'Legacy ad'}));
 await expect(generateWithRetry({},'', 'meta_ad',2)).rejects.toMatchObject({status:502});
 expect(llm.callLLM).toHaveBeenCalledTimes(2);
});
test('partial campaigns are rejected after creative retry budget',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas})).mockResolvedValue(response(creative(0)));
 const invalid=creative(1);invalid.body_copies[0].cta='BUY NOW';
 llm.callLLM.mockReset().mockResolvedValueOnce(response({personas})).mockResolvedValueOnce(response(creative(0))).mockResolvedValue(response(invalid));
 await expect(generateWithRetry({},'', 'meta_ad',2)).rejects.toMatchObject({status:502});
 expect(llm.callLLM).toHaveBeenCalledTimes(4);
});
test('validators reject duplicate hooks, malformed bodies, and overlong Unicode copy',()=>{
 const output=creative(1);
 output.hooks[1]=output.hooks[0].toUpperCase().replace('?','!');
 output.hooks[2]='😀'.repeat(126);
 output.body_copies[0].primary_text='x'.repeat(281);
 output.body_copies[1].body=output.body_copies[2].body;
 const errors=validateCreative(output).join(' ');
 expect(errors).toContain('distinct');expect(errors).toContain('125');expect(errors).toContain('280');
 expect(validateCreative(null).length).toBeGreaterThan(0);
});
test('valid Unicode hook limits count characters rather than UTF-16 units',()=>{
 const output=creative(1);output.hooks[0]='😀'.repeat(125);
 expect(validateCreative(output)).toEqual([]);
});
const cachedContext = {tenant_id:'tenant-a',knowledge_revision:'revision-1',business_profile:'Acme',brand_voice:'Direct'};
function queueCampaign(includePlan = true) {
 if(includePlan) llm.callLLM.mockResolvedValueOnce(response({personas}));
 personas.forEach((p,i)=>llm.callLLM.mockResolvedValueOnce(response(creative(i))));
}
test('missing primary_text uses an existing short body without regenerating a persona',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas}));
 personas.forEach((p,i)=>{
  const value=creative(i);value.body_copies.forEach(copy=>delete copy.primary_text);
  llm.callLLM.mockResolvedValueOnce(response(value));
 });
 const result=await generateWithRetry({},'', 'meta_ad');
 expect(result.attempts).toBe(4);
 expect(result.output.personas[0].body_copies[0].primary_text).toBe(result.output.personas[0].body_copies[0].body);
});
test('long body missing primary text gets a small targeted repair, preserving hooks',async()=>{
 const broken=creative(0);broken.body_copies.forEach((copy,i)=>{copy.body=`Option ${i} `+'x'.repeat(300);delete copy.primary_text;});
 llm.callLLM.mockResolvedValueOnce(response({personas})).mockResolvedValueOnce(response(broken)).mockResolvedValueOnce(response({primary_texts:['Short text 1','Short text 2','Short text 3']})).mockResolvedValueOnce(response(creative(1))).mockResolvedValueOnce(response(creative(2)));
 const result=await generateWithRetry({},'', 'meta_ad');
 expect(result.output.personas[0].hooks).toEqual(broken.hooks);
 expect(result.output.personas[0].body_copies[0].primary_text).toBe('Short text 1');
 expect(llm.callLLM.mock.calls[2][0].maxTokens).toBe(700);
 expect(result.attempts).toBe(5);
});
test('cached persona plans remove the planning call and report progressive results',async()=>{
 queueCampaign(); await generateWithRetry(cachedContext,'same', 'meta_ad');
 queueCampaign(false); const events=[];
 const result=await generateWithRetry(cachedContext,'same','meta_ad',3,{onProgress:event=>events.push(event)});
 expect(result.attempts).toBe(3);expect(result.tokensUsed).toBe(15);
 expect(events.find(e=>e.type==='plan').cached).toBe(true);
 expect(events.filter(e=>e.type==='persona').map(e=>e.index)).toEqual([0,1,2]);
 expect(llm.callLLM).toHaveBeenCalledTimes(7);
});
test.each([{tenant_id:'tenant-b'},{knowledge_revision:'revision-2'},{business_profile:'Changed offer'},{brand_voice:'Warm'}])('cache invalidates or isolates on changed context %p',async change=>{
 queueCampaign();await generateWithRetry(cachedContext,'same','meta_ad');
 queueCampaign();await generateWithRetry({...cachedContext,...change},'same','meta_ad');
 expect(llm.callLLM).toHaveBeenCalledTimes(8);
});
test('failed planning is never cached',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas:[]}));
 await expect(generateWithRetry(cachedContext,'same','meta_ad',1)).rejects.toMatchObject({status:502});
 queueCampaign();const result=await generateWithRetry(cachedContext,'same','meta_ad');
 expect(result.attempts).toBe(4);
});
test('aborted streaming request stops before generating more personas',async()=>{
 queueCampaign();const controller=new AbortController();
 await expect(generateWithRetry({},'','meta_ad',3,{signal:controller.signal,onProgress:event=>{if(event.type==='persona')controller.abort();}})).rejects.toHaveProperty('name','AbortError');
 expect(llm.callLLM).toHaveBeenCalledTimes(2);
});
