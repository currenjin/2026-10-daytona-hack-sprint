// Private subprocess entrypoint. No user URL, path, command, or source is accepted by HTTP.
import { readFile } from 'node:fs/promises';
import { BASE_SOURCE, validatePatch } from './runner.mjs';
const phase = process.argv[2];
try {
  if (!['baseline','upgraded','patched'].includes(phase)) throw new Error('Unsupported phase');
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (text.length > 65536) throw new Error('Input too large'); }
  const {source,cases} = JSON.parse(text);
  if (phase === 'patched') validatePatch(BASE_SOURCE,source);
  else if(source !== BASE_SOURCE) throw new Error('Source outside fixture allowlist');
  const alias = phase === 'baseline' ? 'zod3' : 'zod4';
  const {z} = await import(alias);
  const packageInfo = JSON.parse(await readFile(new URL(`../node_modules/${alias}/package.json`,import.meta.url),'utf8'));
  const {createSchema} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const schema = createSchema(z);
  const rows = cases.map(({id,input}) => {
    const result = schema.safeParse(input);
    return {id,accept:result.success,data:result.success ? result.data : null,issues:result.success ? [] : result.error.issues};
  });
  process.stdout.write(JSON.stringify({node:process.version,version:packageInfo.version,rows}));
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
