const fs=require('fs');
let JSDOM;
try { ({JSDOM} = require('jsdom')); }
catch (e) {
  // jsdom is not installed here. Say so loudly rather than passing silently,
  // but do not fail the build over a missing dev dependency.
  console.log('SKIPPED: jsdom not installed. Run  npm install jsdom  in C:\\redash-page to enable this test.');
  process.exit(0);
}
const html=fs.readFileSync(__dirname+'/../vip-transfer.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const d=dom.window.document; let fail=0;
const ok=(c,m)=>{ if(!c){console.log('FAIL: '+m);fail++;} else console.log('ok  : '+m); };
ok(!d.getElementById('kpis') && !d.querySelector('.lede'),'KPI strip and lede removed');
ok(d.querySelectorAll('#tPlayers tbody tr').length===152,'player table has 152 rows, got '+d.querySelectorAll('#tPlayers tbody tr').length);
ok(d.querySelectorAll('#tVA tbody tr').length===8,'VA table has 8 rows, got '+d.querySelectorAll('#tVA tbody tr').length);
ok(d.querySelectorAll('#tCas tbody tr').length>10,'casino table populated: '+d.querySelectorAll('#tCas tbody tr').length);
ok(!d.querySelector('svg'),'no chart svg remains');
ok(!d.getElementById('verdict') && !d.getElementById('matchNote'),'caption and verdict box are gone');
// sign before currency symbol
ok(/-€/.test(d.body.textContent) && !/€-/.test(d.body.textContent),'sign printed before the currency symbol');
// filters
ok(!d.querySelector('.controls') && !d.getElementById('q'),'filter controls removed');
// verdict chips
ok(![...d.querySelectorAll('#tPlayers thead th')].some(h=>h.textContent.includes('30d')),'verdict column removed');
ok(!d.getElementById('method'),'method section is gone');
console.log(fail? '\n'+fail+' FAILURES':'\nall assertions passed');
process.exit(fail?1:0);
