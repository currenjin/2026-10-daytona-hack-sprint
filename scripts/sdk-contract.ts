// Compile-time only: validate calls against installed @daytona/sdk 0.224.0.
import {Buffer} from 'buffer';
import type {Daytona,DaytonaConfig,CreateSandboxFromSnapshotParams,Sandbox} from '@daytona/sdk';
const config:DaytonaConfig={apiKey:'not-a-real-key',apiUrl:'https://app.daytona.io/api',target:'us',otelEnabled:false,requestTimeoutMs:30000};
const params:CreateSandboxFromSnapshotParams={language:'typescript',ephemeral:true,public:false,autoStopInterval:5,autoDeleteInterval:0,ttlMinutes:10,networkBlockAll:false,domainAllowList:'registry.npmjs.org',envVars:{NODE_ENV:'production'},labels:{app:'package-upgrade-lab',phase:'baseline'}};
export async function sdkContract(client:Daytona,sandbox:Sandbox,bytes:Buffer){
 const created=await client.create(params,{timeout:60});
 await created.fs.uploadFile(bytes,'/home/daytona/upgrade-lab/input.json',30);
 const r=await created.process.executeCommand('node remote-worker.mjs','/home/daytona/upgrade-lab',{},30);
 const exit:number=r.exitCode;const output:string=r.result;
 await client.delete(sandbox,30,true);await client.get(sandbox.id);
 return {config,exit,output};
}
