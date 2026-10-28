import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {stopAIProcess} from './ai-runtime.mjs';

const execute=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const fail=(code,message)=>Object.assign(new Error(message),{status:422,code});
const normalize=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015\u2212]/g,'-').replace(/-\s+(?=\p{L})/gu,'').replace(/(?<=\d)\s*-\s*(?=\d)/gu,'numberrange').replace(/(?<=\d)[.,](?=\d)/gu,'numberdecimal').replace(/(?<=\d)\s*\/\s*(?=\d)/gu,'numberfraction').replace(/[^\p{L}\p{N}]/gu,'');

export function ocrLanguages(metadata={}) {
 const labels=[metadata.language,...(Array.isArray(metadata.languages)?metadata.languages:[])].filter(Boolean).join(' ').toLowerCase();
 const kaz=/\b(?:kk|kaz)\b|казах|қазақ/.test(labels),rus=/\b(?:ru|rus)\b|русск/.test(labels);
 return kaz?(rus?['kaz','rus']:['kaz']):rus?['rus']:['kaz','rus'];
}
const ocrPages=input=>input.pages.filter(p=>p.method==='tesseract.js');

// Deterministic preparation, using the same shared PDF tools as the parser skill.
// No lesson/source artifact or verification claim is generated on the model's behalf.
export async function prepareSourceInput({repo,dir,brief,runTool=execute,onSpawn=()=>{},onActivity=()=>{},isCancelled=()=>false,toolTimeoutMs=180000}) {
 if(!brief.textbookTopic)return null; // Legacy free-form topics retain their discovery flow.
 const parsedPath=path.resolve(repo,brief.parsedTextbookPath),pdfPath=path.resolve(repo,brief.pdfTextbookPath);
 const parsed=await readJSON(parsedPath),topic=brief.textbookTopic;
 const offset=parsed.source?.pdf_page_mapping?.offset;
 if(!Number.isInteger(offset))throw fail('source_mapping_missing','В разборе нет подтверждённого смещения страниц PDF. Сначала нужна проверка карты страниц.');
 const first=topic.pageStart,last=topic.pageEnd??first;
 if(!Number.isInteger(first)||!Number.isInteger(last)||last<first||last-first>31)throw fail('source_range','Выберите раздел не более 32 страниц с известным диапазоном.');
 const base=path.join(dir,'.local','source-input');await fs.mkdir(base,{recursive:true});
 const tool=async args=>{
  if(isCancelled())throw Error('Preparation cancelled');
  const pending=runTool(process.execPath,args,{cwd:repo,windowsHide:true,maxBuffer:1024*1024});
  if(pending.child)onSpawn(pending.child);
  let timer;
  try{return await Promise.race([pending,new Promise((_,reject)=>{
   timer=setTimeout(()=>{stopAIProcess(pending.child);reject(fail('source_timeout','Подготовка страницы превысила 3 минуты. Проверьте PDF-инструменты и продолжите заказ: готовый OCR используется из кеша.'));},toolTimeoutMs);
  })]);}finally{clearTimeout(timer);onSpawn(null);}
 };
 try{
  await tool([path.join(repo,'content/tools/textbook-nav.js'),'--parsed',parsedPath,'--topic',String(topic.sourceId),'--out',path.join(base,'nav')]);
  await tool([path.join(repo,'content/tools/read-textbook-pages.js'),'--parsed',parsedPath,'--pdf',pdfPath,'--pages',`${first}-${last}`,'--pdf-offset',String(offset),'--out',path.join(base,'pages')]);
 }catch(error){if(error.status)throw error;throw fail('source_preparation','Не удалось подготовить выбранные страницы. Проверьте локальные PDF-инструменты, карту страниц и доступ к источнику.');}
 const manifest=await readJSON(path.join(base,'pages/manifest.json'));
 const pdfSha256=sha(await fs.readFile(pdfPath));
 if(manifest.pdfSha256!==pdfSha256)throw fail('source_hash','PDF изменился во время подготовки. Повторите проверку источника.');
 const expected=Array.from({length:last-first+1},(_,i)=>first+i);
 if(!Array.isArray(manifest.pages)||JSON.stringify(manifest.pages.map(p=>p.bookPage))!==JSON.stringify(expected)||manifest.pages.some(p=>p.pdfPage!==p.bookPage+offset))throw fail('source_pages','PDF-инструмент вернул неполный или неверный диапазон страниц.');
 const pages=[],languages=ocrLanguages(parsed.metadata);
 const needed=manifest.pages.filter(p=>p.source!=='pdf_text_layer'||p.candidateUsable===false);
 if(needed.length){
  for(const lang of languages)try{await fs.access(path.join(repo,lang+'.traineddata'));}catch{throw fail('source_ocr_model_missing',`Для OCR нужен файл ${lang}.traineddata в корне репозитория. Установите локальную языковую модель и продолжите этот заказ.`);}
 }
 for(let page of manifest.pages){
  if(needed.includes(page)){
   onActivity(`Распознаёт страницу ${page.bookPage} (${pages.length+1}/${expected.length}); OCR ${languages.join('+')}`);
   const out=path.join(base,`ocr-${page.bookPage}`);
   try{await tool([path.join(repo,'content/tools/read-textbook-pages.js'),'--parsed',parsedPath,'--pdf',pdfPath,'--pages',String(page.bookPage),'--pdf-offset',String(offset),'--out',out,'--force-ocr','--lang',languages.join('+'),'--model-dir',repo]);}
   catch(error){if(error.status)throw error;throw fail('source_ocr_failed','Локальный OCR не завершил страницу. Проверьте зависимости content/tools (tesseract.js) и языковые модели; затем продолжите заказ.');}
   const ocr=await readJSON(path.join(out,'manifest.json'));
   if(ocr.pdfSha256!==pdfSha256||ocr.pages?.length!==1||ocr.pages[0].bookPage!==page.bookPage||ocr.pages[0].pdfPage!==page.pdfPage)throw fail('source_hash','Результат OCR не соответствует выбранному PDF или странице.');
   page=ocr.pages[0];
   if(page.source!=='tesseract.js'||page.candidateUsable!==true)throw fail('source_ocr_unreadable',`OCR страницы ${page.bookPage} не получил пригодного текста. Нужен более чёткий PDF или проверенная расшифровка; повтор без изменения источника не поможет.`);
  }
  if(isCancelled())throw fail('source_cancelled','Подготовка остановлена.');
  const extracted=await readJSON(page.textPath);
  pages.push({bookPage:page.bookPage,pdfPage:page.pdfPage,text:extracted.raw_text??extracted.text??'',method:page.source,pngPath:page.pngPath,pngSha256:sha(await fs.readFile(page.pngPath)),...(page.source==='tesseract.js'?{ocrLanguages:extracted.languages??languages,quality:page.quality,requiresVisualReview:true}:{})});
  onActivity(`Подготовлена страница ${page.bookPage} (${pages.length}/${expected.length})`);
 }
 if(pages.some(page=>!page.text.trim()))throw fail('source_text_missing','У выбранных страниц нет доступного текстового слоя. Требуется OCR и отдельная проверка источника.');
 const meta=parsed.metadata??{};
 const bibliography=Object.fromEntries(['title','authors','publisher','year','language','languages'].filter(k=>meta[k]!=null).map(k=>[k,meta[k]]));
 if(sha(await fs.readFile(pdfPath))!==pdfSha256)throw fail('source_hash','PDF изменился во время OCR. Повторите подготовку источника.');
 if(isCancelled())throw fail('source_cancelled','Подготовка остановлена.');
 const input={schemaVersion:1,pdfPath,parsedPath,pdfSha256,bibliography,topic:{sourceId:topic.sourceId,title:topic.title,pageStart:first,pageEnd:last,pdfOffset:offset},pages,limitations:['Текстовый слой или OCR подготовлен локально; это не визуальная проверка и не подтверждение фактов.','Для OCR парсер обязан открыть PNG, проверить цитаты и критические символы, явно указать непроверенные таблицы и фрагменты в gaps.']};
 const file=path.join(dir,'.local/source-input.json');await fs.writeFile(file,JSON.stringify(input,null,2)+'\n');return input;
}

