import http from 'node:http';
import {randomBytes} from 'node:crypto';

// Чтение лекции и обычное воспроизведение не требуют устройств записи.
// Запрет наследуется вложенными фреймами, включая внешний плеер.
export const PREVIEW_PERMISSIONS='camera=(), microphone=(), display-capture=()';

// Отдельный origin позволяет YouTube работать со своим origin внутри sandbox.
// Здесь нет файлового/API-доступа: выдаются только уже собранные документы по
// случайным адресам. Даже код в preview не может прочитать API основной Мастерской.
export async function createPreviewHost() {
  const pages=new Map(),lifetime=10*60*1000,limit=16;
  const server=http.createServer((req,res)=>{
    const address=server.address();
    if(req.headers.host!==`127.0.0.1:${address.port}`) {res.writeHead(403);return res.end('Недопустимый адрес.');}
    if(req.method!=='GET') {res.writeHead(405,{'Allow':'GET'});return res.end();}
    const key=/^\/preview\/([a-f0-9]{48})$/.exec(req.url??'')?.[1];
    const page=key&&pages.get(key);
    if(!page||page.expires<Date.now()) {
      if(key)pages.delete(key);
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      return res.end('Предпросмотр устарел. Обновите его в Мастерской.');
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':PREVIEW_PERMISSIONS});
    res.end(page.html);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    put(html) {
      // Уборка по запросу без фонового таймера; живой документ уже загружен в iframe.
      for(const [key,page] of pages)if(page.expires<Date.now())pages.delete(key);
      while(pages.size>=limit)pages.delete(pages.keys().next().value);
      const key=randomBytes(24).toString('hex');pages.set(key,{html,expires:Date.now()+lifetime});
      return `${origin}/preview/${key}`;
    },
    close(){pages.clear();server.closeAllConnections();server.close();}
  };
}
