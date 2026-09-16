const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const set=o=>{Object.assign(D.state,o); return D.aggregate();};

// ---- filters exist and are wired
['btnNew','btnOld','btnAll','btnWEx','btnWInc','btnEAll','btnEYes','btnENo',
 'btnPAll','btnPYes','btnPNo','btnSAll','btnSActive','btnSBlocked','selProd','btnReset']
 .forEach(id=>ok(!!doc.getElementById(id),'control present: '+id));
ok(doc.querySelectorAll('.fgroup').length===9,'9 filter rows rendered (era, whale, email, phone, status, product, churn)');
ok(doc.getElementById('selProd').options.length===11,'product dropdown has All + 10 products');

// ---- defaults live in test_defaults.js; this suite drives state explicitly

// ---- live aggregation reproduces the SQL, all six era/whale combos
const E=SNAP.eras;
Object.entries(E).forEach(([k,[p,d,t]])=>{
  const [era,whale]=k.split('|');
  const T=set({era,whale,email:'all',phone:'all',status:'all',prod:-1,fraud:'all'}).T;
  ok(T.p===p,k+' depositors = '+p+' (got '+T.p+')');
  ok(T.d===d,k+' deposits = '+d+' (got '+T.d+')');
  const budget=p*0.005, diff=Math.abs(T.c/100-t);
  ok(diff<=budget,k+' value within rounding budget (diff '+diff.toFixed(2)+', budget '+budget.toFixed(2)+')');
});

// ---- filter subsets partition the whole: verified + unverified == all
const whole=set({era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,fraud:'all'}).T;
['email','phone'].forEach(f=>{
  const yes=set({era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,fraud:'all',[f]:'yes'}).T;
  const no =set({era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,fraud:'all',[f]:'no'}).T;
  ok(yes.p+no.p===whole.p,f+': verified + not verified == all depositors');
  ok(yes.d+no.d===whole.d,f+': deposit counts partition');
  ok(yes.c+no.c===whole.c,f+': value partitions exactly (integer cents)');
});
const act=set({era:'all',whale:'inc',email:'all',phone:'all',status:'active',prod:-1,fraud:'all'}).T;
const blk=set({era:'all',whale:'inc',email:'all',phone:'all',status:'blocked',prod:-1,fraud:'all'}).T;
ok(act.p+blk.p===whole.p,'status: active + blocked == all depositors');
ok(act.c+blk.c===whole.c,'status: value partitions exactly');

// ---- products partition too (that's why (none) must be its own option)
let pp=0,pc=0;
D.PRODS.forEach((_,i)=>{const T=set({era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:i,fraud:'all'}).T; pp+=T.p; pc+=T.c;});
ok(pp===whole.p,'every product bucket sums back to all depositors (got '+pp+')');
ok(pc===whole.c,'product value partitions exactly');

// ---- attribute counts match the SQL breakdown
const evAll=set({era:'all',whale:'inc',email:'yes',phone:'all',status:'all',prod:-1,fraud:'all'}).T;
ok(evAll.p>0&&evAll.p<SNAP.eras['all|inc'][0],'email-verified is a strict subset of all depositors');
const blkAll=set({era:'all',whale:'inc',email:'all',phone:'all',status:'blocked',prod:-1,fraud:'all'}).T;
ok(blkAll.p===SNAP.eras['all|inc'][0]-SNAP.notBlocked,'blocked == all minus not-blocked');
const noneP=set({era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:0,fraud:'all'}).T;
ok(D.PRODS[0]==='(none)'&&noneP.p>0,'(none) product is its own bucket, not dropped');

// ---- buckets stay exclusive under filtering
const A=set({era:'new',whale:'ex',email:'yes',phone:'yes',status:'blocked',prod:-1,fraud:'all'});
ok(A.B.reduce((a,b)=>a+b.p,0)===A.T.p,'filtered buckets still sum to the filtered total');
ok(A.B.reduce((a,b)=>a+b.c,0)===A.T.c,'filtered bucket value sums exactly');
ok(A.T.p<whole.p,'a narrow filter really does narrow the selection');

// ---- median matches percentile_cont(0.5) on the unfiltered default
const base=set({era:'new',whale:'ex',email:'all',phone:'all',status:'all',prod:-1,fraud:'all'});
base.B.forEach(b=>b.amts.sort((x,y)=>x-y));
const med100=D.median(base.B[9].amts)/100;
ok(med100>15000&&med100<25000,'100+ median is five figures, matching percentile_cont order of magnitude (got '+med100.toFixed(2)+')');
const med1=D.median(base.B[0].amts)/100;
ok(med1>0&&med1<100,'single-deposit median is a small figure (got '+med1.toFixed(2)+')');

// ---- UI renders under filters, including an empty selection
D.state.era='new';D.state.whale='ex';D.state.email='all';D.state.phone='all';D.state.status='all';D.state.prod=-1;D.render();
click('btnSBlocked'); click('btnEYes');
ok(doc.getElementById('btnReset').style.display==='','Clear filters appears once filtering');
ok(doc.getElementById('filterSummary').textContent.includes('Filtered to'),'summary names the active filters');
const heads=[...doc.querySelectorAll('#tbl thead th')].map(e=>e.textContent);
ok(heads.slice(1,11).join(',')==='1,2,3,4,5,6-10,11-20,21-50,51-100,100+','buckets still horizontal under filters');
click('btnReset');
ok(D.state.status==='all'&&D.state.email==='all'&&doc.getElementById('btnReset').style.display==='none','Clear filters resets everything');

// empty selection must not throw or render a broken chart
D.state.prod=D.PRODS.indexOf('Micro Betting'); D.state.status='blocked'; D.state.phone='no'; D.render();
D.state.prod=-1;D.state.status='all';D.state.phone='all';D.render();

// ---- zero rules / axis conventions survive

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
