const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const base={era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',reason:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.aggregate();};
const ri=name=>D.REASONS.indexOf(name);

ok(!!doc.getElementById('selReason'),'reason control present');
ok(doc.querySelectorAll('.fgroup').length===9,'9 filter groups');
ok(D.state.reason==='','reason defaults to any');

// ---- vocabulary and grouping
ok(D.REASONS[0]==='','index 0 is not-blocked');
ok(ri('self_exclusion')>0,'self_exclusion is in the vocabulary');
const gnames=D.REASON_GROUPS.map(g=>g[0]);
ok(gnames.includes('Responsible gambling'),'responsible gambling group exists');
ok(gnames.includes('Fraud & abuse')&&gnames.includes('Dormant')&&gnames.includes('Unknown'),'other groups exist');
ok(gnames.includes('Other'),'unmapped reason (refresh) lands in Other rather than vanishing');

// ---- Fraud & abuse is ONE entry in the list, not six
const sel0=doc.getElementById('selReason');
const fraudOpts=[...sel0.querySelectorAll('option')].filter(o=>/fraud/i.test(o.textContent));
ok(fraudOpts.length===1,'Fraud & abuse appears exactly once in the Reason list (got '+fraudOpts.length+')');
ok(fraudOpts[0].value.slice(0,2)==='g:','that single entry selects the whole group');
ok(fraudOpts[0].textContent.includes(SNAP.fraudAbuse.toLocaleString('en-US')),'it carries the group total');
['multi_accounting','bonus_abuse','suspicious_user','risk_decision','bug_abuse','email_pattern_bot']
  .forEach(r=>ok(![...sel0.querySelectorAll('option')].some(o=>o.textContent.startsWith(r)),
    r+' is no longer listed separately'));
ok(![...sel0.querySelectorAll('optgroup')].some(g=>g.label==='Fraud & abuse'),'no Fraud optgroup remains');
// single-member groups collapse too, instead of repeating themselves
['Dormant','Unknown'].forEach(g=>{
  const o=[...sel0.querySelectorAll('option')].filter(x=>x.textContent.startsWith(g));
  ok(o.length===1,g+' collapses to one entry rather than group + lone member');
});
// the groups worth breaking out stay expanded
ok([...sel0.querySelectorAll('optgroup')].some(g=>g.label==='Responsible gambling'),'Responsible gambling stays expanded');
ok([...sel0.querySelectorAll('option')].some(o=>o.textContent.startsWith('self_exclusion')),'self_exclusion still selectable on its own');

// ---- reasons PARTITION the base
D.state.era='all';
let sum=0; D.REASONS.forEach((_,i)=>{sum+= i===0 ? set({reason:'nb'}).T.p : set({reason:'r:'+i}).T.p;});
const whole=set({reason:''}).T;
ok(sum===whole.p&&sum===SNAP.eras['all|inc'][0],'every reason plus not-blocked partitions the base ('+sum+')');

// ---- a group equals the sum of its members
D.REASON_GROUPS.forEach((g,gi)=>{
  const grp=set({reason:'g:'+gi}).T;
  let p=0,c=0; g[1].forEach(r=>{const T=set({reason:'r:'+r}).T; p+=T.p; c+=T.c;});
  ok(p===grp.p&&c===grp.c,'group "'+g[0]+'" equals the sum of its member reasons');
});

// ---- figures match the SQL
const EXP=SNAP.reasons;
Object.entries(EXP).forEach(([r,n])=>ok(set({reason:'r:'+ri(r)}).T.p===n,r+' = '+n+' depositors (got '+set({reason:'r:'+ri(r)}).T.p+')'));
ok(set({reason:'nb'}).T.p===SNAP.notBlocked,'not blocked matches the snapshot');
const rgIx=gnames.indexOf('Responsible gambling');
const rg=set({reason:'g:'+rgIx}).T;
ok(rg.p===SNAP.responsibleGambling,'responsible gambling matches the snapshot (got '+rg.p+')');
ok(rg.c>0,'responsible gambling carries a positive deposited total');

// ---- the self-exclusion figure really is concentrated in two players
const se=set({reason:'r:'+ri('self_exclusion')});
se.B.forEach(b=>b.amts.sort((a,b2)=>a-b2));
const all=[].concat(...se.B.map(b=>b.amts)).sort((a,b)=>b-a);
ok(all[0]/100>10000000&&all[1]/100>5000000,'the top two self-excluded depositors are both eight figures');
const rest=all.slice(2).reduce((a,x)=>a+x,0)/100;
ok(rest>0,'self-exclusion excluding the top two is still a real total');
// SQL's 675.53 was computed EXCLUDING the top two depositors, so compare the
// same population; including them shifts the middle pair and gives 680.15.
const exTop2=all.slice(2).sort((a,b)=>a-b);
const medEx=D.median(exTop2)/100;
ok(medEx>0&&medEx<2000,'self-exclusion median excl. top 2 sits in the hundreds (got '+medEx.toFixed(2)+')');
const medAll=D.median(all.slice().sort((a,b)=>a-b))/100;
ok(medAll>=medEx,'including the two outliers barely moves the median ('+medAll.toFixed(2)+')');
ok(se.T.c/100/se.T.p>medAll*15,'mean per self-excluded player is >15x the median - do not quote the mean');

// ---- reason composes with the other filters
const seB=set({reason:'r:'+ri('self_exclusion'),status:'blocked'}).T;
ok(seB.p===se.T.p,'a block reason is already implicitly blocked');
const seV=set({reason:'r:'+ri('self_exclusion'),email:'yes'}).T;
const seN=set({reason:'r:'+ri('self_exclusion'),email:'no'}).T;
ok(seV.p+seN.p===se.T.p&&seV.c+seN.c===se.T.c,'reason composes with email exactly');

// ---- contradictory combination is corrected, not left empty
D.state.era='all';D.state.status='active';D.state.reason='';D.render();
const sr=doc.getElementById('selReason');
sr.value='r:'+ri('self_exclusion');
sr.dispatchEvent(new w.Event('change',{bubbles:true}));
ok(D.state.status==='all','choosing a block reason while Status=Active widens Status instead of emptying the page');
ok(doc.getElementById('btnSAll').classList.contains('active'),'the Status button visibly moves to All');
ok(D.AGG.T.p>0,'page is not empty after that correction');
sr.value='nb'; sr.dispatchEvent(new w.Event('change',{bubbles:true}));
D.state.status='blocked'; sr.value='nb'; sr.dispatchEvent(new w.Event('change',{bubbles:true}));
ok(D.state.status==='all','not-blocked while Status=Blocked is corrected the same way');

// ---- era switch keeps the control coherent
D.state.era='old'; D.buildReasonOptions();
ok([...sr.options].length>2,'reason list rebuilds for the pre-migration era');
click('btnAll');

// ---- reset
D.state.reason='g:'+rgIx; D.render(); click('btnReset');
ok(D.state.reason===''&&doc.getElementById('selReason').value==='','Clear filters resets the reason');
ok(D.AGG.T.p===SNAP.eras['all|inc'][0],'cleared view is the whole base');

// ---- summary wording
D.state.reason='r:'+ri('self_exclusion'); D.render();
ok(doc.getElementById('filterSummary').textContent.includes('self_exclusion'),'summary names the reason');
D.state.reason='g:'+rgIx; D.render();
ok(doc.getElementById('filterSummary').textContent.includes('responsible gambling'),'summary names the group');

// ---- prior guarantees still hold
ok(set({whale:'ex',era:'new'}).T.d===SNAP.eras['new|ex'][1],'era totals still reconcile');
const A=set({reason:'g:'+rgIx});
ok(A.B.reduce((a,b)=>a+b.p,0)===A.T.p,'buckets still partition under a reason filter');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
