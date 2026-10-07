import assert from 'node:assert/strict';
import esbuildPluginPino from 'esbuild-plugin-pino';

/** Pino's plugin embeds the build machine's absolute outdir. Resolve its worker
 * base from this ESM bundle's banner instead, before esbuild parses/maps it. */
export function relocatePinoWorkerBase(contents) {
  assert.equal(typeof contents, 'string');
  const helpers=contents.match(/function pinoBundlerAbsolutePath\(p\)/g)??[];
  const literals=contents.match(/const outputDir = "(?:[^"\\]|\\.)*";/g)??[];
  assert.equal(helpers.length,1,'Expected exactly one upstream Pino worker helper');
  assert.equal(literals.length,1,'Expected exactly one upstream Pino absolute output directory');
  return contents.replace(literals[0],'const outputDir = globalThis.__dirname;');
}

/** Preserve the upstream entry points, worker assets and hooks. Patch only its
 * generated onLoad source; never normalize or rewrite a finished binary. */
export function portablePinoPlugin(options) {
  const upstream=esbuildPluginPino(options);
  return {
    name:'portable-pino-worker-base',
    async setup(build) {
      const adapter=Object.create(build);
      adapter.onLoad=(settings,callback)=>build.onLoad(settings,async args=>{
        const result=await callback(args);
        return result?{...result,contents:relocatePinoWorkerBase(result.contents)}:result;
      });
      await upstream.setup(adapter);
    },
  };
}
