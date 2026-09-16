const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const base={whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.aggregate();};

// ---- stat strip is gone, and its figures survived
ok(doc.querySelectorAll('.stat-card').length===0,'stat cards removed');
ok(doc.querySelectorAll('.stat-row').length===0,'stat row removed');
ok(!html.includes('.stat-card {'),'dead stat-card CSS removed too');
ok(typeof w.DF.render==='function'&&!html.includes('renderStrip'),'renderStrip gone');
const meta=doc.getElementById('grpMeta').textContent;
['depositors','deposits','per deposit','per player','deposits per player'].forEach(k=>
  ok(meta.includes(k),'header still carries "'+k+'"'));

// ---- churn control
ok(!!doc.getElementById('selChurn'),'churn control present');
ok(doc.querySelectorAll('.fgroup').length===9,'9 filter groups');
D.state.era='new'; D.buildChurnOptions();
const yrs=()=>[...doc.getElementById('selChurn').querySelectorAll('optgroup')].pop().querySelectorAll('option');
const yv=()=>[...yrs()].map(o=>o.value.slice(2)).join(',');
ok([...doc.getElementById('selChurn').options][0].value==='','first churn option is Any recency');
ok(yv()==='2022,2023,2024,2025,2026','post-migration churn years are 2022-2026');
ok([...doc.getElementById('selChurn').options].some(o=>o.textContent.includes('still active')),'latest year labelled still active');
D.state.era='old'; D.buildChurnOptions();
ok(yv()==='2018,2019,2020,2021,2022','pre-migration churn years are 2018-2022');
D.state.era='all'; D.buildChurnOptions();
ok(yv()==='2018,2019,2020,2021,2022,2023,2024,2025,2026','all-history churn years are 2018-2026');

// ---- churn partitions the base exactly, in every era
[['new',SNAP.eras['new|inc'][0]],['old',SNAP.eras['old|inc'][0]],['all',SNAP.eras['all|inc'][0]]].forEach(([era,total])=>{
  let p=0,d=0,c=0;
  D.state.era=era;
  D.churnOptions().years.forEach(y=>{const T=set({churn:'y:'+y.year}).T; p+=T.p; d+=T.d; c+=T.c;});
  const whole=set({churn:''}).T;
  ok(p===whole.p&&p===total,era+': churn years partition players ('+p+' == '+total+')');
  ok(d===whole.d,era+': churn years partition deposits exactly');
  ok(c===whole.c,era+': churn years partition value exactly');
});

// ---- expected all-history churn distribution from the builder
D.state.era='all';
const EXP=SNAP.churnYears;
Object.entries(EXP).forEach(([y,n])=>{
  const T=set({churn:'y:'+y}).T;
  ok(T.p===n,'all-history churn '+y+' = '+n+' players (got '+T.p+')');
});

// ---- churn composes with the other filters
D.state.era='new';
const c26=set({churn:'y:2026'}).T, c26b=set({churn:'y:2026',status:'blocked'}).T, c26a=set({churn:'y:2026',status:'active'}).T;
ok(c26b.p+c26a.p===c26.p,'churn + status compose without double counting');
ok(c26b.c+c26a.c===c26.c,'that composition is exact in cents');

// ---- totals still reconcile with churn unset
const E={'new|ex':SNAP.eras['new|ex'],'old|ex':SNAP.eras['old|ex'],'all|ex':SNAP.eras['all|ex']};
Object.entries(E).forEach(([k,[p,d]])=>{const [era,whale]=k.split('|');
  const T=set({era,whale}).T; ok(T.p===p&&T.d===d,k+' still reconciles after the churn change');});

// ---- switching era drops a churn year that no longer exists
D.state.era='old'; D.state.churn='y:2019'; D.buildChurnOptions(); D.render();
click('btnNew');
ok(D.state.churn==='','switching to an era without the selected churn year clears it rather than showing nothing');
ok(D.AGG.T.p>0,'page is not left empty after that switch');

// ---- reset clears churn too
D.state.churn='y:2024'; D.render(); click('btnReset');
ok(D.state.churn===''&&doc.getElementById('selChurn').value==='','Clear filters resets churn');

// ---- page still renders
D.state.era='new'; D.state.churn='y:2023'; D.render();
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'13 metric rows under a churn filter');
ok([...doc.querySelectorAll('#tbl thead th')].map(e=>e.textContent).slice(1,11).join(',')==='1,2,3,4,5,6-10,11-20,21-50,51-100,100+','buckets still horizontal');
ok(doc.getElementById('filterSummary').textContent.includes('last deposited in 2023'),'summary names the churn year');
D.state.churn='y:2026'; D.render();
ok([...yrs()].some(o=>o.textContent.includes('still active')),'latest year is labelled still active in the list');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
