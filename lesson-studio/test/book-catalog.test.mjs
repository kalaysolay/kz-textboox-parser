import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {textbookCatalog,textbookTopics} from '../book-catalog.mjs';
import {LessonPipeline} from '../pipeline.mjs';

async function fixture(t){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-books-')),root=path.join(repo,'lessons');await fs.mkdir(root);
 t.after(()=>fs.rm(repo,{recursive:true,force:true}));
 const write=async(relative,content)=>{const file=path.join(repo,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof content==='string'?content:JSON.stringify(content));};
 return{repo,root,write,catalog:()=>textbookCatalog({repo,lessonsRoot:root})};
}
const book=(pdf,grade=4)=>({source:{file_name:pdf,version:'v2'},metadata:{grade,title:'Учебник',subject:'Математика'},topics_with_pages:[{lesson_no:1,topic_title:'Скорость и расстояние',page_start:7}]});

test('catalog uses BOM-safe metadata links and prefers current book over legacy and TOC artifacts',async t=>{
 const f=await fixture(t);await f.write('sources/математика/4 класс/Акпаева часть 1.pdf','pdf');
 const data=book('Акпаева часть 1.pdf');await f.write('parsed_outputs/математика/4 класс/math_v2.json','\uFEFF'+JSON.stringify(data));
 await f.write('parsed_outputs/математика/4 класс/math_legacy.json',{...data,source:{...data.source,version:'v1'}});
 await f.write('parsed_outputs/математика/4 класс/math_toc.json',{toc:[]});
 const books=await f.catalog();assert.equal(books.length,1);assert.match(books[0].parsedTextbookPath,/math_v2.json$/);assert.equal(books[0].grade,4);assert.equal(books[0].topics[0].pageStart,7);assert.equal(books[0].subjectKk,'Математика');
});

test('registry resolves renamed sources and metadata grade wins over PDF directory',async t=>{
 const f=await fixture(t);await f.write('sources/казахский язык/6 класс/Переименованный.pdf','pdf');
 const parsed='parsed_outputs/казахский язык/5 класс/book.json';await f.write(parsed,book('Старое название.pdf',5));
 await f.write('SOURCE_REGISTRY.md','| `sources/казахский язык/6 класс/Переименованный.pdf` | `'+parsed+'` |');
 const books=await f.catalog();assert.equal(books[0].status,'available');assert.equal(books[0].grade,5);
 assert.match(books[0].pdfTextbookPath,/Переименованный.pdf$/);
});

test('missing PDF stays visible but cannot launch an unchecked generation',async t=>{
 const f=await fixture(t);await f.write('parsed_outputs/математика/4 класс/book.json',book('Отсутствует.pdf'));
 const books=await f.catalog();assert.equal(books.length,1);assert.equal(books[0].status,'source_missing');assert.equal(books[0].topics.length,1);
 const pipeline=new LessonPipeline({repo:f.repo,lessonsRoot:f.root});
 await assert.rejects(pipeline.start({bookId:books[0].id,topicId:books[0].topics[0].id}),e=>e.code==='source_missing');
});

test('a complete parsed section remains available when PDF is absent',async t=>{
 const f=await fixture(t),doc=book('Отсутствует.pdf');doc.topics_with_pages[0].full_text='Полный текст раздела учебника.';
 await f.write('parsed_outputs/математика/4 класс/book.json',doc);
 const [selected]=await f.catalog();assert.equal(selected.status,'parsed_available');assert.equal(selected.topics[0].textAvailable,true);
});

test('topic selection excludes utility pages, keeps language and estimated page provenance, and has stable identity',()=>{
 const doc={metadata:{languages:['kk']},topics_with_pages:[{id:'cover',level:'front_matter',topic_title:'Мұқаба',page_start:1},{id:'a',level:'topic',topic_title:'Алғашқы адамдар',page_start:10,page_end_estimated:15},{id:'section',level:'section',topic_title:'Бөлім',page_start:3}]};
 const topics=textbookTopics(doc);assert.equal(topics.length,1);assert.equal(topics[0].titleKk,'Алғашқы адамдар');assert.equal(topics[0].titleRu,'');assert.equal(topics[0].pageEndEstimated,true);
 assert.equal(textbookTopics({...doc,topics_with_pages:doc.topics_with_pages.slice(1)})[0].id,topics[0].id);
});

test('selected textbook topic and pages reach the order without manual subject entry',async t=>{
 const f=await fixture(t);await f.write('sources/математика/4 класс/Акпаева.pdf','pdf');
 await f.write('parsed_outputs/математика/4 класс/math.json',book('Акпаева.pdf'));
 const pipeline=new LessonPipeline({repo:f.repo,lessonsRoot:f.root,prepareSource:async()=>null,runStage:async()=>{throw Error('fixture stage stopped');}});
 await pipeline.initialize();
 pipeline.available=async()=>({available:true,version:'fixture'});
 const selected=(await pipeline.books())[0];
 await assert.rejects(pipeline.start({bookId:selected.id,topicId:'unknown'}),e=>e.code==='topic_missing');
 const job=await pipeline.start({bookId:selected.id,topicId:selected.topics[0].id});
 for(let i=0;pipeline.running&&i<200;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(pipeline.running,null);
 const order=JSON.parse(await fs.readFile(path.join(pipeline.jobs.get(job.id).dir,'00-Заказ.json'),'utf8'));
 assert.equal(order.subjectKk,'Математика');assert.equal(order.topicRu,'Скорость и расстояние');assert.equal(order.textbookTopic.pageStart,7);assert.equal(order.textbookTopic.id,selected.topics[0].id);
});
