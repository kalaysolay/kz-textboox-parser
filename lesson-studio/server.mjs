import http from 'node:http';
import {hasOpenReviewIssues} from './review.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { targetPreview } from './target-preview.mjs';
import { createPreviewHost, PREVIEW_PERMISSIONS } from './preview-host.mjs';
import { DamulabClient } from './damulab-client.mjs';
import { LessonPipeline } from './pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../lessons');
const PUBLIC = path.join(HERE, 'public');
const sha = data => createHash('sha256').update(data).digest('hex');
const inside = (root, file) => file === root || (!path.relative(root, file).startsWith('..') && !path.isAbsolute(path.relative(root, file)));
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.json':'application/json; charset=utf-8','.jsonl':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};

class ApiError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
async function jsonBody(req) {
  let size=0, chunks=[];
  for await (const chunk of req) {size+=chunk.length; if(size>3*1024*1024) throw new ApiError(413,'too_large','Документ больше 3 МБ.'); chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new ApiError(400,'invalid_json','Некорректный JSON.');}
}
function send(res,status,value,headers={}) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(value));}
async function maybeJSON(root,file) {try{return JSON.parse(await fs.readFile(await safeFile(root,file),'utf8'));}catch{return null;}}
async function safeFile(root,file) {
  let resolved;
  try {resolved=await fs.realpath(file);} catch {throw new ApiError(404,'not_found','Файл не найден.');}
  if(!inside(root,resolved)) throw new ApiError(403,'outside_root','Файл находится за пределами lessons.');
  return resolved;
}
async function walk(root,dir=root,result=[]) {
  const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const entry of entries) {
    if(entry.isSymbolicLink() || entry.name==='.local' || entry.name.startsWith('.')) continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) await walk(root,file,result);
    else if(entry.isFile() && entry.name.endsWith('.lesson.json')) {
      const real=await safeFile(root,file); const raw=await fs.readFile(real,'utf8');
      try {const doc=JSON.parse(raw); if(typeof doc.id==='string' && doc.id) result.push({id:doc.id,file:real,raw,doc,hash:sha(raw),relative:path.relative(root,real).split(path.sep).join('/')});}
      catch {result.push({id:'invalid:'+sha(real).slice(0,20),file:real,raw,doc:null,hash:sha(raw),relative:path.relative(root,real).split(path.sep).join('/')});}
    }
  }
  return result;
}
async function artifacts(root,dir,base=dir,result=[]) {
  for(const e of await fs.readdir(dir,{withFileTypes:true})) {
    if(e.isSymbolicLink() || e.name.startsWith('.')) continue;
    const file=path.join(dir,e.name);
    if(e.isDirectory()) await artifacts(root,file,base,result);
    else if(e.isFile()) {
      const real=await safeFile(root,file), stat=await fs.stat(real), bytes=await fs.readFile(real);
      result.push({name:path.relative(base,real).split(path.sep).join('/'),size:stat.size,modifiedAt:stat.mtime.toISOString(),sha256:sha(bytes)});
    }
  }
  return result;
}
function reviewState(review,hash) {
  const expected=review?.lessonSha256 ?? review?.sha256 ?? review?.sourceSha256 ?? review?.documentSha256 ?? review?.targetSha256 ?? review?.lesson?.sha256;
  return {review,hashMatches:!!expected && expected===hash,ready:expected===hash && review?.verdict==='ready_for_preview'&&!hasOpenReviewIssues(review),expectedHash:expected??null};
}
function filenameHeader(name) {return `attachment; filename="lesson.${name.endsWith('.html')?'html':'json'}"; filename*=UTF-8''${encodeURIComponent(name)}`;}