export function sourceArtifactErrors(data,input,brief) {
 if(!data||typeof data!=='object'||Array.isArray(data))return [{code:'source_format',message:'Источник должен быть объектом JSON.'}];
 if(!input)return [];
 const errors=[],add=(code,message)=>errors.push({code,message});
 if(data.schemaVersion!==2||data.lessonId!==brief.id)add('source_identity','Укажите schemaVersion=2 и lessonId из заказа.');
 if(['title','revision','status','blocks'].some(k=>Object.hasOwn(data,k)))add('source_format','Парсер должен записать источник, а не главный документ урока.');
 if(data.source?.pdfSha256!==input.pdfSha256)add('source_hash','Источник относится к другому PDF: SHA-256 не совпадает с подготовленным файлом.');
 if(data.source?.sourceTopicId!==input.topic.sourceId)add('source_topic','Источник должен относиться к выбранному разделу учебника.');
 const pages=input.pages.map(p=>p.bookPage);
 if(JSON.stringify(data.source?.pages)!==JSON.stringify(pages))add('source_pages','В источнике должны быть указаны подготовленные страницы учебника.');
 if(!Array.isArray(data.keyIdeas)||!data.keyIdeas.length)add('source_ideas','В источнике нет ключевых идей.');
 else {const ids=new Set();for(const idea of data.keyIdeas){
  if(typeof idea?.id!=='string'||!/^[\w-]{1,128}$/.test(idea.id)||ids.has(idea.id)||typeof idea.statement!=='string'||!idea.statement.trim()||!Array.isArray(idea.sourcePages)||!idea.sourcePages.length||idea.sourcePages.some(p=>!pages.includes(p)))add('source_idea','Каждой идее нужны уникальный ID, текст и страницы внутри выбранного диапазона.');
  ids.add(idea?.id);
 }}
 return errors;
}

