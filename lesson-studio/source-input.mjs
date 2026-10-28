import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const execute=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const fail=(code,message)=>Object.assign(new Error(message),{status:422,code});
const normalize=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015\u2212]/g,'-').replace(/-\s+(?=\p{L})/gu,'').replace(/(?<=\d)\s*-\s*(?=\d)/gu,'numberrange').replace(/(?<=\d)[.,](?=\d)/gu,'numberdecimal').replace(/(?<=\d)\s*\/\s*(?=\d)/gu,'numberfraction').replace(/[^\p{L}\p{N}]/gu,'');

// Deterministic preparation, using the same shared PDF tools as the parser skill.
// No lesson/source artifact or verification claim is generated on the model's behalf.
export async function prepareSourceInput({repo,dir,brief,runTool=execute,onSpawn=()=>{},isCancelled=()=>false}) {
 if(!brief.textbookTopic)return null; // Legacy free-form topics retain their discovery flow.
 const parsedPath=path.resolve(repo,brief.parsedTextbookPath),pdfPath=path.resolve(repo,brief.pdfTextbookPath);
 const parsed=await readJSON(parsedPath),topic=brief.textbookTopic;
 const offset=parsed.source?.pdf_page_mapping?.offset;
 if(!Number.isInteger(offset))throw fail('source_mapping_missing','В разборе нет подтверждённого смещения страниц PDF. Сначала нужна проверка карты страниц.');
 const first=topic.pageStart,last=topic.pageEnd??first;
 if(!Number.isInteger(first)||!Number.isInteger(last)||last<first||last-first>31)throw fail('source_range','Выберите раздел не более 32 страниц с известным диапазоном.');
 const base=path.join(dir,'.local','source-input');await fs.mkdir(base,{recursive:true});
 const tool=async args=>{if(isCancelled())throw Error('Preparation cancelled');const pending=runTool(process.execPath,args,{cwd:repo,windowsHide:true,timeout:120000,maxBuffer:1024*1024});if(pending.child)onSpawn(pending.child);try{return await pending;}finally{onSpawn(null);}};
 try{
  await tool([path.join(repo,'content/tools/textbook-nav.js'),'--parsed',parsedPath,'--topic',String(topic.sourceId),'--out',path.join(base,'nav')]);
  await tool([path.join(repo,'content/tools/read-textbook-pages.js'),'--parsed',parsedPath,'--pdf',pdfPath,'--pages',`${first}-${last}`,'--pdf-offset',String(offset),'--out',path.join(base,'pages')]);
 }catch{throw fail('source_preparation','Не удалось подготовить выбранные страницы. Проверьте локальные PDF-инструменты, карту страниц и доступ к источнику.');}
 const manifest=await readJSON(path.join(base,'pages/manifest.json'));
 const pdfSha256=sha(await fs.readFile(pdfPath));
 if(manifest.pdfSha256!==pdfSha256)throw fail('source_hash','PDF изменился во время подготовки. Повторите проверку источника.');
 const pages=[];
 for(const page of manifest.pages){
  if(page.source!=='pdf_text_layer'||page.candidateUsable===false)throw fail('source_text_unverified','Выбранным страницам требуется OCR или визуальная проверка. Автопроверка цитат доступна для пригодного текстового слоя PDF.');
  const extracted=await readJSON(page.textPath);
  pages.push({bookPage:page.bookPage,pdfPage:page.pdfPage,text:extracted.raw_text??extracted.text??'',method:page.source,pngPath:page.pngPath,pngSha256:sha(await fs.readFile(page.pngPath))});
 }
 if(pages.some(page=>!page.text.trim()))throw fail('source_text_missing','У выбранных страниц нет доступного текстового слоя. Требуется OCR и отдельная проверка источника.');
 const meta=parsed.metadata??{};
 const bibliography=Object.fromEntries(['title','authors','publisher','year','language','languages'].filter(k=>meta[k]!=null).map(k=>[k,meta[k]]));
 const input={schemaVersion:1,pdfPath,parsedPath,pdfSha256,bibliography,topic:{sourceId:topic.sourceId,title:topic.title,pageStart:first,pageEnd:last,pdfOffset:offset},pages,limitations:['Текстовый слой подготовлен локально; доступность текста не означает визуальную проверку или подтверждение фактов.']};
 const file=path.join(dir,'.local/source-input.json');await fs.writeFile(file,JSON.stringify(input,null,2)+'\n');return input;
}

