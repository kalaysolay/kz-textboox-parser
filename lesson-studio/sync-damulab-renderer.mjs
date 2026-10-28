import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
// В репозитории Damulab находится единственный редактируемый источник.
// Мастерская содержит точную переносимую копию и работает без запущенного Spring.
const source=path.resolve(process.env.DAMULAB_REPO_DIR??path.join(here,'../../dlab'),'src/main/resources/static');
const files={
  'js/lecture-content.js':'damulab/lecture-content.js',
  'css/lecture-content.css':'damulab/lecture-content.css',
  'css/fonts.css':'damulab/fonts.css',
  'fonts/manrope/Manrope-wght.ttf':'fonts/manrope/Manrope-wght.ttf',
  'fonts/nunito/Nunito-wght.ttf':'fonts/nunito/Nunito-wght.ttf'
};
const manifest={version:'2.0.1',source:'dlab/src/main/resources/static',files:{}};
const check=process.argv.includes('--check');
for(const [from,to] of Object.entries(files)) {
  const bytes=await fs.readFile(path.join(source,from));
  const target=path.join(here,'public',to);
  manifest.files[to]={source:from,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(check) {
    if(!bytes.equals(await fs.readFile(target))) throw new Error(`Обновите общий рендерер: ${to}`);
  } else {await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
}
const serialized=JSON.stringify(manifest,null,2)+'\n';
const manifestPath=path.join(here,'public/damulab/manifest.json');
if(check) {if(await fs.readFile(manifestPath,'utf8')!==serialized) throw new Error('Манифест рендерера устарел');}
else await fs.writeFile(manifestPath,serialized);
console.log(check?'Общий рендерер совпадает с Damulab.':'Общий рендерер и шрифты синхронизированы.');
