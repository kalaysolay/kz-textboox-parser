import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

test('копия рендерера не расходится с соседним checkout Damulab',async t=>{
 const here=path.dirname(fileURLToPath(import.meta.url));
 const root=path.resolve(process.env.DAMULAB_REPO_DIR??path.join(here,'../../../dlab'),'src/main/resources/static');
 try {await fs.access(root);} catch(error) {
  if(!process.env.DAMULAB_REPO_DIR&&error.code==='ENOENT'){t.skip('Автономная Мастерская: checkout Damulab отсутствует');return;}
  throw error;
 }
 const manifest=JSON.parse(await fs.readFile(path.join(here,'../public/damulab/manifest.json'),'utf8'));
 for(const entry of Object.values(manifest.files)) {
  const file=path.resolve(root,entry.source);
  assert.ok(!path.relative(root,file).startsWith('..')&&!path.isAbsolute(path.relative(root,file)));
  const hash=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  assert.equal(hash,entry.sha256,`Синхронизируйте ${entry.source}: pnpm sync:damulab`);
 }
});
