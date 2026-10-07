import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (fs.existsSync('.env')) {
  console.log('.env already exists; preserved.');
} else {
  const template = fs.readFileSync('.env.example', 'utf8');
  fs.writeFileSync('.env', template.replace('replace-with-random-64-character-secret-before-sharing', randomBytes(32).toString('hex')), { mode: 0o600 });
  console.log('Created local .env with a random verification secret.');
}
