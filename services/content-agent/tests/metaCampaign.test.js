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
test('repairs only a missing body and counts every model call',async()=>{
 const broken=creative(0);broken.body_copies.pop();
 llm.callLLM.mockResolvedValueOnce(response({personas})).mockResolvedValueOnce(response(broken))
 .mockResolvedValueOnce(response(creative(0).body_copies[2]))
 .mockResolvedValueOnce(response(creative(1))).mockResolvedValueOnce(response(creative(2)));
 const result=await generateWithRetry({},'', 'meta_ad');
 expect(result.attempts).toBe(5);expect(result.tokensUsed).toBe(25);
 expect(llm.callLLM.mock.calls[2][0].prompt).toContain('Write ONE new ad body');
 expect(result.output.personas[0].hooks).toEqual(broken.hooks);
 expect(validateMetaCampaign(result.output)).toEqual([]);
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
 expect(llm.callLLM).toHaveBeenCalledTimes(5);
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
test('repairs only missing hooks and duplicate body options while retaining valid work',async()=>{
 const broken=creative(0);broken.hooks=broken.hooks.slice(0,9);broken.body_copies[0].cta='learn_more';broken.body_copies[2]={...broken.body_copies[1]};
 llm.callLLM.mockResolvedValueOnce(response({personas})).mockResolvedValueOnce(response(broken))
 .mockResolvedValueOnce(response(creative(0).body_copies[2]))
 .mockResolvedValueOnce(response({hooks:['A new tenth angle?']}))
 .mockResolvedValueOnce(response(creative(1))).mockResolvedValueOnce(response(creative(2)));
 const result=await generateWithRetry({},'', 'meta_ad');
 expect(validateMetaCampaign(result.output)).toEqual([]);
 expect(result.output.personas[0].hooks.slice(0,9)).toEqual(broken.hooks);
 expect(result.output.personas[0].body_copies[0].cta).toBe('LEARN MORE');
 const repair=llm.callLLM.mock.calls[2][0];
 expect(repair.schema.required).toEqual(['body','headline','cta']);
 expect(repair.prompt).toContain('excluded_bodies');
 expect(llm.callLLM.mock.calls[3][0].schema.properties.hooks.minItems).toBe(1);
});
test('winner-only generation makes one creative call for the saved persona',async()=>{
 llm.callLLM.mockResolvedValueOnce(response(creative(1)));
 const result=await generateWithRetry({},'','meta_ad',3,{selectedPersona:personas[1]});
 expect(result.output.personas).toHaveLength(1);
 expect(result.output.personas[0].name).toBe(personas[1].name);
 expect(validateMetaCampaign(result.output,1)).toEqual([]);
 expect(llm.callLLM).toHaveBeenCalledTimes(1);
});
test('resuming a draft skips two completed personas and preserves their copy',async()=>{
 const completed=personas.slice(0,2).map((p,i)=>({...p,...creative(i),inferred:true}));
 llm.callLLM.mockResolvedValueOnce(response(creative(2)));
 const events=[];
 const result=await generateWithRetry({},'','meta_ad',3,{savedPlan:{personas},completedPersonas:completed,onProgress:async event=>events.push(event)});
 expect(llm.callLLM).toHaveBeenCalledTimes(1);
 expect(result.output.personas.slice(0,2)).toEqual(completed);
 expect(events.filter(e=>e.resumed)).toHaveLength(2);
});
test('awaits checkpoint persistence before starting the next persona',async()=>{
 queueCampaign();
 await expect(generateWithRetry({},'','meta_ad',3,{onProgress:async e=>{if(e.type==='persona')throw new Error('checkpoint failed');}})).rejects.toThrow('checkpoint failed');
 expect(llm.callLLM).toHaveBeenCalledTimes(2);
});
test('planning constrains pain points and repairs only the invalid persona',async()=>{
 const broken={...personas[2],pain_points:['Same pain','SAME PAIN!','Third obstacle']};
 llm.callLLM.mockResolvedValueOnce(response({personas:[...personas.slice(0,2),broken]}))
 .mockResolvedValueOnce(response({personas:[personas[2]]}));
 personas.forEach((p,i)=>llm.callLLM.mockResolvedValueOnce(response(creative(i))));
 const result=await generateWithRetry({},'','meta_ad');
 expect(validateMetaCampaign(result.output)).toEqual([]);
 const first=llm.callLLM.mock.calls[0][0];
 expect(first.schema.properties.personas.minItems).toBe(3);
 expect(first.schema.properties.personas.items.properties.pain_points.minItems).toBe(3);
 const repair=llm.callLLM.mock.calls[1][0];
 expect(repair.schema.properties.personas.maxItems).toBe(1);
 expect(repair.prompt).toContain('"repair_indexes":[3]');
 expect(result.attempts).toBe(5);
});
test('planning rejects repeated names across retained and repaired personas',async()=>{
 llm.callLLM.mockResolvedValueOnce(response({personas:[personas[0],personas[0],personas[2]]}))
 .mockResolvedValue(response({personas:[personas[0]]}));
 await expect(generateWithRetry({},'','meta_ad',2)).rejects.toMatchObject({status:502});
 expect(llm.callLLM).toHaveBeenCalledTimes(2);
});
test.each([null, {}, {personas:[null]}, {personas:personas.slice(0,2)}])('malformed planning response is repaired without a TypeError: %p',async invalid=>{
 llm.callLLM.mockResolvedValueOnce(response(invalid));
 const missing=invalid?.personas?.length===2 ? [personas[2]] : personas;
 llm.callLLM.mockResolvedValueOnce(response({personas:missing}));
 personas.forEach((p,i)=>llm.callLLM.mockResolvedValueOnce(response(creative(i))));
 const result=await generateWithRetry({},'','meta_ad');
 expect(validateMetaCampaign(result.output)).toEqual([]);
});
test('invalid saved plan is regenerated before any creative generation',async()=>{
 queueCampaign();
 const result=await generateWithRetry({},'','meta_ad',3,{savedPlan:{personas:[null]}});
 expect(validateMetaCampaign(result.output)).toEqual([]);
 expect(llm.callLLM).toHaveBeenCalledTimes(4);
});
test('invalid selected persona returns a setup error without calling the model',async()=>{
 await expect(generateWithRetry({},'','meta_ad',3,{selectedPersona:{name:'Broken'}})).rejects.toMatchObject({status:400});
 expect(llm.callLLM).not.toHaveBeenCalled();
});
test('missing hooks get a dedicated repair without regenerating complete body copy',async()=>{
 const initial=creative(0); initial.hooks=initial.hooks.slice(0,8);
 llm.callLLM.mockResolvedValueOnce(response(initial))
 .mockResolvedValueOnce(response({hooks:[initial.hooks[0], 'Fresh ninth angle?']}))
 .mockResolvedValueOnce(response({hooks:['Fresh tenth angle?']}));
 const result=await generateWithRetry({},'','meta_ad',3,{selectedPersona:personas[0]});
 expect(validateMetaCampaign(result.output,1)).toEqual([]);
 expect(result.output.personas[0].body_copies).toEqual(initial.body_copies);
 expect(llm.callLLM.mock.calls[1][0].schema.properties.hooks.minItems).toBe(2);
 expect(llm.callLLM.mock.calls[2][0].schema.properties.hooks.minItems).toBe(1);
 expect(llm.callLLM.mock.calls[1][0].prompt).toContain('Do not write body copy');
});
test('hook repair exhaustion rejects incomplete output',async()=>{
 const initial=creative(0);initial.hooks=[];
 llm.callLLM.mockResolvedValueOnce(response(initial)).mockResolvedValue(response({hooks:['Repeated hook']}));
 await expect(generateWithRetry({},'','meta_ad',2,{selectedPersona:personas[0]})).rejects.toMatchObject({status:502});
});

test('malformed creative JSON recovers using individual bodies and hooks',async()=>{
 llm.callLLM.mockResolvedValueOnce({output:'{truncated',tokensUsed:1});
 creative(0).body_copies.forEach(copy=>llm.callLLM.mockResolvedValueOnce(response(copy)));
 llm.callLLM.mockResolvedValueOnce(response({hooks:creative(0).hooks}));
 const result=await generateWithRetry({},'','meta_ad',3,{selectedPersona:personas[0]});
 expect(validateMetaCampaign(result.output,1)).toEqual([]);
 expect(result.attempts).toBe(5);
});
test('duplicate single-body repair is rejected before accepting a new angle',async()=>{
 const broken=creative(0);broken.body_copies=broken.body_copies.slice(0,2);
 llm.callLLM.mockResolvedValueOnce(response(broken))
 .mockResolvedValueOnce(response(broken.body_copies[0]))
 .mockResolvedValueOnce(response(creative(0).body_copies[2]));
 const result=await generateWithRetry({},'','meta_ad',3,{selectedPersona:personas[0]});
 expect(validateMetaCampaign(result.output,1)).toEqual([]);
 expect(result.attempts).toBe(3);
});
