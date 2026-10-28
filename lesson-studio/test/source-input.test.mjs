import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSourceInput,sourceArtifactErrors,sourceStageContract,ocrLanguages} from '../source-input.mjs';

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

test('OCR language follows the textbook rather than the bilingual output',()=>{
 assert.deepEqual(ocrLanguages({languages:['ru']}),['rus']);
 assert.deepEqual(ocrLanguages({language:'Қазақша'}),['kaz']);
 assert.deepEqual(ocrLanguages({languages:['kk','ru']}),['kaz','rus']);
 assert.deepEqual(ocrLanguages(),['kaz','rus']);
});

test('OCR evidence requires page image hashes and explicit review, corrections retain a verbatim anchor',()=>{
 const raw='Средние века охватывают период с конца V в. до середины ХУП в.';
 const context={...input,pages:[{bookPage:16,method:'tesseract.js',pngSha256:'b'.repeat(64),ocrLanguages:['rus'],text:raw}]};
 const doc=valid();doc.keyIdeas[0].statement=raw;doc.verification={method:'ocr_with_visual_review',pages:[{bookPage:16,pngSha256:'b'.repeat(64),status:'checked',notes:'В верхнем абзаце проверены даты и римские цифры.'}]};doc.ocrInfo={languages:['rus']};
 assert.deepEqual(sourceArtifactErrors(doc,context,brief),[]);
 doc.keyIdeas[0]={...doc.keyIdeas[0],ocrQuote:raw,ocrCorrections:[{from:'ХУП',to:'XVII'}],statement:raw.replace('ХУП','XVII')};
 assert.deepEqual(sourceArtifactErrors(doc,context,brief),[]);
 for(const [change,code] of [
  [d=>{d.verification.pages=[];},'source_visual_required'],
  [d=>{d.verification.pages[0].pngSha256='invented';},'source_visual_required'],
  [d=>{d.verification.pages[0].notes='ЗАПОЛНИ ПО ПРОСМОТРУ PNG';},'source_visual_required'],
  [d=>{d.verification.method='pdf_text_layer';},'source_method'],
  [d=>{d.ocrInfo.languages=['kaz'];},'source_ocr_languages'],
  [d=>{d.ocrInfo.languages={};},'source_ocr_languages'],
  [d=>{d.keyIdeas[0].ocrCorrections=[{from:raw,to:'Новая выдуманная цитата'}];},'source_ocr_correction'],
  [d=>{d.keyIdeas[0].ocrQuote='Выдуманный оригинал OCR, которого нет на странице.';},'source_quote'],
 ]){const copy=structuredClone(doc);change(copy);assert.ok(sourceArtifactErrors(copy,context,brief).some(e=>e.code===code),code);}
 assert.match(sourceStageContract(context,brief,'lesson'),/открой все PNG/);
 assert.match(sourceStageContract(context,brief,'lesson'),/ready_unverified/);
});

async function scannedFixture(t,{ocrUsable=true,models=true}={}){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-ocr-'));t.after(()=>fs.rm(repo,{recursive:true,force:true}));
 const dir=path.join(repo,'lesson'),pdf=path.join(repo,'source.pdf'),parsed=path.join(repo,'parsed.json');await fs.mkdir(dir);await fs.writeFile(pdf,'pdf');
 await fs.writeFile(parsed,JSON.stringify({source:{pdf_page_mapping:{offset:2}},metadata:{languages:['ru']}}));if(models)await fs.writeFile(path.join(repo,'rus.traineddata'),'fixture');
 const png=path.join(repo,'page.png'),raw=path.join(repo,'text.json');await fs.writeFile(png,'png');await fs.writeFile(raw,JSON.stringify({raw_text:text,languages:['rus']}));
 const calls=[],messages=[];const hash=createHash('sha256').update('pdf').digest('hex');
 const runTool=async(exe,args)=>{calls.push(args);if(!args[0].endsWith('read-textbook-pages.js'))return;
  const out=args[args.indexOf('--out')+1],ocr=args.includes('--force-ocr');await fs.mkdir(out,{recursive:true});
  const pages=ocr?[{bookPage:17,pdfPage:19,textPath:raw,pngPath:png,source:'tesseract.js',candidateUsable:ocrUsable,quality:{ocrConfidence:72,flags:['ocr_confidence_review']}}]:[16,17].map(n=>({bookPage:n,pdfPage:n+2,textPath:raw,pngPath:png,source:'pdf_text_layer',candidateUsable:n===16}));
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({pdfSha256:hash,pages}));
 };
 const order={id:brief.id,parsedTextbookPath:parsed,pdfTextbookPath:pdf,textbookTopic:{sourceId:'s03',pageStart:16,pageEnd:17}};
 return {repo,dir,brief:order,runTool,calls,messages,onActivity:m=>messages.push(m)};
}

