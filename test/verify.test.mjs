import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT} from '../lib/runner.mjs';
import {verify} from '../scripts/verify-contract.mjs';
test('npm verify performs real phases and writes actual evidence',async()=>{
  const outputPath=resolve(ROOT,'test/verify-cli-evidence.json');
  const run=spawnSync('npm',['run','verify','--','--output','test/verify-cli-evidence.json'],{cwd:ROOT,encoding:'utf8'});
  try {
    assert.equal(run.status,0,run.stderr);
    const evidence=JSON.parse(await readFile(outputPath,'utf8'));
    assert.equal(evidence.verdict,'LOCAL_VERIFIED');assert.equal(evidence.commands.length,3);
    assert.deepEqual(evidence.phases.map(p=>p.name),['baseline','upgraded','patched']);
    assert.equal(evidence.phases[0].matched,evidence.phases[0].total);
    assert.equal(evidence.phases[2].matched,evidence.phases[2].total);
    assert.ok(evidence.commands.every(command=>command.exitCode===0 && command.pid));
    assert.match(run.stdout,/LOCAL_VERIFIED/);
  }finally {await rm(outputPath,{force:true});}
});
test('verification CLI helper preserves real failed-execution evidence',async()=>{
  const outputPath=resolve(ROOT,'test/verify-failure-evidence.json');
  try {
    await assert.rejects(verify({outputPath,nodePath:'/nonexistent/package-upgrade-node'}),{code:'INFRA_ERROR'});
    const evidence=JSON.parse(await readFile(outputPath,'utf8'));
    assert.equal(evidence.error.code,'INFRA_ERROR');assert.notEqual(evidence.verdict,'LOCAL_VERIFIED');
    assert.match(evidence.commands.at(-1).error,/ENOENT/);
  }finally{await rm(outputPath,{force:true});}
});
