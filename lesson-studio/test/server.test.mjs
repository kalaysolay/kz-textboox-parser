import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createLessonServer } from '../server.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
function lesson(){return {schemaVersion:2,id:'test-decimals',revision:1,status:'reviewed',grade:5,subject:{ru:'математика',kk:'математика'},title:{ru:'Десятичные дроби',kk:'Ондық бөлшектер'},summary:{ru:'Дроби и вычисления',kk:'Бөлшектер мен есептеулер'},estimatedMinutes:35,objectives:{ru:['Сложить дроби'],kk:['Бөлшектерді қосу']},blocks:[{id:'intro',type:'heading',level:2,origin:'authored',sourceRefs:['author'],content:{ru:'Разберём пример',kk:'Мысалды талдайық'}},{id:'example',type:'paragraph',origin:'authored',sourceRefs:['author'],content:{ru:'$0{,}1+0{,}2=0{,}3$ — точное равенство.',kk:'$0{,}1+0{,}2=0{,}3$ — дәл теңдік.'},machineChecks:[{expression:'0.1+0.2',expected:'0.3'}]}],sources:[{id:'author',type:'authored',title:'Авторский пример',usage:{ru:'Пример сложения',kk:'Қосу мысалы'}}],assets:[]};}
async function fixture(t,pipeline){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'lesson-studio-test-')),root=path.join(temp,'lessons'),dir=path.join(root,'5 класс','математика','Десятичные дроби');
  await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,'Десятичные дроби.lesson.json'),raw=JSON.stringify(lesson(),null,2)+'\n';
  await fs.writeFile(file,raw);await fs.writeFile(path.join(dir,'04-Ревью.json'),JSON.stringify({verdict:'ready_for_preview',lessonSha256:sha(raw)}));
  await fs.writeFile(path.join(dir,'Журнал.jsonl'),JSON.stringify({timestamp:'2026-10-22T08:00:00Z',event:'author_complete',actor:'author'})+'\n');
  const server=await createLessonServer({lessonsRoot:root,pipeline});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});});
  async function get(p){const res=await fetch(base+p);return {status:res.status,headers:res.headers,body:await res.json()};}
  async function put(doc,hash=sha(raw)){const res=await fetch(base+'/api/lessons/test-decimals',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${hash}"`},body:JSON.stringify({doc})});return {status:res.status,body:await res.json()};}
  return {temp,root,dir,file,raw,base,get,put,server};
}

test('bibliographic inventory, Unicode filenames and exact review hash are read from disk',async t=>{
  const f=await fixture(t),list=await f.get('/api/lessons');
  assert.equal(list.status,200);assert.equal(list.body.lessons.length,1);assert.equal(list.body.lessons[0].title.ru,'Десятичные дроби');assert.equal(list.body.lessons[0].review.ready,true);
  const detail=await f.get('/api/lessons/test-decimals');assert.equal(detail.body.hash,sha(f.raw));assert.equal(detail.body.validation.ok,true);assert.equal(detail.body.journal[0].event,'author_complete');assert.match(detail.body.path,/5 класс\/математика/);assert.ok(detail.body.artifacts.find(a=>a.name==='04-Ревью.json'&&a.sha256.length===64));
  await fs.writeFile(path.join(f.dir,'04-Ревью.json'),JSON.stringify({verdict:'ready_for_preview',lessonSha256:'0'.repeat(64)}));assert.equal((await f.get('/api/lessons/test-decimals')).body.review.ready,false);
});

test('generation polling never reads books or probes the CLI; catalog is separate',async t=>{
 let bookReads=0,runtimeReads=0;
 const f=await fixture(t,{initialize:async()=>{},close:async()=>{},list:()=>[{id:'job',status:'running',currentAction:'Читает страницы'}],books:async()=>{bookReads++;return [{id:'book',topics:[{id:'topic'}]}];},available:async()=>{runtimeReads++;return {available:true,version:'test'};}});
 for(let i=0;i<3;i++) {
  const response=await f.get('/api/generation');assert.equal(response.status,200);
  assert.deepEqual(Object.keys(response.body).sort(),['jobs','serverTime']);assert.equal(response.body.jobs[0].currentAction,'Читает страницы');
 }
 assert.equal(bookReads,0);assert.equal(runtimeReads,0);
 const catalog=await f.get('/api/generation/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.books[0].topics[0].id,'topic');assert.equal(catalog.body.runtime.available,true);
 assert.equal(bookReads,1);assert.equal(runtimeReads,1);
});

test('invalid AI config remains visible in the generation catalog with lessons available',async t=>{
 const pipeline={initialize:async()=>{},close:async()=>{},list:()=>[],books:async()=>[{id:'book'}],available:async()=>{throw Object.assign(Error('ai.config.json: runtime должен быть codex или opencode.'),{code:'ai_config_invalid',status:422});}};
 const f=await fixture(t,pipeline),response=await f.get('/api/generation/catalog');
 assert.equal(response.status,200);assert.equal(response.body.runtime.available,false);assert.equal(response.body.runtime.error.code,'ai_config_invalid');assert.equal(response.body.books.length,1);
});

test('save increments revision, invalidates review, preserves refs and writes exact previous revision',async t=>{
  const f=await fixture(t),doc=lesson();doc.title.ru='Десятичные дроби: урок';
  const saved=await f.put(doc);assert.equal(saved.status,200);assert.equal(saved.body.doc.revision,2);assert.equal(saved.body.doc.status,'draft');assert.deepEqual(saved.body.doc.blocks[1].sourceRefs,['author']);assert.equal(saved.body.review.ready,false);assert.notEqual(saved.body.hash,sha(f.raw));
  const revisions=await fs.readdir(path.join(f.dir,'.local/revisions'));assert.equal(revisions.length,1);assert.equal(await fs.readFile(path.join(f.dir,'.local/revisions',revisions[0]),'utf8'),f.raw);
  const lines=(await fs.readFile(path.join(f.dir,'Журнал.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);assert.equal(lines[1].event,'local_edit');assert.equal(lines[1].previousSha256,sha(f.raw));assert.equal(lines[1].lessonSha256,saved.body.hash);
  const stale=await f.put(doc);assert.equal(stale.status,409);assert.equal(stale.body.error.code,'stale_revision');assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).revision,2);
});

test('hash-bound ready review with an open nested blocker does not authorize publication',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.dir,'04-Ревью.json'),JSON.stringify({verdict:'ready_for_preview',lessonSha256:sha(f.raw),items:[{blockId:'example',issues:[{severity:'blocker',status:'open'}]}]}));
 const detail=await f.get('/api/lessons/test-decimals');
 assert.equal(detail.body.review.hashMatches,true);assert.equal(detail.body.review.ready,false);
});

