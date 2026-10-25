const {callLLM}=require('../src/services/llmService');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
test('model timeout becomes a recoverable generation error',async()=>{
 global.fetch=jest.fn().mockRejectedValue(new DOMException('Timed out','TimeoutError'));
 await expect(callLLM({model:'test',prompt:'test'})).rejects.toMatchObject({status:504,message:expect.stringContaining('resume saved progress')});
});
test('network failure is reported as Ollama unavailable',async()=>{
 global.fetch=jest.fn().mockRejectedValue(new TypeError('fetch failed'));
 await expect(callLLM({model:'test',prompt:'test'})).rejects.toMatchObject({status:502});
});
test('user cancellation is preserved',async()=>{
 const controller=new AbortController();controller.abort();
 global.fetch=jest.fn().mockRejectedValue(controller.signal.reason);
 await expect(callLLM({model:'test',prompt:'test',signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
});
test('successful model response retains usage and requested schema',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({response:'{}',eval_count:2,prompt_eval_count:3})});
 expect(await callLLM({model:'test',prompt:'test',schema:{type:'object'}})).toEqual({output:'{}',tokensUsed:5});
 expect(JSON.parse(global.fetch.mock.calls[0][1].body).format).toEqual({type:'object'});
});
