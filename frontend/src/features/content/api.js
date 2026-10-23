import { api } from '../../lib/api-client.js';
export async function request(path, options) {
 const data=await api('/content'+path,{...options,...(path==='/generate'?{signal:AbortSignal.timeout(340000)}:{})});
 if(data.success===false)throw new Error(data.error || data.message || (data.missing?`Complete your business setup: ${data.missing.join(', ')}.`:'The content service could not complete this request.'));
 return data;
}
