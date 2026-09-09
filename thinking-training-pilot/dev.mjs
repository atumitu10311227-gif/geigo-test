import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHandler } from './server/engine.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';
export function startDev({port=Number(process.env.PORT||3000),handler=createHandler()}={}){
  const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(url.pathname==='/api/ai'){
        const init={method:req.method,headers:req.headers};
        if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
        const r=await handler(new Request(url,init));
        res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
      }
      const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      const full=path.resolve(publicRoot,filename);
      if(!full.startsWith(publicRoot)||!['index.html','app.js','data.js','styles.css'].includes(filename)){res.writeHead(404);res.end('Not found');return;}
      const data=await readFile(full);res.writeHead(200,{'content-type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data);
    }catch{res.writeHead(500);res.end('Local server error');}
  });
  server.listen(port,'127.0.0.1',()=>console.log(`Local pilot: http://127.0.0.1:${server.address().port}`));return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))startDev();
