import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {LessonPipeline} from '../pipeline.mjs';
import {prepareParsedSource} from '../parsed-source.mjs';
import {progressSnapshot} from '../generation-progress.mjs';
import {renderProgress} from '../public/generation-progress-ui.js';
import {hasOpenReviewIssues} from '../review.mjs';

const pair=x=>({ru:x,kk:x}),sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,{externalSources=0,rejectFirst=false,interruptReview=false,missingText=false,omitReviewHash=false,minorEdit=false}={}){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-fast-')),root=path.join(repo,'lessons'),parsed=path.join(repo,'book.json');await fs.mkdir(root);
 const doc={metadata:{title:'Учебник',grade:5},source:{},topics_with_pages:[{id:'s10',page_start:36,page_end:37,topic_title:'Колесницы',full_text:missingText?'':'Колесницы использовали для передвижения и военных действий. Почему использовали колесницы?'}],example_tasks_v2:{textbook_tasks:[{task_id:'T42',topic_ref:'s10',page:36,question_text:'Для чего использовали колесницы?'},{task_id:'other',topic_ref:'other',page:36,question_text:'Чужой вопрос'}],structural_examples_for_generation:[{topic_ref:'s10',template:'Придуманный шаблон'}]}};
 await fs.writeFile(parsed,JSON.stringify(doc));let reviews=0,preparations=0;const calls=[];
 const pipeline=new LessonPipeline({repo,lessonsRoot:root,prepareSource:async()=>{preparations++;return {pdfPath:'original.pdf',pdfSha256:'a'.repeat(64),pages:[{bookPage:36,pdfPage:36,text:doc.topics_with_pages[0].full_text||'Содержимое из подготовленного PDF',pngPath:'page.png'}]};},runStage:async({job,key,dir,prompt})=>{
  calls.push(key);assert.equal(job.aiConfig.model,'fixture-model');assert.doesNotMatch(prompt,/Прочитай и выполняй скилл/);
  const pack=JSON.parse(await fs.readFile(path.join(dir,'01-Источник учебника.json'),'utf8'));let data,file;
  if(key==='research'){data=[];file='Дополнительные источники.json';}
  if(key==='author'){file=job.title+'.lesson.json';data={schemaVersion:2,id:job.lessonId,revision:job.attempt+1,status:'draft',grade:5,subject:pair('История'),title:pair(job.title),summary:pair('Описание'),objectives:pair(['Цель']),estimatedMinutes:5,sources:[pack.source],assets:[],blocks:[{id:'q',type:'question',origin:'adaptation',sourceRefs:['textbook'],sourceTaskId:pack.textbookTasks[0]?.id??null,sourcePages:[36],answerBasis:'Колесницы использовали для передвижения',content:pair('Для чего использовали колесницы?'),answer:pair('Для передвижения и военных действий.')}]};}
  if(key==='review'){reviews++;const before=await fs.readFile(path.join(dir,job.title+'.lesson.json'));if(minorEdit){const edited=JSON.parse(before);edited.summary=pair('Уточнённое описание');await fs.writeFile(path.join(dir,job.title+'.lesson.json'),JSON.stringify(edited));}if(interruptReview&&reviews===1)throw Object.assign(Error('temporary'),{status:503,code:'ai_limit'});file='04-Ревью.json';data={lessonSha256:sha(await fs.readFile(path.join(dir,job.title+'.lesson.json'))),verdict:rejectFirst&&reviews===1?'needs_rework':'ready_for_preview',issues:rejectFirst&&reviews===1?[{severity:'major',status:'open',blockId:'q',message:'Ответ не подтверждён учебником'}]:[],questionChecks:[{blockId:'q',sourceTaskId:'T42',answerSupported:true}],factChecks:[{supported:true}]};}
  if(key==='review'&&omitReviewHash)delete data.lessonSha256;
  if(key==='review'&&minorEdit)data.lessonSha256=prompt.match(/[a-f0-9]{64}/)[0];
  await fs.writeFile(path.join(dir,file),JSON.stringify(data));
 }});
 await pipeline.initialize();pipeline.config=async()=>({runtime:'codex',model:'fixture-model',executable:'codex',configSource:'file'});pipeline.available=async()=>({available:true,version:'fixture'});pipeline.books=async()=>[{id:'book',grade:5,subjectRu:'история',subjectKk:'Тарих',parsedTextbookPath:parsed,pdfTextbookPath:missingText?'original.pdf':null,topics:[{id:'topic',sourceId:'s10',title:'Колесницы',pageStart:36,pageEnd:37,textAvailable:!missingText}]}];
 t.after(async()=>{await pipeline.close();await Promise.allSettled([...pipeline.writes.values()]);await fs.rm(repo,{recursive:true,force:true});});
 const start=()=>pipeline.start({bookId:'book',topicId:'topic',externalSources});
 const settled=async()=>{for(let i=0;i<500;i++){if(!pipeline.running)return pipeline.list()[0];await new Promise(r=>setTimeout(r,5));}throw Error('did not settle');};
 return{repo,parsed,pipeline,calls,start,settled,get preparations(){return preparations;}};
}

