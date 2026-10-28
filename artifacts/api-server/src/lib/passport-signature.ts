import {createPublicKey,sign,verify,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from './canonical-json';
import type {SignedPassportBody,SignedPassportDocument} from '@workspace/db';
const claim=z.object({skillId:z.string().min(1).max(80),label:z.string().min(1).max(120),level:z.enum(['Junior','Middle','Senior']),programVersion:z.string().max(120),verifiedAt:z.string().datetime(),source:z.object({type:z.literal('signal_skill_assessment'),attemptId:z.number().int().positive(),evidenceId:z.number().int().positive(),bankReleaseHash:z.string().regex(/^[0-9a-f]{64}$/).nullable(),reviewRevision:z.number().int().nonnegative()}).strict()}).strict();
export const PassportDocumentSchema=z.object({body:z.object({schema:z.literal('signal-voluntary-passport-v1'),algorithm:z.literal('Ed25519'),issuer:z.string().url(),kid:z.string().min(3).max(100),id:z.string().uuid(),subject:z.string().uuid(),issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),claims:z.array(claim).min(1).max(12)}).strict(),signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
export function signPassport(body:SignedPassportBody,key:KeyObject):SignedPassportDocument{
 if(key.asymmetricKeyType!=='ed25519')throw new Error('Ed25519 signing key required');
 return {body,signature:sign(null,Buffer.from(canonicalJson(body)),key).toString('base64url')};
}
export function verifyPassportIntegrity(input:unknown,keys:readonly {kid:string;issuer:string;publicKeyPem:string;state:string}[],expectedIssuer:string,at=new Date()){
 const parsed=PassportDocumentSchema.safeParse(input);if(!parsed.success)return {valid:false as const,status:'invalid_schema'};
 const doc=parsed.data,key=keys.find(k=>k.kid===doc.body.kid&&k.issuer===doc.body.issuer);
 if(doc.body.issuer!==expectedIssuer||!key)return {valid:false as const,status:'untrusted_issuer_or_key'};
 if(key.state==='compromised')return {valid:false as const,status:'compromised_key'};
 try{const publicKey=createPublicKey(key.publicKeyPem);if(publicKey.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(canonicalJson(doc.body)),publicKey,Buffer.from(doc.signature,'base64url')))return {valid:false as const,status:'invalid_signature'};}catch{return {valid:false as const,status:'invalid_signature'};}
 if(+new Date(doc.body.issuedAt)>+at+60000||+new Date(doc.body.expiresAt)<=+new Date(doc.body.issuedAt))return {valid:false as const,status:'invalid_dates'};
 if(+new Date(doc.body.expiresAt)<=+at)return {valid:false as const,status:'expired'};
 return {valid:true as const,status:'integrity_verified_current_status_unknown',document:doc};
}
