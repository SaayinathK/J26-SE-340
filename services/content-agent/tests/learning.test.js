jest.mock('../src/config/db',()=>({transaction:jest.fn()}));
const db=require('../src/config/db');
const {hashPrompt,recordPromptUse,recordFeedback}=require('../src/services/learningService');
const tenant='11111111-1111-4111-8111-111111111111';
let run;
beforeEach(()=>{jest.clearAllMocks();run=jest.fn().mockResolvedValue({rows:[{total_uses:5,positive_ratings:5,is_champion:true}]});db.transaction.mockImplementation((tenant,fn)=>fn(run));});
test('hash identifies prompt variants without depending on each user brief',()=>{
 expect(hashPrompt('meta_ad','awareness',{system:'base',guidance:'A'})).toBe(hashPrompt('meta_ad','awareness',{system:'base',guidance:'A'}));
 expect(hashPrompt('meta_ad','awareness',{system:'base',guidance:'A'})).not.toBe(hashPrompt('meta_ad','awareness',{system:'base',guidance:'B'}));
});
test('usage uses the callers transaction and does not disable RLS',async()=>{
 await recordPromptUse({tenantId:tenant,agentType:'meta_ad',subType:'awareness',promptHash:'hash',promptSnapshot:{}},run);
 expect(db.transaction).not.toHaveBeenCalled();expect(run).toHaveBeenCalledTimes(1);expect(run.mock.calls[0][0]).not.toContain('row_security');
});
test.each([['positive',null,1,0],['positive','positive',0,0],['negative','positive',-1,1],['positive','negative',1,-1],['negative','negative',0,0]])('rating %s after %s applies exact deltas',async(feedback,previousRating,pos,neg)=>{
 await recordFeedback({tenantId:tenant,promptHash:'hash',agentType:'meta_ad',feedback,previousRating},run);
 expect(run.mock.calls[0][1]).toEqual([pos,neg,tenant,'hash','meta_ad']);
});
test('storage failures propagate for rollback instead of pretending learning succeeded',async()=>{
 run.mockRejectedValue(new Error('Database unavailable'));
 await expect(recordPromptUse({tenantId:tenant},run)).rejects.toThrow('Database unavailable');
});
