import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Пакет накладывается на существующий репозиторий с учебниками. Кэши OCR,
// node_modules, авторизация, тестовые jobs и сопоставления серверов исключены.
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowedRoot=path.join(repo,'lesson-studio/.local');
const output=path.resolve(process.argv[2]??path.join(allowedRoot,'release-'+new Date().toISOString().replace(/[:.]/g,'-')));
const inside=(root,file)=>file.startsWith(root+path.sep);
if(!inside(allowedRoot,output))throw Error('Каталог выпуска должен находиться внутри lesson-studio/.local.');
await fs.mkdir(output,{recursive:false});
const destination=path.join(output,'source');await fs.mkdir(destination);
const entries=[];
async function copy(relative){
 const from=path.join(repo,relative),stat=await fs.lstat(from);
 if(stat.isSymbolicLink())throw Error('Симлинк в составе выпуска: '+relative);
 if(stat.isDirectory()){
  for(const entry of await fs.readdir(from)){if(entry.startsWith('.')||entry==='node_modules'||(relative==='lesson-studio'&&entry==='ai.config.json'))continue;await copy(path.join(relative,entry));}
 }else if(stat.isFile()){
  const bytes=await fs.readFile(from),to=path.join(destination,relative);
  await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes);
  entries.push({path:relative.split(path.sep).join('/'),sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
 }
}
for(const file of ['.gitignore','README.md','LECTURE_PIPELINE.md','lesson-studio','lessons','.agents/skills/damulab-lecture-pipeline',...['pipeline','parser','planner','generator','reviewer'].map(role=>`.cursor/skills/damulab-lecture-${role}`)])await copy(file);
// Каталог может использовать явные связи переименованных PDF из этого реестра.
if(await fs.access(path.join(repo,'SOURCE_REGISTRY.md')).then(()=>true,()=>false))await copy('SOURCE_REGISTRY.md');
entries.sort((a,b)=>a.path.localeCompare(b.path));
const prerequisites=[];
for(const order of entries.filter(e=>e.path.endsWith('/00-Заказ.json'))){
 const brief=JSON.parse(await fs.readFile(path.join(repo,order.path),'utf8'));
 for(const key of ['parsedTextbookPath','pdfTextbookPath']){
  const relative=brief[key];if(!relative||prerequisites.some(p=>p.path===relative))continue;
  const file=path.resolve(repo,relative);if(!inside(repo,file))throw Error('Учебник вне репозитория.');
  const bytes=await fs.readFile(file);
  // Эти файлы копируются только для проверки пакета; в доставляемый overlay
  // не входят. Они уже хранятся в базовом репозитории с учебниками.
  const to=path.join(destination,relative);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes);
  prerequisites.push({path:relative,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
 }
}
const manifest={kind:'damulab.lesson-studio-local-overlay',createdAt:new Date().toISOString(),baseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceDirectory:destination,requiresExistingParserRepository:true,entries,prerequisites,excluded:['.local/**','node_modules/**','ocr/**','lesson-studio/ai.config.json','unrelated parser/source changes']};
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,files:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0),prerequisites:prerequisites.length}));
