const fs = require('fs');
const md = fs.readFileSync('_batch-math5-ch3-6-20260808.md', 'utf8');
const markers = ['Пачка C', 'ПачкаC', 'Pack C', '# Пачка C'];
for (const m of markers) {
  console.log(m, md.indexOf(m));
}
// also search run ids
const runs = [
  'math-5-koordinatnyy-luch-20260808-1800',
  'math-5-sravnenie-naturalnyh-chisel-20260808-1830',
  'math-5-istor-sistemy-schisleniya-20260808-1900',
  'math-5-slozhenie-vychitanie-naturalnyh-20260808-1930',
  'math-5-umnozhenie-delenie-naturalnyh-20260808-2000',
  'math-5-istor-arifmeticheskih-deystviy-20260808-2030',
  'math-5-svoystva-arifmeticheskih-deystviy-20260808-2100',
  'math-5-sposob-slozheniya-gaussa-20260808-2130',
  'math-5-arifmeticheskie-deystviya-naturalnye-20260808-2200',
  'math-5-chislovye-bukvennye-vyrazheniya-20260808-2230',
  'math-5-uproshchenie-vyrazheniy-20260808-2300',
];
for (const r of runs) {
  const i = md.indexOf(r);
  console.log(r, i);
  if (i >= 0) {
    const start = md.lastIndexOf('\n', i - 1);
    console.log('CTX:', md.slice(Math.max(0, i - 120), i + r.length + 200).replace(/\n/g, ' | '));
  }
}
// find all H1 headers
const headers = [...md.matchAll(/^# .+$/gm)].map(m => m[0]);
console.log('HEADERS', headers);
// find table rows mentioning 1800 etc
const lines = md.split(/\n/);
const packCish = lines.map((l,i)=>({i:i+1,l})).filter(x => /1800|1830|1900|1930|2000|2030|2100|2130|2200|2230|2300|Пачка C|глава I|1\.2|координат/i.test(x.l));
console.log('MATCH LINES', packCish.length);
packCish.slice(0, 80).forEach(x => console.log(x.i + '|' + x.l.slice(0, 220)));
