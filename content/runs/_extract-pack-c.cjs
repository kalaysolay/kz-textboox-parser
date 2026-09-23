const fs = require('fs');
const md = fs.readFileSync('_batch-math5-ch3-6-20260808.md', 'utf8');
const start = md.indexOf('# Пачка C:');
const section = md.slice(start);
fs.writeFileSync('_pack-c-section.txt', section, 'utf8');
console.log('len', section.length);
// print summary + detail headers
const lines = section.split(/\n/);
lines.slice(0, 40).forEach((l,i)=>console.log((i+1)+'|'+l));
console.log('---TAIL---');
lines.slice(-80).forEach((l,i)=>console.log((lines.length-80+i+1)+'|'+l));