test('simultaneous saves cannot silently overwrite one another',async t=>{
  const f=await fixture(t),a=lesson(),b=lesson();a.title.ru='Редакция А';b.title.ru='Редакция Б';
  const results=await Promise.all([f.put(a),f.put(b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).revision,2);
});

test('invalid docs and missing concurrency tokens never mutate lesson files',async t=>{
  const f=await fixture(t),doc=lesson();doc.blocks[1].machineChecks[0].expected='0.4';
  const invalid=await f.put(doc);assert.equal(invalid.status,422);assert.equal(invalid.body.error.validation.ok,false);assert.equal(await fs.readFile(f.file,'utf8'),f.raw);
  const noHash=await fetch(f.base+'/api/lessons/test-decimals',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc:lesson()})});assert.equal(noHash.status,428);
  const changed=lesson();changed.id='other-id';assert.equal((await f.put(changed)).status,400);assert.equal(await fs.readFile(f.file,'utf8'),f.raw);
});

test('preview uses safe KaTeX while HTML export keeps editable formula source',async t=>{
  const f=await fixture(t),doc=lesson();doc.blocks[1].content={ru:'<script>alert(1)</script> $0{,}3$',kk:'<script>alert(1)</script> $0{,}3$'};
  const preview=await fetch(f.base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc,lang:'ru'})});const body=await preview.json();assert.equal(preview.status,200);assert.match(body.html,/&lt;script&gt;/);assert.doesNotMatch(body.html,/<script>/);assert.match(body.html,/class="katex"/);
  const exported=await fetch(f.base+'/api/lessons/test-decimals/export?lang=kk&format=html');const html=await exported.text();assert.match(html,/Ондық бөлшектер/);assert.match(html,/ql-formula/);assert.match(html,/data-value=/);assert.doesNotMatch(html,/class="katex"/);assert.match(exported.headers.get('content-disposition'),/filename\*=UTF-8/);
  assert.equal(await (await fetch(f.base+'/api/lessons/test-decimals/export?format=json')).text(),f.raw);
  doc.blocks[1].content.ru='$broken';const bad=await fetch(f.base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc})});assert.equal(bad.status,422);
});

test('artifact paths and manifest assets cannot escape their lesson directory',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.temp,'secret.json'),'SECRET');
  assert.equal((await f.get('/api/lessons/test-decimals/artifact?name=../../../../secret.json')).status,404);
  const artifact=await fetch(f.base+'/api/lessons/test-decimals/artifact?name='+encodeURIComponent('04-Ревью.json'));assert.equal(artifact.status,200);assert.match(await artifact.text(),/ready_for_preview/);
  const doc=lesson();doc.assets=[{id:'bad',path:'../../../../secret.json'}];await fs.writeFile(f.file,JSON.stringify(doc));assert.equal((await f.get('/api/lessons/test-decimals/assets/bad')).status,404);
  await fs.mkdir(path.join(f.dir,'assets'));await fs.writeFile(path.join(f.dir,'assets/image.png'),Buffer.from([137,80,78,71]));doc.assets=[{id:'good',path:'assets/image.png'}];await fs.writeFile(f.file,JSON.stringify(doc));const image=await fetch(f.base+'/api/lessons/test-decimals/assets/good');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
});

