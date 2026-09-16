const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const base={whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.aggregate();};

ok(D.RAW.meta.anchor===SNAP.anchor,'anchor is the last deposit day in the data, not today');

// ---- selector structure
D.state.era='all'; D.buildChurnOptions();
const sel=doc.getElementById('selChurn');
const groups=[...sel.querySelectorAll('optgroup')].map(g=>g.label);
ok(groups.length===3,'three option groups');
ok(/each player in one band/.test(groups[0]),'group 1 is the exclusive bands');
ok(/cumulative/.test(groups[1]),'group 2 is flagged cumulative');
ok(/Calendar year/.test(groups[2]),'group 3 is calendar years');
const vals=[...sel.options].map(o=>o.value);
ok(vals[0]==='','first option is Any recency');
['b:0-30','b:31-90','b:91-180','b:181-360','b:360+'].forEach(v=>ok(vals.includes(v),'band option '+v));
['c:30','c:90','c:180','c:360'].forEach(v=>ok(vals.includes(v),'threshold option '+v));
ok(vals.includes('y:2018')&&vals.includes('y:2026'),'year options still present');

// ---- bands PARTITION the base, in every era
[['new',SNAP.eras['new|inc'][0]],['old',SNAP.eras['old|inc'][0]],['all',SNAP.eras['all|inc'][0]]].forEach(([era,total])=>{
  D.state.era=era;
  let p=0,d=0,c=0;
  ['b:0-30','b:31-90','b:91-180','b:181-360','b:360+'].forEach(k=>{
    const T=set({era,churn:k}).T; p+=T.p; d+=T.d; c+=T.c;});
  const whole=set({era,churn:''}).T;
  ok(p===whole.p&&p===total,era+': bands partition players ('+p+' == '+total+')');
  ok(d===whole.d&&c===whole.c,era+': bands partition deposits and value exactly');
});

// ---- thresholds NEST, and must not be summed
D.state.era='all';
const th={};[30,90,180,360].forEach(t=>th[t]=set({churn:'c:'+t}).T.p);
ok(th[30]>th[90]&&th[90]>th[180]&&th[180]>th[360],'thresholds are strictly nested 30 > 90 > 180 > 360');
ok(th[30]+th[90]+th[180]+th[360]>102280,'summing thresholds overshoots the base — they are cumulative, as the footnote warns');

// ---- threshold 30+ is exactly the complement of band 0-30
const whole=set({churn:''}).T, b030=set({churn:'b:0-30'}).T;
ok(th[30]===whole.p-b030.p,'churned 30+ == everyone minus the last-30-days band');
ok(set({churn:'c:360'}).T.p===set({churn:'b:360+'}).T.p,'churned 360+ == the over-360 band');

// ---- expected all-history figures from the builder
const EXP={'b:0-30':SNAP.bands['0-30'],'b:31-90':SNAP.bands['31-90'],'b:91-180':SNAP.bands['91-180'],'b:181-360':SNAP.bands['181-360'],'b:360+':SNAP.bands['360+']};
Object.entries(EXP).forEach(([k,n])=>ok(set({churn:k}).T.p===n,'all-history '+k+' = '+n+' (got '+set({churn:k}).T.p+')'));
ok(th[30]===SNAP.eras['all|inc'][0]-SNAP.bands['0-30']&&th[90]===SNAP.eras['all|inc'][0]-SNAP.bands['0-30']-SNAP.bands['31-90'],'cumulative counts follow from the bands');

// ---- composes with other filters without double counting
const c90=set({churn:'c:90'}).T;
const c90b=set({churn:'c:90',status:'blocked'}).T, c90a=set({churn:'c:90',status:'active'}).T;
ok(c90b.p+c90a.p===c90.p&&c90b.c+c90a.c===c90.c,'churn threshold composes with status exactly');

// ---- pre-migration: everyone is over 360 days idle, by definition
ok(set({era:'old',churn:'b:360+'}).T.p===SNAP.eras['old|inc'][0],'pre-migration: everyone sits in the over-360 band');
ok(set({era:'old',churn:'b:0-30'}).T.p===0,'pre-migration: nobody is recent');

// ---- totals still reconcile with recency unset
ok(set({era:'new',whale:'ex'}).T.d===SNAP.eras['new|ex'][1]&&set({era:'all',whale:'ex'}).T.p===SNAP.eras['all|ex'][0],'era totals still reconcile');

// ---- era switch drops a year that does not exist, keeps a band that does
D.state.era='old'; D.state.churn='y:2019'; D.buildChurnOptions(); D.render();
click('btnNew');
ok(D.state.churn===''&&D.AGG.T.p>0,'switching era clears a year absent from the new era');
D.state.era='old'; D.state.churn='b:360+'; D.buildChurnOptions(); D.render();
click('btnNew');
ok(D.state.churn==='b:360+','a band survives the era switch, since bands always exist');

// ---- UI
D.state.era='all'; D.state.churn='c:90'; D.render();
ok(doc.getElementById('filterSummary').textContent.includes('no deposit in 90+ days'),'summary spells out the churn threshold');
D.state.churn='b:0-30'; D.render();
ok(doc.getElementById('filterSummary').textContent.includes('last 30 days'),'summary spells out the recent band');
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'table renders under a recency filter');
ok(doc.getElementById('filterMeta').textContent.includes(SNAP.anchor),'meta line names the anchor date');
click('btnReset');
ok(D.state.churn===''&&doc.getElementById('selChurn').value==='','Clear filters resets recency');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
