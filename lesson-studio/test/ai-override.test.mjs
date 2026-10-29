import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseAIConfig,orderAIConfig,runtimeExecutable} from '../ai-config.mjs';
import {generationRequest,aiOverrideControls,selectedAIAvailable} from '../public/generation-ai-ui.js';
import {LessonPipeline} from '../pipeline.mjs';

test('per-order model inherits the configured executable and effort without mutating defaults',async()=>{
 const base=parseAIConfig({runtime:'codex',model:'default-model',reasoningEffort:'high',executable:'custom-codex'}),before=structuredClone(base);
 const chosen=await orderAIConfig(base,{model:'another-model'});
 assert.equal(chosen.model,'another-model');assert.equal(chosen.executable,base.executable);assert.equal(chosen.reasoningEffort,'high');assert.equal(chosen.configSource,'order');assert.deepEqual(base,before);
 assert.equal(await orderAIConfig(base,undefined),base);
 assert.equal((await orderAIConfig(base,{model:'another-model',reasoningEffort:null})).reasoningEffort,undefined);
});

test('switching CLI never reuses the other executable or incompatible reasoning settings',async()=>{
 const base=parseAIConfig({runtime:'codex',model:'base',reasoningEffort:'high',executable:'custom-codex'});
 const chosen=await orderAIConfig(base,{runtime:'opencode',model:'provider/model#high'},{env:{}});
 assert.equal(chosen.executable,'opencode');assert.equal(chosen.reasoningEffort,undefined);
 const codex=await orderAIConfig(chosen,{runtime:'codex',model:'other',reasoningEffort:'low'},{env:{LESSON_STUDIO_CODEX_EXE:'custom-codex'}});
 assert.equal(codex.executable,'custom-codex');assert.equal(codex.reasoningEffort,'low');
});

test('OpenCode installed outside PATH can be selected from the browser',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const installed=path.join(dir,'Programs','OpenCodeCLI','opencode.exe');await fs.mkdir(path.dirname(installed),{recursive:true});await fs.writeFile(installed,'fixture');
 assert.equal(await runtimeExecutable('opencode',{runtime:'codex',executable:'codex'},{env:{LOCALAPPDATA:dir}}),installed);
});

test('browser cannot set executable paths, credentials or malformed model parameters',async()=>{
 const base=parseAIConfig({runtime:'codex',model:'base'});
 for(const override of [null,[],{executable:'SECRET'},{apiKey:'SECRET'},{runtime:'unknown',model:'x'},{runtime:'opencode',model:'missing-provider'},{model:'display name'},{runtime:'opencode',model:'p/m',reasoningEffort:'high'}])await assert.rejects(orderAIConfig(base,override),e=>e.code==='ai_override_invalid'&&!e.message.includes('SECRET'));
});

test('UI sends an override only when enabled and never sends Codex effort to OpenCode',()=>{
 const base={bookId:'b',aiRuntime:'codex',aiModel:'m',aiReasoningEffort:'high'};
 assert.deepEqual(generationRequest(base),{bookId:'b'});
 assert.deepEqual(generationRequest({...base,aiOverrideEnabled:'on',aiRuntime:'opencode',aiModel:'p/m#high'}),{bookId:'b',aiOverride:{runtime:'opencode',model:'p/m#high'}});
 assert.deepEqual(generationRequest({...base,aiOverrideEnabled:'on',aiReasoningEffort:''}).aiOverride,{runtime:'codex',model:'m',reasoningEffort:null});
 assert.equal(selectedAIAvailable({runtime:'codex',available:false},[{runtime:'opencode',available:true}],true,'opencode'),true);
 assert.equal(selectedAIAvailable({available:false},[],false,'opencode'),false);
 const html=aiOverrideControls({runtime:'opencode',model:'<unsafe>'},s=>String(s).replaceAll('<','&lt;'));
 assert.doesNotMatch(html,/<unsafe>/);assert.match(html,/Переопределить для этого урока/);
});

