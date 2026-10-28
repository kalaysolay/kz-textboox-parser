import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {LessonPipeline} from '../pipeline.mjs';
const pair=s=>({ru:s,kk:s});
const digest=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,{failResearch=false,rejectFirst=false,nestedMajor=false,oversized=false,excessSources=false,invalidSourceOnce=false,invalidSourceAlways=false,evidenceMismatchOnce=false,reviewerCorrupts=false}={}){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-pipeline-')),root=path.join(repo,'lessons');await fs.mkdir(root);
 let failed=false,reviews=0;const calls=[];
 const sourceInput={pdfSha256:'a'.repeat(64),topic:{sourceId:'s1'},pages:[{bookPage:1,text:'Пример подтверждённого текста учебника.'}]};
 const runStage=async({job,key,dir,prompt})=>{
  calls.push(key);assert.match(prompt,/отдельная роль/);assert.match(prompt,/максимум 650 слов/);assert.doesNotMatch(prompt,/2–4/);let name,data;
  if(key==='source'){name='01-Источник учебника.json';data={sourceStatus:'ready'};if(invalidSourceAlways||(invalidSourceOnce&&calls.filter(c=>c==='source').length===1)){await fs.writeFile(path.join(dir,name),'{invalid json');return;}}
  if(key==='source'&&evidenceMismatchOnce)data={schemaVersion:2,lessonId:job.lessonId,sourceStatus:'ready',source:{pdfSha256:calls.filter(c=>c==='source').length===1?'invented':sourceInput.pdfSha256,sourceTopicId:'s1',pages:[1]},verification:{method:'pdf_text_layer'},keyIdeas:[{id:'idea1',statement:sourceInput.pages[0].text,sourcePages:[1]}]};
  if(key==='research'){if(failResearch&&!failed){failed=true;throw Error('interrupted');}name='Дополнительные источники.json';data=[];}
  if(key==='plan'){name='02-План.json';data={schemaVersion:2};}
  if(key==='author'){name=`${job.title}.lesson.json`;data={schemaVersion:2,id:job.lessonId,revision:1,status:'draft',grade:5,title:pair(job.title),subject:pair('Математика'),summary:pair('Описание'),estimatedMinutes:5,objectives:pair(['Цель']),sources:[{id:'author',type:'authored',title:'Автор',usage:pair('Пример')}],assets:[],blocks:[{id:'intro',type:'paragraph',origin:'authored',sourceRefs:['author'],content:pair('Пример $1+1=2$')}]};}
  if(key==='review'){name='04-Ревью.json';reviews++;if(reviewerCorrupts){const main=path.join(dir,`${job.title}.lesson.json`),doc=JSON.parse(await fs.readFile(main,'utf8'));delete doc.assets;await fs.writeFile(main,JSON.stringify(doc));}data={lessonSha256:digest(await fs.readFile(path.join(dir,`${job.title}.lesson.json`))),verdict:rejectFirst&&reviews===1?'needs_rework':'ready_for_preview',issues:[],items:nestedMajor?[{blockId:'intro',issues:[{severity:'major',status:'open'}]}]:[]};}
  if(key==='research'&&excessSources)data=[{url:'https://a.example'},{url:'https://b.example'}];
  if(key==='author'&&oversized)data.blocks[0].content=pair('слово '.repeat(651));
  await fs.writeFile(path.join(dir,name),JSON.stringify(data,null,2));
 };
 const pipeline=new LessonPipeline({repo,lessonsRoot:root,runStage,...(evidenceMismatchOnce?{prepareSource:async()=>sourceInput}:{})});await pipeline.initialize();pipeline.available=async()=>({available:true,version:'test-runtime'});pipeline.books=async()=>[{id:'book',grade:5,subjectRu:'математика',parsedTextbookPath:'parsed.json',pdfTextbookPath:'textbook.pdf'}];
 t.after(async()=>{await pipeline.close();await fs.rm(repo,{recursive:true,force:true});});
 const start=()=>pipeline.start({bookId:'book',topicRu:'Тестовый урок',subjectKk:'Математика'});
 async function settled(){for(let i=0;i<400;i++){if(!pipeline.running)return pipeline.list()[0];await new Promise(r=>setTimeout(r,5));}throw Error('pipeline did not settle');}
 return{pipeline,start,settled,calls};
}
test('five roles produce a validated lesson and a hash-bound independent review',async t=>{
 const f=await fixture(t);await f.start();const done=await f.settled();assert.equal(done.status,'completed');assert.deepEqual(f.calls,['source','research','plan','author','review']);assert.equal(done.completed.length,5);
});