export async function createLessonServer({lessonsRoot=DEFAULT_ROOT,core:providedCore,pipeline:providedPipeline}={}) {
  await fs.mkdir(lessonsRoot,{recursive:true});
  const root=await fs.realpath(lessonsRoot);
  const core=providedCore??await import('./core.mjs');
  const preview=await createPreviewHost();
  const locks=new Map();
  const pipeline=providedPipeline??new LessonPipeline({repo:path.resolve(HERE,'..'),lessonsRoot:root});await pipeline.initialize();
  const renderer=JSON.parse(await fs.readFile(path.join(PUBLIC,'damulab/manifest.json'),'utf8'));
  const damulab=new DamulabClient({find,validate:core.validateLesson,rendererVersion:renderer.version,
    reviewReady:async item=>reviewState(await maybeJSON(root,path.join(path.dirname(item.file),'04-Ревью.json')),item.hash).ready,
    readAsset:async(item,asset)=>fs.readFile(await safeFile(path.dirname(item.file),path.resolve(path.dirname(item.file),asset.path))),
    appendJournal:async(item,entry)=>fs.appendFile(path.join(path.dirname(item.file),'Журнал.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),actor:'lesson-studio',lessonId:item.id,...entry})+'\n')
  });
  async function inventory() {return walk(root);}
  async function find(id) {
    const matches=(await inventory()).filter(item=>item.id===id);
    if(!matches.length) throw new ApiError(404,'not_found','Урок не найден.');
    if(matches.length>1) throw new ApiError(409,'duplicate_id','В библиотеке повторяется id урока. Исправьте пакеты.');
    if(!matches[0].doc) throw new ApiError(422,'invalid_lesson','Основной JSON урока повреждён.');
    return matches[0];
  }
  async function details(item) {
    const dir=path.dirname(item.file);
    let journal=[];
    try {journal=(await fs.readFile(await safeFile(root,path.join(dir,'Журнал.jsonl')),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return {message:line};}});}catch{}
    const review=await maybeJSON(root,path.join(dir,'04-Ревью.json'));
    return {doc:item.doc,hash:item.hash,path:item.relative,review:reviewState(review,item.hash),validation:await core.validateLesson(item.doc),artifacts:await artifacts(root,dir),journal};
  }
  async function save(id,expected,submitted) {
    const previous=locks.get(id)??Promise.resolve();
    let release; const queued=new Promise(r=>release=r); locks.set(id,queued); await previous;
    try {
      const item=await find(id);
      if(!expected) throw new ApiError(428,'hash_required','Для сохранения требуется If-Match.');
      if(expected.replaceAll('"','')!==item.hash) throw new ApiError(409,'stale_revision','Урок изменился на диске. Загрузите последнюю редакцию; ваши правки остаются в редакторе.');
      if(submitted?.id!==id || submitted?.schemaVersion!==2) throw new ApiError(400,'identity_changed','Нельзя менять id или версию формата при редактировании.');
      const doc={...submitted,revision:item.doc.revision+1,status:'draft'};
      const validation=await core.validateLesson(doc);
      if(!validation.ok) {const error=new ApiError(422,'validation_failed','Сохранение остановлено: исправьте ошибки документа.');error.validation=validation;throw error;}
      const dir=path.dirname(item.file), local=path.join(dir,'.local'), revisions=path.join(local,'revisions');
      const journalPath=path.join(dir,'Журнал.jsonl');
      try {await safeFile(dir,journalPath);}catch(error){if(error.code!=='not_found') throw error;}
      // Never follow a user-created .local/revisions symlink out of the lesson root.
      for(const candidate of [local,revisions]) {await fs.mkdir(candidate,{recursive:true});await safeFile(dir,candidate);}
      const timestamp=new Date().toISOString();
      const backup=path.join(revisions,`${timestamp.replaceAll(':','-')}-r${item.doc.revision}-${item.hash.slice(0,12)}.json`);
      await fs.writeFile(backup,item.raw,{encoding:'utf8',flag:'wx'});
      // Re-read immediately before replace: external processes may edit while validation runs.
      if(sha(await fs.readFile(await safeFile(root,item.file)))!==item.hash) throw new ApiError(409,'stale_revision','Урок изменился во время сохранения. Повторите после обновления.');
      const serialized=JSON.stringify(doc,null,2)+'\n', temp=path.join(dir,`.lesson-${randomUUID()}.tmp`);
      try {await fs.writeFile(temp,serialized,{encoding:'utf8',flag:'wx'});await fs.rename(temp,item.file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
      const entry={timestamp,event:'local_edit',actor:'lesson-studio',lessonId:id,revision:doc.revision,previousSha256:item.hash,lessonSha256:sha(serialized),reviewInvalidated:true};
      let journalWarning=null;
      try {let prefix='';try{const before=await fs.readFile(journalPath,'utf8');if(before&&!before.endsWith('\n'))prefix='\n';}catch{}await fs.appendFile(journalPath,prefix+JSON.stringify(entry)+'\n','utf8');}catch{journalWarning='Урок сохранён, но запись журнала не удалась. Резервная редакция сохранена.';}
      const saved=await find(id);return {...await details(saved),journalWarning};
    } finally {release();if(locks.get(id)===queued) locks.delete(id);}
  }
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      const host=req.headers.host??'';
      if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) throw new ApiError(403,'invalid_host','Разрешён только локальный адрес.');
      const publicFont=req.method==='GET' && /^\/(?:fonts\/|vendor\/katex\/fonts\/)/.test(url.pathname);
      // У предпросмотра свой loopback origin без API. Из него разрешены только
      // публичные шрифты; доступ к API Мастерской остаётся в пределах её origin.
      if(req.headers.origin && req.headers.origin!==`http://${host}` && !(publicFont && [preview.origin,'null'].includes(req.headers.origin))) throw new ApiError(403,'cross_origin','Запрос должен исходить из локального приложения.');
      if(req.method==='GET' && url.pathname==='/api/lessons') {
        const entries=await inventory();
        return send(res,200,{lessons:await Promise.all(entries.map(async i=>({id:i.id,title:i.doc?.title??{ru:path.basename(i.file)},subject:i.doc?.subject??{},grade:i.doc?.grade,status:i.doc?.status??'invalid',revision:i.doc?.revision,estimatedMinutes:i.doc?.estimatedMinutes,summary:i.doc?.summary??{},path:i.relative,hash:i.hash,review:reviewState(await maybeJSON(root,path.join(path.dirname(i.file),'04-Ревью.json')),i.hash)})))});
      }
      if(req.method==='GET'&&url.pathname==='/api/damulab')return send(res,200,damulab.status());
      if(req.method==='GET'&&url.pathname==='/api/generation')return send(res,200,{jobs:pipeline.list(),serverTime:new Date().toISOString()});
      if(req.method==='GET'&&url.pathname==='/api/generation/catalog'){
        const [runtime,books,aiOptions]=await Promise.all([pipeline.available().catch(error=>{if(error.code==='ai_config_invalid')return {available:false,error:{code:error.code,message:error.message}};throw error;}),pipeline.books(),pipeline.runtimeOptions?.().catch(()=>[])??[]]);return send(res,200,{runtime,books,aiOptions});
      }
      if(req.method==='POST'&&url.pathname==='/api/generation')return send(res,202,await pipeline.start(await jsonBody(req)));
      const jobRoute=url.pathname.match(/^\/api\/generation\/([a-f0-9]{24})\/(resume|stop)$/);
      if(req.method==='POST'&&jobRoute)return send(res,200,await pipeline[jobRoute[2]](jobRoute[1]));
      if(req.method==='POST'&&url.pathname==='/api/damulab/connect')return send(res,200,await damulab.connect(await jsonBody(req)));
      if(req.method==='POST'&&url.pathname==='/api/damulab/disconnect')return send(res,200,damulab.disconnect());
      if(req.method==='GET'&&url.pathname==='/api/damulab/catalog')return send(res,200,await damulab.catalog(Object.fromEntries(url.searchParams)));
      const publishRoute=url.pathname.match(/^\/api\/lessons\/([^/]+)\/damulab(?:\/(prepare|upload|publish))?$/);
      if(publishRoute){
        const id=decodeURIComponent(publishRoute[1]);
        if(req.method==='GET'&&!publishRoute[2])return send(res,200,await damulab.info(id));
        if(req.method==='POST'){
          const body=await jsonBody(req);
          if(publishRoute[2]==='prepare')return send(res,200,await damulab.prepare(id,body));
          if(publishRoute[2]==='upload')return send(res,200,await damulab.upload(id,body.planId));
          if(publishRoute[2]==='publish')return send(res,200,await damulab.publish(id,body.lessonSha256));
        }
      }
      if(req.method==='POST' && url.pathname==='/api/render') {
        const {doc,lang,mode,token}=await jsonBody(req);
        const validation=await core.validateLesson(doc);
        if(!validation.ok){const error=new ApiError(422,'validation_failed',validation.errors[0]?.message??'Документ содержит ошибки.');error.validation=validation;throw error;}
        if(mode==='damulab') {
          const document=targetPreview(doc,lang,`http://${host}`,token);
          return send(res,200,{document,previewUrl:preview.put(document),mode:'damulab'});
        }
        return send(res,200,{html:await core.renderLesson(doc,lang==='kk'?'kk':'ru',{interactive:true,showSources:true})});
      }
      if(req.method==='POST' && url.pathname==='/api/validate') {const {doc}=await jsonBody(req);return send(res,200,await core.validateLesson(doc));}
      const match=url.pathname.match(/^\/api\/lessons\/([^/]+)(?:\/(export|artifact|preview))?$/);
      const assetMatch=url.pathname.match(/^\/api\/lessons\/([^/]+)\/assets\/([^/]+)$/);
      if(req.method==='GET' && assetMatch) {
        const item=await find(decodeURIComponent(assetMatch[1])),asset=item.doc.assets?.find(a=>a.id===decodeURIComponent(assetMatch[2]));
        if(!asset || !/^assets\//.test(asset.path) || path.isAbsolute(asset.path) || asset.path.split(/[\\/]/).includes('..')) throw new ApiError(404,'asset_not_found','Изображение не найдено в пакете.');
        const lessonDir=await fs.realpath(path.dirname(item.file)),file=await safeFile(lessonDir,path.resolve(lessonDir,asset.path));
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[path.extname(file).toLowerCase()];
        if(!mime) throw new ApiError(415,'asset_type','Неподдерживаемый формат изображения.');
        const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(data);
      }
      if(match) {
        let id;try{id=decodeURIComponent(match[1]);}catch{throw new ApiError(400,'invalid_id','Некорректный id.');}
        if(req.method==='PUT' && !match[2]) {const {doc}=await jsonBody(req);return send(res,200,await save(id,req.headers['if-match'],doc));}
        const item=await find(id);
        if(req.method==='GET' && !match[2]) return send(res,200,await details(item),{ETag:`"${item.hash}"`});
        if(req.method==='GET' && match[2]==='preview') {
          const lang=url.searchParams.get('lang')==='kk'?'kk':'ru';
          const validation=await core.validateLesson(item.doc);
          if(!validation.ok) throw new ApiError(422,'validation_failed','Исправьте ошибки пакета перед просмотром.');
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Permissions-Policy':PREVIEW_PERMISSIONS});
          return res.end(targetPreview(item.doc,lang,`http://${host}`));
        }
        if(req.method==='GET' && match[2]==='export') {
          const lang=url.searchParams.get('lang')==='kk'?'kk':'ru', html=url.searchParams.get('format')==='html';
          const name=`${item.doc.title?.[lang]??'Урок'}.${html?`${lang}.html`:'lesson.json'}`;
          const validation=await core.validateLesson(item.doc);
          if(html&&!validation.ok) {const error=new ApiError(422,'validation_failed','Экспорт HTML остановлен: исправьте ошибки документа.');error.validation=validation;throw error;}
          const data=html?await core.buildExport(item.doc,lang):item.raw;
          res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':filenameHeader(name),'Cache-Control':'no-store'});
          return res.end(data);
        }
        if(req.method==='GET' && match[2]==='artifact') {
          const name=url.searchParams.get('name'),allowed=await artifacts(root,path.dirname(item.file));
          if(!allowed.some(x=>x.name===name)) throw new ApiError(404,'not_found','Файл пакета не найден.');
          const file=await safeFile(root,path.join(path.dirname(item.file),name));
          const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':filenameHeader(path.basename(file)),'Cache-Control':'no-store'});return res.end(data);
        }
      }
      if(req.method==='GET' && !url.pathname.startsWith('/api/')) {
        let file;
        if(url.pathname.startsWith('/vendor/katex/')) {const relative=decodeURIComponent(url.pathname.slice('/vendor/katex/'.length));const vendor=path.join(HERE,'node_modules/katex/dist');file=path.resolve(vendor,relative);if(!inside(vendor,file)) throw new ApiError(403,'invalid_path','Недопустимый путь.');}
        else {const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));file=path.resolve(PUBLIC,name);if(!inside(PUBLIC,file)) throw new ApiError(403,'invalid_path','Недопустимый путь.');}
        const allowedRoot=file.startsWith(PUBLIC)?PUBLIC:path.join(HERE,'node_modules/katex/dist');
        // pnpm's vendor symlink is intentionally allowed; only fixed dist-relative files are exposed.
        if(!inside(allowedRoot,file)) throw new ApiError(403,'invalid_path','Недопустимый путь.');
        let data;try{data=await fs.readFile(file);}catch{throw new ApiError(404,'not_found','Страница не найдена.');}
        res.writeHead(200,{'Content-Type':MIME[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',...(publicFont?{'Access-Control-Allow-Origin':'*'}:{})});return res.end(data);
      }
      throw new ApiError(404,'not_found','Адрес не найден.');
    } catch(error) {if(res.headersSent){res.end();return;}send(res,error.status??500,{error:{code:error.code??'server_error',message:error.status?error.message:'Внутренняя ошибка сервера.',...(error.validation?{validation:error.validation}:{})}});}
  });
  server.once('close',()=>{preview.close();damulab.disconnect({force:true});void pipeline.close();});
  server.once('error',()=>preview.close());
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const port=Number(process.env.LESSON_STUDIO_PORT??4317);
  if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Некорректный LESSON_STUDIO_PORT.');
  const server=await createLessonServer();
  server.listen(port,'127.0.0.1',()=>console.log(`Мастерская уроков: http://127.0.0.1:${port}`));
}
