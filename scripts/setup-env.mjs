import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (fs.existsSync('.env')) {
  console.log('.env already exists; preserved.');
} else {
  const template = fs.readFileSync('.env.example', 'utf8');
  const databasePassword = randomBytes(32).toString('hex');
  const generated = template
    .replaceAll('replace-with-random-64-character-database-password', databasePassword)
    .replace('replace-with-random-64-character-secret-before-sharing', randomBytes(32).toString('hex'));
  fs.writeFileSync('.env', generated, { mode: 0o600 });
  console.log('Created local .env with random database and verification secrets.');
}
