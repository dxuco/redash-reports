const fs=require('fs'),{JSDOM}=require('jsdom');
const SNAP=require('./snapshot.js');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const base={era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',reason:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.aggregate();};

// ---- rows exist
Object.assign(D.state,base); D.render();
const labels=[...doc.querySelectorAll('#tbl tbody tr th')].map(e=>e.textContent);
ok(labels.includes('Adjusted GGR'),'Adjusted GGR row present');
ok(labels.includes('GGR'),'raw GGR row present alongside it');
ok(labels.includes('Adj GGR per player'),'per-player adjusted GGR row present');
ok(labels.includes('…with a GGR record'),'coverage row present');
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'13 metric rows now (got '+doc.querySelectorAll('#tbl tbody tr').length+')');
ok([...doc.querySelectorAll('#tbl tbody tr')].every(r=>r.querySelectorAll('td').length===11),'every row still has 11 cells');

// ---- totals reconcile to the SQL snapshot (post-migration = full coverage)
const nw=set({era:'new',whale:'inc'}).T;
ok(nw.ggrN===SNAP.ggrPlayers,'post-migration: every player carries a GGR record ('+nw.ggrN+')');
ok(Math.abs(nw.ggr/100-SNAP.ggrTotal)<nw.ggrN*0.005,'raw GGR total matches the snapshot');
ok(Math.abs(nw.adj/100-89016498.36)<nw.ggrN*0.005,'adjusted GGR total matches SQL (EUR 89.0m)');
ok(nw.adj>nw.ggr,'adjusted runs ABOVE raw, as the source says - not below');
ok(Math.abs((nw.adj-nw.ggr)/100-8134720.67)<nw.ggrN*0.01,'the gap is the EUR 8.13m adjustment, matching SQL');

// ---- buckets partition the GGR population too
const A=set({era:'new',whale:'inc'});
ok(A.B.reduce((a,b)=>a+b.ggrN,0)===A.T.ggrN,'GGR record counts partition across buckets');
ok(A.B.reduce((a,b)=>a+b.ggr,0)===A.T.ggr,'raw GGR partitions exactly in cents');
ok(A.B.reduce((a,b)=>a+b.adj,0)===A.T.adj,'adjusted GGR partitions exactly in cents');

// ---- coverage is honest in all-history
const all=set({era:'all',whale:'inc'}).T;
ok(all.ggrN===SNAP.ggrPlayers,'all-history: only the post-migration players carry GGR');
ok(all.ggrN<all.p,'coverage is a strict subset in all-history');
ok(all.p-all.ggrN===SNAP.eras['all|inc'][0]-SNAP.ggrPlayers,'the uncovered count is exactly the pre-migration-only population');
Object.assign(D.state,base,{era:'all'}); D.render();
// the prose note is gone, so coverage must still be legible as a NUMBER in
// the table itself - otherwise a subset total would read as a whole one
const rowLabel=r=>r.querySelector('th').textContent;
const covRow=[...doc.querySelectorAll('#tbl tbody tr')].find(r=>rowLabel(r).indexOf('GGR record')>=0);
ok(!!covRow,'the "…with a GGR record" row still carries coverage');
const covAll=covRow.querySelector('td.col-total').textContent;
ok(covAll===all.ggrN.toLocaleString('en-US'),'and it shows the covered count ('+covAll+'), not the full player count');




Object.assign(D.state,base,{era:'new'}); D.render();


// ---- pre-migration has no GGR at all, and the rows say so rather than showing 0
// pre-migration: the only players with a GGR figure are the both-era returners,
// and what shows is their POST-migration GGR. The page must say so.
const old=set({era:'old',whale:'inc'});
ok(old.T.ggrN===3465,'pre-migration: 3,465 players carry a GGR record (got '+old.T.ggrN+')');
ok(old.T.ggrN===SNAP.eras['new|inc'][0]+SNAP.eras['old|inc'][0]-SNAP.eras['all|inc'][0],
   'that is exactly the both-era overlap, not a coincidence');
ok(old.T.ggrN<old.T.p*0.07,'it is a small minority of the pre-migration base');
Object.assign(D.state,base,{era:'old'}); D.render();





// ---- filters flow through
const cas=set({era:'new',whale:'inc',prod:D.PRODS.indexOf('Casino')}).T;
ok(cas.ggrN>0&&cas.ggrN<nw.ggrN,'product filter narrows the GGR population');
let accG=0,accA=0,accN=0;
D.PRODS.forEach((_,i)=>{const T=set({era:'new',whale:'inc',prod:i}).T; accG+=T.ggr; accA+=T.adj; accN+=T.ggrN;});
ok(accN===nw.ggrN&&accG===nw.ggr&&accA===nw.adj,'products partition GGR and adjusted GGR exactly');

// ---- the whale dominates adjusted GGR too
const ex=set({era:'new',whale:'ex'}).T;
ok(nw.adj-ex.adj>20000000,'karolik777 alone is over EUR 20m of adjusted GGR');

// ---- prior guarantees
ok(A.B.reduce((a,b)=>a+b.p,0)===A.T.p,'player buckets still partition');
ok(doc.querySelectorAll('#xtab tbody tr').length>0,'cross-tab still renders');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
