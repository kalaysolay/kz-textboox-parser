import {StringDecoder} from 'node:string_decoder';

// Only fixed labels leave this module. No command text, tool output, messages
// or reasoning is exposed or persisted.
export function activityFromEvent(event) {
 if(!event||!['thread.started','turn.started','turn.completed','turn.failed','error','item.started','item.updated','item.completed'].includes(event.type))return null;
 if(event.type==='thread.started')return {action:'Агент подключён; подготавливает этап'};
 if(event.type==='turn.started')return {action:'Агент начал работу'};
 if(event.type==='turn.completed')return {action:'Агент закончил работу; ожидается завершение процесса'};
 if(['turn.failed','error'].includes(event.type))return {action:'Агент сообщил об ошибке; ожидается результат процесса'};
 const item=event.item??{},done=event.type==='item.completed';
 if(item.type==='command_execution') {
  if(done)return {action:item.exit_code!=null&&item.exit_code!==0?'Команда завершилась с ошибкой; агент проверяет результат':'Команда выполнена; агент готовит следующий шаг'};
  const command=typeof item.command==='string'?item.command:'';
  if(/read-textbook-pages/.test(command))return {action:'Извлекает и проверяет страницы учебника'};
  if(/textbook-nav/.test(command))return {action:'Находит выбранную тему в учебнике'};
  if(/select-textbook/.test(command))return {action:'Читает материал выбранного раздела'};
  if(/tesseract|--ocr\b/i.test(command))return {action:'Распознаёт текст страниц'};
  return {action:'Выполняет рабочую команду'};
 }
 if(item.type==='mcp_tool_call') {
  if(done)return {action:'Инструмент завершил работу; агент проверяет результат'};
  const tool=typeof item.tool==='string'?item.tool:'';
  if(/view_image|image|screenshot/.test(tool))return {action:'Просматривает изображения страниц'};
  if(/search|browse|web/.test(tool))return {action:'Проверяет внешний источник'};
  return {action:'Выполняет инструмент этапа'};
 }
 if(item.type==='file_change')return {action:done?'Сохранил рабочие файлы этапа':'Записывает рабочие файлы этапа'};
 if(item.type==='web_search')return {action:done?'Получил результаты поиска':'Ищет дополнительный источник'};
 if(item.type==='agent_message')return {action:'Агент подводит итог этапа'};
 // Reasoning and unknown items count only as a signal that the CLI responded.
 return {action:null};
}

// Bounded JSONL reader, including split UTF-8 characters and oversized lines.
export function eventReader(onEvent,maxLength=1024*1024,mapEvent=activityFromEvent) {
 const decoder=new StringDecoder('utf8');let pending='',discard=false;
 function accept(text) {
  for(const part of text.split(/(?<=\n)/)) {
   if(!discard)pending+=part;
   if(pending.length>maxLength){pending='';discard=true;}
   if(part.endsWith('\n')) {
    if(!discard){try{const activity=mapEvent(JSON.parse(pending));if(activity)onEvent(activity);}catch{}}
    pending='';discard=false;
   }
  }
 }
 return {write:chunk=>accept(decoder.write(chunk)),end:()=>{accept(decoder.end());if(pending&&!discard)accept('\n');}};
}

export function progressSnapshot(job,child,now=Date.now()) {
 const running=job.status==='running',end=Date.parse(job.stageFinishedAt??job.finishedAt??'');
 const started=Date.parse(job.stageStartedAt??'');
 const lastActivityAt=job.lastActivityAt??job.completed?.at(-1)?.completedAt??null;
 const last=Date.parse(lastActivityAt??'');
 return {
  totalDurationMs:Number.isFinite(job.activeDurationMs)?job.activeDurationMs+(running&&job.runStartedAt?Math.max(0,now-Date.parse(job.runStartedAt)):0):null,
  processAlive:running&&!!child&&child.exitCode===null&&!child.killed,
  stageDurationMs:Number.isFinite(started)?Math.max(0,(running?now:Number.isFinite(end)?end:started)-started):null,
  lastActivityAt,
  idleMs:Number.isFinite(last)?Math.max(0,(running?now:Number.isFinite(end)?end:last)-last):null,
  quiet:running&&Number.isFinite(last)&&now-last>=120000,
 };
}
