import { performance } from 'node:perf_hooks';
import { buildDocument } from '../dist/document.js';

const sample = (size) => {
  const line = '<article class="panel"><h2>Component</h2><p>Interactive sample</p></article>';
  const html = '<!doctype html><html><head><title>Benchmark</title></head><body>' +
    line.repeat(Math.ceil(size / line.length)) + '</body></html>';
  return { html, css: '.panel{display:grid;gap:8px}', javascript: 'console.log("ok")' };
};

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
const cases = [
  { name: 'small', bytes: 1024, iterations: 250 },
  { name: 'medium', bytes: 32 * 1024, iterations: 100 },
  { name: 'large', bytes: 256 * 1024, iterations: 30 }
];

console.log('Document assembly benchmark (Node, excludes browser rendering and iframe startup)');
for (const workload of cases) {
  const files = sample(workload.bytes);
  for (let i = 0; i < 5; i++) buildDocument(files, 'benchmark', i + 1);
  const elapsed = [];
  for (let i = 0; i < workload.iterations; i++) {
    const start = performance.now();
    const result = buildDocument(files, 'benchmark', i + 10);
    elapsed.push(performance.now() - start);
    if (!result.includes('Content-Security-Policy')) throw new Error('Assembly dropped CSP');
  }
  console.log(JSON.stringify({
    workload: workload.name,
    inputBytes: Buffer.byteLength(files.html),
    iterations: workload.iterations,
    medianMs: Number(percentile(elapsed, 0.5).toFixed(3)),
    p95Ms: Number(percentile(elapsed, 0.95).toFixed(3)),
    worstMs: Number(Math.max(...elapsed).toFixed(3))
  }));
}
