import path from 'node:path';
import {spawn} from 'node:child_process';
import {activityFromEvent,eventReader} from './generation-progress.mjs';
import {publicAISelection} from './ai-config.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{status:503,code});
const label=config=>config.runtime==='opencode'?'OpenCode':'Codex';

export function stopAIProcess(child,{spawnProcess=spawn,platform=process.platform}={}) {
 if(!child||child.exitCode!==null||child.killed)return;
 if(platform==='win32'&&child.pid){
  const killer=spawnProcess('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,shell:false,stdio:'ignore'});
  killer.on('error',()=>child.kill());
 }else child.kill('SIGTERM');
}

export function probeAI(config,{spawnProcess=spawn,timeoutMs=10000}={}) {
 return new Promise(resolve=>{
  let version='',settled=false,child,timer;
  const done=available=>{if(settled)return;settled=true;clearTimeout(timer);resolve({available,version:available?version.trim().slice(0,100):null,...publicAISelection(config)});};
  try{child=spawnProcess(config.executable,['--version'],{windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});}catch{return done(false);}
  child.stdout.on('data',c=>{version=(version+c).slice(0,500);});
  child.once('error',()=>done(false));child.once('close',code=>done(code===0));
  timer=setTimeout(()=>{stopAIProcess(child);done(false);},timeoutMs);timer.unref?.();
 });
}

export function opencodePermissions({repo,dir,key,externalSources=1}) {
 const normalized=p=>path.resolve(p).replaceAll('\\','/');
 const root=normalized(repo),workspace=normalized(dir);
 const rules=[
  {action:'*',resource:'*',effect:'deny'},
  ...['read','glob','grep','execute'].map(action=>({action,resource:'*',effect:'allow'})),
  {action:'external_directory',resource:`${root}/*`,effect:'allow'},
  {action:'external_directory',resource:`${workspace}/*`,effect:'allow'},
  // Internal paths are location-relative; explicit external paths are absolute.
  {action:'edit',resource:'*',effect:'allow'},
  ...['../*','/*','?:/*'].map(resource=>({action:'edit',resource,effect:'deny'})),
  {action:'edit',resource:`${workspace}/*`,effect:'allow'},
  ...['node *','python *','python3 *','pdftotext *','pdftoppm *','tesseract *','rg *','Get-Content *','Get-ChildItem *','Get-FileHash *','Test-Path *'].map(resource=>({action:'shell',resource,effect:'allow'})),
 ];
 if(externalSources>0){
  if(key==='research')rules.push({action:'websearch',resource:'*',effect:'allow'});
  if(['research','review'].includes(key))rules.push({action:'webfetch',resource:'*',effect:'allow'});
 }
 return rules;
}

export function stageCommand({config,repo,key,dir,externalSources,env=process.env}) {
 if(config.runtime==='codex')return {
  executable:config.executable,
  args:['-a','never',...(key==='research'&&externalSources!==0?['--search']:[]),'exec','--ephemeral','--json','--sandbox','workspace-write','-C',dir,...(config.model?['--model',config.model]:[]),...(config.reasoningEffort?['-c',`model_reasoning_effort=${JSON.stringify(config.reasoningEffort)}`]:[]),...(key==='source'?['--add-dir',path.join(repo,'ocr')]:[]),'-'],
  env,
 };
 let inherited={};
 if(env.OPENCODE_CONFIG_CONTENT){try{inherited=JSON.parse(env.OPENCODE_CONFIG_CONTENT);if(!inherited||typeof inherited!=='object'||Array.isArray(inherited))throw Error();}catch{throw fail('ai_config_invalid','OpenCode: OPENCODE_CONFIG_CONTENT должен содержать объект JSON.');}}
 const content={...inherited,agents:{...inherited.agents,'lesson-studio':{
  description:'Выполнить отдельный этап создания урока',mode:'primary',
  system:'Выполни задание отдельной роли. Записывай результат в указанные файлы. Не задавай интерактивных вопросов. Не запускай других агентов. Не меняй конфигурацию и код приложения. Если входных данных или инструментов недостаточно, сообщи об этом и не выдумывай результат.',
  permissions:opencodePermissions({repo,dir,key,externalSources}),
 }}};
 return {executable:config.executable,args:['run','--standalone','--format','json','--model',config.model,'--agent','lesson-studio'],env:{...env,OPENCODE_CONFIG_CONTENT:JSON.stringify(content)}};
}

// Inspect errors only to choose fixed messages; never return provider text or bodies.
export function runtimeError(runtime,error) {
 const name=runtime==='opencode'?'OpenCode':'Codex';
 const type=String(error?.type??error?.code??''),status=error?.status??error?.statusCode;
 const message=typeof error?.message==='string'?error.message:'';
 if(status===402||/provider\.quota|insufficient.*fund|insufficient_quota/i.test(type+' '+message))return fail('ai_quota',`${name}: недостаточно средств или исчерпана квота. Проверьте аккаунт поставщика.`);
 if(status===429||/free.limit|rate.limit|usage.limit|limit.reached/i.test(type+' '+message))return fail('ai_limit',`${name}: исчерпан лимит запросов. Восстановите доступ и продолжите этот заказ.`);
 if(status===401||status===403||/auth|credential|unauthorized|forbidden/i.test(type))return fail('ai_auth',`${name}: требуется вход или доступ к выбранной модели. Проверьте авторизацию CLI.`);
 if(/model.*(?:not.found|unavailable|unsupported|not.supported)|unknown.model|variant.*(?:not.found|unavailable|unsupported|unknown)/i.test(type+' '+message))return fail('ai_model',`${name}: выбранная модель или её вариант недоступны. Проверьте точный ID и доступ аккаунта.`);
 return fail('ai_failed',`${name} не завершил этап. Проверьте доступ к модели, лимит и артефакты; затем продолжите заказ.`);
}

export function opencodeActivity(event) {
 if(event.type==='step_start')return {action:'Агент начал работу'};
 if(event.type==='step_finish')return {action:'Агент завершил шаг; ожидается результат процесса'};
 if(event.type==='text')return {action:'Агент подводит итог этапа'};
 if(event.type==='reasoning')return {action:null};
 if(event.type==='error')return {action:'Агент сообщил об ошибке; ожидается результат процесса'};
 if(event.type!=='tool_use')return null;
 const part=event.part??{},tool=part.tool??'',state=part.state??{};
 if(state.status==='error')return {action:'Инструмент сообщил об ошибке; агент проверяет результат'};
 if(/write|edit|patch/.test(tool))return {action:'Сохранил рабочие файлы этапа'};
 if(/websearch|webfetch/.test(tool))return {action:'Проверяет внешний источник'};
 if(/read|glob|grep/.test(tool))return {action:'Читает входные файлы этапа'};
 return {action:'Выполняет инструмент этапа'};
}

export function runAIStage({config,repo,key,prompt,dir,externalSources=1,onSpawn=()=>{},onActivity=()=>{},spawnProcess=spawn,env=process.env}) {
 return new Promise((resolve,reject)=>{
  let command;try{command=stageCommand({config,repo,key,dir,externalSources,env});}catch(error){reject(error);return;}
  let child;try{child=spawnProcess(command.executable,command.args,{cwd:dir,env:command.env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{reject(fail('ai_missing',`${label(config)} CLI не найден или недоступен.`));return;}
  onSpawn(child);onActivity('Процесс агента запущен; ожидается первый ответ');
  let terminalError=null,finished=false,stderr='';
  const reader=eventReader(({action})=>onActivity(action),1024*1024,event=>{
   if(event.type==='error'||event.type==='turn.failed')terminalError=runtimeError(config.runtime,event.error??event);
   if(config.runtime==='codex'&&event.type==='turn.completed')finished=true;
   if(config.runtime==='opencode'&&event.type==='step_finish')finished=true;
   return config.runtime==='opencode'?opencodeActivity(event):activityFromEvent(event);
  });
  child.stdout.on('data',chunk=>reader.write(chunk));child.stdout.once('end',()=>reader.end());
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
  child.once('error',()=>reject(fail('ai_missing',`${label(config)} CLI не найден или недоступен.`)));
  child.once('close',code=>{
   reader.end();
   if(terminalError)return reject(terminalError);
   if(code!==0)return reject(runtimeError(config.runtime,{message:stderr}));
   if(!finished)return reject(fail('ai_incomplete',`${label(config)} завершился без подтверждения окончания ответа. Проверьте доступ к модели и повторите этап.`));
   resolve();
  });
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
 });
}
