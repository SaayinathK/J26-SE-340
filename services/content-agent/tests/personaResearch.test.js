const {validateEvidence,validateReview,assess,claimsFor}=require('../src/services/personaResearch');
const p={name:'Beginners',description:'New Java learners',pain_points:['Need practice','Unsure where to start','Need explanations']};
const source={id:'evidence',finding:'Some new Java learners reported needing practice, a starting point, and explanations.',source_reference:'CRM support-tag report',sample_size:12};
const links=claimsFor(p).map(c=>({claim_key:c.key,evidence_id:source.id,stance:'supports',excerpt:'new Java learners',reason:'Reviewed the matching source field'}));
test('absence of actual evidence never validates AI claims',()=>{expect(assess(p,null,[]).status).toBe('inferred');});
test('full reviewed claim coverage produces qualified research support',()=>{expect(assess(p,{links},[source])).toMatchObject({status:'research_supported',supported_claims:4});});
test('missing claims and contradictions remain explicit',()=>{
 expect(assess(p,{links:links.slice(0,1)},[source]).status).toBe('partially_supported');
 expect(assess(p,{links:links.map((l,i)=>({...l,stance:i===0?'contradicts':'supports'}))},[source]).status).toBe('conflicting');
});
test('withdrawn or nonexistent evidence cannot maintain support',()=>{
 expect(assess(p,{links},[{...source,withdrawn_at:'2026-10-22'}]).status).toBe('inferred');
 expect(assess(p,{links},[]).status).toBe('inferred');
});
test('review rejects foreign evidence and invented quotations',()=>{
 const review={links,reviewer_note:'Reviewed actual research and its limitations',confirm_review:true};
 expect(()=>validateReview(p,review,[])).toThrow('active campaign source');
 expect(()=>validateReview(p,{...review,links:[{...links[0],excerpt:'invented claim'}]},[source])).toThrow('exactly');
 expect(validateReview(p,review,[source]).links).toHaveLength(4);
});
test('CRM evidence requires provenance, sample size, limitations and source confirmation',()=>{
 const e={source_type:'crm',source_reference:'Report 1, beginner tag',collected_on:'2026-01-01',sample_size:12,audience:'Java enquiries',finding:'12 enquiries mentioned Java',limitations:'Enquiries only; not representative of all students',confirm_source:true};
 expect(validateEvidence(e).sample_size).toBe(12);
 for(const patch of [{sample_size:0},{limitations:''},{confirm_source:false},{collected_on:'2026-02-30'}])expect(()=>validateEvidence({...e,...patch})).toThrow();
});
