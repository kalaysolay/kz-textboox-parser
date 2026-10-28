import {randomBytes} from 'node:crypto';
import {buildExport,escapeHtml} from './core.mjs';

export function targetPreview(doc,lang,origin,token=0) {
  const nonce=randomBytes(18).toString('base64');
  const language=lang==='kk'?'kk':'ru';
  const safeToken=Number.isSafeInteger(token)?token:0;
  let html=buildExport(doc,language);
  // В предпросмотре локальные изображения читаются из того же manifest пакета.
  // В импорте эти ссылки по-прежнему заменяет сервер Damulab на свои asset URL.
  for(const asset of doc.assets) html=html.replaceAll(`src="asset://${escapeHtml(asset.id)}"`,`src="${origin}/api/lessons/${encodeURIComponent(doc.id)}/assets/${encodeURIComponent(asset.id)}"`);
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${origin}; style-src ${origin} 'unsafe-inline'; font-src ${origin}; img-src ${origin}; frame-src https://www.youtube.com; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(doc.title[language])}</title><link rel="stylesheet" href="${origin}/damulab/fonts.css"><link rel="stylesheet" href="${origin}/vendor/katex/katex.min.css"><link rel="stylesheet" href="${origin}/damulab/lecture-content.css">
<style>html{font-size:16px;color-scheme:light}body{margin:0;padding:32px;background:white}main{min-width:0}</style></head><body><main class="damulab-lecture">${html}</main>
<script nonce="${nonce}" src="${origin}/vendor/katex/katex.min.js"></script><script nonce="${nonce}" src="${origin}/damulab/lecture-content.js"></script>
<script nonce="${nonce}">DamulabLecture.render(document.querySelector('main'),{language:'${language}'});
const report=()=>parent.postMessage({type:'damulab-preview-size',token:${safeToken},height:Math.ceil(document.body.getBoundingClientRect().height)},'*');
new ResizeObserver(report).observe(document.body);document.fonts.ready.then(report);report();</script></body></html>`;
}
