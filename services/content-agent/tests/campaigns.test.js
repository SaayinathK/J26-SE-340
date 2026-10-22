process.env.JWT_SECRET='test-only-secret';
jest.mock('../src/config/db',()=>({query:jest.fn(),transaction:jest.fn(),pool:{connect:jest.fn()},validTenant:id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)}));
const request=require('supertest');
const jwt=require('jsonwebtoken');
const db=require('../src/config/db');
const app=require('../src/index');
const service=require('../src/services/campaignService');
const tenant='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const auth=`Bearer ${jwt.sign({clientId:tenant},process.env.JWT_SECRET)}`;
const profile={business_name:'Acme',offer_name:'Java',target_audience:'IT students'};
const campaign={id,tenant_id:tenant,profile,version:1,personas:[{name:'Beginners'},{name:'Career starters'},{name:'Practitioners'}]};
let client;
beforeEach(()=>{
 jest.clearAllMocks();
 client={query:jest.fn().mockResolvedValue({rows:[{locked:true}]}),release:jest.fn()};db.pool.connect.mockResolvedValue(client);
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM clients')?[{id:tenant,is_active:true}]:[campaign]}));
});
test('campaign routes require authentication',async()=>{expect((await request(app).get('/campaigns')).status).toBe(401);});
test('create ignores supplied tenant and isolates profile',async()=>{
 const res=await request(app).post('/campaigns').set('Authorization',auth).send({name:'November',profile,tenant_id:id});
 expect(res.status).toBe(201);
 const call=db.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO content_campaigns'));
 expect(call[1][1]).toBe(tenant);expect(call[2]).toBe(tenant);
});
test('missing campaign facts rejected',async()=>{expect((await request(app).post('/campaigns').set('Authorization',auth).send({name:'Test',profile:{}})).status).toBe(400);});
test('foreign campaign cannot be read for winner selection',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM clients')?[{id:tenant,is_active:true}]:[]}));
 expect((await request(app).post(`/campaigns/${id}/winner`).set('Authorization',auth).send({persona_index:0,version:1})).status).toBe(404);
 expect(db.pool.connect).not.toHaveBeenCalled();
});
test('winner must belong to the current initial campaign',async()=>{
 expect((await request(app).post(`/campaigns/${id}/winner`).set('Authorization',auth).send({persona_index:4,version:1})).status).toBe(400);
 expect(client.release).toHaveBeenCalled();
 expect((await request(app).post(`/campaigns/${id}/winner`).set('Authorization',auth).send({persona_index:1,version:1})).status).toBe(200);
 expect(db.query.mock.calls.find(([sql])=>sql.includes('SET winner_index'))[1]).toEqual([tenant,id,1]);
});
test('saving campaign invalidates old personas and draft',async()=>{
 expect((await request(app).put(`/campaigns/${id}`).set('Authorization',auth).send({name:'Updated',profile,version:1})).status).toBe(200);
 expect(db.query.mock.calls.find(([sql])=>sql.includes('UPDATE content_campaigns'))[0]).toContain('draft=NULL');
 expect(client.release).toHaveBeenCalled();
});
test('concurrent generation and edit lock returns 409 and releases connection',async()=>{
 client.query.mockResolvedValue({rows:[{locked:false}]});
 await expect(service.lockCampaign(tenant,id)).rejects.toMatchObject({status:409});expect(client.release).toHaveBeenCalledTimes(1);
});
test('draft fingerprint changes with profile, knowledge, instructions and winner',()=>{
 const ctx={business_profile:'Java',knowledge_revision:'1'};
 const original=service.fingerprint(ctx,'','initial');
 expect(service.fingerprint({...ctx,knowledge_revision:'2'},'','initial')).not.toBe(original);
 expect(service.fingerprint({...ctx,business_profile:'Python'},'','initial')).not.toBe(original);
 expect(service.fingerprint(ctx,'New direction','initial')).not.toBe(original);
 expect(service.fingerprint(ctx,'','winner',{name:'Beginners'})).not.toBe(original);
});
