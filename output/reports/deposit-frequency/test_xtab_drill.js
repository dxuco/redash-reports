const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const xcell=(c,g)=>doc.querySelector('#xtab td[data-xd="'+c+','+g+'"]');
const n=s=>parseInt(s.replace(/,/g,''),10);

const X=D.crosstab();
const NB=D.GGR_BANDS.length;   // "no GGR record" row index

// ---- every populated cell is clickable, empty ones are not
ok(doc.querySelectorAll('#xtab td[data-xd]').length>0,'cross-tab cells are clickable');
const empties=[...doc.querySelectorAll('#xtab td')].filter(t=>t.textContent==='—');
ok(empties.every(t=>!t.hasAttribute('data-xd')),'empty cells are not clickable');
const filled=[...doc.querySelectorAll('#xtab tbody td')].filter(t=>t.textContent!=='—');
ok(filled.every(t=>t.hasAttribute('data-xd')),'every populated cell, including totals, is clickable');

// ---- a body cell drills to exactly its own count, in EVERY populated cell
let checked=0, bad=0;
X.rows.forEach((r,gi)=>{
  r.cells.forEach((v,ci)=>{
    if(v===0) return;
    checked++;
    if(D.drill(ci,gi).length!==v) bad++;
  });
});
ok(bad===0,'all '+checked+' populated body cells drill to exactly their own count');

// ---- row totals drill to the whole GGR band
let rbad=0;
X.rows.forEach((r,gi)=>{ if(r.total>0 && D.drill(-1,gi).length!==r.total) rbad++; });
ok(rbad===0,'every row total drills to its whole GGR band');

// ---- column totals drill to the whole deposit bucket
let cbad=0;
X.colTot.forEach((v,ci)=>{ if(v>0 && D.drill(ci,-1).length!==v) cbad++; });
ok(cbad===0,'every column total drills to its whole deposit bucket');
ok(D.drill(-1,-1).length===X.grand,'the grand total drills to everything');

// ---- and the column totals agree with the buckets table above
const A=D.aggregate();
ok(X.colTot.every((v,i)=>D.drill(i,-1).length===A.B[i].p),'cross-tab column drills match the buckets table Players row');

// ---- clicking wires through to the panel with the right title
click(xcell(9,NB-1));            // 100+ deposits, EUR50k+ band
ok(doc.getElementById('drillPanel').style.display!=='none','clicking a cross-tab cell opens the panel');
const t=doc.getElementById('drillTitle').textContent;
ok(t.includes('100+')&&t.includes('€50k+'),'title names BOTH the deposit bucket and the GGR band (got "'+t+'")');
ok(D.DRILL_HITS.length===n(xcell(9,NB-1).textContent),'population equals the clicked cell');

// row total: band named, deposit count not constrained
click(xcell(-1,5));
ok(doc.getElementById('drillTitle').textContent.includes('All deposit counts'),'a row total says all deposit counts');
ok(doc.getElementById('drillTitle').textContent.includes('€0 to €100'),'and names the band');

// column total: bucket named, no band
click(xcell(3,-1));
const t3=doc.getElementById('drillTitle').textContent;
ok(t3.includes('4 deposits')&&!t3.includes('GGR'),'a column total names only the bucket');

// no-GGR-record row
if (xcell(-1,NB)){
  click(xcell(-1,NB));
  ok(doc.getElementById('drillTitle').textContent.includes('not recorded'),'the no-GGR-record row is drillable and labelled');
  ok(D.DRILL_HITS.every(p=>p.ggr===null),'and every player in it genuinely has no GGR');
}

// ---- returned players really are in that band
const hits=D.drill(9,NB-1);
ok(hits.every(p=>p.ggr!==null&&p.ggr>=5000000),'EUR50k+ band really contains only players over EUR 50k GGR (5,000,000 cents)');
const neg=D.drill(-1,0);
ok(neg.every(p=>p.ggr!==null&&p.ggr< -1000000),'the < -EUR10k band really contains only big losers to us');

// ---- filters flow through the cross-tab drill too
Object.assign(D.state,{era:'new',whale:'inc',email:'all',phone:'all',status:'all',prod:D.PRODS.indexOf('Sport'),churn:'',reason:'',fraud:'all'});
D.render();
const X2=D.crosstab();
ok(D.drill(-1,-1).length===X2.grand,'under a product filter the drill still matches the cross-tab');
ok(D.drill(-1,-1).every(p=>p.prod==='Sport'),'and every drilled player carries that product');

// ---- the buckets table stays clickable too
Object.assign(D.state,{era:'all',whale:'inc',prod:-1}); D.render();
ok(doc.querySelectorAll('#tbl td[data-drill]').length===11,'buckets table Players row still drillable');
click(doc.querySelectorAll('#tbl td[data-drill]')[2]);
ok(doc.getElementById('drillTitle').textContent==='3 deposits','a buckets-table click still gives an unconstrained bucket drill');

// ---- nothing else broke
ok(doc.querySelectorAll('#xtab tbody tr').length>0,'cross-tab still renders');
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'buckets table still 13 rows');
ok(doc.querySelectorAll('.grp-header[data-collapse]').length===4,'collapse controls intact');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
