import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {stageCommand,runAIStage,probeAI,opencodeActivity,runtimeError,stopAIProcess} from '../ai-runtime.mjs';
import {aiSelectionLabel,aiRuntimeStatus} from '../public/ai-runtime-ui.js';

const repo=path.resolve('repo with spaces'),dir=path.join(repo,'lessons','Тема тарих');
const config=runtime=>({runtime,model:runtime==='codex'?'gpt-5.6-sol':'opencode/deepseek-v4-pro',executable:path.join(repo,`${runtime}.exe`),...(runtime==='codex'?{reasoningEffort:'high'}:{}),configSource:'file'});
const childProcess=()=>Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false,pid:1234,kill(){this.killed=true;}});

test('Codex command preserves sandbox, model, effort, OCR paths and source policy',()=>{
 const cmd=stageCommand({config:config('codex'),repo,dir,key:'source',env:{}});
 assert.equal(cmd.executable,config('codex').executable);assert.ok(cmd.args.includes('workspace-write'));assert.ok(cmd.args.includes('gpt-5.6-sol'));assert.ok(cmd.args.includes('model_reasoning_effort="high"'));assert.equal(cmd.args.at(-1),'-');
 assert.ok(cmd.args.includes(path.join(repo,'ocr')));assert.equal(cmd.args[cmd.args.indexOf('-C')+1],dir);
 assert.ok(stageCommand({config:config('codex'),repo,dir,key:'research',externalSources:1}).args.includes('--search'));
 assert.ok(!stageCommand({config:config('codex'),repo,dir,key:'research',externalSources:0}).args.includes('--search'));
});

test('OpenCode uses a private session with explicit model and a dedicated agent, never auto-approval',()=>{
 const cmd=stageCommand({config:config('opencode'),repo,dir,key:'author',env:{OPENCODE_CONFIG_CONTENT:JSON.stringify({providers:{custom:{name:'Private'}}})}});
 assert.deepEqual(cmd.args,['run','--standalone','--format','json','--model','opencode/deepseek-v4-pro','--agent','lesson-studio']);
 const content=JSON.parse(cmd.env.OPENCODE_CONFIG_CONTENT);assert.equal(content.providers.custom.name,'Private');
 const rules=content.agents['lesson-studio'].permissions;
 assert.ok(rules.some(r=>r.action==='*'&&r.effect==='deny'));
 assert.ok(!rules.some(r=>r.action==='execute'&&r.effect==='allow'));
 assert.ok(!rules.some(r=>r.action==='websearch'&&r.effect==='allow'));
 const research=JSON.parse(stageCommand({config:config('opencode'),repo,dir,key:'research',externalSources:1,env:{}}).env.OPENCODE_CONFIG_CONTENT);
 assert.ok(research.agents['lesson-studio'].permissions.some(r=>r.action==='websearch'&&r.effect==='allow'));
});

for(const runtime of ['codex','opencode'])test(`${runtime}: bounded events, Unicode stdin, fixed activity, no secret output`,async()=>{
 const child=childProcess(),activity=[];let invocation,input='';child.stdin.on('data',c=>input+=c);
 const completed=runAIStage({config:config(runtime),repo,dir,key:'author',prompt:'Қазақша әғқңөұүһі Привет '.repeat(5000),spawnProcess:(...args)=>{invocation=args;return child;},onActivity:a=>activity.push(a)});
 assert.equal(invocation[2].cwd,dir);assert.equal(invocation[2].shell,false);assert.equal(invocation[2].windowsHide,true);assert.match(input,/әғқңөұүһі/);assert.ok(input.length>32768);
 child.stderr.write('SECRET');child.stdout.write('invalid\n');
 child.stdout.write(JSON.stringify(runtime==='codex'?{type:'item.completed',item:{type:'reasoning',text:'SECRET'}}:{type:'reasoning',part:{text:'SECRET'}})+'\n');
 const event=Buffer.from(JSON.stringify(runtime==='codex'?{type:'item.started',item:{type:'command_execution',command:'node SECRET'}}:{type:'tool_use',part:{tool:'read',state:{output:'SECRET'}}})+'\n');
 for(const byte of event)child.stdout.write(Buffer.from([byte]));
 child.stdout.end(JSON.stringify({type:runtime==='codex'?'turn.completed':'step_finish'})+'\n');child.exitCode=0;child.emit('close',0);await completed;
 assert.doesNotMatch(JSON.stringify(activity),/SECRET|reasoning/);assert.ok(activity.filter(Boolean).length>=2);
});

