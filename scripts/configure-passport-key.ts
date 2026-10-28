import {createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
const option=(s:string)=>process.argv[process.argv.indexOf(s)+1],kid=option('--kid'),issuer=option('--issuer'),state=option('--state');
try{
 if(!process.argv.includes('--kid')||!process.argv.includes('--issuer')||!['active','retired','compromised'].includes(state))throw new Error('Required: --kid ID --issuer HTTPS_URL --state active|retired|compromised [--public-key FILE]');
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7494,0)');
  const found=await client.query('SELECT kid FROM signal_passport_keys WHERE kid=$1 AND issuer=$2',[kid,issuer]);
  if(state==='active')await client.query("UPDATE signal_passport_keys SET state='retired' WHERE issuer=$1 AND state='active' AND kid<>$2",[issuer,kid]);
  if(found.rowCount)await client.query('UPDATE signal_passport_keys SET state=$1 WHERE kid=$2 AND issuer=$3',[state,kid,issuer]);
  else{if(!process.argv.includes('--public-key'))throw new Error('New key requires --public-key FILE');const publicKey=createPublicKey(readFileSync(option('--public-key')));if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('Ed25519 key required');await client.query('INSERT INTO signal_passport_keys(kid,issuer,public_key_pem,state) VALUES($1,$2,$3,$4)',[kid,issuer,publicKey.export({type:'spki',format:'pem'}).toString(),state]);}
  await client.query('COMMIT');console.log('Trusted passport key updated:',kid,state);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}finally{await pool.end();}
