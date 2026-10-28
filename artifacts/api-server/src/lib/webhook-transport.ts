import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import https from 'node:https';
import http from 'node:http';
const denied=new BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)denied.addSubnet(address,prefix,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix]of [['2001:db8::',32],['2001::',32],['2002::',16],['3fff::',20]] as const)denied.addSubnet(address,prefix,'ipv6');
export function publicWebhookAddress(address:string){const family=isIP(address);return family===4?!denied.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied.check(address,'ipv6');}
export function localWebhookTest(url:URL){return process.env.NODE_ENV==='test'&&process.env.SIGNAL_ATS_LOCAL_TEST==='true'&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port===process.env.SIGNAL_ATS_LOCAL_TEST_PORT;}
export async function validateWebhookEndpoint(raw:string,resolver=lookup){
 const u=new URL(raw);if(u.username||u.password||u.hash||u.search||u.href.length>1000)throw new Error('Endpoint URL is not allowed');
 if(localWebhookTest(u))return {url:u,address:'127.0.0.1',family:4};
 if(u.protocol!=='https:'||u.port&&u.port!=='443')throw new Error('Webhook requires HTTPS on443');
 const hostname=u.hostname.replace(/^\[|\]$/g,''),family=isIP(hostname),addresses=family?[{address:hostname,family}]:await resolver(hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(a=>!publicWebhookAddress(a.address)))throw new Error('Endpoint resolves to a forbidden address');
 return {url:u,...addresses[0]};
}
export function webhookSignature(secret:string,timestamp:string,eventId:string,body:Buffer){return createHmac('sha256',secret).update(`${timestamp}.${eventId}.`).update(body).digest('hex');}
export function verifyWebhookSignature(secret:string,timestamp:string,eventId:string,body:Buffer,signature:string,now=Date.now()){
 if(!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(eventId)||!/^[0-9a-f]{64}$/.test(signature))return false;
 return timingSafeEqual(Buffer.from(webhookSignature(secret,timestamp,eventId,body),'hex'),Buffer.from(signature,'hex'));
}
export async function sendWebhook(raw:string,secret:string,eventId:string,body:Buffer){
 // Resolve on every delivery; the approved address is pinned to this exact connection. No fetch/proxy agents, redirects or cross-origin retries.
 const checked=await validateWebhookEndpoint(raw),timestamp=String(Math.floor(Date.now()/1000)),transport=localWebhookTest(checked.url)?http:https;
 return new Promise<number>((resolve,reject)=>{const request=transport.request(checked.url,{method:'POST',agent:false,lookup:(_hostname,_options,callback)=>callback(null,checked.address,checked.family),headers:{'Content-Type':'application/json','Content-Length':body.length,'X-Signal-Id':eventId,'X-Signal-Timestamp':timestamp,'X-Signal-Signature':webhookSignature(secret,timestamp,eventId,body)}},response=>{let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>4096)request.destroy(new Error('Response limit'));});response.on('end',()=>resolve(response.statusCode??0));response.on('error',reject);});request.setTimeout(5000,()=>request.destroy(new Error('Delivery timeout')));request.on('error',reject);request.end(body);});
}
export const webhookBodyHash=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