test('symlinked packages and review files outside lessons are not read',async t=>{
  const f=await fixture(t),outside=path.join(f.temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.lesson.json'),JSON.stringify({...lesson(),id:'secret-lesson'}));
  try {await fs.symlink(outside,path.join(f.root,'linked'),process.platform==='win32'?'junction':'dir');}catch(error){t.skip('Symlinks unavailable: '+error.code);return;}
  assert.equal((await f.get('/api/lessons')).body.lessons.length,1);
  await fs.rm(path.join(f.dir,'04-Ревью.json'));try{await fs.symlink(path.join(outside,'secret.lesson.json'),path.join(f.dir,'04-Ревью.json'),'file');}catch(error){t.diagnostic('File symlinks unavailable: '+error.code);return;}
  const detail=await f.get('/api/lessons/test-decimals');assert.equal(detail.body.review.review,null);assert.equal(detail.body.artifacts.some(a=>a.name==='04-Ревью.json'),false);
});

test('reject foreign origins and rebinding hostnames; serve local UI and bundled KaTeX',async t=>{
  const f=await fixture(t);assert.equal((await fetch(f.base+'/api/lessons',{headers:{Origin:'https://foreign.example'}})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const req=http.request(f.base+'/api/lessons',{headers:{Host:'foreign.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostStatus,403);
  const page=await fetch(f.base);assert.equal(page.status,200);assert.match(await page.text(),/Мастерская уроков/);assert.equal((await fetch(f.base+'/vendor/katex/katex.min.css')).status,200);assert.equal((await fetch(f.base+'/vendor/katex/fonts/KaTeX_Main-Regular.woff2')).status,200);
  assert.equal((await fetch(f.base+'/api/lessons/'+encodeURIComponent('../../secret'))).status,404);
});

test('oversized JSON is rejected before rendering',async t=>{
  const f=await fixture(t),res=await fetch(f.base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc:'x'.repeat(3*1024*1024)})});assert.equal(res.status,413);
});
test('Damulab preview renders current draft in an isolated document without saving and serves identical bundled assets',async t=>{
 const f=await fixture(t),doc=lesson();doc.blocks[0].content.ru='Несохранённое объяснение <script>bad()</script>';
 const r=await fetch(f.base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc,lang:'ru',mode:'damulab',token:42})});
 const result=await r.json();assert.equal(r.status,200);assert.equal(result.mode,'damulab');
 assert.match(result.document,/Несохранённое объяснение &lt;script&gt;/);
 assert.doesNotMatch(result.document,/<script>bad/);
 assert.match(result.document,/Content-Security-Policy/);assert.match(result.document,/damulab\/lecture-content.js/);
 assert.match(result.document,/token:42/);assert.equal(await fs.readFile(f.file,'utf8'),f.raw);
 // Отдельный origin оставляет origin YouTube рабочим, но не открывает файловый
 // API родительского приложения. URL выдаёт только этот документ и живёт в памяти.
 const previewOrigin=new URL(result.previewUrl).origin;assert.notEqual(previewOrigin,f.base);
 const isolated=await fetch(result.previewUrl);assert.equal(isolated.status,200);assert.equal(await isolated.text(),result.document);
 for(const feature of ['camera','microphone','display-capture'])assert.ok(isolated.headers.get('permissions-policy').includes(`${feature}=()`));
 assert.equal((await fetch(previewOrigin+'/api/lessons')).status,404);
 assert.equal((await fetch(result.previewUrl,{method:'POST'})).status,405);
 assert.equal((await fetch(f.base+'/api/lessons',{headers:{Origin:previewOrigin}})).status,403);
 assert.equal((await fetch(f.base+'/fonts/manrope/Manrope-wght.ttf',{headers:{Origin:previewOrigin}})).status,200);
 const markup=await (await fetch(f.base+'/app.js')).text();assert.match(markup,/allow-same-origin/);assert.match(markup,/el.src=result.previewUrl/);assert.doesNotMatch(markup,/el.srcdoc=/);
 const saved=await fetch(f.base+'/api/lessons/test-decimals/preview?lang=kk');assert.equal(saved.status,200);assert.match(await saved.text(),/<html lang="kk"/);
 assert.equal(saved.headers.get('permissions-policy'),isolated.headers.get('permissions-policy'));
 assert.equal((await fetch(f.base+'/fonts/manrope/Manrope-wght.ttf',{headers:{Origin:'null'}})).status,200);
 assert.equal((await fetch(f.base+'/api/lessons',{headers:{Origin:'null'}})).status,403);
 const manifest=await (await fetch(f.base+'/damulab/manifest.json')).json();
 for(const [file,entry] of Object.entries(manifest.files)) {const asset=await fetch(f.base+'/'+file);assert.equal(asset.status,200);assert.equal(sha(Buffer.from(await asset.arrayBuffer())),entry.sha256);}
});
