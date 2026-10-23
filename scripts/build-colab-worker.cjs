'use strict';
// Explicit allowlist: do not package .env files, model weights, datasets or notebook outputs.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const files=[
 ['colab_worker.py','ml/email-agent/training/colab_worker.py'],
 ['requirements-colab-worker.txt','ml/email-agent/training/requirements-colab-worker.txt'],
 ['c4_continuous_qlora_colab.ipynb','ml/email-agent/notebooks/c4_continuous_qlora_colab.ipynb'],
 ['README.md','docs/colab-qlora-automation.md'],
];
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
const entries=[],directory=[];let offset=0;
for(const[name,file]of files){
 const data=fs.readFileSync(path.join(root,file)),compressed=zlib.deflateRawSync(data),label=Buffer.from(name),checksum=crc32(data);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(label.length,26);
 entries.push(local,label,compressed);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(checksum,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(offset,42);directory.push(central,label);
 offset+=local.length+label.length+compressed.length;
}
const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
const destination=path.join(root,'frontend/public/downloads/colab-ft-worker.zip');
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,Buffer.concat([...entries,central,end]));
console.log('Built code-only Colab setup kit ('+files.length+' files).');
