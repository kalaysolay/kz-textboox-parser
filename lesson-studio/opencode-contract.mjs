// Opt-in real-binary integration test. Only inference is replaced by a local fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {parseAIConfig} from './ai-config.mjs';
import {runAIStage,probeAI,stopAIProcess} from './ai-runtime.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),repo=path.dirname(HERE);
const root=path.join(HERE,'.local','cli-tests',randomUUID()),dir=path.join(root,'contract'),refs=path.join(root,'refs');
await fs.mkdir(dir,{recursive:true});await fs.mkdir(refs,{recursive:true});
const forbidden=await fs.mkdtemp(path.join(os.tmpdir(),'studio-contract-external-'));
const input={ru:'Проверка истории: ё.',kk:'Тарих: ә ғ қ ң ө ұ ү һ і.'},bytes=JSON.stringify(input),digest=createHash('sha256').update(bytes).digest('hex');
await fs.writeFile(path.join(dir,'input.json'),bytes);await fs.writeFile(path.join(refs,'SKILL.md'),'LESSON_STUDIO_SKILL_OK');await fs.writeFile(path.join(forbidden,'private.txt'),'OUTSIDE_REPO_MUST_NOT_BE_READ');
const output={...input,inputSha256:digest,skillMarker:'LESSON_STUDIO_SKILL_OK'};
const script=[
 ['read',{path:path.join(dir,'input.json')}],
 ['read',{path:path.join(refs,'SKILL.md')}],
 ['shell',{command:'node -e "process.stdout.write(require(\'crypto\').createHash(\'sha256\').update(require(\'fs\').readFileSync(\'input.json\')).digest(\'hex\'))"'}],
 ['write',{path:path.join(dir,'result.json'),content:JSON.stringify(output)}],
 ['write',{path:path.join(root,'outside-absolute.txt'),content:'MUST_BE_DENIED'}],
 ['write',{path:'../outside-relative.txt',content:'MUST_BE_DENIED'}],
 ['shell',{command:'Write-Output CONTRACT_FORBIDDEN'}],
 ['read',{path:path.join(forbidden,'private.txt')}],
];
let requests=0,child,timer;const results=[];
const server=http.createServer(async(req,res)=>{
 try{
  let body='';for await(const chunk of req)body+=chunk;
  if(++requests>25)throw Error('Unexpected fixture request loop');
  const request=JSON.parse(body),completed=request.messages?.filter(m=>m.role==='tool'&&/^call_\d+$/.test(m.tool_call_id))??[];
  for(const message of completed)results[Number(message.tool_call_id.slice(5))]=JSON.stringify(message.content);
  // Startup can cancel/retry inference. Replay from conversation, not HTTP count.
  const step=completed.length?Math.max(...completed.map(m=>Number(m.tool_call_id.slice(5))))+1:0;
  const call=script[step],id=`call_${step}`;
  if(call&&!request.tools?.some(t=>t.function?.name===call[0]))throw Error(`Required native tool is not available: ${call[0]}`);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'chatcmpl-contract',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  emit(call?{role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{role:'assistant',content:'Contract test complete.'});
  emit({},call?'tool_calls':'stop');res.end('data: [DONE]\n\n');
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Local contract provider failed'}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.argv[2]??'opencode';
const config=parseAIConfig({runtime:'opencode',model:'studio-contract/fixture',executable});
const provider={name:'Local integration fixture',env:['LESSON_STUDIO_CONTRACT_KEY'],package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:`http://127.0.0.1:${server.address().port}/v1`},models:{fixture:{name:'Fixture',limit:{context:64000,output:4000},capabilities:{tools:true,input:['text'],output:['text']}}}};
const env={...process.env,LESSON_STUDIO_CONTRACT_KEY:'local-fixture-only',OPENCODE_CONFIG_CONTENT:JSON.stringify({providers:{'studio-contract':provider}})};
const report={kind:'real-opencode-binary-local-inference',startedAt:new Date().toISOString(),status:'running',checks:{}};
try{
 const runtime=await probeAI(config);report.cliVersion=runtime.version;if(!runtime.available)throw Error('CLI unavailable');
 timer=setTimeout(()=>stopAIProcess(child),90000);
 await runAIStage({config,repo,key:'source',dir,env,externalSources:0,prompt:'Run the isolated file contract test. All fixtures belong to this test. Do not access other files.',onSpawn:value=>{child=value;}});
 const result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
 const exists=async file=>fs.access(file).then(()=>true,()=>false);
 report.checks={readUnicode:results[0]?.includes(input.kk)===true,readSkill:results[1]?.includes('LESSON_STUDIO_SKILL_OK')===true,shellHash:results[2]?.includes(digest)===true,writeResult:JSON.stringify(result)===JSON.stringify(output),absoluteWriteDenied:!await exists(path.join(root,'outside-absolute.txt')),relativeWriteDenied:!await exists(path.join(root,'outside-relative.txt')),unlistedShellDenied:/denied|permission|not allowed/i.test(results[6]??''),externalReadDenied:!results[7]?.includes('OUTSIDE_REPO_MUST_NOT_BE_READ')&&/denied|permission|not allowed/i.test(results[7]??''),inputUnchanged:await fs.readFile(path.join(dir,'input.json'),'utf8')===bytes};
 report.status=Object.values(report.checks).every(Boolean)?'passed':'failed';if(report.status==='failed')process.exitCode=1;
}catch(error){report.status='failed';report.errorCode=error.code??'contract_failed';report.message=error.status?error.message:'Native OpenCode contract test failed.';process.exitCode=1;}
finally{clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(forbidden,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));console.log(`Report: ${path.join(root,'report.json')}`);
