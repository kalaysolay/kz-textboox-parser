import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const array=v=>Array.isArray(v)?v:[];

// Read the selected parsed section once. Never launch PDF/OCR/LLM preparation.
export async function prepareParsedSource({brief,dir}) {
 if(!brief.textbookTopic?.sourceId||!brief.parsedTextbookPath)return null;
 const bytes=await fs.readFile(brief.parsedTextbookPath),doc=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 const id=brief.textbookTopic.sourceId;let topic;
 function find(items){for(const item of array(items)){if(item.id===id){topic=item;return;}find(item.lessons_detected);if(topic)return;}}
 find(doc.topics_with_pages);
 if(!topic||typeof topic.full_text!=='string'||!topic.full_text.trim()||topic.full_text_status?.truncated||topic.full_text_status?.available===false)return null;
 const first=topic.page_start??brief.textbookTopic.pageStart,last=topic.page_end??topic.page_end_estimated??brief.textbookTopic.pageEnd??first;
 const pages=array(topic.full_text_status?.source_pages).length?topic.full_text_status.source_pages:Array.from({length:Math.max(1,last-first+1)},(_,i)=>first+i);
 const belongs=item=>{
  const refs=[...array(item.topic_refs),item.topic_ref,item.topic_id].filter(Boolean);
  if(refs.length)return refs.includes(id);
  return [item.page,item.source_page,...array(item.source_pages)].some(p=>pages.includes(p));
 };
 const tasks=Array.isArray(doc.example_tasks_v2)?doc.example_tasks_v2:array(doc.example_tasks_v2?.textbook_tasks);
 const textbookTasks=tasks.filter(belongs).map((t,i)=>({id:t.task_id??t.id??'task-'+(i+1),question:t.question_text??t.statement??t.question??t.prompt,answerIfGiven:t.expected_answer_if_given??t.answer??null,page:t.page??t.source_page??first,type:t.task_type,notes:t.quality_notes??[],needsManualCheck:t.needs_manual_check??false})).filter(t=>t.question);
 const source={id:'textbook',type:'textbook',title:doc.metadata?.title??brief.topicRu,path:brief.parsedTextbookPath,sha256:sha(bytes),pages,bibliography:doc.metadata??{},usage:{ru:'Материал и задания выбранного раздела учебника',kk:'Оқулықтың таңдалған бөліміндегі материал мен тапсырмалар'}};
 const pack={schemaVersion:2,lessonId:brief.id,sourceStatus:'ready',inputMode:'parsed_json',source,topic:{id,title:topic.topic_title??brief.topicRu,pageStart:first,pageEnd:last,pageEndEstimated:topic.page_end==null},text:topic.full_text,textbookTasks,rules:array(doc.rules).filter(belongs),qualityNotes:topic.quality_notes??[],textStatus:topic.full_text_status??{},visualSourceRefs:topic.visual_source_refs??[],originalPdf:{path:brief.pdfTextbookPath??null,sha256FromMetadata:doc.source?.pdf_sha256??null},limitations:['Текст взят из готового разбора без повторного OCR. Оцените замечания к качеству; не додумывайте неясные факты.']};
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'01-Источник учебника.json'),JSON.stringify(pack,null,2));
 return pack;
}
