const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const base={era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',reason:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.crosstab();};

ok(!!doc.getElementById('xtab'),'cross-tab table present');
ok(doc.querySelectorAll('#xtab thead th').length===12,'header = GGR label + 10 buckets + All');
const heads=[...doc.querySelectorAll('#xtab thead th')].map(e=>e.textContent);
ok(heads[0]==='GGR (lifetime)','first column is the GGR range label');
ok(heads.slice(1,11).join(',')==='1,2,3,4,5,6-10,11-20,21-50,51-100,100+','deposit counts run horizontally');
ok(D.GGR_BANDS.length===12,'12 GGR bands');

// ---- the cross-tab reconciles both ways
[['all','inc',SNAP.eras['all|inc'][0]],['new','ex',SNAP.eras['new|ex'][0]],['old','inc',SNAP.eras['old|inc'][0]]].forEach(([era,whale,total])=>{
  const X=set({era,whale});
  const rowSum=X.rows.reduce((a,r)=>a+r.total,0);
  const colSum=X.colTot.reduce((a,v)=>a+v,0);
  const cellSum=X.rows.reduce((a,r)=>a+r.cells.reduce((b,v)=>b+v,0),0);
  ok(rowSum===X.grand,era+'/'+whale+': rows sum to the grand total');
  ok(colSum===X.grand,era+'/'+whale+': columns sum to the grand total');
  ok(cellSum===X.grand,era+'/'+whale+': every player lands in exactly one cell');
  ok(X.grand===total,era+'/'+whale+': grand total = '+total+' (got '+X.grand+')');
});

// ---- columns must equal the main table's Players row
[['all','inc'],['new','ex'],['new','inc']].forEach(([era,whale])=>{
  const X=set({era,whale});
  Object.assign(D.state,base,{era,whale});
  const A=D.aggregate();
  const same=X.colTot.every((v,i)=>v===A.B[i].p);
  ok(same,era+'/'+whale+': cross-tab columns match the Players row of the table above');
});

// ---- GGR coverage: post-migration only
const all=set({era:'all',whale:'inc'});
ok(all.noData===SNAP.eras['all|inc'][0]-SNAP.ggrPlayers,'players without a GGR record == all minus the GGR population');
const nw=set({era:'new',whale:'inc'});
ok(nw.noData===0,'every post-migration player has a GGR record');
ok(D.RAW.meta.ggrPlayers===SNAP.ggrPlayers,'payload agrees with the snapshot GGR population');

// ---- GGR bands match the SQL distribution (post-migration, whale in)
const EXP=SNAP.ggrBands;
const got=nw.rows.slice(0,12).map(r=>r.total);
EXP.forEach((n,i)=>ok(got[i]===n,'GGR band "'+D.GGR_BANDS[i][0]+'" = '+n+' players (got '+got[i]+')'));
ok(got.reduce((a,v)=>a+v,0)===SNAP.ggrPlayers,'GGR bands cover the whole GGR population');

// ---- zero is its own band, not folded into a range
ok(D.GGR_BANDS[4][0]==='exactly €0','there is an exactly-zero band');
ok(nw.rows[4].total===SNAP.ggrBands[4],'the exactly-zero band is distinct from no-record');

// ---- product filter drives it
const cas=set({era:'new',whale:'inc',prod:D.PRODS.indexOf('Casino')});
const spo=set({era:'new',whale:'inc',prod:D.PRODS.indexOf('Sport')});
ok(cas.grand>0&&spo.grand>0&&cas.grand!==spo.grand,'the product filter changes the cross-tab');
let acc=0; D.PRODS.forEach((_,i)=>{acc+=set({era:'new',whale:'inc',prod:i}).grand;});
ok(acc===SNAP.ggrPlayers,'products partition the cross-tab population exactly');

// ---- other filters compose
const se=set({era:'new',whale:'inc',reason:'r:'+D.REASONS.indexOf('self_exclusion')});
ok(se.grand>0&&se.grand<SNAP.ggrPlayers,'reason filter narrows the cross-tab');
const ev=set({era:'new',whale:'inc',email:'yes'}).grand;
const en=set({era:'new',whale:'inc',email:'no'}).grand;
ok(ev+en===SNAP.ggrPlayers,'email split partitions the cross-tab');

// ---- rendering
Object.assign(D.state,base,{era:'new',whale:'ex'}); D.render();
const bodyRows=doc.querySelectorAll('#xtab tbody tr');
ok(bodyRows.length===13,'12 GGR rows + total row when no-data row is empty (got '+bodyRows.length+')');
ok([...bodyRows].pop().classList.contains('rowtot'),'last row is the column-total row');
ok([...bodyRows].every(r=>r.querySelectorAll('td').length===11),'every row has 10 buckets + All');
Object.assign(D.state,base,{era:'all',whale:'inc'}); D.render();
ok(doc.querySelectorAll('#xtab tbody tr').length===14,'no-GGR-record row appears in all-history');
ok(doc.getElementById('xtabNote').textContent.includes('55,172'),'note explains the missing GGR population');
ok(doc.getElementById('xtabNote').textContent.includes('zero GGR is a real outcome'),'note distinguishes zero from missing');
ok(doc.getElementById('xtabMeta').textContent.includes('all products'),'header names the product scope');
Object.assign(D.state,base,{prod:D.PRODS.indexOf('Casino')}); D.render();
ok(doc.getElementById('xtabMeta').textContent.includes('Casino'),'header names the selected product');

// ---- previous guarantees intact
Object.assign(D.state,base); D.render();
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'main table still renders');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
