import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {LessonPipeline} from '../pipeline.mjs';

const pair=value=>({ru:value,kk:value});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,runtime,{failResearch=false,changeAfterSource=false}={}) {
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-ai-pipeline-')),root=path.join(repo,'lessons'),configFile=path.join(repo,'lesson-studio','ai.config.json');
 await fs.mkdir(root);await fs.mkdir(path.dirname(configFile));
 const selection={runtime,model:runtime==='codex'?'gpt-5.6-sol':'opencode/deepseek-v4-pro',executable:path.join(repo,`${runtime}.exe`),...(runtime==='codex'?{reasoningEffort:'high'}:{})};
 await fs.writeFile(configFile,JSON.stringify(selection));
 const calls=[];let failed=false;
 const spawnRuntime=(executable,args,options)=>{
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false,kill(){this.killed=true;}});
  const finish=(code,event)=>{if(event)child.stdout.write(JSON.stringify(event)+'\n');child.stdout.end();child.exitCode=code;child.emit('close',code);};
  if(args[0]==='--version'){setImmediate(()=>{child.stdout.write('fixture-cli 1.0');finish(0);});return child;}
  let prompt='';child.stdin.on('data',chunk=>prompt+=chunk);
  child.stdin.on('finish',()=>{void(async()=>{
   const role=prompt.match(/отдельная роль (\w+)/)?.[1];calls.push({executable,args,role,options});
   if(role==='researcher'&&failResearch&&!failed){failed=true;finish(0,{type:'error',error:{status:429,type:'provider.free-limit',message:'SECRET'}});return;}
   const order=JSON.parse(await fs.readFile(path.join(options.cwd,'00-Заказ.json'),'utf8'));let file,data;
   if(role==='parser'){file='01-Источник учебника.json';data={sourceStatus:'ready'};if(changeAfterSource)await fs.writeFile(configFile,JSON.stringify({runtime:runtime==='codex'?'opencode':'codex',model:runtime==='codex'?'opencode/other':'other'}));}
   if(role==='researcher'){file='Дополнительные источники.json';data=[];}
   if(role==='planner'){file='02-План.json';data={schemaVersion:2};}
   if(role==='generator'){file=`${order.topicRu}.lesson.json`;data={schemaVersion:2,id:order.id,revision:1,status:'draft',grade:5,title:pair(order.topicRu),subject:pair('История'),summary:pair('Описание'),estimatedMinutes:5,objectives:pair(['Цель']),sources:[{id:'author',type:'authored',title:'Автор',usage:pair('Пример')}],assets:[],blocks:[{id:'intro',type:'paragraph',origin:'authored',sourceRefs:['author'],content:pair('Проверенный пример')} ]};}
   if(role==='reviewer'){file='04-Ревью.json';data={lessonSha256:digest(await fs.readFile(path.join(options.cwd,`${order.topicRu}.lesson.json`))),verdict:'ready_for_preview',issues:[]};}
   await fs.writeFile(path.join(options.cwd,file),JSON.stringify(data));
   finish(0,{type:args[0]==='run'?'step_finish':'turn.completed'});
  })().catch(error=>child.emit('error',error));});
  return child;
 };
 const pipeline=new LessonPipeline({repo,lessonsRoot:root,spawnRuntime});await pipeline.initialize();
 pipeline.books=async()=>[{id:'book',grade:5,subjectRu:'история',subjectKk:'Тарих',pdfTextbookPath:'source.pdf',parsedTextbookPath:'parsed.json'}];
 t.after(async()=>{await pipeline.close();await Promise.allSettled([...pipeline.writes.values()]);await fs.rm(repo,{recursive:true,force:true});});
 const start=()=>pipeline.start({bookId:'book',topicRu:'Причины и последствия',externalSources:0});
 async function settled(){for(let i=0;i<400;i++){if(!pipeline.running)return pipeline.list()[0];await new Promise(r=>setTimeout(r,5));}throw Error('pipeline did not settle');}
 return {pipeline,root,configFile,selection,calls,start,settled};
}

for(const runtime of ['codex','opencode'])test(`${runtime}: all five stages use the pinned model despite changes to the config`,async t=>{
 const f=await fixture(t,runtime,{changeAfterSource:true}),started=await f.start(),done=await f.settled();
 assert.equal(done.status,'completed');assert.equal(done.ai.runtime,runtime);assert.equal(done.ai.model,f.selection.model);
 assert.deepEqual(f.calls.map(c=>c.role),['parser','researcher','planner','generator','reviewer']);
 for(const call of f.calls){assert.equal(call.executable,f.selection.executable);assert.equal(call.args[call.args.indexOf('--model')+1],f.selection.model);}
 const job=f.pipeline.jobs.get(started.id),order=JSON.parse(await fs.readFile(path.join(job.dir,'00-Заказ.json'),'utf8'));
 assert.equal(order.ai.runtime,runtime);assert.equal(order.ai.executable,undefined);assert.equal(done.aiConfig,undefined);
 assert.doesNotMatch(JSON.stringify(done),/\.exe|SECRET/);
});

for(const runtime of ['codex','opencode'])test(`${runtime}: resume uses the saved CLI even when current config is invalid`,async t=>{
 const f=await fixture(t,runtime,{failResearch:true}),job=await f.start();assert.equal((await f.settled()).errorCode,'ai_limit');
 await fs.writeFile(f.configFile,'INVALID SECRET');await f.pipeline.resume(job.id);const done=await f.settled();
 assert.equal(done.status,'completed');assert.equal(done.errorCode,undefined);assert.equal(f.calls.filter(c=>c.role==='parser').length,1);
 assert.ok(f.calls.every(c=>c.executable===f.selection.executable));
});

test('legacy interrupted jobs stay on inherited Codex instead of switching to the new OpenCode config',async t=>{
 const f=await fixture(t,'opencode',{failResearch:true}),started=await f.start();await f.settled();
 const job=f.pipeline.jobs.get(started.id);delete job.aiConfig;
 await f.pipeline.resume(job.id);const done=await f.settled();assert.equal(done.status,'completed');assert.equal(done.ai.runtime,'codex');assert.equal(done.ai.configSource,'legacy');assert.equal(done.ai.model,null);
 const last=f.calls.at(-1);assert.ok(!last.args.includes('--model'));assert.ok(last.args.includes('exec'));
});

test('invalid config is rejected before making a lesson directory or starting a process',async t=>{
 const f=await fixture(t,'codex');await fs.writeFile(f.configFile,'{}');
 await assert.rejects(f.start(),e=>e.code==='ai_config_invalid');assert.deepEqual(await fs.readdir(f.root),[]);assert.equal(f.calls.length,0);
});

test('pinned settings survive a server restart and unavailable saved CLI does not get replaced',async t=>{
 const f=await fixture(t,'opencode',{failResearch:true}),started=await f.start();await f.settled();await fs.writeFile(f.configFile,'INVALID');
 const restarted=new LessonPipeline({repo:f.pipeline.repo,lessonsRoot:f.root,spawnRuntime:f.pipeline.spawnRuntime});await restarted.initialize();
 restarted.available=async()=>({available:false});await assert.rejects(restarted.resume(started.id),e=>e.code==='ai_missing');
 assert.equal(restarted.jobs.get(started.id).aiConfig.runtime,'opencode');
 delete restarted.available;await restarted.resume(started.id);
 for(let i=0;restarted.running&&i<400;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(restarted.list()[0].status,'completed');assert.equal(restarted.list()[0].ai.model,'opencode/deepseek-v4-pro');
 await restarted.close();
});