test('parsed JSON without PDF reaches author and reviewer in exactly two model calls',async t=>{
 const f=await fixture(t);await f.start();const j=await f.settled();assert.equal(j.status,'completed');assert.deepEqual(f.calls,['author','review']);assert.equal(f.preparations,0);assert.deepEqual(j.stagePlan.map(s=>s.key),['source','author','review']);
 const raw=f.pipeline.jobs.get(j.id),pack=JSON.parse(await fs.readFile(path.join(raw.dir,'01-Источник учебника.json'),'utf8'));
 assert.deepEqual(pack.textbookTasks.map(q=>q.id),['T42']);assert.equal(pack.source.sha256,sha(await fs.readFile(f.parsed)));assert.equal(pack.inputMode,'parsed_json');assert.ok(j.totalDurationMs>=0);
 const journal=(await fs.readFile(path.join(raw.dir,'Журнал.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);assert.ok(journal.some(e=>e.event==='source_loaded'&&e.mode==='parsed_json'));assert.ok(journal.filter(e=>e.event==='stage_completed').every(e=>e.durationMs>=0));
});

test('research is called only when an additional source is requested',async t=>{
 const f=await fixture(t,{externalSources:1});await f.start();assert.equal((await f.settled()).status,'completed');assert.deepEqual(f.calls,['research','author','review']);
});

test('typing an exact unique textbook title also selects the direct JSON path',async t=>{
 const f=await fixture(t);await f.pipeline.start({bookId:'book',topicRu:'Колесницы',externalSources:0});
 const job=await f.settled();assert.equal(job.pipelineVersion,2);assert.equal(job.status,'completed');assert.deepEqual(f.calls,['author','review']);
});

test('content rejection returns to a separate author and reviewer, never replans or reparses',async t=>{
 const f=await fixture(t,{rejectFirst:true});await f.start();assert.equal((await f.settled()).status,'completed');assert.deepEqual(f.calls,['author','review','author','review']);assert.equal(f.preparations,0);
});

test('interrupted review resumes without model author or source preparation repeated',async t=>{
 const f=await fixture(t,{interruptReview:true});await f.start();let j=await f.settled();assert.equal(j.status,'needs_attention');
 await f.pipeline.resume(j.id);j=await f.settled();assert.equal(j.status,'completed');assert.deepEqual(f.calls,['author','review','review']);assert.equal(f.preparations,0);
});

test('missing full text uses local PDF preparation without an AI parser or planner',async t=>{
 const f=await fixture(t,{missingText:true});await f.start();assert.equal((await f.settled()).status,'completed');assert.equal(f.preparations,1);assert.deepEqual(f.calls,['author','review']);
});

test('incomplete parsed sections are not silently used as complete source material',async t=>{
 const f=await fixture(t);const d=JSON.parse(await fs.readFile(f.parsed,'utf8'));d.topics_with_pages[0].full_text_status={truncated:true};await fs.writeFile(f.parsed,JSON.stringify(d));
 assert.equal(await prepareParsedSource({brief:{textbookTopic:{sourceId:'s10'},parsedTextbookPath:f.parsed},dir:f.repo}),null);
});

test('total generation time is distinct from current stage and freezes on pause',()=>{
 const now=Date.parse('2026-10-29T00:03:00Z'),job={status:'running',activeDurationMs:60000,runStartedAt:'2026-10-29T00:01:00Z',stageStartedAt:'2026-10-29T00:02:00Z'};
 const p=progressSnapshot(job,null,now);assert.equal(p.totalDurationMs,180000);assert.equal(p.stageDurationMs,60000);
 const html=renderProgress({...job,...p},String);assert.match(html,/Генерация всего/);assert.match(html,/3 мин 0 с/);assert.match(html,/Текущий этап/);
 job.status='interrupted';assert.equal(progressSnapshot(job,null,now+60000).totalDurationMs,60000);
});

test('a ready label cannot override the editor explicitly finding unsupported facts or answers',()=>{
 assert.equal(hasOpenReviewIssues({verdict:'ready_for_preview',issues:[],factChecks:[{supported:false}]}),true);
 assert.equal(hasOpenReviewIssues({verdict:'ready_for_preview',issues:[],questionChecks:[{blockId:'q',answerSupported:false}]}),true);
 assert.equal(hasOpenReviewIssues({verdict:'ready_for_preview',issues:[],questionChecks:[{answerSupported:true}]}),false);
});


test('server binds a review to actual bytes without asking the model to compute a hash',async t=>{
 const f=await fixture(t,{omitReviewHash:true}),execute=f.pipeline.execute;f.pipeline.execute=async args=>{await execute(args);if(args.key==='review'){const file=path.join(args.dir,'04-Ревью.json'),data=JSON.parse(await fs.readFile(file,'utf8'));data.lessonSha256='stale-model-value';await fs.writeFile(file,JSON.stringify(data));}};await f.start();const j=await f.settled();assert.equal(j.status,'completed');
 const state=f.pipeline.jobs.get(j.id),report=JSON.parse(await fs.readFile(path.join(state.dir,'04-Ревью.json'),'utf8'));
 assert.equal(report.hashBoundBy,'lesson-studio');assert.equal(report.lessonSha256,sha(await fs.readFile(path.join(state.dir,state.title+'.lesson.json'))));
 assert.match(await fs.readFile(path.join(state.dir,'Журнал.jsonl'),'utf8'),/review_bound/);
});

test('minor reviewer edits are bound to the final file while keeping the reviewed input hash',async t=>{
 const f=await fixture(t,{minorEdit:true});await f.start();const j=await f.settled();assert.equal(j.status,'completed');
 const state=f.pipeline.jobs.get(j.id),report=JSON.parse(await fs.readFile(path.join(state.dir,'04-Ревью.json'),'utf8'));
 assert.notEqual(report.reviewInputSha256,report.lessonSha256);assert.equal(report.lessonSha256,sha(await fs.readFile(path.join(state.dir,state.title+'.lesson.json'))));assert.deepEqual(f.calls,['author','review']);
});
