jest.mock('../src/services/llmService', () => ({callLLM:jest.fn()}));
const llm = require('../src/services/llmService');
const {buildPrompt,generateWithRetry,generateFunnelPage} = require('../src/services/contentGenerator');
const funnel = {hook:'Know the Java theory but struggle to write a working program?',problem:'Turning classroom concepts into code can feel confusing.',solution:'Explore the saved Java course for IT and A/L students.',benefits:['Study Java in Colombo'],social_proof:'Not provided',offer:'Java course: 100 USD in Colombo.',cta:'Contact us to ask about registration.'};
beforeEach(()=>jest.resetAllMocks());
test('funnel prompt specifies seven pillars and requires evidence for proof and urgency',()=>{
 const {systemPrompt}=buildPrompt({business_profile:'Java course, 100 USD, Colombo'},'', 'funnel_page');
 expect(systemPrompt).toContain('EXACTLY SEVEN PILLARS');
 expect(systemPrompt).toContain('Lead with the target audience');
 expect(systemPrompt).toContain('return exactly "Not provided"');
 expect(systemPrompt).toContain('Prior AI-generated examples are NOT verified proof');
 expect(systemPrompt).toContain('urgency ONLY');
});
test('legacy six-section output retries until all seven pillars are present',async()=>{
 llm.callLLM.mockResolvedValueOnce({output:JSON.stringify({headline:'Java',subheadline:'Learn Java',benefits:['Study'],social_proof:'Not provided',cta:'Register',urgency:'Not provided'}),tokensUsed:2}).mockResolvedValueOnce({output:JSON.stringify(funnel),tokensUsed:3});
 const result=await generateWithRetry({},'', 'funnel_page');
 expect(result.output).toEqual(funnel);
 expect(result.attempts).toBe(2);
 expect(result.tokensUsed).toBe(5);
 expect(llm.callLLM.mock.calls[1][0].prompt).toContain('problem is required');
});
test('incomplete funnel fails rather than being returned as successful content',async()=>{
 llm.callLLM.mockResolvedValue({output:JSON.stringify({headline:'Legacy output'}),tokensUsed:1});
 await expect(generateFunnelPage({},'')).rejects.toMatchObject({status:502});
 expect(llm.callLLM).toHaveBeenCalledTimes(3);
});
