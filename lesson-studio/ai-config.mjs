import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const fields=new Set(['runtime','model','reasoningEffort','executable']);
const efforts=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
const invalid=message=>Object.assign(new Error(`ai.config.json: ${message}`),{status:422,code:'ai_config_invalid'});

export function legacyAIConfig(env=process.env) {
 return {runtime:'codex',model:null,configSource:'cli-default',executable:env.LESSON_STUDIO_CODEX_EXE||'codex'};
}

export function parseAIConfig(value,{baseDir=HERE,env=process.env}={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('ожидается объект JSON.');
 if(Object.keys(value).some(key=>!fields.has(key)))throw invalid('неизвестное поле. Допустимы runtime, model, reasoningEffort, executable.');
 const {runtime,model,reasoningEffort,executable}=value;
 if(!['codex','opencode'].includes(runtime))throw invalid('runtime должен быть codex или opencode.');
 if(typeof model!=='string'||model.length>250||!model||/[\s<>]/.test(model)||/PROVIDER_ID|MODEL_ID|YOUR_|PLACEHOLDER/i.test(model))throw invalid('model: укажите точный ID модели вместо пустой строки или заполнителя.');
 if(runtime==='opencode'?!/^[\w.-]+\/[\w./:+-]+(?:#[\w.-]+)?$/.test(model):!/^[\w./:+-]+$/.test(model))throw invalid('model: неверный формат ID модели. Для OpenCode нужен provider/model или provider/model#variant.');
 if(Object.hasOwn(value,'reasoningEffort')&&(runtime!=='codex'||!efforts.has(reasoningEffort)))throw invalid('reasoningEffort: допустим только для Codex; у OpenCode вариант задаётся как model#variant.');
 if(Object.hasOwn(value,'executable')&&typeof executable!=='string')throw invalid('executable: ожидается строка с путём или именем команды.');
 let command=executable??(runtime==='codex'?env.LESSON_STUDIO_CODEX_EXE:undefined)??runtime;
 if(typeof command!=='string'||!command.trim()||/[\r\n\0"]/.test(command)||command.startsWith('-'))throw invalid('executable: укажите путь или имя команды без аргументов и кавычек.');
 if(/[\\/]/.test(command)||path.isAbsolute(command))command=path.resolve(baseDir,command);
 else if(!/^[\w.-]+$/.test(command))throw invalid('executable: аргументы команды должны задаваться приложением.');
 return {runtime,model,...(reasoningEffort?{reasoningEffort}:{}),executable:command,configSource:'file'};
}

export async function loadAIConfig({configFile=path.join(HERE,'ai.config.json'),env=process.env}={}) {
 let text;
 try{text=await fs.readFile(configFile,'utf8');}catch(error){
  if(error.code==='ENOENT')return legacyAIConfig(env);
  throw invalid('не удалось прочитать файл. Проверьте доступ.');
 }
 if(Buffer.byteLength(text)>65536)throw invalid('файл слишком большой.');
 let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw invalid('некорректный JSON. Комментарии и завершающие запятые не поддерживаются.');}
 return parseAIConfig(value,{baseDir:path.dirname(configFile),env});
}

export async function runtimeExecutable(runtime,base,{env=process.env}={}) {
 if(runtime===base.runtime)return base.executable;
 if(runtime==='codex')return env.LESSON_STUDIO_CODEX_EXE||'codex';
 if(runtime==='opencode'&&env.LOCALAPPDATA){
  const installed=path.join(env.LOCALAPPDATA,'Programs','OpenCodeCLI','opencode.exe');
  try{await fs.access(installed);return installed;}catch{}
 }
 return runtime;
}

// Browser overrides select a CLI/model, never executable paths or credentials.
export async function orderAIConfig(base,override,{env=process.env}={}) {
 if(override===undefined)return base;
 const bad=message=>Object.assign(new Error('Настройки этого урока: '+message),{status:422,code:'ai_override_invalid'});
 if(!override||typeof override!=='object'||Array.isArray(override)||Object.keys(override).some(k=>!['runtime','model','reasoningEffort'].includes(k)))throw bad('допустимы только runtime, model и reasoningEffort.');
 if(!Object.keys(override).length)return base;
 const runtime=override.runtime??base.runtime;
 if(!['codex','opencode'].includes(runtime))throw bad('выберите Codex или OpenCode.');
 const model=override.model??(runtime===base.runtime?base.model:null);
 if(runtime!=='codex'&&override.reasoningEffort)throw bad('у OpenCode вариант задаётся в ID модели через #variant.');
 const effort=Object.hasOwn(override,'reasoningEffort')?override.reasoningEffort:runtime===base.runtime?base.reasoningEffort:undefined;
 try{
  const parsed=parseAIConfig({runtime,model,...(runtime==='codex'&&effort?{reasoningEffort:effort}:{}),executable:await runtimeExecutable(runtime,base,{env})},{env});
  return {...parsed,configSource:'order'};
 }catch(error){if(error.code==='ai_config_invalid')throw bad(error.message.replace(/^ai.config.json:\s*/,''));throw error;}
}

// Only this allowlist may leave local job state; never expose executable or CLI config.
export function publicAISelection(config) {
 return {runtime:config.runtime,model:config.model??null,...(config.reasoningEffort?{reasoningEffort:config.reasoningEffort}:{}),configSource:config.configSource??'legacy',...(config.cliVersion?{cliVersion:config.cliVersion}:{})};
}
