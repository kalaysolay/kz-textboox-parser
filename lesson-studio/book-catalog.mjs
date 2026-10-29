import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const digest=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>typeof s==='string'?s.trim():'';
const subjectNames={'математика':'Математика','история казахстана':'Қазақстан тарихы','всемирная история':'Дүниежүзі тарихы','казахский язык':'Қазақ тілі','русская литература':'Орыс әдебиеті','алтын сака':'Алтын сақа'};
async function walk(root,pattern,out=[]){
 for(const e of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])){
  if(e.isSymbolicLink()||e.name.startsWith('.'))continue;
  const file=path.join(root,e.name);if(e.isDirectory())await walk(file,pattern,out);else if(e.isFile()&&pattern.test(e.name))out.push(file);
 }return out;
}
const readJson=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));

// Сохраняем язык оригинального заголовка и указанные страницы. Оценённая граница
// не становится подтверждённой страницей только из-за появления в форме заказа.
export function textbookTopics(doc){
 const result=[],kkOnly=doc.metadata?.languages?.length===1&&doc.metadata.languages[0]==='kk';
 function add(t,parentTitle=null,nested=false){
  const generic=clean(t.topic_title??t.title),titleRu=clean(t.topic_title_ru??t.title_ru)||(!kkOnly?generic:''),titleKk=clean(t.topic_title_kk??t.title_kk)||(kkOnly?generic:'');
  const title=titleRu||titleKk,start=Number(t.page_start??t.source_page);
  if(!title||!Number.isInteger(start)||start<1)return;
  const end=Number(t.page_end??t.page_end_estimated),level=t.level??(nested?'lesson':'topic');
  if(!nested&&!['topic','lesson','paragraph'].includes(level))return;
  result.push({id:digest(JSON.stringify([t.id??null,title,start,Number.isInteger(end)?end:null,parentTitle])).slice(0,24),title,titleRu,titleKk,pageStart:start,pageEnd:Number.isInteger(end)&&end>=start?end:null,pageEndEstimated:t.page_end==null&&t.page_end_estimated!=null,sourceId:t.id??null,lessonNo:t.lesson_no??t.lesson_range??null,parentTitle,confidence:t.confidence??null,textAvailable:typeof t.full_text==='string'&&!!t.full_text.trim()&&!t.full_text_status?.truncated&&t.full_text_status?.available!==false});
 }
 for(const t of (Array.isArray(doc.topics_with_pages)?doc.topics_with_pages:[])){
  add(t);
  for(const child of (Array.isArray(t.lessons_detected)?t.lessons_detected:[]))add(child,clean(t.topic_title??t.topic_title_kk)||null,true);
 }return result;
}

export async function textbookCatalog({repo,lessonsRoot}){
 const parsedRoot=path.join(repo,'parsed_outputs'),pdfRoot=path.join(repo,'sources');
 const [parsed,pdfs,orders]=await Promise.all([walk(parsedRoot,/\.json$/i),walk(pdfRoot,/\.pdf$/i),walk(lessonsRoot,/^00-Заказ\.json$/)]);
 const known=new Map();
 // Реестр служит явной связью для переименованных исходников; абсолютные пути из
 // JSON/Markdown допускаются только если файл реально найден внутри sources.
 const registry=await fs.readFile(path.join(repo,'SOURCE_REGISTRY.md'),'utf8').catch(()=>'');
 for(const line of registry.split(/\r?\n/)){
  const refs=[...line.matchAll(/`([^`]+)`/g)].map(m=>m[1]);
  const pdf=refs.find(p=>/^sources\//.test(p)&&/\.pdf$/i.test(p));
  for(const file of refs.filter(p=>/^parsed_outputs\//.test(p)&&/\.json$/i.test(p)))if(pdf)known.set(path.resolve(repo,file),path.resolve(repo,pdf));
 }
 for(const file of orders){try{const o=await readJson(file);if(o.parsedTextbookPath&&o.pdfTextbookPath&&!known.has(path.resolve(repo,o.parsedTextbookPath)))known.set(path.resolve(repo,o.parsedTextbookPath),path.resolve(repo,o.pdfTextbookPath));}catch{}}
 const books=[];
 for(const file of parsed){
  let doc;try{doc=await readJson(file);}catch{continue;}
  // TOC sidecars, наборы сгенерированных задач и подобные артефакты — не книги.
  if(!doc.metadata||!doc.source||!Array.isArray(doc.topics_with_pages))continue;
  const relative=path.relative(parsedRoot,file),parts=relative.split(path.sep),grade=Number(doc.metadata.grade??parts.find(p=>/^\d+\s*класс/u.test(p))?.match(/^\d+/)?.[0]);
  if(!Number.isInteger(grade)||grade<1||grade>12)continue;
  const subjectRu=parts[0],filename=clean(doc.source.file_name).normalize('NFC').toLowerCase();
  const matches=pdfs.filter(p=>path.basename(p).normalize('NFC').toLowerCase()===filename&&path.relative(pdfRoot,p).split(path.sep)[0]===subjectRu);
  const registered=known.get(file);
  const pdf=matches.length===1?matches[0]:registered&&pdfs.includes(registered)?registered:null;
  const topics=textbookTopics(doc),version=Number(String(doc.source.version??file.match(/_v(\d+)\.json$/i)?.[1]??0).replace(/^v/i,''))||0;
  const title=clean(doc.metadata.title)||clean(doc.source.file_name)||path.basename(file,'.json');
  const parsedAvailable=topics.some(t=>t.textAvailable);
  books.push({id:digest(file).slice(0,24),title,part:doc.metadata.part??null,authors:Array.isArray(doc.metadata.authors)?doc.metadata.authors:[],subjectRu,subjectKk:subjectNames[subjectRu]??'',grade,parsedTextbookPath:file,pdfTextbookPath:pdf,sourceFileName:pdf?path.basename(pdf):clean(doc.source.file_name),status:pdf?'available':parsedAvailable?'parsed_available':'source_missing',topics,version,qualityNote:clean(doc.source.quality_report?.note),warnings:pdf?[]:[parsedAvailable?'PDF не найден; доступны темы с готовым текстом JSON.':'Исходный PDF и готовый текст разделов не найдены.']});
 }
 // Выбираем актуальную версию одного PDF, но разные части/учебники не объединяем.
 const latest=new Map();
 for(const book of books){const key=book.pdfTextbookPath??`${book.subjectRu}/${book.grade}/${book.sourceFileName||book.parsedTextbookPath}`;const prior=latest.get(key);if(!prior||book.version>prior.version)latest.set(key,book);}
 return [...latest.values()].sort((a,b)=>a.subjectRu.localeCompare(b.subjectRu,'ru')||a.grade-b.grade||a.sourceFileName.localeCompare(b.sourceFileName,'ru'));
}