async function fixture(t,{interruptReview=false}={}){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-override-')),root=path.join(repo,'lessons'),configFile=path.join(repo,'lesson-studio','ai.config.json'),parsed=path.join(repo,'book.json');
 await fs.mkdir(root);await fs.mkdir(path.dirname(configFile));await fs.writeFile(configFile,JSON.stringify({runtime:'codex',model:'configured-model',reasoningEffort:'high',executable:'custom-codex'}));
 await fs.writeFile(parsed,JSON.stringify({source:{},metadata:{title:'Book'},topics_with_pages:[{id:'topic',page_start:1,full_text:'Проверяемый текст учебника.'}]}));
 const calls=[];let interrupted=false;const pair=x=>({ru:x,kk:x});
 const pipeline=new LessonPipeline({repo,lessonsRoot:root,configFile,runStage:async({job,key,dir})=>{
  calls.push({key,ai:structuredClone(job.aiConfig)});
  if(key==='review'&&interruptReview&&!interrupted){interrupted=true;throw Object.assign(Error('limit'),{status:503,code:'ai_limit'});}
  if(key==='author'){
   const pack=JSON.parse(await fs.readFile(path.join(dir,'01-Источник учебника.json'),'utf8'));
   const doc={schemaVersion:2,id:job.lessonId,revision:1,status:'draft',grade:5,title:pair(job.title),subject:pair('История'),summary:pair('Описание'),estimatedMinutes:5,objectives:pair(['Цель']),sources:[pack.source],assets:[],blocks:[{id:'p',type:'paragraph',origin:'adaptation',sourceRefs:['textbook'],content:pair('Проверяемый текст учебника.')}]};await fs.writeFile(path.join(dir,job.title+'.lesson.json'),JSON.stringify(doc));
  }else await fs.writeFile(path.join(dir,'04-Ревью.json'),JSON.stringify({verdict:'ready_for_preview',issues:[]}));
 }});await pipeline.initialize();pipeline.available=async()=>({available:true,version:'fixture'});pipeline.books=async()=>[{id:'book',grade:5,subjectRu:'история',subjectKk:'Тарих',parsedTextbookPath:parsed,pdfTextbookPath:null,topics:[{id:'topic-ui',sourceId:'topic',title:'Тема',pageStart:1,pageEnd:1,textAvailable:true}]}];
 t.after(async()=>{await pipeline.close();await fs.rm(repo,{recursive:true,force:true});});
 const input={bookId:'book',topicId:'topic-ui',externalSources:0,aiOverride:{runtime:'opencode',model:'provider/chosen-model#high'}};
 const settled=async()=>{for(let i=0;i<500;i++){if(!pipeline.running)return pipeline.list()[0];await new Promise(r=>setTimeout(r,5));}throw Error('timeout');};
 return {pipeline,root,configFile,calls,input,settled};
}

test('all fast stages use the order selection and leave the config file unchanged',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.configFile);await f.pipeline.start(f.input);const j=await f.settled();
 assert.equal(j.status,'completed');assert.equal(j.ai.configSource,'order');assert.equal(j.ai.model,'provider/chosen-model#high');assert.deepEqual(await fs.readFile(f.configFile),before);
 assert.deepEqual(f.calls.map(c=>c.key),['author','review']);assert.ok(f.calls.every(c=>c.ai.runtime==='opencode'&&c.ai.model===j.ai.model&&c.ai.executable!=='custom-codex'&&!c.ai.reasoningEffort));
});

test('resume preserves the order override even if the default config becomes invalid',async t=>{
 const f=await fixture(t,{interruptReview:true});const started=await f.pipeline.start(f.input);assert.equal((await f.settled()).errorCode,'ai_limit');
 await fs.writeFile(f.configFile,'INVALID');await f.pipeline.resume(started.id);assert.equal((await f.settled()).status,'completed');
 assert.ok(f.calls.every(c=>c.ai.model==='provider/chosen-model#high'));
});

test('an existing lesson is rejected without replacing its files or creating a new version',async t=>{
 const f=await fixture(t);const first=await f.pipeline.start(f.input);await f.settled();const job=f.pipeline.jobs.get(first.id),file=path.join(job.dir,job.title+'.lesson.json'),before=await fs.readFile(file),calls=f.calls.length;
 await assert.rejects(f.pipeline.start(f.input),e=>e.status===409&&e.code==='lesson_exists');
 assert.deepEqual(await fs.readFile(file),before);assert.equal(f.calls.length,calls);assert.equal(f.pipeline.jobs.size,1);
});