for(const runtime of ['codex','opencode'])test(`${runtime}: error event fails a zero-exit process and incomplete output cannot pass`,async()=>{
 const child=childProcess();const completed=runAIStage({config:config(runtime),repo,dir,key:'source',prompt:'test',spawnProcess:()=>child});
 const rejected=assert.rejects(completed,e=>e.code==='ai_quota'&&!e.message.includes('SECRET'));
 child.stdout.end(JSON.stringify({type:'error',error:{type:'provider.quota',status:402,message:'SECRET',response:{token:'SECRET'}}})+'\n');child.exitCode=0;child.emit('close',0);await rejected;
 const incomplete=childProcess(),run=runAIStage({config:config(runtime),repo,dir,key:'source',prompt:'test',spawnProcess:()=>incomplete});const bad=assert.rejects(run,e=>e.code==='ai_incomplete');incomplete.stdout.end('{}\n');incomplete.exitCode=0;incomplete.emit('close',0);await bad;
});

test('missing executable and version probes report safe metadata',async()=>{
 const child=childProcess(),probe=probeAI(config('opencode'),{spawnProcess:()=>child});
 child.stdout.end('opencode v2.2.0\n');child.exitCode=0;child.emit('close',0);const result=await probe;
 assert.equal(result.available,true);assert.equal(result.version,'opencode v2.2.0');assert.equal(result.executable,undefined);
 const missing=childProcess(),p=probeAI(config('codex'),{spawnProcess:()=>missing});missing.emit('error',Error('SECRET'));assert.equal((await p).available,false);
});

test('OpenCode finalized text can end a clean process without step_finish; errors still win',async()=>{
 for(const withError of [false,true]){
  const child=childProcess(),run=runAIStage({config:config('opencode'),repo,dir,key:'author',prompt:'test',spawnProcess:()=>child});
  const result=withError?assert.rejects(run,e=>e.code==='ai_limit'):run;
  child.stdout.write(JSON.stringify({type:'text',part:{type:'text',text:'SECRET',time:{start:1,end:2}}})+'\n');
  if(withError)child.stdout.write(JSON.stringify({type:'error',error:{type:'provider.free-limit',status:429}})+'\n');
  child.stdout.end();child.exitCode=0;child.emit('close',0);await result;
 }
 const child=childProcess(),run=runAIStage({config:config('opencode'),repo,dir,key:'author',prompt:'test',spawnProcess:()=>child});
 const rejected=assert.rejects(run,e=>e.code==='ai_incomplete');
 child.stdout.end(JSON.stringify({type:'text',part:{text:'unfinished'}})+'\n');child.exitCode=0;child.emit('close',0);await rejected;
});

test('a transport retry must finish successfully after the error; quotas are never cleared',async()=>{
 for(const scenario of ['recovered','unfinished','late_error','quota','nonzero']){
  const child=childProcess(),run=runAIStage({config:config('opencode'),repo,dir,key:'source',prompt:'test',spawnProcess:()=>child});
  const result=scenario==='recovered'?run:assert.rejects(run,e=>e.code===(scenario==='quota'?'ai_limit':'ai_connection'));
  const emit=e=>child.stdout.write(JSON.stringify(e)+'\n');
  const finish={type:'step_finish'},error={type:'error',error:scenario==='quota'?{type:'provider.free-limit',status:429}:{type:'provider.transport',message:'ECONNRESET PRIVATE'}};
  if(scenario==='late_error')emit(finish);
  emit(error);
  if(['recovered','quota','nonzero'].includes(scenario))emit(finish);
  child.stdout.end();child.exitCode=scenario==='nonzero'?1:0;child.emit('close',child.exitCode);await result;
 }
});

test('permission errors, quotas and labels do not reveal model messages',()=>{
 assert.equal(runtimeError('opencode',{type:'provider.free-limit',status:429,message:'SECRET'}).code,'ai_limit');
 assert.equal(runtimeError('codex',{status:401}).code,'ai_auth');
 assert.equal(runtimeError('codex',{message:'model unsupported'}).code,'ai_model');
 const connection=runtimeError('opencode',{type:'provider.transport',message:'ECONNRESET SECRET'});
 assert.equal(connection.code,'ai_connection');assert.doesNotMatch(connection.message,/SECRET|ECONNRESET/);
 assert.equal(opencodeActivity({type:'unknown'}),null);
 assert.match(aiSelectionLabel({runtime:'opencode',model:'opencode/deepseek-v4-pro'}),/^OpenCode/);
 assert.match(aiSelectionLabel({runtime:'codex',configSource:'legacy'}),/точная модель не зафиксирована/);
 assert.match(aiRuntimeStatus({available:false,error:{message:'Конфиг повреждён'}}),/Конфиг повреждён/);
});

test('stop targets the owned Windows process tree without a shell',()=>{
 const child=childProcess();let invocation;stopAIProcess(child,{platform:'win32',spawnProcess:(...args)=>{invocation=args;return new EventEmitter();}});
 assert.deepEqual(invocation[1],['/pid','1234','/t','/f']);assert.equal(invocation[2].shell,false);
});
