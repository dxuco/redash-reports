const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const cell=(c,a)=>doc.querySelector('#avgtab td[data-ad="'+c+','+a+'"]');

ok(!!doc.getElementById('avgtab'),'average-deposit cross-tab exists');
ok(D.AVG_BANDS.length===9,'9 average-deposit bands');
ok(doc.querySelectorAll('#avgtab tbody tr').length===10,'9 band rows + the totals row');

// ---- the bug that nearly shipped: every player landing in the first band
const X=D.crosstab('avg');
const nonEmpty=X.rows.filter(r=>r.total>0).length;
ok(nonEmpty>=7,'players are spread across the bands, not dumped in one ('+nonEmpty+' populated)');
ok(X.rows[0].total<X.grand*0.5,'the first band is not swallowing everyone');
ok(X.rows[0].cells[0]!==D.aggregate().B[0].p,'the first cell is not simply the whole bucket');

// ---- partitions, both ways
ok(X.rows.reduce((a,r)=>a+r.total,0)===X.grand,'rows sum to the grand total');
ok(X.colTot.reduce((a,v)=>a+v,0)===X.grand,'columns sum to the grand total');
ok(X.rows.reduce((a,r)=>a+r.cells.reduce((b,v)=>b+v,0),0)===X.grand,'every player lands in exactly one cell');
const A=D.aggregate();
ok(X.grand===A.T.p,'grand total matches the buckets table');
ok(X.colTot.every((v,i)=>v===A.B[i].p),'column totals match the buckets table Players row');

// ---- no missing-data row: everyone has an average
ok(X.rows.length===D.AVG_BANDS.length,'no extra "no record" row - every depositor has an average');
const labels=[...doc.querySelectorAll('#avgtab tbody th')].map(e=>e.textContent);
ok(!labels.some(l=>/no .*record/i.test(l)),'and none is rendered');

// ---- the classification is actually right
[[0,1000],[3,10000],[8,Infinity]].forEach(([ri])=>{
  const hits=D.drill(-1,-1,ri);
  const lo=D.AVG_BANDS[ri][1], hi=D.AVG_BANDS[ri][2];
  const bad=hits.filter(p=>{const a=p.amt/p.cnt; return !(a>=lo&&a<hi);});
  ok(bad.length===0,'band "'+D.AVG_BANDS[ri][0]+'" contains only players whose average really falls in it');
});

// ---- drilling every populated cell matches its count
let checked=0,bad=0;
X.rows.forEach((r,ai)=>r.cells.forEach((v,ci)=>{ if(v===0)return; checked++; if(D.drill(ci,-1,ai).length!==v) bad++; }));
ok(bad===0,'all '+checked+' populated cells drill to exactly their own count');
let rb=0; X.rows.forEach((r,ai)=>{ if(r.total>0&&D.drill(-1,-1,ai).length!==r.total) rb++; });
ok(rb===0,'row totals drill to the whole band');
let cb=0; X.colTot.forEach((v,ci)=>{ if(v>0&&D.drill(ci,-1,-1).length!==v) cb++; });
ok(cb===0,'column totals drill to the whole bucket');

// ---- clicking wires through with the right title
click(cell(9,8));
ok(doc.getElementById('drillPanel').style.display!=='none','clicking opens the drill panel');
const t=doc.getElementById('drillTitle').textContent;
ok(t.includes('100+'),'title names the deposit bucket');
ok(!t.includes('GGR'),'and does NOT claim a GGR band - this table is a different dimension');
ok(t.includes('avg deposit')&&t.includes('€5k+'),'title names the average-deposit band it came from (got "'+t+'")');

// ---- the two cross-tabs stay independent
ok(doc.querySelectorAll('#xtab td[data-xd]').length>0,'GGR cross-tab still clickable');
ok(doc.querySelectorAll('#avgtab td[data-ad]').length>0,'avg cross-tab clickable on its own attribute');
click(doc.querySelector('#xtab td[data-xd]'));
ok(/GGR/.test(doc.getElementById('drillTitle').textContent),'a GGR-table click still constrains on GGR');

// ---- filters flow through
Object.assign(D.state,{era:'new',whale:'inc',email:'all',phone:'all',status:'all',prod:D.PRODS.indexOf('Sport'),churn:'',reason:'',fraud:'all'});
D.render();
const X2=D.crosstab('avg');
ok(X2.rows.reduce((a,r)=>a+r.total,0)===X2.grand,'still partitions under a product filter');
ok(X2.grand===D.aggregate().T.p,'and still matches the buckets table');
Object.assign(D.state,{era:'all',whale:'inc',prod:-1}); D.render();

// ---- collapsible like the others
ok(!!doc.querySelector('.grp-header[data-collapse="avgBody"]'),'it has its own collapse control');
ok(doc.querySelectorAll('.grp-header[data-collapse]').length===4,'four collapsible sections now');
click(doc.querySelector('.grp-header[data-collapse="avgBody"]'));
ok(doc.getElementById('avgBody').style.display==='none','it collapses');
click(doc.querySelector('.grp-header[data-collapse="avgBody"]'));

// ---- nothing else broke
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'buckets table intact');
ok(doc.querySelectorAll('#xtab tbody tr').length>0,'GGR cross-tab intact');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
