import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DamulabClient} from '../damulab-client.mjs';
import {compareHtml} from '../html-fidelity.mjs';
const pair=s=>({ru:s,kk:s});
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function fixture(t,{dropFormula=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-upload-'));
 const doc={schemaVersion:2,id:'test-upload',revision:1,status:'draft',grade:5,subject:pair('Математика'),title:pair('Урок'),summary:pair('Описание'),objectives:pair(['Сравнить']),estimatedMinutes:5,sources:[{id:'author',type:'authored',title:'Автор',usage:pair('Пример')}],assets:[],blocks:[{id:'p1',type:'paragraph',origin:'authored',sourceRefs:['author'],content:pair('Пример $1+1=2$')} ]};
 let current={id:doc.id,doc,hash:digest(doc),file:path.join(dir,'Урок.lesson.json')},stored=null,writes=0,ready=true;
 const revision=()=>digest(stored),journal=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
  const send=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(data));};
  if(req.url==='/api/auth/login')return send(200,{ok:true},{'set-cookie':'SESSION=private-cookie; HttpOnly'});
  if(req.headers.cookie!=='SESSION=private-cookie')return send(401,{error:'auth'});
  if(req.url==='/admin/lectures/new'){res.writeHead(200,{'content-type':'text/html'});return res.end('<input name="_csrf" value="csrf-token">');}
  if(req.method==='POST'&&req.headers['x-csrf-token']!=='csrf-token')return send(403,{error:'csrf'});
  if(req.url.endsWith('/capabilities'))return send(200,{kind:'damulab.lesson-studio',syncVersion:'1.0',lessonSchemaVersion:2,rendererVersion:'2.0.1',conditionalWrites:true});
  if(req.url==='/api/admin/subjects')return send(200,[{id:1,titleRu:'Математика'}]);
  if(req.url==='/api/admin/grades')return send(200,[{id:5,gradeNo:5}]);
  if(req.url==='/api/admin/topics?subjectId=1&gradeId=5')return send(200,[{id:9,subjectId:1,gradeId:5,titleRu:'Тема'}]);
  if(req.url.startsWith('/api/admin/lectures/studio/lookup'))return stored?send(200,{lecture:stored,revision:revision(),assetUrls:{}}):send(404,{error:'lecture_not_found'});
  if(req.url.endsWith('/sync')){
   if((stored?revision():null)!==(body.expectedRevision??null))return send(409,{error:'lecture_sync_conflict'});
   const l=body.lesson;stored={id:42,status:stored?.status??'draft',publishedAt:null,topicId:l.metadata.topicId,titleRu:l.metadata.title.ru,titleKk:l.metadata.title.kk,contentRu:l.content.ruHtml,contentKk:l.content.kkHtml,source:l.metadata.source,controlMode:l.completionControl.mode.toLowerCase(),autoCheckpointCount:0,attachments:[]};
   if(dropFormula)stored.contentRu=stored.contentRu.replace(/<span class="ql-formula"[^>]*><\/span>/g,'');
   writes++;return send(200,{lecture:stored,revision:revision(),assetUrls:{}});
  }
  if(req.url.endsWith('/publish')){if(revision()!==body.expectedRevision)return send(409,{error:'lecture_sync_conflict'});stored.status='published';stored.publishedAt=new Date().toISOString();return send(200,{lecture:stored,revision:revision(),assetUrls:{}});}
  send(404,{});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=new DamulabClient({find:async()=>current,validate:()=>({ok:true}),readAsset:async()=>{throw Error('unexpected');},appendJournal:async(item,e)=>journal.push(e),reviewReady:async()=>ready,rendererVersion:'2.0.1'});
 await client.connect({baseUrl:`http://127.0.0.1:${server.address().port}`,email:'admin@example.org',password:'private-password'});
 t.after(async()=>{client.disconnect();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return{client,dir,journal,selection:{subjectId:1,gradeId:5,topicId:9,controlMode:'NONE'},writes:()=>writes,edit:()=>stored.contentRu+='<p>Правка в админке</p>',changeLocal:()=>current={...current,hash:'changed'},reviseLocal:()=>{doc.blocks[0].content=pair('Уточнение $1+1=2$');current={...current,hash:digest(doc)};},setReady:v=>ready=v};
}

test('draft upload is read back, retry is idempotent and publication is a separate reviewed action',async t=>{
 const f=await fixture(t);const plan=await f.client.prepare('test-upload',f.selection);assert.equal(f.writes(),0);
 const first=await f.client.upload('test-upload',plan.planId);assert.equal(first.status,'draft');assert.equal(first.verified,true);assert.equal(f.writes(),1);
 const retry=await f.client.prepare('test-upload',f.selection);assert.equal((await f.client.upload('test-upload',retry.planId)).unchanged,true);assert.equal(f.writes(),1);
 f.setReady(false);await assert.rejects(f.client.publish('test-upload',first.lessonSha256),e=>e.code==='publication_not_ready');
 f.setReady(true);assert.equal((await f.client.publish('test-upload',first.lessonSha256)).status,'published');
 assert.deepEqual(f.journal.map(e=>e.event),['damulab_draft_uploaded','damulab_published']);
 const mapping=await fs.readFile(path.join(f.dir,'.local/damulab',(await fs.readdir(path.join(f.dir,'.local/damulab')))[0]),'utf8');assert.doesNotMatch(mapping,/private-password|private-cookie|csrf-token/);
});
test('local and remote edits invalidate prepared upload before any overwrite',async t=>{
 const f=await fixture(t);let plan=await f.client.prepare('test-upload',f.selection);await f.client.upload('test-upload',plan.planId);
 plan=await f.client.prepare('test-upload',f.selection);f.edit();await assert.rejects(f.client.upload('test-upload',plan.planId),e=>e.code==='remote_changed');assert.equal(f.writes(),1);
 await assert.rejects(f.client.prepare('test-upload',f.selection),e=>e.code==='remote_changed');
 const g=await fixture(t);plan=await g.client.prepare('test-upload',g.selection);g.changeLocal();await assert.rejects(g.client.upload('test-upload',plan.planId),e=>e.code==='stale_revision');assert.equal(g.writes(),0);
});

test('connection cannot switch destinations or disconnect during a write',async t=>{
 const f=await fixture(t);const origin=f.client.status().origin;
 let release;const gate=new Promise(resolve=>release=resolve);
 const writing=f.client.exclusive(()=>gate);
 assert.throws(()=>f.client.disconnect(),e=>e.code==='upload_busy');
 await assert.rejects(f.client.connect({baseUrl:'http://127.0.0.1:1',email:'admin@example.org',password:'other'}),e=>e.code==='upload_busy');
 assert.equal(f.client.status().origin,origin);
 release();await writing;
 assert.equal(f.client.disconnect().connected,false);
});

test('a new draft of a published lesson still requires separate publication',async t=>{
 const f=await fixture(t);let plan=await f.client.prepare('test-upload',f.selection);
 await f.client.upload('test-upload',plan.planId);await f.client.publish('test-upload',plan.lessonSha256);
 f.reviseLocal();plan=await f.client.prepare('test-upload',f.selection);
 const updated=await f.client.upload('test-upload',plan.planId);
 assert.equal(updated.status,'draft');assert.equal(updated.verified,true);assert.equal(updated.lectureId,42);
 assert.equal((await f.client.publish('test-upload',plan.lessonSha256)).status,'published');
});
test('readback formula loss blocks publication and is recorded instead of reported as success',async t=>{
 const f=await fixture(t,{dropFormula:true});const plan=await f.client.prepare('test-upload',f.selection);
 await assert.rejects(f.client.upload('test-upload',plan.planId),e=>e.code==='readback_mismatch');assert.equal(f.journal[0].verified,false);assert.ok(f.journal[0].comparisons.ru.differences.includes('formulas'));
 await assert.rejects(f.client.publish('test-upload',plan.lessonSha256),e=>e.code==='publication_not_ready');
});
test('HTML comparison catches geometry, list type, modes and alt while tolerating Quill wrappers',()=>{
 const html='<table><tr><th colspan="2">A</th></tr></table><ul><li>Пункт</li></ul><p><span class="ql-formula" data-value="x" data-display="block"></span></p><img src="/a.png" alt="A">';
 assert.equal(compareHtml(html,'<div>'+html+'</div>').ok,true);
 for(const modified of [html.replace('colspan="2"','colspan="1"'),html.replace(/ul/g,'ol'),html.replace('data-display="block"','data-display="inline"'),html.replace('alt="A"','alt="B"')])assert.equal(compareHtml(html,modified).ok,false);
});

test('HTML comparison preserves word boundaries and tolerates repeated whitespace',()=>{
 assert.equal(compareHtml('<p>Кимакский каганат</p>','<p>Кимакский   каганат</p>').ok,true);
 assert.equal(compareHtml('<p>Кимакский каганат</p>','<p>Кимакскийкаганат</p>').ok,false);
 assert.equal(compareHtml('<p>25 учеников</p>','<p>25учеников</p>').ok,false);
});
