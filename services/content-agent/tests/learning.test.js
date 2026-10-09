jest.mock('../src/config/db',()=>({transaction:jest.fn()}));
const {hashPrompt,recordFeedback}=require('../src/services/learningService');
const tenant='11111111-1111-4111-8111-111111111111';
test('hash preserves system/user boundaries',()=>{
 expect(hashPrompt('ab','c')).not.toBe(hashPrompt('a','bc'));
 expect(hashPrompt('ab','c')).toMatch(/^[a-f0-9]{64}$/);
});
test.each([['positive',null,1],['positive','positive',0],['negative','positive',-1],['negative','negative',0]])('rating %s following %s applies delta %s',async(feedback,previousFeedback,delta)=>{
 const run=jest.fn(async()=>({rows:[{total_uses:5}]}));
 await recordFeedback({tenantId:tenant,promptHash:'hash',agentType:'meta_ad',subType:'awareness',feedback,previousFeedback},run);
 expect(run.mock.calls[0][0]).toContain('WHERE tenant_id = $1');
 expect(run.mock.calls[0][1]).toEqual([tenant,'hash','meta_ad','awareness',delta]);
});
