import test from 'node:test';
import assert from 'node:assert/strict';
import {readCampaignStream} from '../src/services/campaignStream.js';
const encoder=new TextEncoder();
function response(text, chunkSize=7) {
 const bytes=encoder.encode(text);
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=chunkSize)controller.enqueue(bytes.slice(i,i+chunkSize));controller.close();}}));
}
const complete={type:'complete',data:{success:true,content_id:'saved-id',personas:[]}};
test('parser handles split UTF-8 and JSON chunks without duplicate events',async()=>{
 const events=[];
 const text=[{type:'heartbeat'},{type:'persona',persona:{name:'Créateurs 😀'}},complete].map(JSON.stringify).join('\n');
 const result=await readCampaignStream(response(text,1),event=>events.push(event));
 assert.equal(result.content_id,'saved-id');assert.equal(events.length,2);assert.equal(events[0].persona.name,'Créateurs 😀');
});
test('preview is delivered before final completion arrives',async()=>{
 let controller;
 const stream=new ReadableStream({start(value){controller=value;}});
 const received=[];
 let previewResolve;
 const previewReady=new Promise(resolve=>previewResolve=resolve);
 const finished=readCampaignStream(new Response(stream),event=>{received.push(event.type);if(event.type==='persona')previewResolve();});
 controller.enqueue(encoder.encode(JSON.stringify({type:'persona',persona:{name:'First'}})+'\n'));
 await previewReady;
 assert.deepEqual(received,['persona']);
 controller.enqueue(encoder.encode(JSON.stringify(complete)+'\n'));controller.close();
 await finished;assert.deepEqual(received,['persona','complete']);
});
test('server failure never becomes a completed campaign',async()=>{
 await assert.rejects(readCampaignStream(response(JSON.stringify({type:'error',error:'Failed to save'})),()=>{}),/Failed to save/);
});
test('truncated connection requires checking History rather than automatically retrying',async()=>{
 await assert.rejects(readCampaignStream(response(JSON.stringify({type:'persona',persona:{}})),()=>{}),/Check History/);
});
