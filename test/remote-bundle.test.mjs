import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {buildRemoteBundle,hashText} from '../lib/adapters.mjs';
import {BASE_SOURCE,proposePatch,loadOracle} from '../lib/runner.mjs';
import {isDeepStrictEqual} from 'node:util';
test('uploaded remote worker bundle executes real fixed cases locally with offline packages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'upgrade-remote-worker-'));
 try{
  const bundle=await buildRemoteBundle();const {oracle}=await loadOracle();
  for(const [name,body] of Object.entries(bundle.files))await writeFile(join(dir,name),body);
  execFileSync('npm',['ci','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir,timeout:30000,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'}});
  assert.equal(hashText(await readFile(join(dir,'package-lock.json'))),bundle.lockSha256);
  for(const phase of ['baseline','upgraded','patched']){
   const source=phase==='patched'?proposePatch(BASE_SOURCE).after:BASE_SOURCE;
   await writeFile(join(dir,'input.json'),JSON.stringify({phase,source,cases:oracle.cases.map(({id,input})=>({id,input}))}));
   const actual=JSON.parse(execFileSync(process.execPath,['remote-worker.mjs'],{cwd:dir,timeout:10000,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}}));
   assert.equal(actual.version,oracle.versions[phase]);assert.equal(actual.lockSha256,bundle.lockSha256);
   assert.equal(actual.rows.length,oracle.cases.length);
   actual.rows.forEach((r,i)=>{const e=oracle.cases[i].expected[phase];assert.equal(r.accept,e.accept,phase+':'+r.id);assert.ok(isDeepStrictEqual(r.data,e.data),phase+':'+r.id);});
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
