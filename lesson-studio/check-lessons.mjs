import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateLesson} from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lessons');
const args = process.argv.slice(2);
const targets = args.filter(a => !a.startsWith('--'));
const write = !args.includes('--no-write');
async function find(dir) {
  const results = [];
  for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const p = path.join(dir,entry.name);
    if (entry.isDirectory()) results.push(...await find(p));
    else if (entry.name.endsWith('.lesson.json')) results.push(p);
  }
  return results;
}
const files=[];
for (const target of targets.length?targets:[root]) {
  const p=path.resolve(target), stat=await fs.stat(p);
  files.push(...(stat.isDirectory()?await find(p):[p]));
}
if (!files.length) { console.error('Файлы .lesson.json не найдены'); process.exitCode=1; }
for (const file of files) {
  let report;
  try {
    const raw=await fs.readFile(file,'utf8');
    const doc=JSON.parse(raw.replace(/^\uFEFF/,''));
    const result=validateLesson(doc);
    // Наличие источника в JSON не доказывает его фактическую доступность на диске.
    // Поэтому отдельно проверяем исходные PDF и байты, на которые ссылается пакет.
    for (const source of doc.sources||[]) {
      if (source.type!=='textbook') continue;
      const pdf=path.resolve(root,'..',source.path);
      try {
        if (!pdf.startsWith(path.resolve(root,'..')+path.sep)) throw new Error('Источник вне репозитория');
        const bytes=await fs.readFile(pdf);
        if (crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256) result.errors.push({code:'source_hash',message:`Изменился PDF ${source.id}`});
      } catch(e) { result.errors.push({code:'source_file',message:`Не удалось проверить ${source.id}: ${e.message}`}); }
    }
    for (const asset of doc.assets||[]) {
      try { const p=path.resolve(path.dirname(file),asset.path);if(!p.startsWith(path.dirname(file)+path.sep))throw new Error('Путь вне пакета');await fs.access(p); }
      catch { result.errors.push({code:'asset_file',message:`Не найден файл ${asset.id}`}); }
    }
    result.ok=result.errors.length===0;
    report={...result,lessonSha256:crypto.createHash('sha256').update(raw).digest('hex'),checkedAt:new Date().toISOString(),checker:'lesson-studio/core-v2',file:path.basename(file),limitations:['Совместимость с редактором и мобильным reader Дамулаб требует отдельного сквозного теста.','Веб-источники и естественность казахского проверяются редактором; этот скрипт не подтверждает их автоматически.']};
  } catch(e) { report={ok:false,errors:[{code:'file',message:e.message}],warnings:[],checkedAt:new Date().toISOString()}; }
  if(write) await fs.writeFile(path.join(path.dirname(file),'Проверка.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${report.ok?'PASS':'FAIL'} ${path.relative(root,file)}: ${report.stats?.blocks||0} блоков, ${report.stats?.formulasChecked||0} формул, ${report.stats?.arithmeticChecked||0} вычислений`);
  for(const error of report.errors) console.error(`  ${error.blockId||''} ${error.code}: ${error.message}`);
  if(!report.ok)process.exitCode=1;
}
