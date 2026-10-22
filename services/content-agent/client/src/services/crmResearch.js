export const CRM_COLUMNS=['source_reference','collected_on','sample_size','audience','finding','limitations'];
export function parseCRM(text){
 if(typeof text!=='string'||text.length>100000)throw new Error('Use an anonymized CSV under 100 KB.');
 const rows=[];let row=[],cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted)quoted=false;else if(!cell)quoted=true;else throw new Error('Unexpected quote in CSV.');}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('Unclosed quoted field in CSV.');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(x=>x.trim());
 if(!headers||headers.length!==CRM_COLUMNS.length||new Set(headers).size!==headers.length||CRM_COLUMNS.some(k=>!headers.includes(k)))throw new Error(`Use only these columns: ${CRM_COLUMNS.join(', ')}. Do not upload customer names or contact details.`);
 if(!rows.length||rows.length>100)throw new Error('Provide 1–100 summarized findings.');
 const records=rows.map((values,i)=>{
  if(values.length!==headers.length)throw new Error(`Row ${i+2} has the wrong number of columns.`);
  const record=Object.fromEntries(headers.map((key,n)=>[key,values[n].trim()]));
  if(!/^\d+$/.test(record.sample_size))throw new Error(`Row ${i+2}: sample_size must be a whole number.`);
  return {...record,sample_size:Number(record.sample_size)};
 });
 if(new TextEncoder().encode(JSON.stringify({records,confirm_source:true})).length>60000)throw new Error('Split this import into smaller files to fit the API request limit.');
 return records;
}
