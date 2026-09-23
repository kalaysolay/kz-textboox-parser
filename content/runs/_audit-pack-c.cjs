const fs = require('fs');
const path = require('path');
const root = __dirname;
const runs = [
  ['C1','math-5-koordinatnyy-luch-20260808-1800'],
  ['C2','math-5-sravnenie-naturalnyh-chisel-20260808-1830'],
  ['C3','math-5-istor-sistemy-schisleniya-20260808-1900'],
  ['C4','math-5-slozhenie-vychitanie-naturalnyh-20260808-1930'],
  ['C5','math-5-umnozhenie-delenie-naturalnyh-20260808-2000'],
  ['C6','math-5-istor-arifmeticheskih-deystviy-20260808-2030'],
  ['C7','math-5-svoystva-arifmeticheskih-deystviy-20260808-2100'],
  ['C8','math-5-sposob-slozheniya-gaussa-20260808-2130'],
  ['C9','math-5-arifmeticheskie-deystviya-naturalnye-20260808-2200'],
  ['C10','math-5-chislovye-bukvennye-vyrazheniya-20260808-2230'],
  ['C11','math-5-uproshchenie-vyrazheniy-20260808-2300'],
];
function readJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ return {__err:String(e)}; } }
function exists(p){ return fs.existsSync(p); }
const out = [];
for (const [id,name] of runs) {
  const dir = path.join(root,name);
  const r = { id, name, dirExists: exists(dir), files:{} };
  for (const f of ['00-brief.json','01-source-slice.json','02-matrix.json','03-questions.draft.json','04-review.json','05-questions.final.json','06-illustrations.json']) {
    r.files[f.slice(0,2)] = exists(path.join(dir,f));
  }
  const slice = r.files['01'] ? readJson(path.join(dir,'01-source-slice.json')) : null;
  const matrix = r.files['02'] ? readJson(path.join(dir,'02-matrix.json')) : null;
  const review = r.files['04'] ? readJson(path.join(dir,'04-review.json')) : null;
  const finalQ = r.files['05'] ? readJson(path.join(dir,'05-questions.final.json')) : null;
  const ill = r.files['06'] ? readJson(path.join(dir,'06-illustrations.json')) : null;

  const qs = (finalQ && (finalQ.questions || finalQ.items)) || (Array.isArray(finalQ)?finalQ:[]);
  const tc = {SCQ:0,MCQ:0,FILL_IN:0,other:0};
  for (const q of qs) {
    const t = q.type || q.questionType || '?';
    if (tc[t]!=null) tc[t]++; else tc.other++;
  }
  r.qCount = Array.isArray(qs)?qs.length:0;
  r.typeCounts = tc;

  const summary = (review && review.summary) || {};
  r.accepted = summary.accepted ?? null;
  r.fixed = summary.fixed ?? null;
  r.rejected = summary.rejected ?? null;
  r.verdict = summary.verdict || (review && review.verdict) || null;
  r.rejectRate = summary.rejectRate ?? null;
  r.summary = summary;
  r.reviewTop = review && !review.__err ? Object.keys(review) : (review && review.__err);
  r.sourceReliability = slice && (slice.sourceReliability || (slice.meta&&slice.meta.sourceReliability) || (slice.quality&&slice.quality.sourceReliability)) || null;
  if (slice && !r.sourceReliability) {
    // search shallow
    for (const k of Object.keys(slice)) {
      if (/reliab/i.test(k)) r.sourceReliability = slice[k];
      if (slice[k] && typeof slice[k]==='object' && slice[k].sourceReliability) r.sourceReliability = slice[k].sourceReliability;
    }
  }
  r.sliceTop = slice && !slice.__err ? Object.keys(slice).slice(0,25) : slice;

  const slots = (matrix && (matrix.slots || matrix.questions)) || [];
  r.needIll = slots.filter(s => s.needsIllustration===true || s.illustration===true).length;
  r.slotSample = slots[0] ? Object.keys(slots[0]) : [];

  r.ill = {ready:0,blocked:[],missingSvg:[],missingPng:[],statuses:{},itemCount:0};
  if (ill && !ill.__err) {
    const items = ill.items || ill.illustrations || [];
    r.ill.itemCount = items.length;
    r.illTop = Object.keys(ill);
    r.illItemKeys = items[0] ? Object.keys(items[0]) : [];
    const illDir = path.join(dir,'illustrations');
    const onDisk = exists(illDir) ? fs.readdirSync(illDir) : [];
    r.illOnDisk = onDisk;
    for (const it of items) {
      const st = String(it.status||it.state||'?');
      r.ill.statuses[st]=(r.ill.statuses[st]||0)+1;
      const qid = it.questionId || it.slotId || it.id || it.localId || it.fileStem;
      if (/block/i.test(st)) {
        r.ill.blocked.push({id:qid, reason: it.blockReason||it.reason||it.notes||it.message||''});
      } else if (/ready|done|ok/i.test(st)) {
        r.ill.ready++;
        const stem = it.fileStem || qid;
        const svgCandidates = [];
        const pngCandidates = [];
        if (it.svgPath) svgCandidates.push(path.isAbsolute(it.svgPath)?it.svgPath:path.join(dir,it.svgPath));
        if (it.pngPath) pngCandidates.push(path.isAbsolute(it.pngPath)?it.pngPath:path.join(dir,it.pngPath));
        if (stem) {
          svgCandidates.push(path.join(illDir, stem+'.svg'));
          pngCandidates.push(path.join(illDir, stem+'.png'));
        }
        if (qid) {
          svgCandidates.push(path.join(illDir, qid+'.svg'));
          pngCandidates.push(path.join(illDir, qid+'.png'));
        }
        // also match any file containing qid
        const hasSvg = svgCandidates.some(p=>exists(p)) || onDisk.some(f=>f.endsWith('.svg') && String(qid)&&f.includes(String(qid)));
        const hasPng = pngCandidates.some(p=>exists(p)) || onDisk.some(f=>f.endsWith('.png') && String(qid)&&f.includes(String(qid)));
        if (!hasSvg) r.ill.missingSvg.push(qid);
        if (!hasPng) r.ill.missingPng.push(qid);
      }
    }
  } else if (ill && ill.__err) {
    r.illErr = ill.__err;
  }
  out.push(r);
}
fs.writeFileSync(path.join(root,'_audit-pack-c.json'), JSON.stringify(out,null,2));
console.log('wrote', out.length);
for (const r of out) {
  console.log(r.id, r.dirExists?'DIR':'MISSING', JSON.stringify(r.files), 'q='+r.qCount, JSON.stringify(r.typeCounts), 'acc/fix/rej=', r.accepted, r.fixed, r.rejected, 'verdict='+r.verdict, 'rr='+r.rejectRate, 'src='+r.sourceReliability, 'needIll='+r.needIll, '06='+r.files['06'], 'illReady='+r.ill.ready, 'blocked='+r.ill.blocked.length, 'missSvg='+r.ill.missingSvg.length, 'missPng='+r.ill.missingPng.length);
}
