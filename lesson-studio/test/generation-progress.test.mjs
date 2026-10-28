import test from 'node:test';
import assert from 'node:assert/strict';
import {activityFromEvent,eventReader,progressSnapshot} from '../generation-progress.mjs';
import {renderProgress,duration} from '../public/generation-progress-ui.js';
import {LessonPipeline} from '../pipeline.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('stream reader handles split UTF-8, partial lines, malformed and oversized events',()=>{
 const events=[],reader=eventReader(event=>events.push(event),240);
 const bytes=Buffer.from(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'node read-textbook-pages.js учебник'}})+'\n');
 for(const byte of bytes)reader.write(Buffer.from([byte]));
 reader.write(Buffer.from('not-json\n'+JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'private'.repeat(100)}})+'\n'));
 reader.write(Buffer.from(JSON.stringify({type:'turn.completed'})));reader.end();
 assert.deepEqual(events,[{action:'Извлекает и проверяет страницы учебника'},{action:'Агент закончил работу; ожидается завершение процесса'}]);
});

test('only fixed action labels leave the CLI parser, never arguments, output or reasoning',()=>{
 const events=[{type:'item.completed',item:{type:'reasoning',text:'SECRET'}},{type:'item.started',item:{type:'mcp_tool_call',tool:'exec',arguments:{password:'SECRET'}}},{type:'item.completed',item:{type:'command_execution',command:'echo SECRET',aggregated_output:'SECRET',exit_code:1}},{type:'error',message:'SECRET'}];
 const result=JSON.stringify(events.map(activityFromEvent));assert.doesNotMatch(result,/SECRET|password|aggregated_output/);
 assert.deepEqual(activityFromEvent(events[0]),{action:null});assert.equal(activityFromEvent({type:'unrecognized'}),null);
});

test('polling derives elapsed and idle time without faking activity; stopped timers freeze',()=>{
 const job={status:'running',stageStartedAt:'2026-10-23T06:00:00Z',lastActivityAt:'2026-10-23T06:00:10Z'};
 const child={exitCode:null,killed:false};
 const before=JSON.stringify(job),first=progressSnapshot(job,child,Date.parse('2026-10-23T06:01:00Z')),quiet=progressSnapshot(job,child,Date.parse('2026-10-23T06:03:00Z'));
 assert.equal(first.stageDurationMs,60000);assert.equal(first.idleMs,50000);assert.equal(first.quiet,false);
 assert.equal(quiet.quiet,true);assert.equal(quiet.processAlive,true);assert.equal(JSON.stringify(job),before);
 job.status='interrupted';job.stageFinishedAt='2026-10-23T06:03:00Z';
 assert.equal(progressSnapshot(job,child,Date.parse('2026-10-23T08:00:00Z')).stageDurationMs,180000);
 assert.equal(progressSnapshot(job,child).processAlive,false);
 assert.equal(progressSnapshot({status:'completed',completed:[]},null).stageDurationMs,null);
});

test('card labels quiet periods and escapes actions; client clock ticks between polls',()=>{
 const escape=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=renderProgress({status:'running',currentAction:'<script>',stageDurationMs:60000,idleMs:119000,lastActivityAt:'2026-10-23T06:00:00Z',processAlive:true},escape,2000);
 assert.match(html,/Давно нет событий/);assert.match(html,/1 мин 2 с/);assert.match(html,/зависание не подтверждено/);assert.doesNotMatch(html,/<script>/);
 assert.equal(duration(59999),'59 с');assert.equal(duration(60000),'1 мин 0 с');
});

test('live CLI events update the public job and persist only safe progress',async t=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-progress-'));
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false});
 const pipeline=new LessonPipeline({repo,lessonsRoot:repo,spawnRuntime:()=>child});await pipeline.initialize();
 t.after(async()=>{clearTimeout(pipeline.progressTimer);pipeline.running=null;await Promise.allSettled([...pipeline.writes.values()]);await fs.rm(repo,{recursive:true,force:true});});
 const job={id:'test',dir:repo,status:'running',stage:0,stageStartedAt:new Date().toISOString(),completed:[]};pipeline.jobs.set(job.id,job);pipeline.running={job,child:null};
 const completed=pipeline.runStage({job,key:'source',prompt:'test',dir:repo});
 child.stdout.write(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'node read-textbook-pages.js SECRET'}})+'\n');
 assert.equal(pipeline.publicJob(job).processAlive,true);assert.equal(job.currentAction,'Извлекает и проверяет страницы учебника');assert.ok(job.lastActivityAt);
 const activity=job.lastActivityAt;pipeline.list();assert.equal(job.lastActivityAt,activity);
 child.stderr.write('SECRET');child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'SECRET'}})+'\n');
 await pipeline.persist(job);const persisted=await fs.readFile(path.join(pipeline.jobsDir,'test.json'),'utf8');assert.doesNotMatch(persisted,/SECRET|reasoning/);
 job.cancelled=true;const last=job.lastActivityAt;pipeline.activity(job,'ignored');assert.equal(job.lastActivityAt,last);
 child.exitCode=0;child.stdout.end(JSON.stringify({type:'turn.completed'})+'\n');child.emit('close',0);await completed;assert.equal(pipeline.publicJob(job).processAlive,false);
});
