const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const rows=()=>doc.querySelectorAll('#drill tbody tr').length;
const panel=()=>doc.getElementById('drillPanel');
const setRows=v=>{const s=doc.getElementById('drillRows'); s.value=String(v); s.dispatchEvent(new w.Event('change',{bubbles:true}));};

// ---- inline, not a modal
ok(doc.querySelectorAll('.modal-back').length===0,'the overlay modal is gone');
ok(!!panel(),'inline drill panel exists');
ok(panel().style.display==='none','panel is hidden until a cell is clicked');
const sec=doc.querySelector('section');
ok(sec.contains(panel()),'the panel lives inside the page flow, not fixed over it');
const tbl=doc.getElementById('tbl').closest('.table-wrap');
ok(tbl.compareDocumentPosition(panel())&w.Node.DOCUMENT_POSITION_FOLLOWING,'it renders BELOW the buckets table');

// ---- row limit
D.openDrill(9);
ok(panel().style.display!=='none','clicking opens it inline');
ok(!!doc.getElementById('drillRows'),'Rows control present');
ok([...doc.getElementById('drillRows').options].map(o=>o.value).join(',')==='25,50,100,250,500,-1','row options 25/50/100/250/500/All');
ok(D.DRILL_LIMIT===50&&rows()===50,'defaults to 50 rows');
setRows(25); ok(rows()===25,'25 shows 25 rows');
setRows(100); ok(rows()===100,'100 shows 100 rows');
setRows(250); ok(rows()===250,'250 shows 250 rows');
const total=D.DRILL_HITS.length;
setRows(-1); ok(rows()===total,'All shows every player in the cell ('+total+')');
setRows(50);

// ---- the limit changes what is SHOWN, never the population
const before=D.DRILL_HITS.length;
setRows(25);
ok(D.DRILL_HITS.length===before,'changing the limit does not change the underlying population');
ok(doc.getElementById('drillSub').textContent.includes('of '+before.toLocaleString('en-US')),'subtitle still reports the full population');
setRows(50);

// ---- a small cell shows fewer rows than the limit, and says so honestly
let smallB=-1;
for(let b=0;b<10;b++){ if(D.drill(b).length>0&&D.drill(b).length<50){ smallB=b; break; } }
if(smallB>=0){
  D.openDrill(smallB);
  const n=D.DRILL_HITS.length;
  ok(rows()===n,'a cell smaller than the limit renders all '+n+' of its rows');
  ok(doc.getElementById('drillSub').textContent.includes('showing '+n+' of '+n),'subtitle says showing N of N');
} else { ok(true,'no cell smaller than 50 in this view - skipped'); }

// ---- new columns
D.openDrill(9);
const heads=[...doc.querySelectorAll('#drill thead th')].map(e=>e.textContent.replace(/[▲▼]/g,'').trim());
['Player','ID','Country','Status','FTD date','Last deposit','Days since deposit','Lifetime deposits',
 'Deposit days','Lifetime deposited','Lifetime GGR','Adjusted GGR','Favourite product']
 .forEach(h=>ok(heads.includes(h),'column present: '+h));
ok(heads[0]==='#','rank stays first');
ok(doc.querySelectorAll('#drill tbody tr')[0].querySelectorAll('td').length===14,'14 cells per row');

// ---- country and status are real values
const cells=n=>[...doc.querySelectorAll('#drill tbody tr')].map(r=>r.querySelectorAll('td')[n].textContent);
ok(cells(3).every(c=>c.length>0),'country populated on every row');
ok(cells(4).every(c=>c==='Active'||c==='Blocked'),'status is Active or Blocked');
ok(D.RAW.meta.countries.length===216,'216 countries interned in the payload');
ok(D.RAW.meta.countries.includes('VPN Player'),'VPN Player is kept as a real value, not nulled');

// ---- deposit days can never exceed the deposit count
const bad=D.DRILL_HITS.filter(p=>p.days>p.cnt);
ok(bad.length===0,'deposit days never exceeds lifetime deposits');

// ---- sorting still works, on the new columns too
const col=k=>[...doc.querySelectorAll('#drill th.sortable')].find(t=>t.getAttribute('data-key')===k);
col('country').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const cs=cells(3).map(s=>s.toLowerCase());
ok(cs.every((x,i)=>i===0||cs[i-1]<=x),'country sorts A-Z');
col('adj').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const adj=cells(12).map(s=>s==='no record'?null:parseFloat(s.replace(/[^0-9.-]/g,'')));
ok(adj.filter(x=>x!==null).every((x,i,a)=>i===0||a[i-1]>=x),'adjusted GGR sorts high to low');
col('since').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const since=cells(7).map(s=>s==='—'?null:parseInt(s.replace(/,/g,''),10));
ok(since.filter(x=>x!==null).every((x,i,a)=>i===0||a[i-1]>=x),'days since deposit sorts high to low');

// ---- sort respects the limit
setRows(25);
ok(rows()===25,'sorting keeps the row limit');
setRows(50);

// ---- close
doc.getElementById('drillClose').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok(panel().style.display==='none','close button hides the panel');
D.openDrill(3);
doc.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
ok(panel().style.display==='none','Escape still closes it');

// ---- population still matches the clicked cell
D.openDrill(-1);
const A=D.aggregate();
ok(D.DRILL_HITS.length===A.T.p,'All cell still drills to the grand total');
for(let b=0;b<10;b++) if(D.drill(b).length!==A.B[b].p){ ok(false,'bucket '+b+' mismatch'); break; }
ok(true,'every bucket still matches its cell count');

// ---- prior guarantees
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'buckets table still 13 rows');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