// Text comparison locates material for the editor; it cannot judge meaning.
// OCR corrections, paraphrases and table reconstruction are never hard failures.
export function sourceArtifactReview(data,input,brief) {
 const errors=sourceArtifactErrors(data,input,brief),observations=[];
 const add=(code,message,extra={})=>observations.push({code,message,...extra});
 if(input&&!errors.length){
  if(data.sourceStatus==='ready_unverified')add('source_unverified','Парсер оставил ограничения проверки. Оцените их влияние на правильность урока.');
  const scanned=ocrPages(input);
  if(scanned.length)add('source_ocr','Материал получен OCR. При проверке содержания сверьте важные даты, имена, формулы и связи в таблицах с подготовленными страницами.',{pages:scanned.map(p=>p.bookPage)});
  for(const idea of data.keyIdeas){
   const corpus=normalize(input.pages.filter(p=>idea.sourcePages.includes(p.bookPage)).map(p=>p.text).join(' '));
   if(!corpus.includes(normalize(idea.statement)))add('source_reconstruction','Формулировка или порядок материала отличаются от линейного извлечения. Исправление OCR, пересказ и восстановление таблицы допустимы: проверьте смысл, числа и связи по источнику. Само отличие не является ошибкой.',{ideaId:idea.id,sourcePages:idea.sourcePages});
  }
  if(data.source?.bibliography&&Object.entries(data.source.bibliography).some(([k,v])=>JSON.stringify(input.bibliography?.[k])!==JSON.stringify(v)))add('source_bibliography','Библиографические сведения отличаются от метаданных: проверьте атрибуцию по учебнику.');
 }
 return {ok:!errors.length,errors,observations,reviewRequired:observations.length>0};
}

export function sourceStageContract(input,brief,dir) {
 if(!input)return '';
 const shape={schemaVersion:2,lessonId:brief.id,sourceStatus:'ready',source:{pdfSha256:input.pdfSha256,sourceTopicId:input.topic.sourceId,pages:input.pages.map(p=>p.bookPage)},keyIdeas:[{id:'idea-01',statement:'Основная мысль раздела',sourcePages:[input.pages[0].bookPage]}],terms:[],workedExamples:[],gaps:[]};
 return 'Контракт этого задания имеет приоритет над примерами скилла. Сервер подготовил текст и изображения страниц: прочитай '+path.join(dir,'.local/source-input.json')+'. Запиши 01-Источник учебника.json по структуре '+JSON.stringify(shape)+'. Извлеки основные идеи, определения и нужные связи. Можно исправлять OCR, переформулировать и восстанавливать порядок строк/колонок таблицы при сохранении смысла. Буквальное совпадение с OCR и список посимвольных замен не требуются. Для восстановленного материала укажи в evidence или notes, что и по каким страницам восстановлено; дословной цитатой называй только дословный текст. Не выдумывай факты, страницы и хеш PDF. При наличии инструмента просмотра изображений используй PNG для спорных чисел и связей; если просмотра нет, честно запиши ограничения в gaps, не заявляй выполненную визуальную проверку. Смысловую правильность проверит независимый редактор; отличие от OCR само по себе не основание отклонять материал. Не создавай здесь главный урок. Сохрани корректный JSON, используй JSON.stringify для экранирования строк, не повторяй уже выполненную PDF/OCR-подготовку.';
}