test('malformed JSON gets one bounded technical correction before the next role runs',async t=>{
 const f=await fixture(t,{invalidSourceOnce:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'completed');assert.equal(done.technicalRepairs.source,1);assert.deepEqual(f.calls.slice(0,3),['source','source','research']);
 const job=f.pipeline.jobs.get(done.id);assert.match(await fs.readFile(path.join(job.dir,'Техническая проверка.json'),'utf8'),/artifact_json/);
});

test('repeated malformed JSON stops instead of retrying indefinitely or advancing',async t=>{
 const f=await fixture(t,{invalidSourceAlways:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'needs_attention');assert.equal(done.errorCode,'artifact_json');assert.deepEqual(f.calls,['source','source']);
});

test('a ready source with invented PDF evidence cannot advance before correction',async t=>{
 const f=await fixture(t,{evidenceMismatchOnce:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'completed');assert.equal(done.technicalRepairs.source,1);assert.deepEqual(f.calls.slice(0,3),['source','source','research']);
});

test('reviewer edits cannot invalidate the document while keeping a ready verdict',async t=>{
 const f=await fixture(t,{reviewerCorrupts:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'needs_attention');assert.equal(done.attempt,1);assert.equal(f.calls.filter(c=>c==='author').length,2);
 const job=f.pipeline.jobs.get(done.id),checked=JSON.parse(await fs.readFile(path.join(job.dir,'Проверка.json'),'utf8'));assert.equal(checked.ok,false);assert.ok(checked.errors.some(e=>e.code==='assets'));
});
test('a failed stage resumes without repeating verified source extraction',async t=>{
 const f=await fixture(t,{failResearch:true});const job=await f.start();assert.equal((await f.settled()).status,'needs_attention');await f.pipeline.resume(job.id);assert.equal((await f.settled()).status,'completed');assert.equal(f.calls.filter(k=>k==='source').length,1);assert.equal(f.calls.filter(k=>k==='research').length,2);
});
test('review rejection returns once to a separate author and reviewer',async t=>{
 const f=await fixture(t,{rejectFirst:true});await f.start();assert.equal((await f.settled()).status,'completed');assert.deepEqual(f.calls,['source','research','plan','author','review','author','review']);
});
test('modified completed artifacts cannot be silently reused after interruption',async t=>{
 const f=await fixture(t,{failResearch:true});const started=await f.start();await f.settled();const job=f.pipeline.jobs.get(started.id);await fs.writeFile(path.join(job.dir,'01-Источник учебника.json'),'{}');await assert.rejects(f.pipeline.resume(started.id),e=>e.code==='stage_changed');
});

test('a ready verdict cannot bypass unresolved major issues inside a block',async t=>{
 const f=await fixture(t,{nestedMajor:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'needs_attention');assert.equal(done.attempt,1);assert.equal(f.calls.filter(k=>k==='review').length,2);
});

test('oversized lessons cannot pass a ready review and return for one revision',async t=>{
 const f=await fixture(t,{oversized:true});await f.start();const done=await f.settled();
 assert.equal(done.status,'needs_attention');assert.equal(done.attempt,1);assert.equal(f.calls.filter(k=>k==='author').length,2);
});

test('research cannot introduce more sources than the order allows',async t=>{
 const f=await fixture(t,{excessSources:true});await f.start();assert.equal((await f.settled()).status,'needs_attention');assert.deepEqual(f.calls,['source','research']);
});

test('stage timing and real activity survive persistence without poll-generated heartbeats',async t=>{
 const f=await fixture(t,{failResearch:true});await f.start();const stopped=await f.settled();
 assert.equal(stopped.currentStage,'research');assert.ok(stopped.stageStartedAt);assert.ok(stopped.stageFinishedAt);assert.ok(stopped.lastActivityAt);
 assert.equal(stopped.processAlive,false);
 const last=stopped.lastActivityAt;assert.equal(f.pipeline.list()[0].lastActivityAt,last);
 const job=f.pipeline.jobs.get(stopped.id);const persisted=JSON.parse(await fs.readFile(path.join(f.pipeline.jobsDir,job.id+'.json'),'utf8'));
 assert.equal(persisted.lastActivityAt,last);assert.equal(persisted.stageFinishedAt,stopped.stageFinishedAt);
});
