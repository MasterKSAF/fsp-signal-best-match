/** Local authored-fixture verifier. Never accepts candidate source or runs in HTTP.
 * It executes the SHOWN Python/TypeScript/SQL rather than generator answer formulas.
 * Non-executable judgement/architecture choices are deliberately not evaluated. */
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
export function executeVisibleSemanticTask(prompt: string, slot: number): string | null {
  if (slot === 2 || slot === 4) return null;
  const found=prompt.match(/```(python|typescript|sql)\n([\s\S]*?)\n```/);
  if (!found) throw new Error('No supported visible authored fixture');
  const [,language,source]=found;
  if (language === 'typescript') {
    const instrumented=slot===1 ? `${source}\n__out.push(String(total));` : source!.split('\n').map(line=>/^(display|key|focus|receive)\(/.test(line) ? `__out.push(String(${line.replace(/;$/,'')}));` : line).join('\n');
    const context={__out:[] as string[]};
    vm.runInNewContext(ts.transpile(instrumented,{target:ts.ScriptTarget.ES2022}),context,{timeout:500});
    if (!context.__out.length) throw new Error('Unsupported trace has no instrumented calls');
    return context.__out.join('|');
  }
  const worker=language==='sql'
    ? "import sys,json,sqlite3\ns=json.load(sys.stdin)\nprint(sqlite3.connect(':memory:').execute(s).fetchone()[0])"
    : "import sys,json\ns=json.load(sys.stdin)\nlines=[]\nfor line in s.splitlines():\n if line.startswith(('authorize(', 'consume(', 'read(')): line='__out.append(str('+line+'))'\n lines.append(line)\nns={'__out':[]}\nexec('\\n'.join(lines),ns)\nassert ns['__out'], 'No instrumented trace calls'\nprint('|'.join(ns['__out']))";
  const result=spawnSync('python',['-c',worker],{input:JSON.stringify(source),encoding:'utf8',timeout:3000,windowsHide:true});
  if (result.error || result.status!==0) throw new Error(`Visible authored fixture execution failed: ${result.error?.message??result.stderr}`);
  return result.stdout.trim();
}
