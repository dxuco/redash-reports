const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const base={era:'all',whale:'inc',email:'all',phone:'all',status:'all',prod:-1,churn:'',reason:'',fraud:'all'};
const set=o=>{Object.assign(D.state,base,o); return D.aggregate();};
const setX=o=>{Object.assign(D.state,base,o); return D.crosstab();};

// ---- control exists, defaults to All
['btnFAll','btnFYes','btnFNo'].forEach(id=>ok(!!doc.getElementById(id),'control present: '+id));
ok(doc.querySelectorAll('.fgroup').length===9,'9 filter groups');
ok(D.state.fraud==='no','fraud defaults to No - fraud & abuse excluded');
ok(doc.getElementById('btnFNo').classList.contains('active'),'No is lit on load');
ok(!doc.getElementById('btnFYes').classList.contains('active')&&!doc.getElementById('btnFAll').classList.contains('active'),'Yes/All not lit on load');

// ---- yes/no partition the base, in every era
[['all',SNAP.eras['all|inc'][0]],['new',SNAP.eras['new|inc'][0]],['old',SNAP.eras['old|inc'][0]]].forEach(([era,total])=>{
  const y=set({era,fraud:'yes'}).T, n=set({era,fraud:'no'}).T, a=set({era}).T;
  ok(y.p+n.p===a.p&&a.p===total,era+': Yes + No == all players ('+y.p+' + '+n.p+' = '+total+')');
  ok(y.d+n.d===a.d,era+': deposit counts partition');
  ok(y.c+n.c===a.c,era+': value partitions exactly in cents');
});

// ---- Yes matches the Fraud & abuse group exactly
const gi=D.REASON_GROUPS.findIndex(g=>g[0]==='Fraud & abuse');
const viaGroup=set({reason:'g:'+gi}).T, viaFlag=set({fraud:'yes'}).T;
ok(viaGroup.p===viaFlag.p&&viaGroup.c===viaFlag.c,'Yes is identical to selecting the Fraud & abuse group');
ok(viaFlag.p===SNAP.fraudAbuse,'fraud & abuse matches the snapshot (got '+viaFlag.p+')');

// ---- member reasons sum to Yes
let mp=0; D.REASON_GROUPS[gi][1].forEach(r=>{mp+=set({reason:'r:'+r}).T.p;});
ok(mp===viaFlag.p,'the six member reasons sum to the Yes count');

// ---- No is NOT the same as clean-and-active
const no=set({fraud:'no'}).T, notBlocked=set({reason:'nb'}).T;
ok(no.p>notBlocked.p,'No is broader than not-blocked - it includes other block reasons');
ok(no.p===SNAP.eras['all|inc'][0]-SNAP.fraudAbuse,'No == everyone minus the fraud group');

// ---- independent of the Reason dropdown, and composes with it
const seIx=D.REASONS.indexOf('self_exclusion');
ok(set({reason:'r:'+seIx,fraud:'no'}).T.p===set({reason:'r:'+seIx}).T.p,'self-exclusion players all pass fraud=No');
ok(set({reason:'r:'+seIx,fraud:'yes'}).T.p===0,'self-exclusion players never pass fraud=Yes');
const maIx=D.REASONS.indexOf('multi_accounting');
ok(set({reason:'r:'+maIx,fraud:'yes'}).T.p===set({reason:'r:'+maIx}).T.p,'multi-accounting players all pass fraud=Yes');

// ---- composes with other filters exactly
const fy=set({fraud:'yes'}).T;
const fyv=set({fraud:'yes',email:'yes'}).T, fyn=set({fraud:'yes',email:'no'}).T;
ok(fyv.p+fyn.p===fy.p&&fyv.c+fyn.c===fy.c,'fraud composes with email exactly');

// ---- the cross-tab honours it too
const xa=setX({}), xy=setX({fraud:'yes'}), xn=setX({fraud:'no'});
ok(xy.grand+xn.grand===xa.grand,'cross-tab: Yes + No == all players');
ok(xy.grand===SNAP.fraudAbuse,'cross-tab Yes matches the snapshot');
ok(xy.rows.reduce((a,r)=>a+r.total,0)===xy.grand,'cross-tab still reconciles by row under fraud=Yes');
ok(xy.colTot.reduce((a,v)=>a+v,0)===xy.grand,'cross-tab still reconciles by column under fraud=Yes');
Object.assign(D.state,base,{fraud:'yes'});
const A=D.aggregate();
ok(setX({fraud:'yes'}).colTot.every((v,i)=>v===A.B[i].p),'cross-tab columns still match the Players row under fraud=Yes');

// ---- UI
Object.assign(D.state,base); D.render();
click('btnFYes');
ok(D.state.fraud==='yes'&&doc.getElementById('btnFYes').classList.contains('active'),'clicking Yes sets and lights it');
ok(!doc.getElementById('btnFAll').classList.contains('active'),'All unlights');
ok(doc.getElementById('filterSummary').textContent.includes('fraud & abuse blocks only'),'summary names the Yes filter');
click('btnFNo');
ok(doc.getElementById('filterSummary').textContent.includes('excluding fraud & abuse'),'summary names the No filter');
ok(new RegExp(SNAP.fraudAbuse.toLocaleString('en-US')).test(doc.getElementById('gFraud').title),'fraud tooltip carries the population size');
ok(doc.getElementById('gFraud').title.includes('multi-accounting'),'fraud tooltip lists what counts as fraud');
ok(doc.querySelectorAll('#tbl tbody tr').length===13&&doc.querySelectorAll('#xtab tbody tr').length>0,'both tables render under the filter');
click('btnReset');
ok(D.state.fraud==='all'&&doc.getElementById('btnFAll').classList.contains('active'),'Clear filters resets fraud');
ok(D.AGG.T.p===SNAP.eras['all|inc'][0],'cleared view is the whole base');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
