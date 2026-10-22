const {summarize,validateMapping}=require('../src/services/crmSummary');
const {encrypt,decrypt}=require('../src/services/crmVault');
const api=require('../src/services/crmClient');
const fields=[{id:'pain',dataType:'SINGLE_OPTIONS',options:['No time','Rare']}];
const mapping={tags:['buyers'],segment_field:'',pain_field:'pain',goal_field:''};
afterEach(()=>{jest.restoreAllMocks();});
test('CRM summaries filter campaigns, suppress small groups and never retain contact identities',()=>{
 const contacts=Array.from({length:4},(_,i)=>({id:String(i),email:'private@example.com',name:'Private person',tags:['buyers'],customFields:[{id:'pain',value:i===3?'Rare':'No time'}]}));contacts.push({id:'outside',tags:['other']});
 const value=summarize(contacts,[{contactId:'0',status:'won'},{contactId:'outside',status:'won'}],mapping,fields,{});
 expect(value.contact_count).toBe(4);expect(value.recorded_pain_points).toEqual([{value:'No time',count:3}]);expect(value.opportunities.won).toBe(1);expect(value.purchases).toBeUndefined();expect(JSON.stringify(value)).not.toMatch(/private@example|Private person|outside/);
});
test('free text and unknown CRM fields are rejected',()=>{expect(()=>validateMapping({...mapping,pain_field:'notes'},fields)).toThrow();expect(validateMapping(mapping,fields)).toEqual(mapping);});
test('credentials are authenticated and bound to tenant',()=>{process.env.CRM_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');try{const cipher=encrypt('secret-token','tenant-a');expect(cipher).not.toContain('secret-token');expect(decrypt(cipher,'tenant-a')).toBe('secret-token');expect(()=>decrypt(cipher,'tenant-b')).toThrow();}finally{delete process.env.CRM_ENCRYPTION_KEY;}});
const response=body=>({ok:true,status:200,json:async()=>body});
test('contacts pagination loads all pages without duplicates',async()=>{const mock=jest.spyOn(global,'fetch').mockResolvedValueOnce(response({contacts:Array.from({length:100},(_,i)=>({id:String(i),locationId:'loc'})),total:101})).mockResolvedValueOnce(response({contacts:[{id:'100',locationId:'loc'}],total:101}));expect(await api.fetchAll('token','loc','contacts')).toHaveLength(101);expect(JSON.parse(mock.mock.calls[1][1].body).page).toBe(2);});
test('cross-account and repeated pages fail instead of replacing snapshots',async()=>{const mock=jest.spyOn(global,'fetch').mockResolvedValue(response({contacts:[{id:'a',locationId:'other'}],total:1}));await expect(api.fetchAll('t','loc','contacts')).rejects.toThrow('cross-account');mock.mockResolvedValue(response({contacts:[{id:'a',locationId:'loc'}],total:2}));await expect(api.fetchAll('t','loc','contacts')).rejects.toThrow('repeated');});
test('invalid tokens produce a safe actionable error',async()=>{jest.spyOn(global,'fetch').mockResolvedValue({ok:false,status:401});await expect(api.fetchAll('secret','loc','contacts')).rejects.toThrow('expired or invalid');});
test('lead view stores only allowed details, tags and linked opportunity status',()=>{
 const {leadDetails}=require('../src/services/crmLeads');
 const result=leadDetails({id:'a',firstName:'Ada',lastName:'Lee',email:'ada@example.com',phone:'123',tags:['buyer','buyer'],notes:'secret notes',customFields:[{value:'secret'}]},[{contactId:'a',name:'Course',status:'won'},{contactId:'b',name:'Other',status:'open'}]);
 expect(result.name).toBe('Ada Lee');expect(result.email).toBe('ada@example.com');expect(result.tags).toEqual(['buyer']);expect(result.opportunities).toEqual([{name:'Course',status:'won'}]);expect(JSON.stringify(result)).not.toContain('secret');
});
