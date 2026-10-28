import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSourceInput,sourceArtifactErrors,sourceStageContract} from '../source-input.mjs';

const text='Древние люди переходили от собирательства и охоты к земледелию и скотоводству.';
const input={pdfSha256:'a'.repeat(64),topic:{sourceId:'s03'},pages:[{bookPage:16,pdfPage:16,text}]},brief={id:'lesson-test'};
const valid=()=>({schemaVersion:2,lessonId:brief.id,sourceStatus:'ready',source:{pdfSha256:input.pdfSha256,sourceTopicId:'s03',pages:[16]},verification:{method:'pdf_text_layer'},keyIdeas:[{id:'idea-01',statement:text,sourcePages:[16]}]});

test('source validation rejects invented evidence, page claims and altered quotations',()=>{
 assert.deepEqual(sourceArtifactErrors(valid(),input,brief),[]);
 assert.equal(sourceArtifactErrors(null,input,brief)[0].code,'source_format');
 for(const [change,code] of [
  [d=>{d.source.pdfSha256='verified_against_png';},'source_hash'],
  [d=>{d.title={kk:'invented translation'};},'source_format'],
  [d=>{d.source.sourceTopicId='other';},'source_topic'],
  [d=>{d.source.bibliography={year:2099};},'source_bibliography'],
  [d=>{d.source.pages=[17];},'source_pages'],
  [d=>{d.verification.method='png_comparison';},'source_method'],
  [d=>{d.visuallyVerified=true;},'source_visual_claim'],
  [d=>{d.keyIdeas[0].statement='Древние люди逐渐 переходили от собирательства и охоты.';},'source_quote'],
  [d=>{d.keyIdeas[0].sourcePages=[17];},'source_idea'],
 ]){const d=valid();change(d);assert.ok(sourceArtifactErrors(d,input,brief).some(e=>e.code===code),code);}
});

test('quote checks tolerate typography and line wrapping without accepting paraphrases',()=>{
 const context={...input,pages:[{bookPage:16,text:'Человек использовал зерно-\nтёрку — каменное орудие.'}]};
 const d=valid();d.keyIdeas[0].statement='Человек использовал зернотёрку - каменное орудие.';
 assert.deepEqual(sourceArtifactErrors(d,context,brief),[]);
 d.keyIdeas[0].statement='Человек использовал металлическую зернотёрку.';
 assert.ok(sourceArtifactErrors(d,context,brief).some(e=>e.code==='source_quote'));
});

test('quote normalization preserves the meaning of date ranges, decimals and fractions',()=>{
 for(const [original,changed] of [['Период охватывает 5–3 тысячи лет до нашей эры.','Период охватывает 53 тысячи лет до нашей эры.'],['Расстояние составляет 1,5 километра.','Расстояние составляет 15 километра.'],['Доля урожая составляет 1/2 от общего.','Доля урожая составляет 12 от общего.']]){
  const context={...input,pages:[{bookPage:16,text:original}]},doc=valid();doc.keyIdeas[0].statement=changed;
  assert.ok(sourceArtifactErrors(doc,context,brief).some(e=>e.code==='source_quote'));
 }
});

test('preparation runs shared tools without shell quoting and binds text to real PDF bytes',async t=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-source-'));t.after(()=>fs.rm(repo,{recursive:true,force:true}));
 const dir=path.join(repo,'lesson with spaces'),pdf=path.join(repo,'source.pdf'),parsed=path.join(repo,'parsed.json');await fs.mkdir(dir);
 await fs.writeFile(pdf,'fixture pdf');await fs.writeFile(parsed,JSON.stringify({source:{pdf_page_mapping:{offset:0}},metadata:{title:'Book'}}));
 const png=path.join(repo,'page.png'),page=path.join(repo,'page.json');await fs.writeFile(png,'fixture png');await fs.writeFile(page,JSON.stringify({raw_text:text}));
 const calls=[],spawned=[],child={pid:1234};const runTool=(executable,args,options)=>{const result=(async()=>{calls.push({executable,args,options});if(args[0].endsWith('read-textbook-pages.js')){const out=args[args.indexOf('--out')+1];await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({pdfSha256:createHash('sha256').update('fixture pdf').digest('hex'),pages:[{bookPage:16,pdfPage:16,textPath:page,pngPath:png,source:'pdf_text_layer'}]}));}})();result.child=child;return result;};
 const order={parsedTextbookPath:parsed,pdfTextbookPath:pdf,textbookTopic:{sourceId:'s03',pageStart:16,pageEnd:16}};
 const result=await prepareSourceInput({repo,dir,brief:order,runTool,onSpawn:child=>spawned.push(child)});
 assert.equal(calls.length,2);assert.equal(calls[0].executable,process.execPath);assert.equal(calls[1].args[calls[1].args.indexOf('--pdf')+1],pdf);
 assert.equal(result.pages[0].text,text);assert.equal(result.pages[0].pngSha256,createHash('sha256').update('fixture png').digest('hex'));
 assert.deepEqual(spawned,[child,null,child,null]);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'.local/source-input.json'),'utf8')).pdfSha256,result.pdfSha256);
 assert.match(sourceStageContract(result,brief,dir),/source-input\.json/);
 calls.length=0;let cancelled=false;
 await assert.rejects(prepareSourceInput({repo,dir,brief:order,runTool,isCancelled:()=>cancelled,onSpawn:child=>{if(child===null)cancelled=true;}}),e=>e.code==='source_preparation');
 assert.equal(calls.length,1,'a cancelled preparation must not start its second subprocess');
});
