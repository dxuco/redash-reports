const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const base={era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',reason:'',fraud:'all'};
const setS=o=>Object.assign(D.state,base,o);

ok(!!doc.getElementById('drillPanel'),'drill-down panel exists');
ok(!(doc.getElementById('drillPanel').style.display!=='none'),'modal starts closed');

// ---- the modal population must equal the cell that was clicked
setS({}); D.render();
const A=D.aggregate();
for (let b=0;b<10;b++){
  const hits=D.drill(b);
  ok(hits.length===A.B[b].p,'bucket "'+D.BUCKETS[b]+'": drill returns '+A.B[b].p+' players, matching the cell (got '+hits.length+')');
}
ok(D.drill(-1).length===A.T.p,'the All cell drills to the grand total');

// ---- every returned player really belongs in that bucket
[0,5,9].forEach(b=>{
  const hits=D.drill(b);
  const bad=hits.filter(p=>{
    const n=p.cnt;   // all-history era, so lifetime == era count here
    return (b===0&&n!==1)||(b===9&&n<=100);
  });
  ok(bad.length===0,'bucket "'+D.BUCKETS[b]+'": every row genuinely falls in it');
});

// ---- ranking
const top=D.drill(9).slice(0,50);
ok(top.length===50,'top 50 returned for a large bucket');
let sorted=true; for(let i=1;i<top.length;i++) if(top[i].amt>top[i-1].amt) sorted=false;
ok(sorted,'rows are ranked by lifetime deposit amount, descending');

// ---- filters carry through
setS({fraud:'yes'}); const fy=D.aggregate(), dy=D.drill(-1);
ok(dy.length===fy.T.p,'drill honours the fraud filter');
setS({prod:D.PRODS.indexOf('Sport')}); const sp=D.aggregate(), ds=D.drill(-1);
ok(ds.length===sp.T.p,'drill honours the product filter');
ok(ds.every(p=>p.prod==='Sport'),'every drilled row carries the filtered product');
setS({era:'new'}); const nw=D.aggregate(), dn=D.drill(3);
ok(dn.length===nw.B[3].p,'drill honours the era');

// ---- rendering
setS({}); D.render(); D.openDrill(9);
ok((doc.getElementById('drillPanel').style.display!=='none'),'openDrill opens the modal');
const heads=[...doc.querySelectorAll('#drill thead th')].map(e=>e.textContent.replace(/[\u25b2\u25bc]/g,'').trim());
ok(heads.length===14,'14 columns');
['Player','ID','Country','Status','FTD date','Last deposit','Lifetime deposits','Lifetime deposited','Lifetime GGR','Adjusted GGR','Favourite product']
  .forEach(h=>ok(heads.includes(h),'column present: '+h));
const rows=doc.querySelectorAll('#drill tbody tr');
ok(rows.length===50,'50 rows rendered');
ok([...rows].every(r=>r.querySelectorAll('td').length===14),'every row has 14 cells');
const first=rows[0].querySelectorAll('td');
ok(/^\d+$/.test(first[2].textContent),'player id is numeric');
ok(first[1].textContent.trim().length>0,'username is populated');
ok(/^\d{4}-\d{2}-\d{2}$/.test(first[5].textContent),'FTD renders as a date');
ok(/^\d{4}-\d{2}-\d{2}$/.test(first[6].textContent),'last deposit renders as a date');
ok(first[10].textContent.startsWith('€'),'deposited renders as euros');
ok(/showing 50/.test(doc.getElementById('drillSub').textContent),'subtitle says how many are shown');
ok(doc.getElementById('drillFoot').textContent.includes('Lifetime'),'footer explains the lifetime scope');
ok(doc.getElementById('drillFoot').textContent.includes('2016'),'footer warns FTD can predate the deposit data');

// ---- negative GGR is marked, missing GGR is not shown as zero
setS({era:'all'}); D.render(); D.openDrill(-1);
const cells=[...doc.querySelectorAll('#drill tbody tr td:nth-child(12)')];
ok(cells.some(c=>c.classList.contains('na')||c.classList.contains('pos')||c.classList.contains('neg')),'GGR cells are classified');
ok(cells.filter(c=>c.classList.contains('na')).every(c=>c.textContent==='no record'),'missing GGR reads "no record", never 0');

// ---- close paths
D.closeDrill();
ok(!(doc.getElementById('drillPanel').style.display!=='none'),'closeDrill closes it');
D.openDrill(1);
doc.getElementById('drillClose').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok(!(doc.getElementById('drillPanel').style.display!=='none'),'close button works');
D.openDrill(1);
doc.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
ok(!(doc.getElementById('drillPanel').style.display!=='none'),'Escape closes it');

// ---- cells are actually wired in the DOM
setS({}); D.render();
const drillCells=doc.querySelectorAll('#tbl td[data-drill]');
ok(drillCells.length===11,'10 bucket cells + the All cell are clickable (got '+drillCells.length+')');
ok([...doc.querySelectorAll('#tbl tbody tr')][0].classList.contains('drillrow'),'only the Players row is the drill row');
ok(doc.querySelectorAll('#tbl tbody tr.drillrow').length===1,'exactly one drillable row');
drillCells[3].dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok((doc.getElementById('drillPanel').style.display!=='none'),'clicking a Players cell opens the modal');
ok(doc.getElementById('drillTitle').textContent==='4 deposits','title names the clicked bucket');
D.closeDrill();

// ---- prior guarantees
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'main table unchanged');
ok(doc.querySelectorAll('#xtab tbody tr').length>0,'cross-tab unchanged');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
