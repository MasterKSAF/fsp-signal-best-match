import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { resolveSmtpTransport, sendVerificationEmail } from '../artifacts/api-server/src/lib/signal-mail.ts';
test('SMTP config requires authenticated TLS externally and permits plaintext only in explicit loopback demo test',()=>{
 const base={MAIL_TRANSPORT:'smtp',SMTP_HOST:'smtp.example.test',SMTP_PORT:'587',MAIL_FROM:'signal@example.test'};
 assert.equal(resolveSmtpTransport(base),null);
 const external=resolveSmtpTransport({...base,SMTP_USER:'synthetic',SMTP_PASSWORD:'synthetic'});
 assert.equal(external?.options.requireTLS,true);assert.equal(external?.options.tls.rejectUnauthorized,true);
 assert.equal(resolveSmtpTransport({...base,SMTP_LOCAL_TEST:'true',DEMO_MODE:'true'}),null);
 assert.equal(resolveSmtpTransport({...base,SMTP_HOST:'127.0.0.1',SMTP_LOCAL_TEST:'true',DEMO_MODE:'false'}),null);
 assert.equal(resolveSmtpTransport({...base,SMTP_PORT:'465',SMTP_USER:'synthetic',SMTP_PASSWORD:'synthetic'})?.options.secure,true);
});
test('SMTP adapter delivers the verification message to a local protocol fixture',async()=>{
 let message='',dataMode=false;
 const server=createServer(socket=>{let pending='';socket.setEncoding('utf8');socket.write('220 localhost synthetic SMTP\r\n');socket.on('data',chunk=>{pending+=chunk;while(pending.includes('\r\n')){const i=pending.indexOf('\r\n'),line=pending.slice(0,i);pending=pending.slice(i+2);if(dataMode){if(line==='.') {dataMode=false;socket.write('250 accepted\r\n');}else message+=line+'\n';}else if(line.startsWith('EHLO')||line.startsWith('HELO'))socket.write('250 localhost\r\n');else if(line==='DATA'){dataMode=true;socket.write('354 Continue\r\n');}else if(line==='QUIT'){socket.end('221 Bye\r\n');}else socket.write('250 OK\r\n');}});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{await sendVerificationEmail({to:'synthetic@example.test',code:'135790'},{MAIL_TRANSPORT:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(address.port),SMTP_LOCAL_TEST:'true',DEMO_MODE:'true',MAIL_FROM:'signal@example.test'});assert.match(Buffer.from(message.split("\n\n")[1]!.replace(/\s/g,""),"base64").toString("utf8"),/135790/);assert.match(message,/To: synthetic@example.test/);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
