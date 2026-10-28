// Explicit, opt-in integration check: this command makes a real model request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {loadAIConfig,parseAIConfig,publicAISelection} from './ai-config.mjs';
import {probeAI,runAIStage,stopAIProcess} from './ai-runtime.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),repo=path.dirname(HERE);
const {values}=parseArgs({options:{runtime:{type:'string'},model:{type:'string'},executable:{type:'string'},'reasoning-effort':{type:'string'},timeout:{type:'string',default:'180000'}}});
const config=values.runtime?parseAIConfig({runtime:values.runtime,model:values.model,...(values.executable?{executable:values.executable}:{}),...(values['reasoning-effort']?{reasoningEffort:values['reasoning-effort']}:{})},{baseDir:HERE}):await loadAIConfig();
const timeoutMs=Number(values.timeout);
if(!Number.isFinite(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw Error('timeout must be between 1000 and 600000 ms');
const root=path.join(HERE,'.local','cli-tests',randomUUID()),dir=path.join(root,config.runtime),refs=path.join(root,'refs');
await fs.mkdir(dir,{recursive:true});await fs.mkdir(refs,{recursive:true});
const input={ru:'История: причины и последствия. Проверка ё.',kk:'Тарих: ә ғ қ ң ө ұ ү һ і.'},bytes=JSON.stringify(input,null,2)+'\n';
await fs.writeFile(path.join(dir,'input.json'),bytes);
await fs.writeFile(path.join(refs,'SKILL.md'),'# Smoke skill\nRead input.json. Echo both language strings exactly. The skill marker is LESSON_STUDIO_SKILL_OK.\n');
const report={startedAt:new Date().toISOString(),selection:publicAISelection(config),checks:{},status:'running'};
let child,timedOut=false,timer,lastAction;
try{
 const runtime=await probeAI(config);report.cliVersion=runtime.version;
 if(!runtime.available)throw Object.assign(Error('CLI executable not available'),{code:'ai_missing'});
 console.log(`${config.runtime}: ${runtime.version}; ${config.model??'CLI default'}; running isolated read/write test`);
 timer=setTimeout(()=>{timedOut=true;stopAIProcess(child);},timeoutMs);
 await runAIStage({config,repo,key:'source',dir,externalSources:0,onSpawn:value=>{child=value;},onActivity:action=>{report.lastActivityAt=new Date().toISOString();if(action){report.lastAction=action;if(action!==lastAction)console.log(`[${config.runtime}] ${action}`);lastAction=action;}},prompt:`Это технический тест CLI, не генерация урока. Не вызывай других агентов, не коммить и не обращайся к сети. Прочитай ${path.join(refs,'SKILL.md')} и input.json в рабочем каталоге ${dir}. Создай result.json в этом каталоге: поля ru и kk должны точно совпадать с input.json; поле inputSha256 должно содержать SHA-256 реальных байтов input.json; поле skillMarker возьми из SKILL.md. Для SHA-256 можно использовать node или Get-FileHash. Нельзя менять исходный input.json или файлы за пределами рабочего каталога. После записи закончи работу.`});
 const actual=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
 report.checks={unicode:actual.ru===input.ru&&actual.kk===input.kk,sha256:actual.inputSha256?.toLowerCase()===createHash('sha256').update(bytes).digest('hex'),skill:actual.skillMarker==='LESSON_STUDIO_SKILL_OK',inputUnchanged:await fs.readFile(path.join(dir,'input.json'),'utf8')===bytes};
 if(!Object.values(report.checks).every(Boolean))throw Object.assign(Error('CLI result did not pass artifact checks'),{code:'artifact_invalid'});
 report.status='passed';
}catch(error){report.status='failed';report.errorCode=timedOut?'ai_timeout':error.code??'smoke_failed';report.message=timedOut?'CLI test timed out':error.status?error.message:'CLI smoke check failed; inspect artifact checks and account access.';process.exitCode=1;}
finally{clearTimeout(timer);report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));console.log(`Report: ${path.join(root,'report.json')}`);
