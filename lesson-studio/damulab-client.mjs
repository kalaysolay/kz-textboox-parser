import {createHash,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildExport,escapeHtml} from './core.mjs';
import {compareHtml,htmlSnapshot} from './html-fidelity.mjs';

const sha=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
function baseUrl(value){
 let url;try{url=new URL(value);}catch{throw fail(400,'target_url','Введите адрес Damulab.');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw fail(400,'target_url','Нужен адрес сайта без пути, пароля и параметров.');
 if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw fail(400,'target_https','Для удалённого Damulab требуется HTTPS.');
 return url.origin;
}

// Авторизация живёт только в памяти локального процесса. Секреты не возвращаются
// браузеру, не попадают в manifest, историю урока или диагностические сообщения.
export class DamulabClient {
 constructor({find,validate,readAsset,appendJournal,reviewReady,rendererVersion}){
  Object.assign(this,{find,validate,readAsset,appendJournal,reviewReady,rendererVersion});this.session=null;this.plans=new Map();this.busy=false;
 }
 status(){return {connected:!!this.session,origin:this.session?.origin??null,capabilities:this.session?.capabilities??null};}
 disconnect({force=false}={}){if(this.busy&&!force)throw fail(409,'upload_busy','Дождитесь текущей операции Damulab.');this.session=null;this.plans.clear();return this.status();}
 async request(route,{method='GET',body,allowMissing=false}={}){
  const session=this.session;if(!session)throw fail(401,'not_connected','Сначала подключитесь к Damulab.');
  const headers={Accept:'application/json'};
  if(session.cookies.size)headers.Cookie=[...session.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
  if(body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET'&&session.csrf)headers['X-CSRF-TOKEN']=session.csrf;
  let response;try{response=await fetch(session.origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(30000)});}catch{throw fail(502,'damulab_unreachable','Нет ответа Damulab. Проверьте соединение; повторная загрузка проверит уже созданный черновик.');}
  for(const cookie of response.headers.getSetCookie()){const [key,...value]=cookie.split(';')[0].split('=');session.cookies.set(key,value.join('='));}
  if(allowMissing&&response.status===404)return null;
  const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{result=null;}
  if(!response.ok||response.status>=300){
   const code=result?.error??'damulab_request_failed';
   const message=code==='lecture_sync_conflict'?'Лекция изменена в админке. Обновите проверку перед загрузкой.':code==='lecture_auto_checkpoints_not_found'?'Для выбранной темы нет опубликованных вопросов итогового теста.':response.status===401||response.status===403?'Сеанс Damulab недоступен. Подключитесь заново.':`DamULab отклонил операцию: ${code} (HTTP ${response.status}).`;
   throw fail(response.status===409?409:502,code,message);
  }
  return result??raw;
 }
 async connect({baseUrl:address,email,password}){
  return this.exclusive(async()=>{
  if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password||email.length>254||password.length>1024)throw fail(400,'credentials','Введите email и пароль.');
  // Смена адреса и сеанса не должна пересекаться с отправкой или публикацией.
  // Иначе продолжение запроса могло бы использовать cookies другого сервера.
  this.session=null;this.plans.clear();this.session={origin:baseUrl(address),cookies:new Map(),csrf:null,capabilities:null,key:randomBytes(16).toString('hex')};
  try{
   await this.request('/api/auth/login',{method:'POST',body:{email:email.trim(),password}});
   const html=await this.request('/admin/lectures/new');
   this.session.csrf=typeof html==='string'?html.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1]:null;
   if(!this.session.csrf)throw fail(502,'csrf_missing','Не удалось получить административный сеанс Damulab.');
   const cap=await this.request('/api/admin/lectures/studio/capabilities',{allowMissing:true});
   if(!cap)throw fail(409,'target_upgrade_required','На сервере ещё нет API Мастерской. Сначала нужно развернуть поддержку формата и синхронизации.');
   if(cap.kind!=='damulab.lesson-studio'||cap.syncVersion!=='1.0'||cap.lessonSchemaVersion!==2||cap.conditionalWrites!==true||cap.rendererVersion!==this.rendererVersion)throw fail(409,'format_mismatch',`Формат сервера и Мастерской различается. Требуется renderer ${this.rendererVersion} и API синхронизации 1.0.`);
   this.session.capabilities=cap;return this.status();
  }catch(error){this.session=null;this.plans.clear();throw error;}
  });
 }
 async catalog(selection={}){const [subjects,grades]=await Promise.all([this.request('/api/admin/subjects'),this.request('/api/admin/grades')]);const subjectId=Number(selection.subjectId),gradeId=Number(selection.gradeId);const topics=Number.isSafeInteger(subjectId)&&subjectId>0&&Number.isSafeInteger(gradeId)&&gradeId>0?await this.request(`/api/admin/topics?subjectId=${subjectId}&gradeId=${gradeId}`):[];return{subjects,grades,topics};}
 lookup(id){return this.request('/api/admin/lectures/studio/lookup?externalId='+encodeURIComponent(id),{allowMissing:true});}
 mappingPath(item){if(!this.session)throw fail(401,'not_connected','Сначала подключитесь.');return path.join(path.dirname(item.file),'.local','damulab',sha(this.session.origin)+'.json');}
 async mapping(item){try{return JSON.parse(await fs.readFile(this.mappingPath(item),'utf8'));}catch{return null;}}
 async info(id){const item=await this.find(id);return{...this.status(),mapping:this.session?await this.mapping(item):null};}
 async prepare(id,selection){
  return this.exclusive(async()=>{
  const item=await this.find(id),validation=this.validate(item.doc);if(!validation.ok)throw fail(422,'validation_failed','Исправьте технические ошибки урока.');
  if(!this.session?.capabilities)throw fail(401,'not_connected','Сначала подключитесь к Damulab.');
  const {subjects,grades,topics}=await this.catalog(selection);
  const subject=subjects.find(s=>s.id===Number(selection.subjectId)),grade=grades.find(g=>g.id===Number(selection.gradeId)),topic=topics.find(t=>t.id===Number(selection.topicId));
  if(!subject||!grade||!topic||topic.subjectId!==subject.id||topic.gradeId!==grade.id||grade.gradeNo!==item.doc.grade)throw fail(422,'target_scope','Выберите тему нужного предмета и класса. Класс должен совпадать с локальным уроком.');
  const mode=selection.controlMode==='AUTO'?'AUTO':'NONE',count=Number(selection.questionCount??3);
  if(!Number.isInteger(count)||count<1||count>10)throw fail(422,'question_count','Число вопросов — от 1 до 10.');
  const assets=[];
  for(const asset of item.doc.assets){const bytes=await this.readAsset(item,asset);if(bytes.length>10*1024*1024)throw fail(422,'asset_size','Картинка больше 10 МБ.');const ext=path.extname(asset.path).toLowerCase();const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[ext];assets.push({id:asset.id,kind:'image',mimeType:mime,source:{type:'base64',data:bytes.toString('base64')},sha256:sha(bytes),credit:asset.credit??'Сведения об изображении находятся в локальном пакете урока.'});}
  const lesson={externalId:item.id,metadata:{subjectId:subject.id,gradeId:grade.id,topicId:topic.id,title:item.doc.title,primaryLanguage:'kk',source:item.doc.sources.filter(s=>s.type==='textbook').map(s=>`${s.title}; стр. ${s.pages.join(', ')}`).join('; ').slice(0,512)||'Авторский урок. Источники приведены в тексте и локальном пакете.'},assets,content:{ruHtml:buildExport(item.doc,'ru'),kkHtml:buildExport(item.doc,'kk')},attachments:[],completionControl:{mode,questionCount:count}};
  const remote=await this.lookup(item.id),mapping=await this.mapping(item);
  if(remote&&(!mapping||mapping.revision!==remote.revision))throw fail(409,'remote_changed','На сервере уже есть урок с этим ID или он изменился в админке. Сначала просмотрите серверную версию; автоматическая перезапись остановлена.');
  const planId=randomBytes(24).toString('hex'),payloadSha256=sha(lesson);
  for(const [key,p] of this.plans)if(p.expires<Date.now())this.plans.delete(key);
  while(this.plans.size>=16)this.plans.delete(this.plans.keys().next().value);
  const plan={planId,id,lesson,hash:item.hash,sessionKey:this.session.key,expectedRevision:remote?.revision??null,payloadSha256,expires:Date.now()+10*60*1000};
  this.plans.set(planId,plan);
  return{planId,lessonSha256:item.hash,payloadSha256,action:remote?'update':'create',reviewReady:await this.reviewReady(item),origin:this.session.origin,subject:subject.titleRu,grade:grade.gradeNo,topic:topic.titleRu,title:item.doc.title,assetCount:assets.length,controlMode:mode,remoteUrl:remote?`${this.session.origin}/admin/lectures/${remote.lecture.id}/preview`:null};
  });
 }
 async exclusive(action){if(this.busy)throw fail(409,'upload_busy','Дождитесь текущей операции Damulab.');this.busy=true;try{return await action();}finally{this.busy=false;}}
 async upload(id,planId){return this.exclusive(async()=>{
  const plan=this.plans.get(planId),item=await this.find(id);
  if(!plan||plan.id!==id||plan.expires<Date.now()||plan.sessionKey!==this.session?.key)throw fail(409,'plan_expired','Проверка загрузки устарела. Выполните её заново.');
  if(item.hash!==plan.hash)throw fail(409,'stale_revision','Урок изменился после проверки. Подготовьте загрузку заново.');
  const previous=await this.mapping(item);
  if(previous?.lessonSha256===item.hash&&previous.payloadSha256===plan.payloadSha256){const remote=await this.lookup(id);if(remote?.revision===previous.revision&&previous.verified)return{...previous,unchanged:true};}
  const remoteBefore=await this.lookup(id);
  if((remoteBefore?.revision??null)!==plan.expectedRevision)throw fail(409,'remote_changed','Серверная версия изменилась после проверки.');
  if(remoteBefore){const dir=path.join(path.dirname(item.file),'.local','remote-revisions');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,`${Date.now()}-${remoteBefore.revision}.json`),JSON.stringify(remoteBefore,null,2));}
  let result;
  try{result=await this.request('/api/admin/lectures/studio/sync',{method:'POST',body:{lesson:plan.lesson,expectedRevision:plan.expectedRevision}});}catch(error){
   // POST мог завершиться на сервере до обрыва ответа. Проверяем externalId и
   // содержимое, прежде чем пользователь повторно отправит тот же пакет.
   if(error.code!=='damulab_unreachable')throw error;
   result=await this.lookup(id);if(!result)throw error;
   result.assetUrls={};
   const actual=htmlSnapshot(result.lecture.contentRu).images,expected=htmlSnapshot(plan.lesson.content.ruHtml).images;
   expected.forEach((img,index)=>{if(img.src.startsWith('asset://')&&actual[index])result.assetUrls[img.src.slice(8)]=actual[index].src;});
  }
  const readBack=await this.lookup(id);if(!readBack)throw fail(502,'readback_missing','Черновик не найден после загрузки.');
  const comparisons={};
  for(const lang of ['ru','kk']){
   let expected=plan.lesson.content[lang+'Html'];for(const [asset,url] of Object.entries(result.assetUrls??{}))expected=expected.replaceAll(`src="asset://${escapeHtml(asset)}"`,`src="${escapeHtml(url)}"`);
   comparisons[lang]=compareHtml(expected,readBack.lecture[lang==='ru'?'contentRu':'contentKk']);
  }
  const verified=Object.values(comparisons).every(c=>c.ok)&&readBack.lecture.titleRu===item.doc.title.ru&&readBack.lecture.titleKk===item.doc.title.kk&&readBack.lecture.topicId===plan.lesson.metadata.topicId;
  // У опубликованного урока может появиться новая административная версия.
  // Общий status остаётся published, а publishedAt новой версии ещё отсутствует.
  const versionStatus=readBack.lecture.status==='published'&&!readBack.lecture.publishedAt?'draft':readBack.lecture.status;
  const mapping={origin:this.session.origin,externalId:id,lectureId:readBack.lecture.id,revision:readBack.revision,lessonSha256:item.hash,payloadSha256:plan.payloadSha256,uploadedAt:new Date().toISOString(),verified,comparisons,assetUrls:result.assetUrls,status:versionStatus,previewUrl:`${this.session.origin}/admin/lectures/${readBack.lecture.id}/preview`,editUrl:`${this.session.origin}/admin/lectures/${readBack.lecture.id}/edit`};
  const file=this.mappingPath(item);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(mapping,null,2));
  await this.appendJournal(item,{event:'damulab_draft_uploaded',origin:mapping.origin,lectureId:mapping.lectureId,lessonSha256:item.hash,remoteRevision:mapping.revision,verified,comparisons});
  this.plans.delete(planId);
  if(!verified)throw fail(422,'readback_mismatch','Черновик загружен, но сравнение обнаружило потери. Публикация заблокирована; подробности в журнале.');
  return mapping;
 });}
 async publish(id,expectedHash){return this.exclusive(async()=>{
  const item=await this.find(id),mapping=await this.mapping(item);
  if(item.hash!==expectedHash||!mapping?.verified||mapping.lessonSha256!==item.hash||!await this.reviewReady(item))throw fail(409,'publication_not_ready','Для публикации нужны актуальное независимое ревью и проверенная загрузка этой редакции.');
  await this.request('/api/admin/lectures/studio/publish',{method:'POST',body:{externalId:id,expectedRevision:mapping.revision}});
  const remote=await this.lookup(id);if(remote?.lecture.status!=='published'||!remote.lecture.publishedAt)throw fail(502,'publication_unverified','Не удалось подтвердить публикацию этой версии.');
  Object.assign(mapping,{status:'published',revision:remote.revision,publishedAt:new Date().toISOString()});await fs.writeFile(this.mappingPath(item),JSON.stringify(mapping,null,2));
  await this.appendJournal(item,{event:'damulab_published',origin:mapping.origin,lectureId:mapping.lectureId,lessonSha256:item.hash,remoteRevision:mapping.revision});return mapping;
 });}
}
