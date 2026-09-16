const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const ths=()=>[...doc.querySelectorAll('#drill th.sortable')];
const col=k=>ths().find(t=>t.getAttribute('data-key')===k);
const cells=n=>[...doc.querySelectorAll('#drill tbody tr')].map(r=>r.querySelectorAll('td')[n].textContent);

D.openDrill(9);

// ---- headers are sortable
ok(ths().length===13,'13 sortable headers (rank is not sortable)');
ok(!doc.querySelector('#drill th.rank').classList.contains('sortable'),'the # column is not sortable');
ok(ths().every(t=>t.querySelector('.sort-arrow')),'every sortable header has an arrow slot');

// ---- opens on lifetime deposited, descending
ok(D.DRILL_SORT.key==='amt'&&D.DRILL_SORT.dir==='desc','opens sorted by lifetime deposited, descending');
ok(col('amt').textContent.includes('▼'),'the active column shows a descending arrow');
ok(ths().filter(t=>/[▼▲]/.test(t.textContent)).length===1,'exactly one column shows an arrow');

// ---- sorting actually reorders
const amtOf=s=>parseFloat(s.replace(/[^0-9.-]/g,''));
let v=cells(10).map(amtOf);
ok(v.every((x,i)=>i===0||v[i-1]>=x),'deposited descends on open');
click(col('amt'));
ok(D.DRILL_SORT.dir==='asc','clicking the active column flips direction');
v=cells(10).map(amtOf);
ok(v.every((x,i)=>i===0||v[i-1]<=x),'deposited ascends after the flip');
ok(col('amt').textContent.includes('▲'),'arrow flips too');

// ---- sorting re-selects from the WHOLE cell, not the visible 50
click(col('ggr')); click(col('ggr'));   // to ggr desc (first click sets desc)
D.openDrill(9);
const byAmt=new Set(cells(1));
click(col('ggr'));
ok(D.DRILL_SORT.key==='ggr'&&D.DRILL_SORT.dir==='desc','clicking GGR sorts by GGR, highest first');
const byGgr=cells(1);
ok(byGgr.some(u=>!byAmt.has(u)),'sorting by GGR brings in players who were not in the top 50 by deposits');
const g=cells(11).map(s=>s==='no record'?null:amtOf(s));
ok(g.filter(x=>x!==null).every((x,i,a)=>i===0||a[i-1]>=x),'GGR descends');
ok(doc.getElementById('drillSub').textContent.includes('lifetime ggr'),'subtitle names the sort column');
ok(doc.getElementById('drillSub').textContent.includes('highest first'),'subtitle names the direction');

// ---- missing values sink, both directions
D.openDrill(-1);
click(col('ggr'));
let gg=cells(11);
let firstNa=gg.indexOf('no record');
ok(firstNa===-1||gg.slice(firstNa).every(x=>x==='no record'),'no-record GGR sorts last on desc');
click(col('ggr'));
gg=cells(11); firstNa=gg.indexOf('no record');
ok(firstNa===-1||gg.slice(firstNa).every(x=>x==='no record'),'no-record GGR still sorts last on asc, not first');

// ---- string columns open A-Z, numbers open high-first
D.openDrill(9);
click(col('un'));
ok(D.DRILL_SORT.dir==='asc','username opens ascending (A-Z)');
const names=cells(1).map(s=>s.toLowerCase());
ok(names.every((x,i)=>i===0||names[i-1]<=x),'usernames are in A-Z order');
click(col('cnt'));
ok(D.DRILL_SORT.dir==='desc','a numeric column opens descending');
const c=cells(8).map(s=>parseInt(s.replace(/,/g,''),10));
ok(c.every((x,i)=>i===0||c[i-1]>=x),'deposit counts descend');

// ---- dates sort chronologically, not lexically by gap
D.openDrill(9);
click(col('last'));
const d1=cells(6);
ok(d1.every((x,i)=>i===0||d1[i-1]>=x),'last-deposit descends = most recent first');
click(col('ftd'));
const d2=cells(5).filter(x=>/^\d{4}/.test(x));
ok(d2.every((x,i)=>i===0||d2[i-1]>=x),'FTD descends = newest first');

// ---- rank renumbers with the sort
ok(cells(0)[0]==='1'&&cells(0)[1]==='2','rank column renumbers 1,2,... under any sort');

// ---- reopening resets the sort
click(col('un'));
D.openDrill(5);
ok(D.DRILL_SORT.key==='amt'&&D.DRILL_SORT.dir==='desc','reopening resets to the default sort');

// ---- row count and integrity unchanged
D.openDrill(9);
ok(doc.querySelectorAll('#drill tbody tr').length===50,'still 50 rows');
ok([...doc.querySelectorAll('#drill tbody tr')].every(r=>r.querySelectorAll('td').length===14),'still 14 cells per row');
ok(D.sortHits().length===D.DRILL_HITS.length,'sorting never drops or duplicates a player');
const ids=new Set(D.sortHits().map(p=>p.id));
ok(ids.size===D.DRILL_HITS.length,'no duplicate players after sorting');
ok(doc.getElementById('drillFoot').textContent.includes('Click any column'),'footer explains the re-selection behaviour');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
