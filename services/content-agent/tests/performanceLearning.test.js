const {evaluate,personaKey,validateMetric,dayAt}=require('../src/services/performanceLearning');
const {convert}=require('../src/services/metaInsights');
const now=new Date('2026-10-21T12:00:00Z');
const campaign={persona_set_id:'test',personas:[0,1,2].map(i=>({name:`Persona ${i}`,description:`Goal ${i}`,pain_points:['A','B','C']}))};
function evidence(){return campaign.personas.flatMap((p,i)=>[3,4,5].map(offset=>({persona_set_id:'test',persona_key:personaKey(p),variant_id:`ad${i}`,snapshot:{hook:'Try a new angle',body:{body:'Saved facts only'}},day:dayAt(-offset,now),impressions:1000,link_clicks:100,purchases:20,spend:i===0?20:200+i*100,currency:'USD',source:'manual'})));}
test('selects a purchase-cost winner only with sufficient matched evidence',()=>{
 const result=evaluate(campaign,evidence(),now);expect(result.status).toBe('winner');expect(result.winner_index).toBe(0);expect(result.guidance.example.hook).toBe('Try a new angle');
});
test('insufficient conversions cannot promote a high CTR persona',()=>{
 const result=evaluate(campaign,evidence().map(r=>({...r,purchases:0,link_clicks:900})),now);expect(result.status).toBe('collecting');expect(result.winner_index).toBeNull();
});
test('mixed currencies and data sources block automatic selection',()=>{
 for(const change of [{currency:'LKR'},{source:'meta'}]){const rows=evidence();rows[0]={...rows[0],...change};expect(evaluate(campaign,rows,now).status).toBe('incomparable');}
});
test('different reporting days do not count as a fair comparison',()=>{expect(evaluate(campaign,evidence().map(r=>r.variant_id==='ad2'?{...r,day:'2026-10-01'}:r),now).status).toBe('collecting');});
test('near ties and uncertain purchase counts remain inconclusive',()=>{
 const rows=evidence().map(r=>({...r,spend:100}));expect(evaluate(campaign,rows,now).status).toBe('inconclusive');
});
test('old persona tests and recent attribution days cannot select a winner',()=>{
 expect(evaluate(campaign,evidence().map(r=>({...r,persona_set_id:'old'})),now).status).toBe('collecting');
 expect(evaluate(campaign,evidence().map(r=>({...r,day:'2026-10-20'})),now).status).toBe('collecting');
});
test('expired evidence withdraws the automatic recommendation',()=>{expect(evaluate(campaign,evidence(),new Date('2026-12-01')).winner_index).toBeNull();});
test.each([{purchases:-1},{spend:Infinity},{day:'2026-02-30'},{currency:'usd'},{link_clicks:1.5}])('metric validation rejects %p',patch=>{
 expect(()=>validateMetric({day:'2026-01-01',impressions:1000,link_clicks:10,purchases:1,spend:10,currency:'USD',...patch})).toThrow();
});
test('Meta purchase aliases are never added together',()=>{
 expect(convert({date_start:'2026-10-01',account_currency:'USD',actions:[{action_type:'purchase',value:'5'},{action_type:'omni_purchase',value:'5'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'5'}]}).purchases).toBe(5);
});
