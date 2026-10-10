import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('dist/preview-host');
const [html, headersFile] = await Promise.all([
  readFile(resolve(root,'runner.html')),
  readFile(resolve(root,'_headers'),'utf8')
]);
const securityHeaders = Object.fromEntries(headersFile.split(/\r?\n/)
  .filter(line => line.startsWith('  ') && line.includes(': '))
  .map(line => {
    const index = line.indexOf(': ');
    return [line.slice(2,index),line.slice(index+2)];
  }));
if (!securityHeaders['Content-Security-Policy']?.includes('frame-ancestors ')) {
  throw new Error('Refusing to serve runner without frame-ancestors');
}
createServer((request,response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1:4174').pathname;
  if (path !== '/runner.html') {
    response.writeHead(404,{'content-type':'text/plain'}).end('Not found');
    return;
  }
  response.writeHead(200,{
    'content-type':'text/html; charset=utf-8',
    ...securityHeaders
  }).end(html);
}).listen(4174,'127.0.0.1',()=>console.log('Security-header runner fixture listening at 4174'));
