'use strict';
const net=require('node:net');
async function createMailCatcher(){
  const messages=[],sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.write('220 localhost test SMTP\r\n');
    let buffer='',data=false,content=[];
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      while(buffer.includes('\r\n')){
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data){if(line==='.') {messages.push(content.join('\r\n'));content=[];data=false;socket.write('250 Message accepted\r\n');} else content.push(line.startsWith('..')?line.slice(1):line);continue;}
        if(/^(EHLO|HELO)\b/i.test(line))socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if(/^(MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line))socket.write('250 OK\r\n');
        else if(/^DATA$/i.test(line)){data=true;socket.write('354 End with dot\r\n');}
        else if(/^QUIT$/i.test(line)){socket.end('221 Goodbye\r\n');}
        else socket.write('500 Command not supported\r\n');
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {messages,port:server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={createMailCatcher};
