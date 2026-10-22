jest.mock('../src/config/db',()=>({query:jest.fn(),transaction:jest.fn()}));
jest.mock('../src/services/campaignService',()=>({getCampaign:jest.fn(),lockCampaign:jest.fn()}));
jest.mock('../src/services/performanceLearning',()=>({dayAt:offset=>offset===-30?'2026-09-21':'2026-10-20',saveMetrics:jest.fn(),evaluateAndSave:jest.fn(),validateMetric:jest.fn()}));
const db=require('../src/config/db'),campaigns=require('../src/services/campaignService'),performance=require('../src/services/performanceLearning');
const {graph,linkAd,syncTenant}=require('../src/services/metaInsights');
const config={account_id:'12345',api_version:'v26.0',token_env:'META_TOKEN_TEST'};
const originalFetch=global.fetch;
beforeEach(()=>{jest.clearAllMocks();process.env.META_TOKEN_TEST='fake-test-token';global.fetch=jest.fn();db.transaction.mockImplementation((tenant,fn)=>fn(jest.fn().mockResolvedValue({rows:[]})));campaigns.lockCampaign.mockResolvedValue(jest.fn());campaigns.getCampaign.mockResolvedValue({id:'campaign',persona_set_id:'set'});});
afterAll(()=>{global.fetch=originalFetch;delete process.env.META_TOKEN_TEST;});
const response=data=>({ok:true,status:200,json:async()=>data});
test('sends credentials only in the header to the fixed Graph host',async()=>{
 global.fetch.mockResolvedValue(response({data:[]}));await graph(config,'12345/insights',{fields:'impressions'});
 const [url,options]=global.fetch.mock.calls[0];expect(url.origin).toBe('https://graph.facebook.com');expect(String(url)).not.toContain('fake-test-token');expect(options.headers.Authorization).toBe('Bearer fake-test-token');
});
test('Meta API errors are sanitized',async()=>{
 global.fetch.mockResolvedValue({ok:false,status:401,json:async()=>({error:{code:190,message:'secret fake-test-token'}})});
 await expect(graph(config,'12345')).rejects.toThrow('code 190');
 try{await graph(config,'12345');}catch(e){expect(e.message).not.toContain('fake-test-token');}
});
test('an ad from another account cannot be mapped',async()=>{
 db.query.mockResolvedValue({rows:[config]});global.fetch.mockResolvedValue(response({account_id:'99999'}));
 await expect(linkAd('tenant',{id:'campaign'},'variant','123456')).rejects.toMatchObject({status:400});expect(db.query).toHaveBeenCalledTimes(1);
});
test('pagination uses cursors on the fixed host and applies one campaign transaction',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('meta_connections')?[config]:[{id:'variant',meta_ad_id:'123456',campaign_id:'campaign'}]}));
 global.fetch.mockResolvedValueOnce(response({account_id:'12345'}))
 .mockResolvedValueOnce(response({data:[],paging:{next:'https://attacker.invalid/?token=bad',cursors:{after:'page2'}}}))
 .mockResolvedValueOnce(response({data:[]}));
 await syncTenant('tenant');
 expect(global.fetch.mock.calls[2][0].origin).toBe('https://graph.facebook.com');expect(global.fetch.mock.calls[2][0].searchParams.get('after')).toBe('page2');
 expect(performance.saveMetrics).toHaveBeenCalledWith('tenant',expect.anything(),'variant',[],'meta',expect.any(Function),true);
 expect(performance.evaluateAndSave).toHaveBeenCalledTimes(1);
});
test('failed remote reads cannot leave partially imported reports',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('meta_connections')?[config]:[{id:'variant',meta_ad_id:'123456',campaign_id:'campaign'}]}));
 global.fetch.mockResolvedValueOnce(response({account_id:'12345'})).mockRejectedValue(new Error('offline'));
 await expect(syncTenant('tenant')).rejects.toThrow('network');expect(performance.saveMetrics).not.toHaveBeenCalled();
});