test('mixed PDF automatically OCRs only bad pages, preserving offsets, provenance and progress',async t=>{
 const f=await scannedFixture(t),result=await prepareSourceInput(f);
 assert.equal(f.calls.length,3);assert.equal(f.calls[2][f.calls[2].indexOf('--pages')+1],'17');
 assert.equal(f.calls[2][f.calls[2].indexOf('--lang')+1],'rus');
 assert.equal(result.pages[0].method,'pdf_text_layer');assert.equal(result.pages[0].requiresVisualReview,undefined);
 assert.equal(result.pages[1].method,'tesseract.js');assert.equal(result.pages[1].requiresVisualReview,true);assert.equal(result.pages[1].quality.ocrConfidence,72);
 assert.ok(f.messages.some(m=>m.includes('OCR rus')));assert.match(sourceStageContract(result,brief,f.dir),/mixed_with_visual_review/);
});

test('unusable OCR and missing models produce actionable errors and no prepared source',async t=>{
 for(const options of [{ocrUsable:false},{models:false}]){
  const f=await scannedFixture(t,options);
  await assert.rejects(prepareSourceInput(f),e=>e.code===(options.models===false?'source_ocr_model_missing':'source_ocr_unreadable'));
  await assert.rejects(fs.access(path.join(f.dir,'.local/source-input.json')));
 }
});

test('cancelled preparation does not start OCR; wrong page ranges cannot become ready',async t=>{
 const f=await scannedFixture(t);let cancelled=false;
 await assert.rejects(prepareSourceInput({...f,isCancelled:()=>cancelled,onSpawn:c=>{if(c===null&&f.calls.length===2)cancelled=true;}}));
 assert.equal(f.calls.length,2);
 const wrapped=f.runTool;await assert.rejects(prepareSourceInput({...f,runTool:async(exe,args)=>{await wrapped(exe,args);if(args[0].endsWith('read-textbook-pages.js')){const file=path.join(args[args.indexOf('--out')+1],'manifest.json'),m=JSON.parse(await fs.readFile(file,'utf8'));m.pages.pop();await fs.writeFile(file,JSON.stringify(m));}}}),e=>e.code==='source_pages');
});

test('OCR tool failures are actionable and timeout terminates the owned process',async t=>{
 const f=await scannedFixture(t),wrapped=f.runTool;
 await assert.rejects(prepareSourceInput({...f,runTool:async(exe,args)=>{if(args.includes('--force-ocr'))throw Error('private tool error');return wrapped(exe,args);}}),e=>e.code==='source_ocr_failed'&&!e.message.includes('private'));
 let killed=false;const child={exitCode:null,killed:false,kill(){killed=true;}};
 await assert.rejects(prepareSourceInput({...f,toolTimeoutMs:10,runTool:()=>{const pending=new Promise(()=>{});pending.child=child;return pending;}}),e=>e.code==='source_timeout');
 assert.equal(killed,true);
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
