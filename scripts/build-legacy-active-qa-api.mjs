/** Immutable QA snapshot, never overwrites the production dist directory. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { portablePinoPlugin } from '../artifacts/api-server/build-portability.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'artifacts/api-server');
const require = createRequire(path.join(api, 'package.json')); globalThis.require = require;
const { build } = require('esbuild');
const parentBuild = await readFile(path.join(api, 'build.mjs'), 'utf8');
const external = JSON.parse(parentBuild.match(/external:\s*(\[[\s\S]*?\])/)[1].replace(/\/\/[^\n]*/g, '').replace(/,\s*\]/, ']'));
const matcher = createHash('sha256').update(await readFile(path.join(api, 'src/lib/signal-matching.ts'))).digest('hex');
const output = path.join(root, 'outputs/local-backup/legacy-active-qa-api-20261008');
assert.ok(output.startsWith(path.join(root, 'outputs/local-backup')));
await mkdir(output, { recursive: true });
const dependencyTarget = await realpath(path.join(api, 'node_modules'));
const dependencyLink = path.join(output, 'node_modules');
try { assert.equal(await realpath(dependencyLink), dependencyTarget); }
catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(dependencyTarget, dependencyLink, 'junction'); }
await build({ entryPoints: [path.join(root, 'scripts/legacy-active-qa-api.ts')], outdir: output, outExtension: { '.js': '.mjs' }, platform: 'node', bundle: true, format: 'esm', external, define: { __SIGNAL_MATCHER_SHA256__: JSON.stringify(matcher) }, plugins: [portablePinoPlugin({ transports: ['pino-pretty'] })], sourcemap: 'linked', logLevel: 'warning', banner: { js: `import {createRequire as __bannerCrReq} from 'node:module'; import __bannerPath from 'node:path'; import __bannerUrl from 'node:url'; globalThis.require=__bannerCrReq(import.meta.url); globalThis.__filename=__bannerUrl.fileURLToPath(import.meta.url); globalThis.__dirname=__bannerPath.dirname(globalThis.__filename);` } });
const bundlePath = path.join(output, 'legacy-active-qa-api.mjs');
const sha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
await writeFile(path.join(output, 'runtime-snapshot.json'), JSON.stringify({ bundlePath: bundlePath.replaceAll('\\','/'), sha256, schedulerFree: true, featureFlag: false }, null, 2));
console.log(JSON.stringify({ bundlePath: bundlePath.replaceAll('\\','/'), sha256, schedulerFree: true }));
