const mockClient = {query:jest.fn(),release:jest.fn()};
jest.mock('../src/config/db',()=>({pool:{connect:jest.fn(async()=>mockClient)}}));
const {hashPrompt,recordPromptUse,recordFeedback}=require('../src/services/learningService');
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{jest.clearAllMocks();mockClient.query.mockResolvedValue({rows:[{total_uses:5,positive_ratings:5,is_champion:true}]});});
test('hash groups the same content type and separates different types',()=>{
 expect(hashPrompt('content','meta_ad')).toBe(hashPrompt('content','meta_ad'));
 expect(hashPrompt('content','meta_ad')).not.toBe(hashPrompt('content','funnel_page'));
 expect(hashPrompt('ab','c')).not.toBe(hashPrompt('a','bc'));
 expect(hashPrompt('content','meta_ad')).toMatch(/^[a-f0-9]{64}$/);
});
test('prompt use upserts the tenant/content group and releases the connection',async()=>{
 const snapshot={addition:'Use clear wording'};
 await recordPromptUse({tenantId:tenant,agentType:'meta_ad',subType:'awareness',promptHash:'hash',promptSnapshot:snapshot});
 expect(mockClient.query).toHaveBeenLastCalledWith(expect.stringContaining('ON CONFLICT (tenant_id, prompt_hash, agent_type)'),[tenant,'meta_ad','awareness','hash',JSON.stringify(snapshot)]);
 expect(mockClient.release).toHaveBeenCalledTimes(1);
});
test.each([['positive',1],['negative',0]])('feedback %s applies the current increment %s',async(feedback,increment)=>{
 const row=await recordFeedback({tenantId:tenant,promptHash:'hash',agentType:'meta_ad',feedback});
 expect(mockClient.query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE tenant_id = $2'),[increment,tenant,'hash','meta_ad']);
 expect(row).toMatchObject({total_uses:5,is_champion:true});
 expect(mockClient.release).toHaveBeenCalledTimes(1);
});
test.each([recordPromptUse,recordFeedback])('query errors are logged and checked-out connections released',async operation=>{
 const log=jest.spyOn(console,'error').mockImplementation(()=>{});
 mockClient.query.mockRejectedValueOnce(new Error('Database unavailable'));
 try {
  await operation({tenantId:tenant,promptHash:'hash',agentType:'meta_ad',feedback:'positive'});
  expect(log).toHaveBeenCalledWith(expect.any(String),'Database unavailable');
  expect(mockClient.release).toHaveBeenCalledTimes(1);
 } finally {log.mockRestore();}
});