export function sourceArtifactErrors(data,input,brief) {
 if(!input)return [];
 const errors=[],add=(code,message,ideaId)=>errors.push({code,message,...(typeof ideaId==='string'&&/^[\w-]{1,128}$/.test(ideaId)?{ideaId}:{})});
 if(!data||typeof data!=='object'||Array.isArray(data))return [{code:'source_format',message:'Источник должен быть объектом JSON по контракту парсера.'}];
 if(data.schemaVersion!==2||data.lessonId!==brief.id)add('source_identity','Укажите schemaVersion=2 и lessonId из заказа. Это источник, а не главный документ урока.');
 if(['title','revision','status','blocks'].some(k=>Object.hasOwn(data,k)))add('source_format','Уберите поля главного урока: title, revision, status, blocks. Парсер не создаёт и не переводит урок.');
 if(data.source?.pdfSha256!==input.pdfSha256)add('source_hash','pdfSha256 должен точно совпадать с подготовленным SHA-256 PDF; подставные значения запрещены.');
 if(data.source?.sourceTopicId!==input.topic.sourceId)add('source_topic','sourceTopicId должен совпадать с ID выбранного раздела учебника.');
 if(data.source?.bibliography&&Object.entries(data.source.bibliography).some(([key,value])=>JSON.stringify(input.bibliography?.[key])!==JSON.stringify(value)))add('source_bibliography','Библиографию можно копировать только из подготовленного входа; неизвестные автора, год и издательство не придумывайте.');
 const pages=input.pages.map(p=>p.bookPage);
 if(JSON.stringify(data.source?.pages)!==JSON.stringify(pages))add('source_pages','В source.pages перечислите ровно подготовленные печатные страницы.');
 if(data.verification?.method!=='pdf_text_layer')add('source_method','Для подготовленного текстового слоя укажите verification.method=pdf_text_layer; не заявляйте визуальную проверку.');
 const claims=JSON.stringify(data);
 if(/"visuallyVerified"\s*:\s*true|"(?:method|confidence)"\s*:\s*"(?:png_comparison|high_visual)"/.test(claims))add('source_visual_claim','Нельзя приписывать этому текстовому извлечению визуальную проверку PNG.');
 if(!Array.isArray(data.keyIdeas)||!data.keyIdeas.length)add('source_ideas','Нужна хотя бы одна дословная ключевая идея с ID и sourcePages.');
 else {const ids=new Set();for(const idea of data.keyIdeas){
  if(ids.has(idea?.id))add('source_idea_id','У каждой ключевой идеи должен быть уникальный ID.');ids.add(idea?.id);
  if(typeof idea?.id!=='string'||!/^[\w-]{1,128}$/.test(idea.id)||typeof idea.statement!=='string'||idea.statement.trim().length<15||!Array.isArray(idea.sourcePages)||!idea.sourcePages.length||idea.sourcePages.some(p=>!pages.includes(p))){add('source_idea','Каждой идее нужны ID, дословная statement и страницы внутри выбранного диапазона.');continue;}
  const corpus=normalize(input.pages.filter(p=>idea.sourcePages.includes(p.bookPage)).map(p=>p.text).join(' '));
  if(!corpus.includes(normalize(idea.statement)))add('source_quote','Цитата не совпадает с текстом указанных страниц. Скопируйте дословный непрерывный фрагмент; не переводите и не пересказывайте его.',idea.id);
 }}
 return errors;
}

export function sourceStageContract(input,brief,dir) {
 if(!input)return '';
 const shape={schemaVersion:2,lessonId:brief.id,sourceStatus:'ready',source:{pdfSha256:input.pdfSha256,sourceTopicId:input.topic.sourceId,pages:input.pages.map(p=>p.bookPage)},verification:{method:'pdf_text_layer',limitations:['Визуальную проверку этот этап не подтверждает.']},keyIdeas:[{id:'idea-01',statement:'ДОСЛОВНАЯ ЦИТАТА ИЗ ПОДГОТОВЛЕННОЙ СТРАНИЦЫ',sourcePages:[input.pages[0].bookPage]}],terms:[],workedExamples:[],gaps:[]};
 return `Текущий контракт парсера имеет приоритет над старыми v1-примерами. Сервер уже подготовил выбранные страницы: прочитай ${path.join(dir,'.local/source-input.json')}. Не читай полный parsed JSON и чужие уроки ради примеров. Итог 01-Источник учебника.json — объект по образцу ${JSON.stringify(shape)}. В keyIdeas достаточно 3–5 главных ДОСЛОВНЫХ цитат: statement скопируй из pages[].text, укажи правильную bookPage в sourcePages. Не добавляй название/поля главного урока, не переводи источник. Казахские термины, отсутствующие в учебнике, оставь пустыми. Не выдумывай библиографию и хеши. verification.method=pdf_text_layer, а не визуальная проверка. Это извлечение текстового слоя, а не подтверждение истинности исторических сведений. Выход должен быть валидным JSON; после записи проверь его через node. Не выполняй повторно уже выполненную сервером PDF/OCR-подготовку.`;
}
