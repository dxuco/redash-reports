const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'..','country-funnel.html'),'utf8'),
  {runScripts:'dangerously'});
const w=dom.window,doc=w.document;let fail=0;
const ok=(nm,c,x)=>{if(c)console.log('  PASS '+nm);else{console.log('  FAIL '+nm+(x?'  -> '+x:''));fail++;}};

ok('script ran',!!w.CF);
const D=w.CF.D, ALL=D.countries;
const us=ALL.find(r=>r.c==='United States');
// A market whose deposit-modal step sits below the reporting floor. Found,
// not named: Qatar used to play this role and dropped out of the top 60
// on the first data refresh, crashing the whole file.
const qa=ALL.find(r=>r.f[3]>0&&r.f[3]<w.CF.MIN_DEN);

// --- the underlying funnel must still be a funnel --------------------------
// every ratio on this page divides one step by an earlier one, so if the
// cumulative rule was ever lost the ratios silently exceed 100%
let mono=true,bad='';
ALL.forEach(r=>{for(let i=0;i<4;i++)if(r.f[i]<r.f[i+1]){mono=false;bad=r.c+' step'+i;}});
ok('every country funnel is monotonic',mono,bad);
let over100=[];
ALL.forEach(r=>w.CF.RATIOS().forEach(s=>{
  if(r.f[s[1]]>=w.CF.MIN_DEN&&r.f[s[2]]/r.f[s[1]]>1)over100.push(r.c+' '+s[0]);}));
ok('no ratio exceeds 100%',over100.length===0,over100.slice(0,3).join(', '));

// --- opens on every market, current month, MTD -----------------------------
ok('opens on all 60 countries',w.CF.state.sel.length===ALL.length,w.CF.state.sel.length);
ok('opens on the current month',w.CF.state.period===D.months[D.months.length-1],
   w.CF.state.period);
ok('opens with MTD on',w.CF.state.mtd===true);
// The market picker was removed on request. state.sel remains the filter the
// tables read, and is now always every market, so this asserts the UI is gone
// rather than that the chips behave.
ok('the market picker is gone',
   !doc.getElementById('chips')&&!doc.getElementById('presets'));
// the period controls must agree with that state, or they lie on load
// The month group is 'Full window' followed by one button per month in order,
// so the newest month is simply the last button in it. Derived rather than
// named: this used to hard-code 'Aug' and broke the moment September arrived.
const _gp=[...doc.querySelectorAll('#period .seg')][0];
const _mb=[..._gp.querySelectorAll('button')];
const _newest=_mb[_mb.length-1].textContent;
const _pressed=[...doc.querySelectorAll('#period .seg button')]
  .filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent);
ok('period buttons agree with the default',
   _pressed.slice().sort().join('|')===
     ['All',_newest,'MTD (1\u2013'+D.mtdDay+')','Ratios'].sort().join('|'),
   _pressed.join('|'));
ok('the MTD toggle is enabled on load',
   [...doc.querySelectorAll('#period .seg button')].every(b=>!b.disabled));
// the Top 5 preset still exists and still returns the original five
ok('the Top 5 preset still returns the five defaults',
   D.defaults.length===5&&D.defaults[0]==='United States',D.defaults.join(', '));

// everything below examines the window view, so switch to it once here
w.CF.state.sel=D.defaults.slice();w.CF.state.period='all';w.CF.state.mtd=false;
w.CF.render();

// --- the ratio table -------------------------------------------------------
const rrows=()=>[...doc.querySelectorAll('#tratio tbody tr')];
ok('a row per country plus a total',rrows().length===6,rrows().length);
// country, registrants, five ratios, then median/avg session and bounce
ok('country, three absolute counts and five ratio columns',
   doc.querySelectorAll('#tratio thead th').length===9,
   doc.querySelectorAll('#tratio thead th').length);
// the denominator is shown, so a rate is never read without knowing its base
const usR=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('all three absolute counts are shown beside the rates',
   usR.cells[1].textContent===us.f[0].toLocaleString()&&
   usR.cells[2].textContent===us.f[2].toLocaleString()&&
   usR.cells[3].textContent===us.f[4].toLocaleString(),
   [1,2,3].map(i=>usR.cells[i].textContent).join(' / '));
// recompute every cell from the raw counts rather than re-reading the page
w.CF.RATIOS().forEach((spec,i)=>{
  const den=us.f[spec[1]],num=us.f[spec[2]];
  const want=den<w.CF.MIN_DEN?'—':(num/den*100).toFixed(1)+'%';
  ok('US ratio "'+spec[0]+'" recomputes',usR.cells[i+4].textContent===want,
     usR.cells[i+4].textContent+' vs '+want);
});

// the total row must be WEIGHTED, not the mean of the country rates -- and the
// two have to differ, or the test proves nothing
const totR=rrows()[rrows().length-1];
const sel5=w.CF.selected();
const weighted=sel5.reduce((a,r)=>a+r.f[4],0)/sel5.reduce((a,r)=>a+r.f[2],0)*100;
const meanRate=sel5.reduce((a,r)=>a+r.f[4]/r.f[2]*100,0)/sel5.length;
ok('total ratio row is weighted',totR.cells[8].textContent===weighted.toFixed(1)+'%',
   totR.cells[8].textContent+' vs weighted '+weighted.toFixed(1)+'%');
ok('weighted and mean actually differ',Math.abs(weighted-meanRate)>1,
   'weighted '+weighted.toFixed(1)+' mean '+meanRate.toFixed(1));

// headers are deliberately abbreviated so ten columns fit without scrolling
ok('ratio headers use the short forms',
   hdrsNow().join('|')==='Country|Visits|Regs|FTD|Reg. Modal / Visits|Reg. / Reg. Modal|'
     +'Dep. Modal / Reg.|Dep. / Dep. Modal|Dep. / Reg.',
   hdrsNow().join('|'));
function hdrsNow(){return [...doc.querySelectorAll('#tratio thead th')].map(t=>t.textContent);}

// counts and the rates derived from them are different kinds of number, so a
// rule separates them -- on the header AND on every body row, or it reads as a
// stray mark rather than a boundary
ok('a rule marks the count/ratio boundary in the header',(function(){
   var th=[...doc.querySelectorAll('#tratio thead th')];
   var i=th.findIndex(t=>t.classList.contains('sep'));
   return i===4&&/\//.test(th[i].textContent)&&!/\//.test(th[i-1].textContent);})(),
   [...doc.querySelectorAll('#tratio thead th')]
     .map((t,i)=>t.classList.contains('sep')?i+':'+t.textContent:null).filter(Boolean).join());
ok('and on every body row including the total',
   rrows().every(tr=>tr.cells[4]&&tr.cells[4].classList.contains('sep')));
ok('exactly one column carries it',
   [...doc.querySelectorAll('#tratio thead th')].filter(t=>t.classList.contains('sep')).length===1);

// the session columns were deleted: they were measured over the whole window
// and read as a wall of dashes in the month view the page now opens on. The
// data is still in the payload if they are ever wanted back.
ok('no session columns remain',
   !hdrsNow().some(h=>/Session|Bounce/.test(h)),hdrsNow().join('|'));
ok('but the session data is still in the payload',!!us.sess&&us.sess.med>=0);

// --- period selector -------------------------------------------------------
ok('the full window can be selected',w.CF.state.period==='all'&&w.CF.state.mtd===false);
ok('period buttons follow the selection',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>b.getAttribute('aria-pressed')==='true')
     .map(b=>b.textContent).sort().join('|')==='All|Full window|Ratios',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent).join('|'));
// window + 4 months, 2 month-span, 2 view, 3 rails -- and the day list is a
// select, not buttons, so it is not in this count
ok('a button per month, plus the window, MTD, view and rail controls',
   doc.querySelectorAll('#period .seg button').length===D.months.length+8,
   doc.querySelectorAll('#period .seg button').length);
ok('the controls sit in the green header',
   !!doc.querySelector('header #period')&&
   doc.querySelectorAll('header #period .seg').length===4,
   doc.querySelectorAll('header #period .seg').length+' groups');
// MTD is meaningless against the whole window, so it must not look available
ok('MTD toggle is disabled on the full window',
   [...doc.querySelectorAll('#period .seg button')].filter(b=>b.disabled).length===2);

// a month must read from the monthly data, not silently fall back to the window
w.CF.state.period='2026-07';w.CF.render();
const julRow=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('July shows July registrants, not the window figure',
   julRow.cells[2].textContent===us.m['2026-07'][2].toLocaleString()&&
   julRow.cells[2].textContent!==us.f[2].toLocaleString(),
   julRow.cells[2].textContent);
ok('MTD toggle becomes available once a month is chosen',
   [...doc.querySelectorAll('#period .seg button')].filter(b=>b.disabled).length===0);

// MTD must actually change a closed month, or the toggle is decorative
w.CF.state.mtd=true;w.CF.render();
const julMtd=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('MTD trims July',julMtd.cells[2].textContent===us.mtd['2026-07'][2].toLocaleString()&&
   us.mtd['2026-07'][2]<us.m['2026-07'][2],
   us.mtd['2026-07'][2]+' vs '+us.m['2026-07'][2]);
// ...and must NOT change the current month, which the window already ends inside.
// This named August, which was right only while the window ended inside August
// and MTD trimmed to day 30. The window now ends 2 September and MTD trims to
// day 2, so August is a CLOSED month that MTD legitimately cuts down, while
// September is the one left untouched. Track the newest month, never name one.
const curMonth=D.months[D.months.length-1];
w.CF.state.period=curMonth;w.CF.render();
const curMtd=[...rrows()].map(tr=>[...tr.cells].map(c=>c.textContent).join());
w.CF.state.mtd=false;w.CF.render();
const curAll=[...rrows()].map(tr=>[...tr.cells].map(c=>c.textContent).join());
ok('MTD leaves the current month untouched',curMtd.join('|')===curAll.join('|'),
   curMonth);

// every closed month must be a subset of the whole month, everywhere
let mtdOver=[];
ALL.forEach(r=>D.months.forEach(m=>{
  if(m===D.months[D.months.length-1])return;
  const a=r.mtd&&r.mtd[m], b=r.m&&r.m[m];
  if(a&&b)for(let s=0;s<5;s++)if(a[s]>b[s])mtdOver.push(r.c+' '+m+' step'+(s+1));
}));
ok('no trimmed month exceeds its whole month',mtdOver.length===0,mtdOver.slice(0,3).join(', '));



// a country with no data in the period is named, not silently dropped
// A market missing a given month, found rather than named -- which market that
// is changes every refresh.
const gone=ALL.find(r=>!(r.m||{})['2026-05']&&(r.m||{})['2026-08']);
w.CF.state.period='2026-05';w.CF.state.sel=['United States',gone?gone.c:'United States'];
w.CF.render();
// Not a failure if every market has May data -- that is a property of the
// window, not of the page. The drop-behaviour assertion below still runs when
// such a market exists, and is skipped honestly when none does.
ok('the drop-from-period case is testable, or absent',true,
   gone?('using '+gone.c):'no market lacks May data in this window');
ok('a country absent from the period is dropped from the table',
   !gone||!rrows().some(tr=>tr.cells[0].textContent===gone.c),
   gone?gone.c:'(none)');
function byName2(c){return ALL.find(r=>r.c===c);}

// sorting follows the period: a market big in the window but small in the month
// must not sit at the top of the month
w.CF.state.period='2026-06';w.CF.state.mtd=false;
w.CF.state.sel=['United States','Mexico','South Africa'];w.CF.render();
const order=[...rrows()].slice(0,3).map(tr=>tr.cells[0].textContent);
const byJune=['United States','Mexico','South Africa']
  .sort((a,b)=>byName2(b).m['2026-06'][2]-byName2(a).m['2026-06'][2]);
ok('rows are ordered by registrants in the chosen period',
   order.join()===byJune.join(),order.join()+' vs '+byJune.join());

w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.sel=D.defaults.slice();w.CF.render();

// --- guards on small numbers and rounding ---------------------------------
w.CF.state.sel=[qa?qa.c:'United States'];w.CF.render();
ok('some market has a denominator below the floor',!!qa,
   'none found under '+w.CF.MIN_DEN);
ok('a ratio on too few people is suppressed',
   [...rrows()[0].cells].some(c=>c.textContent==='—'));
w.CF.state.sel=['South Africa'];w.CF.render();
const za=ALL.find(r=>r.c==='South Africa');
ok('South Africa keeps its decimal rather than rounding to 0%',
   rrows()[0].cells[8].textContent===(za.f[4]/za.f[2]*100).toFixed(1)+'%',
   rrows()[0].cells[8].textContent);
w.CF.state.sel=D.defaults.slice();w.CF.render();

// --- the findings this page exists to show --------------------------------
const de=ALL.find(r=>r.c==='Germany');
// the US break is AFTER the deposit modal opens, not before it -- that is what
// separates a payment problem from a demand problem
ok('US reaches the deposit modal as well as Germany',
   us.f[3]/us.f[2]>=de.f[3]/de.f[2]*0.95,
   (us.f[3]/us.f[2]*100).toFixed(0)+'% vs '+(de.f[3]/de.f[2]*100).toFixed(0)+'%');
ok('US fails inside the deposit modal',
   us.f[4]/us.f[3]<de.f[4]/de.f[3]/2,
   (us.f[4]/us.f[3]*100).toFixed(1)+'% vs '+(de.f[4]/de.f[3]*100).toFixed(1)+'%');

// --- everything else really is gone ---------------------------------------
['ch','ch2','tsel','tgap','tall','ch1','msel','scale'].forEach(id=>
  ok('#'+id+' removed',!doc.getElementById(id)));
ok('no charts remain',doc.querySelectorAll('svg').length===0,
   doc.querySelectorAll('svg').length);
// the ratio table, the source drilldown, the player drilldown and campaigns.
// Named rather than counted, so adding a table is a deliberate edit here and
// a stray one still fails.
ok('exactly the seven expected tables are present',
   ['tratio','tsrc','tchan','tply','tbtag','terr','tsess']
     .every(id=>doc.getElementById(id))
     &&doc.querySelectorAll('table').length===7,
   [...doc.querySelectorAll('table')].map(t=>t.id||'(unnamed)').join(', '));
// but the data behind the removed sections is still in the file, so nothing
// has to be re-pulled to bring a section back
ok('monthly data is still present in the payload',!!D.monthly&&
   Object.keys(D.monthly).length>0,Object.keys(D.monthly||{}).length+' countries');

// --- the explanatory blocks were removed on request ----------------------
// the orange column marking is now the only warning left on the page, so it
// must stay: the Visits column and the ratio built on it both carry the
// attribution defect described nowhere else anymore.
ok('no explanatory note blocks remain',
   doc.querySelectorAll('.note, .verdict, footer').length===0,
   doc.querySelectorAll('.note, .verdict, footer').length);
ok('the two attribution-affected columns are still marked',(function(){
   var h=[...doc.querySelectorAll('#tratio thead th')];
   return h[1].classList.contains('warnflag')&&h[4].classList.contains('warnflag');})(),
   [...doc.querySelectorAll('#tratio thead th')].map(t=>t.className).join('|'));

// --- interaction ----------------------------------------------------------
ok('no toggle is exposed once the picker is gone',typeof w.CF.toggle==='undefined');
w.CF.state.sel=ALL.map(r=>r.c);w.CF.render();
ok('all 60 render without a total-row miscount',rrows().length===61,rrows().length);
w.CF.state.sel=[];w.CF.render();
ok('an empty market list says so instead of rendering a bare table',
   rrows().length===1&&/No markets to show/.test(rrows()[0].textContent),
   rrows()[0].textContent);
w.CF.state.sel=D.defaults.slice();w.CF.render();

// --- source drilldown ------------------------------------------------------
const srows=()=>[...doc.querySelectorAll('#tsrc tbody tr')];
w.CF.state.drill=null;w.CF.render();
// This used to require an empty table and a "click a country" instruction.
// Section 03 now opens on every source across every country, and clicking a
// country narrows it -- so the assertion is that it starts FULL, and says how
// to filter it.
ok('the source table opens on every country',srows().length>1&&
   /Click a country above to filter/.test(doc.getElementById('snote').textContent),
   srows().length+' rows');
// clicking a country row is what opens it
const clickRow=rrows().find(tr=>tr.cells[0].textContent==='United States');
clickRow.onclick();
ok('clicking a country row opens its sources',w.CF.state.drill==='United States'&&
   srows().length>0,srows().length+' rows');
ok('the clicked row is marked',
   rrows().find(tr=>tr.cells[0].textContent==='United States').className==='sel');
ok('source table has the same columns',
   doc.querySelectorAll('#tsrc thead th').length===9,
   doc.querySelectorAll('#tsrc thead th').length);

// every source funnel must itself be a funnel
let sbad=[];
ALL.filter(r=>r.src).forEach(r=>r.src.forEach(s=>{
  for(let i=0;i<4;i++)if(s.f[i]<s.f[i+1])sbad.push(r.c+' / '+s.s);}));
ok('every source funnel is monotonic',sbad.length===0,sbad.slice(0,3).join(', '));

// Sources are first-touch and therefore disjoint. They no longer sum EXACTLY
// to the country row: registrants and FTDs per source come from the later
// player pull, so a live day adds a few. Assert the gap is drift-sized, not
// that it is zero -- and that the remainder row never goes negative.
let srcGap=[];
ALL.filter(r=>r.src).forEach(r=>{
  const sum=r.src.reduce((a,s)=>a+s.f[2],0);
  const lim=r.f[2]*0.05+5;
  if(sum-r.f[2]>lim) srcGap.push(r.c+': '+sum+' vs '+r.f[2]);
});
ok('source rows stay within ingestion drift of their country',
   srcGap.length===0,srcGap.slice(0,3).join(', '));
ALL.filter(r=>r.src).forEach(r=>r.src.forEach(s=>{
  if(s.f.some(v=>v<0)) ok('no negative counts in '+r.c+'/'+s.s,false,s.f.join(','));
}));
ok('no source row carries a negative count',true);
const usSrc=us.src;
// last row is now the country total; the remainder sits just above it
ok('a remainder row exists and is labelled as such',
   usSrc[usSrc.length-1].rest===true&&
   /Other/.test(srows()[srows().length-2].cells[0].textContent),
   srows().slice(-2).map(tr=>tr.cells[0].textContent).join(' | '));

// --- the source table adds up ---------------------------------------------
// "the sums don't work" was a real bug: source registrants came from a later
// pull than the country row, so the parts exceeded the whole and the remainder
// was clamped to a meaningless zero. The country row now adopts the higher
// figure, so these must reconcile exactly.
const srcTot=srows()[srows().length-1];
ok('the last row is the country total',/all sources/.test(srcTot.cells[0].textContent),
   srcTot.cells[0].textContent);
[[1,0],[2,2],[3,4]].forEach(([cell,idx])=>{
  const parts=us.src.reduce((a,s)=>a+s.f[idx],0);
  ok('source column '+cell+' sums to the country figure',
     srcTot.cells[cell].textContent===parts.toLocaleString()&&parts===us.f[idx],
     srcTot.cells[cell].textContent+' vs country '+us.f[idx].toLocaleString());
});
// and it agrees with the row for the same country in the table above
const usRow2=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('section 03 total matches section 02 for the same country',
   srcTot.cells[2].textContent===usRow2.cells[2].textContent&&
   srcTot.cells[3].textContent===usRow2.cells[3].textContent,
   srcTot.cells[2].textContent+'/'+srcTot.cells[3].textContent+' vs '+
   usRow2.cells[2].textContent+'/'+usRow2.cells[3].textContent);
// every country, not just this one
let sumBad=[];
ALL.filter(r=>r.src).forEach(r=>{
  [0,2,4].forEach(i=>{
    if(r.src.reduce((a,s)=>a+s.f[i],0)!==r.f[i])sumBad.push(r.c+' step'+(i+1));});
});
ok('every country reconciles with its sources exactly',sumBad.length===0,
   sumBad.slice(0,3).join(', '));

// --- sortable headers ------------------------------------------------------
const ratioHdr=()=>[...doc.querySelectorAll('#tratio thead th')];
ok('ratio headers are clickable',ratioHdr().every(th=>th.classList.contains('s')));
w.CF.state.sel=D.defaults.slice();w.CF.state.sortRatio={key:null,dir:-1};w.CF.render();
const beforeSort=rrows().map(tr=>tr.cells[0].textContent);
ratioHdr()[3].onclick();                       // FTD, descending
const ftdDesc=rrows().slice(0,-1).map(tr=>parseInt(tr.cells[3].textContent.replace(/,/g,'')));
ok('clicking a header sorts descending',
   ftdDesc.every((v,i)=>i===0||v<=ftdDesc[i-1]),ftdDesc.join(','));
ok('and it actually changed the order',
   rrows().map(tr=>tr.cells[0].textContent).join()!==beforeSort.join());
ratioHdr()[3].onclick();                       // same header again, ascending
const ftdAsc=rrows().slice(0,-1).map(tr=>parseInt(tr.cells[3].textContent.replace(/,/g,'')));
ok('clicking again reverses it',ftdAsc.every((v,i)=>i===0||v>=ftdAsc[i-1]),ftdAsc.join(','));
ok('the sorted header shows a direction arrow',
   /[▲▼]/.test(ratioHdr()[3].textContent),ratioHdr()[3].textContent);
ok('the total row stays at the bottom when sorted',
   /All markets/.test(rrows()[rrows().length-1].cells[0].textContent),
   rrows()[rrows().length-1].cells[0].textContent);
// a dash is an absence, not a low number: it must not float to the top.
// Qatar's deposit-modal step is below the reporting floor, so its last two
// ratios are dashes while its registrant count is not.
w.CF.state.sel=['United States',qa?qa.c:'Germany','Germany'];
w.CF.state.sortRatio={key:'Dep. / Dep. Modal',dir:1};w.CF.render();
ok('rows with no value sort last even ascending',
   rrows()[rrows().length-2].cells[7].textContent==='—',
   rrows().map(tr=>tr.cells[0].textContent+':'+tr.cells[7].textContent).join(' | '));
w.CF.state.sel=D.defaults.slice();w.CF.state.sortRatio={key:null,dir:-1};w.CF.render();

// the source table sorts too, and pins its residue row
w.CF.state.drill='United States';w.CF.render();
[...doc.querySelectorAll('#tsrc thead th')][3].onclick();
const sFtd=srows().slice(0,-2).map(tr=>parseInt(tr.cells[3].textContent.replace(/,/g,'')));
ok('source table sorts by FTD',sFtd.every((v,i)=>i===0||v<=sFtd[i-1]),sFtd.join(','));
ok('the remainder row stays pinned above the total when sorted',
   /Other/.test(srows()[srows().length-2].cells[0].textContent));
w.CF.state.sortSrc={key:null,dir:-1};w.CF.render();

// the player table sorts too (prows() is declared further down, so query
// the DOM directly here rather than reaching forward into its temporal dead zone)
w.CF.state.drillSrc='m.facebook.com';w.CF.render();
[...doc.querySelectorAll('#tply thead th')][4].onclick();
const times=[...doc.querySelectorAll('#tply tbody tr')].map(tr=>tr.cells[4].textContent);
ok('player table sorts by time on site',times.length>0&&
   /[dhm]$/.test(times[0]),times.slice(0,3).join(' | '));
ok('player headers are clickable',
   [...doc.querySelectorAll('#tply thead th')].every(th=>th.classList.contains('s')));
w.CF.state.sortPly={key:null,dir:-1};w.CF.state.drillSrc=null;w.CF.render();
// the remainder is clamped at zero and pushed forward so the row stays a
// funnel -- an independently clamped remainder went up between steps
const restRow=usSrc[usSrc.length-1];
ok('the remainder row is itself a funnel',
   restRow.f.every((v,i)=>i===0||v<=restRow.f[i-1]),restRow.f.join(','));
ok('the remainder never goes negative',restRow.f.every(v=>v>=0),restRow.f.join(','));
// recompute a cell from the raw counts
const fbRow=srows().find(tr=>tr.cells[0].textContent==='m.facebook.com');
const fb=usSrc.find(s=>s.s==='m.facebook.com');
ok('a source ratio recomputes',
   fbRow.cells[8].textContent===(fb.f[4]/fb.f[2]*100).toFixed(1)+'%',
   fbRow.cells[8].textContent);
// the self-referred row is the defect, not a channel, and must stay marked
ok('the self-referred source is flagged',
   srows()[0].cells[0].className==='warnflag'&&
   /attribution lost/.test(srows()[0].cells[0].textContent));

// clicking the same row again clears the filter -- which now returns section 03
// to every country rather than emptying it
clickRow.onclick();
ok('clicking again clears the country filter',
   w.CF.state.drill===null&&srows().length>1,
   w.CF.state.drill+' / '+srows().length+' rows');

// a country with no source split says so instead of rendering an empty table
// A market with no source split at all. Every one of the current 60 has one,
// so this is skipped rather than forced onto a market that does.
const nosplit=ALL.find(r=>!r.src);
w.CF.state.drill=nosplit?nosplit.c:null;w.CF.render();
ok('a market below the threshold explains itself',
   !nosplit||(srows().length===0&&/no source breakdown/.test(doc.getElementById('snote').textContent)),
   nosplit?doc.getElementById('snote').textContent:'no market lacks a source split');

// This assertion used to read the other way round: back when section 03 was
// window-only it required the figures to STAY at the window value. It went on
// passing after the per-period pull landed, because the Regs column was still
// reading the window array -- so the test was holding the bug in place rather
// than catching it. Now it demands the opposite: July must be July.
w.CF.state.drill='United States';w.CF.state.period='2026-07';w.CF.state.mtd=false;
w.CF.render();
const julSrc=srows().find(tr=>tr.cells[0].textContent==='m.facebook.com');
ok('source figures follow the period',
   julSrc.cells[2].textContent===fb.m['2026-07'].f[2].toLocaleString()
   &&julSrc.cells[2].textContent!==fb.f[2].toLocaleString(),
   'july '+julSrc.cells[2].textContent+' vs window '+fb.f[2].toLocaleString());
// prose above the drilldown is empty on the window, and carries the
// different-period warning otherwise -- checked in its own block further down
ok('no prose is printed above the drilldown on the window view',
   w.CF.state.period!=='all'||doc.getElementById('snote').textContent==='',
   doc.getElementById('snote').textContent);
w.CF.state.period='all';w.CF.state.drill=null;w.CF.render();

// --- section 04: players, at country level and narrowed by source ----------
const prows=()=>[...doc.querySelectorAll('#tply tbody tr')];
w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.rail='all';
w.CF.state.view='ratio';w.CF.state.drill=null;w.CF.state.drillSrc=null;
w.CF.state.sortPly={key:null,dir:-1};w.CF.render();
// The invitation now names all three things that fill this table, since a
// source and a campaign select it as well as a country.
ok('player table starts empty with an instruction',prows().length===0&&
   /Click a country, a source or a campaign/.test(doc.getElementById('pnote2').textContent),
   doc.getElementById('pnote2').textContent);

// clicking a country alone fills it with every player that country has a list for
w.CF.state.drill='United States';w.CF.render();
const countryPlayers=us.src.filter(s=>s.p).reduce((a,s)=>a+s.p.length,0);
ok('a country alone lists all its players',prows().length===countryPlayers,
   prows().length+' vs '+countryPlayers);
ok('and shows which source each came from',
   [...doc.querySelectorAll('#tply thead th')].map(t=>t.textContent)
     .join('|')==='User|Source|Reg. Date|Dep. Modal|FTD|Time on Site',
   [...doc.querySelectorAll('#tply thead th')].map(t=>t.textContent).join('|'));
// the lists exclude the attribution-lost bucket, so the caption must say what
// share of the country's registrants this actually is, not imply it is all
ok('the caption states the coverage',
   /% of the country/.test(doc.getElementById('pnote2').textContent),
   doc.getElementById('pnote2').textContent.slice(-90));
ok('coverage is well under 100%',(function(){
   var m=/(\d+)% of the country/.exec(doc.getElementById('pnote2').textContent);
   return m&&+m[1]<80;})(),doc.getElementById('pnote2').textContent.slice(-60));

// clicking a source narrows the same list
const fbSrc=us.src.find(s=>s.s==='m.facebook.com');
w.CF.state.drillSrc='m.facebook.com';w.CF.render();
ok('a source narrows it to that source',prows().length===fbSrc.p.length,
   prows().length+' vs '+fbSrc.p.length);
ok('the source column drops away once one is chosen',
   [...doc.querySelectorAll('#tply thead th')].map(t=>t.textContent)
     .join('|')==='User|Reg. Date|Dep. Modal|FTD|Time on Site');
ok('narrowing really is a subset',fbSrc.p.length<countryPlayers,
   fbSrc.p.length+' of '+countryPlayers);

// the period buttons filter the list by registration date, no extra data needed
w.CF.state.drillSrc=null;w.CF.state.period='2026-08';w.CF.state.mtd=true;
w.CF.render();
const augCount=prows().length;
ok('a month filters the player list',augCount>0&&augCount<countryPlayers,
   augCount+' of '+countryPlayers);
ok('every row shown really is in that month',
   prows().every(tr=>/^08-/.test(tr.cells[2].textContent)),
   prows().slice(0,3).map(tr=>tr.cells[2].textContent).join());
w.CF.state.period='2026-08-29';w.CF.render();
ok('a day filters to that date alone',
   prows().every(tr=>tr.cells[2].textContent==='08-29'),
   prows().length+' rows');
ok('a day is a subset of its month',prows().length<augCount,
   prows().length+' of '+augCount);
w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();

// the no-username signal survives at country level
const noname=prows().filter(tr=>/no username set/.test(tr.cells[0].textContent));
ok('accounts with no username are shown, not dropped',noname.length>0,
   noname.length+' of '+prows().length);
ok('and flagged in the warning colour',noname[0].cells[0].className==='warnflag');
// so does the attribution-lost marking on the source column
ok('the source column marks attribution-lost rows',
   prows().every(tr=>tr.cells[1].textContent!=='fortunejack.com')||
   prows().some(tr=>tr.cells[1].className==='warnflag'));

// depositors sort first by default
const ftdFlags=prows().map(tr=>tr.cells[4].textContent==='yes');
const ftdTotal=ftdFlags.filter(Boolean).length;
ok('depositors are listed first',
   ftdFlags.slice(0,ftdTotal).every(Boolean)&&!ftdFlags[ftdTotal],
   'first non-depositor at '+ftdFlags.indexOf(false));

// A market with no player list at all explains itself rather than showing an
// empty table. Every one of the current 60 has one, so this is skipped rather
// than forced onto a market that does -- with drill=null the panel correctly
// shows the "click something" invitation, which is a different assertion.
w.CF.state.drill=nosplit?nosplit.c:null;w.CF.render();
ok('a market with no player list explains itself',
   !nosplit||(prows().length===0&&
     /no player list/.test(doc.getElementById('pnote2').textContent)),
   nosplit?doc.getElementById('pnote2').textContent.slice(0,60)
         :'every market has a player list');

// every player list is internally consistent with its source row
let plBad=[];
ALL.forEach(r=>(r.src||[]).forEach(s=>{
  if(!s.p)return;
  if(s.p.length!==s.f[2])plBad.push(r.c+'/'+s.s+' n');
  if(s.p.filter(x=>x.f).length!==s.f[4])plBad.push(r.c+'/'+s.s+' ftd');
}));
ok('every player list reconciles with its source row',plBad.length===0,
   plBad.slice(0,3).join(', '));
const totalPlayers=ALL.flatMap(r=>r.src||[]).filter(s=>s.p)
  .reduce((a,s)=>a+s.p.length,0);
ok('the page carries the full player set',totalPlayers>8000,String(totalPlayers));

w.CF.state.drill=null;w.CF.state.drillSrc=null;w.CF.render();

// --- ratios / numbers switcher --------------------------------------------
w.CF.state.sel=['United States','Germany','South Africa'];
w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.rail='all';
w.CF.state.view='ratio';w.CF.state.drill=null;w.CF.state.drillSrc=null;
w.CF.state.sortRatio={key:null,dir:-1};w.CF.render();
ok('opens on ratios',w.CF.state.view==='ratio');
ok('two view buttons exist',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>/^(Ratios|Numbers)$/.test(b.textContent)).length===2);

w.CF.state.view='abs';w.CF.render();
const AH=()=>[...doc.querySelectorAll('#tratio thead th')].map(t=>t.textContent);
ok('numbers mode shows the whole chain',
   AH().join('|')==='Country|Visits|Reg. Modal|Register|Dep. Modal|Copy Address|Deposit',
   AH().join('|'));
ok('the view button follows the state',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>b.getAttribute('aria-pressed')==='true')
     .some(b=>b.textContent==='Numbers'));
// The rail buttons used to be disabled here, on the grounds that Numbers shows
// every step anyway. It does not -- its last two columns are the All-rail ones
// -- so they work in both views now, and the last two headers follow the rail.
ok('the rail buttons work in numbers mode',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>/^(All|Fiat|Crypto)$/.test(b.textContent)).every(b=>!b.disabled));
w.CF.state.rail='fiat';w.CF.render();
ok('numbers under fiat swaps the last two columns',
   AH().slice(-2).join('|')==='Fiat Start|Fiat FTD',AH().join('|'));
w.CF.state.rail='crypto';w.CF.render();
ok('numbers under crypto swaps them again',
   AH().slice(-2).join('|')==='Copy Address|Crypto FTD',AH().join('|'));
// the first four steps are rail-independent and must not move
const deAll=(r)=>{w.CF.state.rail=r;w.CF.render();
  const tr=[...doc.querySelectorAll('#tratio tbody tr')]
    .find(t=>t.cells[0].textContent==='Germany');
  return [...tr.cells].map(c=>c.textContent);};
const a=deAll('all'), f=deAll('fiat'), c=deAll('crypto');
ok('the first four steps are identical across rails',
   a.slice(1,5).join('|')===f.slice(1,5).join('|')&&
   a.slice(1,5).join('|')===c.slice(1,5).join('|'),
   [a,f,c].map(x=>x.slice(1,5).join('/')).join('  vs  '));
// a rail deposit can never exceed the deposit-modal step above it
ok('rail counts sit under the deposit modal',
   [f,c].every(x=>{const dm=Number(x[4].replace(/,/g,''));
     return [5,6].every(i=>x[i]==='—'||Number(x[i].replace(/,/g,''))<=dm);}),
   f.join('|')+'  ||  '+c.join('|'));
w.CF.state.rail='all';w.CF.render();

// every figure must be the raw count, and the chain must be a funnel
const usAbs=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('numbers are the raw counts',
   usAbs.cells[1].textContent===us.f[0].toLocaleString()&&
   usAbs.cells[2].textContent===us.f[1].toLocaleString()&&
   usAbs.cells[3].textContent===us.f[2].toLocaleString()&&
   usAbs.cells[4].textContent===us.f[3].toLocaleString()&&
   usAbs.cells[6].textContent===us.f[4].toLocaleString(),
   [...usAbs.cells].map(c=>c.textContent).join(' | '));
ok('copy address comes from the crypto side of the rail data',
   usAbs.cells[5].textContent===us.rail.w.c[0].toLocaleString(),
   usAbs.cells[5].textContent+' vs '+us.rail.w.c[0]);
const nums=[...usAbs.cells].slice(1).map(c=>parseInt(c.textContent.replace(/,/g,'')));
ok('the chain never goes up',nums.every((v,i)=>i===0||v<=nums[i-1]),nums.join(' > '));

// a market below the rail floor shows a dash for copy address, not a zero
const noC=ALL.find(r=>!r.rail||!r.rail.w.c);
if(noC){
  w.CF.state.sel=[noC.c];w.CF.render();
  ok('copy address is a dash where it was not reported',
     rrows()[0].cells[5].textContent==='—',rrows()[0].cells[5].textContent);
}else ok('copy address is a dash where it was not reported',true,'no such market');

// the source table switches too, and still reconciles
w.CF.state.sel=D.defaults.slice();w.CF.state.drill='United States';w.CF.render();
ok('the source table switches to numbers',
   [...doc.querySelectorAll('#tsrc thead th')].map(t=>t.textContent).join('|')
     ==='Source|Visits|Reg. Modal|Register|Dep. Modal|Copy Address|Deposit');
const srcTotAbs=srows()[srows().length-1];
ok('source numbers still sum to the country',
   srcTotAbs.cells[1].textContent===us.f[0].toLocaleString()&&
   srcTotAbs.cells[3].textContent===us.f[2].toLocaleString()&&
   srcTotAbs.cells[6].textContent===us.f[4].toLocaleString(),
   [...srcTotAbs.cells].map(c=>c.textContent).join(' | '));
// clicking a source row still opens the player list from numbers mode
srows().find(tr=>/m\.facebook/.test(tr.cells[0].textContent)).onclick();
ok('the drilldown still works in numbers mode',
   w.CF.state.drillSrc==='m.facebook.com'&&prows().length>0);

// switching back restores the ratio columns
w.CF.state.view='ratio';w.CF.render();
ok('switching back restores the ratios',/\//.test(AH()[4]),AH().join('|'));
w.CF.state.rail='all';w.CF.state.drill=null;w.CF.state.drillSrc=null;
w.CF.state.sel=D.defaults.slice();w.CF.render();

// --- day filter ------------------------------------------------------------
w.CF.state.sel=D.defaults.slice();w.CF.state.period='all';w.CF.state.mtd=false;
w.CF.state.rail='all';w.CF.state.view='ratio';w.CF.state.drill=null;
w.CF.state.drillSrc=null;w.CF.render();
// Was pinned to 121 days. The window grows with every refresh, so assert the
// series is continuous and complete instead of counting to a constant.
ok('every day of the window is offered',(function(){
  const d=D.days;
  for(let i=1;i<d.length;i++){
    const prev=new Date(d[i-1]+'T00:00:00Z'), cur=new Date(d[i]+'T00:00:00Z');
    if((cur-prev)/86400000!==1)return false;
  }
  return d.length>=121;})(),D.days.length+' days, '+D.days[0]+' to '+D.days[D.days.length-1]);
ok('the picker lists them all plus a clear option',
   doc.querySelectorAll('#dsel option').length===D.days.length+1,
   doc.querySelectorAll('#dsel option').length);
// Pinned to a literal date, which a refresh moves. The day series must simply
// reach the end of the window it claims to cover.
ok('the last day offered is the last day analysed',
   D.days[D.days.length-1].slice(0,7)===D.months[D.months.length-1]&&
   Number(D.days[D.days.length-1].slice(8))>=D.mtdDay,
   D.days[D.days.length-1]+' vs mtdDay '+D.mtdDay);

w.CF.state.period=D.days[D.days.length-1];w.CF.state.view='abs';w.CF.render();
const dayRow=rrows().find(tr=>tr.cells[0].textContent==='United States');
// Read the day from the data rather than naming one -- the last day moves
// with every refresh.
const lastDay=D.days[D.days.length-1];
ok('a day reads from the day series, not the month',
   dayRow.cells[1].textContent===us.d[lastDay][0].toLocaleString()&&
   dayRow.cells[1].textContent!==us.m[lastDay.slice(0,7)][0].toLocaleString(),
   lastDay+': '+dayRow.cells[1].textContent);
const dayNums=[...dayRow.cells].slice(1).map(c=>c.textContent==='—'?null:
  parseInt(c.textContent.replace(/,/g,'')));
// Steps 1-4 and the final deposit are the cumulative chain. Copy Address is
// NOT part of it -- it is the crypto rail's entry step and undercounts, because
// a saved wallet deposits without copying an address, so deposits legitimately
// exceed it. Including it here passed only by luck on the old last day.
const chain=[dayNums[0],dayNums[1],dayNums[2],dayNums[3]].filter(v=>v!=null);
ok('the day chain is still a funnel',
   chain.every((v,i,a)=>i===0||v<=a[i-1])&&
   (dayNums[5]==null||dayNums[3]==null||dayNums[5]<=dayNums[3]),
   dayNums.join(' > '));
// MTD trims a month to a day count; on a single day it means nothing
ok('MTD is disabled on a day',
   [...doc.querySelectorAll('#period .seg button')]
     .filter(b=>/MTD|Whole months/.test(b.textContent)).every(b=>b.disabled));
ok('no month button claims to be selected on a day',
   ![...doc.querySelectorAll('#period .seg button')]
     .filter(b=>/^(May|Jun|Jul|Aug|Full window)$/.test(b.textContent))
     .some(b=>b.getAttribute('aria-pressed')==='true'));

// the rail switcher still works on a day
w.CF.state.view='ratio';w.CF.state.rail='crypto';w.CF.render();
const usDayRail=us.rail.d&&us.rail.d[D.days[D.days.length-1]];
ok('the day has its own rail figures',!!usDayRail,JSON.stringify(usDayRail||null));
w.CF.state.view='abs';w.CF.render();
const dr=rrows().find(tr=>tr.cells[0].textContent==='United States');
ok('copy address on a day comes from the day rail series',
   dr.cells[5].textContent===(usDayRail?usDayRail.c[0]:0).toLocaleString(),
   dr.cells[5].textContent+' vs '+(usDayRail?usDayRail.c[0]:'(none)'));

// every day must fit inside its month, bar the country-attribution exceptions
let dayBad=[];
ALL.forEach(r=>{
  if(!r.d)return;
  Object.keys(r.d).forEach(d=>{
    const mon=r.m&&r.m[d.slice(0,7)];
    if(!mon)return;
    for(let i=0;i<5;i++) if(r.d[d][i]>mon[i]) dayBad.push(r.c+' '+d+' step'+(i+1));
  });
});
ok('days fit inside their months, bar a handful',dayBad.length<=5,
   dayBad.length+': '+dayBad.slice(0,3).join(', '));

// clearing the picker returns to a month rather than an empty table
const sel=doc.getElementById('dsel');
sel.value='';sel.onchange();
ok('clearing the day returns to the current month',
   w.CF.state.period===D.months[D.months.length-1],w.CF.state.period);
w.CF.state.rail='all';w.CF.state.view='ratio';
w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();

// --- section 03 follows the period ------------------------------------------
// Found in use: with August selected the country row showed 58 US first
// depositors and the source table below it showed 233, because section 03 was
// reading window data under a month heading. It now has its own per-month
// figures, and this asserts the two agree -- for every country and every month,
// not just the one that was noticed.
w.CF.state.sel=D.defaults.slice();w.CF.state.rail='all';w.CF.state.view='abs';
w.CF.state.drill='United States';w.CF.state.drillSrc=null;

function srcTotalCells(){
  const rows=[...doc.querySelectorAll('#tsrc tbody tr')];
  return [...rows[rows.length-1].cells].map(c=>c.textContent);
}
function countryCells(c){
  return [...rrows().find(tr=>tr.cells[0].textContent===c).cells].map(x=>x.textContent);
}
[['all',false],['2026-08',true],['2026-08',false],['2026-07',false],['2026-05',true],
 ['2026-08-29',false],['2026-07-15',false],['2026-05-20',false]]
  .forEach(([p,m])=>{
    w.CF.state.period=p;w.CF.state.mtd=m;w.CF.render();
    const cc=countryCells('United States'), st=srcTotalCells();
    ok('sources reconcile with the country for '+p+(m?' MTD':''),
       cc[1]===st[1]&&cc[3]===st[3]&&cc[6]===st[6],
       'country '+cc[1]+'/'+cc[3]+'/'+cc[6]+' vs sources '+st[1]+'/'+st[3]+'/'+st[6]);
  });

// the specific numbers from the bug report
w.CF.state.period='2026-08';w.CF.state.mtd=true;w.CF.render();
// Was pinned to 58. A data refresh moves it, and the thing under test is that
// the two sections agree -- not the value.
ok('August US agrees between sections 02 and 03',
   countryCells('United States')[6]===srcTotalCells()[6],
   countryCells('United States')[6]+' / '+srcTotalCells()[6]);
w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();
ok('the window agrees between sections 02 and 03',
   countryCells('United States')[6]===srcTotalCells()[6],
   countryCells('United States')[6]+' / '+srcTotalCells()[6]);

// every country, every month, both tables -- the check that was missing
let mismatch=[];
D.months.forEach(month=>{
  [false,true].forEach(mtdOn=>{
    w.CF.state.period=month;w.CF.state.mtd=mtdOn;
    ALL.filter(r=>r.src).forEach(r=>{
      const ct=(mtdOn?r.mtd:r.m)[month];
      if(!ct)return;
      const key=mtdOn?'mtd':'m';
      const listed=r.src.filter(x=>x[key]&&x[key][month]);
      if(!listed.length)return;
      [0,2,4].forEach(i=>{
        const sum=listed.reduce((a,x)=>a+x[key][month].f[i],0);
        if(sum!==ct[i])mismatch.push(r.c+' '+month+(mtdOn?' MTD':'')+' step'+(i+1)
          +': '+sum+' vs '+ct[i]);
      });
    });
  });
});
ok('every country and month reconciles between sections 02 and 03',
   mismatch.length===0,mismatch.length+': '+mismatch.slice(0,3).join(' | '));

// a source with nothing in the chosen month drops out rather than showing
// its window figures
w.CF.state.period='2026-08';w.CF.state.mtd=false;w.CF.state.drill='United States';
w.CF.render();
const augSrcNames=[...doc.querySelectorAll('#tsrc tbody tr')].map(tr=>tr.cells[0].textContent);
w.CF.state.period='all';w.CF.render();
const allSrcNames=[...doc.querySelectorAll('#tsrc tbody tr')].map(tr=>tr.cells[0].textContent);
ok('a month shows fewer sources than the window',
   augSrcNames.length<allSrcNames.length,
   augSrcNames.length+' vs '+allSrcNames.length);

// every period now has its own source rows, so nothing needs warning about
w.CF.state.period='2026-08-29';w.CF.render();
ok('a day no longer warns',doc.getElementById('snote').textContent==='',
   doc.getElementById('snote').textContent);
ok('a day reads its own source rows, not the window',(function(){
   var fj=[...doc.querySelectorAll('#tsrc tbody tr')]
     .find(tr=>/fortunejack/.test(tr.cells[0].textContent));
   return fj&&fj.cells[1].textContent!==us.src.find(x=>x.s==='fortunejack.com')
     .f[0].toLocaleString();})());

// every country and day must reconcile too -- the check that was missing the
// first time, now covering the level the user asked for last
let dayMismatch=[];
D.days.forEach(day=>{
  ALL.filter(r=>r.src&&r.d&&r.d[day]).forEach(r=>{
    const listed=r.src.filter(x=>x.d&&x.d[day]);
    if(!listed.length)return;
    [0,2,4].forEach(i=>{
      const sum=listed.reduce((a,x)=>a+x.d[day].f[i],0);
      if(sum!==r.d[day][i])dayMismatch.push(r.c+' '+day+' step'+(i+1)
        +': '+sum+' vs '+r.d[day][i]);
    });
  });
});
ok('every country and day reconciles between sections 02 and 03',
   dayMismatch.length===0,dayMismatch.length+': '+dayMismatch.slice(0,3).join(' | '));

// The two checks above read the DATA. The data was always right; what was
// wrong was the RATIO renderer, which took Visits and Regs from the window
// array while the FTD column beside them followed the period -- Czechia in
// August rendered 691 visits, 159 regs and 7 deposits, three numbers from two
// different ranges on one row. Nothing above caught it because the abs view
// was the only one ever rendered here. So: render the ratio view, every
// country, every period, and require the rendered cells to agree.
// This sweep is 8 periods x 2 views x 60 countries. Driving it through
// render() meant 960 full rebuilds of all five sections and took 125 seconds --
// on its own more than the whole suite's budget, so everything after it never
// ran. Two changes, neither of which weakens it:
//   - only the two tables actually inspected are rebuilt, not all five;
//   - the country table is built ONCE per (period, view) rather than once per
//     country, because state.drill only ever sets a CSS class on the matching
//     row (tr.className='sel'); no cell text depends on it. The source table
//     genuinely does depend on the drill, so that stays inside the loop.
let renderBad=[];
[['all',false],['2026-09',false],['2026-09',true],['2026-08',true],
 ['2026-08',false],['2026-07',false],['2026-06',false],['2026-05',false],
 ['2026-08-29',false],['2026-09-02',false],['2026-07-15',false]]
 .forEach(([p,m])=>{
  ['ratio','abs'].forEach(v=>{
    w.CF.state.period=p;w.CF.state.mtd=m;w.CF.state.view=v;w.CF.state.rail='all';
    w.CF.state.drill=null;w.CF.state.drillSrc=null;
    w.CF.ratioTable();
    const byName={};
    [...rrows()].forEach(tr=>{
      byName[tr.cells[0].textContent]=[...tr.cells].map(x=>x.textContent);});
    ALL.filter(r=>r.src).forEach(r=>{
      const cc=byName[r.c];
      if(!cc)return;                       // country absent in this period
      w.CF.state.drill=r.c;w.CF.state.drillSrc=null;
      w.CF.sourceTable();
      const st=srcTotalCells();
      if(st.length<4)return;               // no source rows in this period
      // ratio view: Visits|Regs|FTD at 1,2,3. abs view: Visits at 1, Deposit at 6.
      const pairs=v==='ratio'?[[1,1],[2,2],[3,3]]:[[1,1],[3,3],[6,6]];
      pairs.forEach(([a,b])=>{
        if(cc[a]!==st[b])renderBad.push(v+' '+p+(m?' MTD':'')+' '+r.c
          +' col'+a+': country '+cc[a]+' vs sources '+st[b]);
      });
    });
  });
});
ok('every rendered country row matches its rendered source total',
   renderBad.length===0,renderBad.length+': '+renderBad.slice(0,4).join(' | '));

// --- section 05: affiliate campaigns ---------------------------------------
// The check that matters is against the PULL, not against the page's own
// arithmetic: summing the rows and comparing to the sum of the rows would pass
// on any dataset, including a truncated one. raw/btag-periods.txt is what
// PostHog returned, __ALL__ included, so the rendered total is measured against
// a number the page never sees.
const rawBtag=path.join(__dirname,'raw','btag-periods.txt');
if(!fs.existsSync(rawBtag)){
  ok('raw/btag-periods.txt is present',false,'missing - section 05 unverifiable');
}else{
  const pulled={};
  fs.readFileSync(rawBtag,'utf8').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line)return;
    const [tag,packed]=line.split('|');
    const per={};
    packed.split(' ').forEach(tok=>{
      const [p,nums]=tok.split('~');
      per[p]=nums.split(',').map(Number);
    });
    pulled[tag]=per;
  });
  const totals=pulled['__ALL__'];
  ok('the pull carries an __ALL__ total row',!!totals);
  ok('every campaign in the pull reached the page',
     Object.keys(pulled).length-1===w.CF.BTAGS.filter(r=>!r.rest).length,
     (Object.keys(pulled).length-1)+' pulled vs '
       +w.CF.BTAGS.filter(r=>!r.rest).length+' on the page');

  // raw period keys -> the page's keys
  const asPageKey=p=>p==='all'?'all'
    :p.endsWith('M')?p.slice(0,-1)
    :p.length===7?p:'2026-'+p;
  const isMtd=p=>p.endsWith('M');

  const btagTotalCells=()=>{
    const rows=[...doc.querySelectorAll('#tbtag tbody tr')];
    return [...rows[rows.length-1].cells].map(c=>c.textContent);
  };
  const num=s=>Number(String(s).replace(/,/g,''));
  // Columns are found by heading, not by position. Adding the Landing page
  // column shifted every index by one and the earlier version of this test
  // failed with "page NaN vs pull 13016" -- a column-numbering problem wearing
  // the costume of a data problem.
  const btagCol=name=>[...doc.querySelectorAll('#tbtag thead th')]
    .findIndex(th=>th.textContent.replace(/[▼▲]/g,'').trim()===name);

  let footBad=[];
  Object.keys(totals).forEach(p=>{
    ['ratio','abs'].forEach(v=>{
      w.CF.state.period=asPageKey(p);
      w.CF.state.mtd=isMtd(p);
      w.CF.state.view=v;
      // only the campaign table is inspected here, so only it is rebuilt --
      // a full render() across 136 periods x 2 views rebuilds the country
      // table, both player lists and 895 error pairs each time, which is what
      // pushed this suite past any sane runtime once September was added
      w.CF.btagTable();
      const c=btagTotalCells();
      // ratio view shows Visits|Regs|FTD; abs shows the whole five-step chain
      const names=v==='ratio'?['Visits','Regs','FTD']
                             :['Visits','Register','Deposit'];
      const got=names.map(nm=>num(c[btagCol(nm)]));
      const want=[totals[p][0],totals[p][2],totals[p][4]];
      for(let i=0;i<3;i++)if(got[i]!==want[i])
        footBad.push(v+' '+p+' '+names[i]+': page '+got[i]+' vs pull '+want[i]);
    });
  });
  ok('the campaign table foots to the pull for every period and both views',
     footBad.length===0,footBad.length+': '+footBad.slice(0,4).join(' | '));

  // Changing the cut-off may change how many rows are listed, but it must never
  // change the total -- what leaves the table has to land in the remainder.
  w.CF.state.period='2026-08';w.CF.state.mtd=true;w.CF.state.view='ratio';
  let cutTotals=[],cutCounts=[];
  const totalTriple=()=>{
    const c=btagTotalCells();
    return ['Visits','Regs','FTD'].map(nm=>c[btagCol(nm)]).join('/');
  };
  [20,5,1,0].forEach(cut=>{
    w.CF.state.btagCut=cut;w.CF.render();
    cutTotals.push(totalTriple());
    cutCounts.push(doc.querySelectorAll('#tbtag tbody tr').length);
  });
  ok('the cut-off never changes the total',
     cutTotals.every(t=>t===cutTotals[0]),cutTotals.join('  vs  '));
  ok('a lower cut-off lists more campaigns',
     cutCounts[3]>cutCounts[0],cutCounts.join(' -> '));
  w.CF.state.btagCut=20;

  // A day must read its own figures, not the month's.
  w.CF.state.period='2026-08-14';w.CF.state.mtd=false;w.CF.render();
  const dayTot=totalTriple();
  w.CF.state.period='2026-08';w.CF.state.mtd=true;w.CF.render();
  const monTot=totalTriple();
  ok('a day is not the month',dayTot!==monTot,dayTot+' vs '+monTot);

  // The landing page column was removed on request. This asserts it stays
  // gone rather than reappearing from a stale build.
  ok('no landing page column',btagCol('Landing page')===-1);
  ok('no landing page cells',doc.querySelectorAll('#tbtag td.land').length===0);
}

// --- section 03 unfiltered: every source, every country ---------------------
// Measured against raw/global-sources.txt for the same reason as the campaign
// table: the page's own rows summed and compared to themselves would pass on a
// truncated pull.
const rawGsrc=path.join(__dirname,'raw','global-sources.txt');
if(!fs.existsSync(rawGsrc)){
  ok('raw/global-sources.txt is present',false,'missing - section 03 unverifiable');
}else{
  const gTot={};
  let gRows=0;
  fs.readFileSync(rawGsrc,'utf8').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line)return;
    const [ref,packed]=line.split('|');
    if(ref!=='__ALL__'){gRows++;return;}
    packed.split(' ').forEach(tok=>{
      const [p,nums]=tok.split('~');
      gTot[p]=nums.split(',').map(Number);
    });
  });

  const srcCol=name=>[...doc.querySelectorAll('#tsrc thead th')]
    .findIndex(th=>th.textContent.replace(/[▼▲]/g,'').trim()===name);
  const srcTotalRow=()=>{
    const rows=[...doc.querySelectorAll('#tsrc tbody tr')];
    return [...rows[rows.length-1].cells].map(c=>c.textContent);
  };
  const numG=s=>Number(String(s).replace(/,/g,''));
  const asKey=p=>p==='all'?'all':p.endsWith('M')?p.slice(0,-1)
    :p.length===7?p:'2026-'+p;

  w.CF.state.drill=null;w.CF.state.drillSrc=null;
  let gBad=[];
  Object.keys(gTot).forEach(p=>{
    ['ratio','abs'].forEach(v=>{
      w.CF.state.period=asKey(p);w.CF.state.mtd=p.endsWith('M');
      w.CF.state.view=v;w.CF.state.rail='all';w.CF.render();
      const c=srcTotalRow();
      const names=v==='ratio'?['Visits','Regs','FTD']:['Visits','Register','Deposit'];
      const got=names.map(nm=>numG(c[srcCol(nm)]));
      const want=[gTot[p][0],gTot[p][2],gTot[p][4]];
      for(let i=0;i<3;i++)if(got[i]!==want[i])
        gBad.push(v+' '+p+' '+names[i]+': page '+got[i]+' vs pull '+want[i]);
    });
  });
  ok('the global source table foots to the pull for every period and both views',
     gBad.length===0,gBad.length+': '+gBad.slice(0,4).join(' | '));
  ok('every source in the pull reached the page',gRows===w.CF.D.sources.length-1,
     gRows+' pulled vs '+(w.CF.D.sources.length-1)+' on the page');

  // Clicking a country must swap the table, not filter the global one: the two
  // are separate pulls with different cut-offs.
  w.CF.state.period='2026-08';w.CF.state.mtd=true;w.CF.state.view='ratio';
  w.CF.state.drill=null;w.CF.render();
  const globalLast=srcTotalRow()[0];
  w.CF.state.drill='Czechia';w.CF.render();
  const czLast=srcTotalRow()[0];
  ok('no country selected shows every country',globalLast==='All traffic',globalLast);
  ok('clicking a country filters section 03',czLast==='Czechia — all sources',czLast);
  ok('the filtered table is smaller than the global one',
     (()=>{const cz=doc.querySelectorAll('#tsrc tbody tr').length;
       w.CF.state.drill=null;w.CF.render();
       return doc.querySelectorAll('#tsrc tbody tr').length>cz;})());

  // Every campaign row is still a funnel in every period.
  let bBad=[];
  w.CF.BTAGS.forEach(r=>{
    ['f'].forEach(()=>{});
    const buckets=[[r.f]].concat(
      ['m','mtd','d'].map(k=>Object.keys(r[k]||{}).map(x=>r[k][x])));
    buckets.forEach(list=>list.forEach(f=>{
      if(!f)return;
      for(let i=0;i<4;i++)if(f[i]<f[i+1])bBad.push(r.t+' step'+(i+1));
    }));
  });
  ok('every campaign row is monotonic',bBad.length===0,
     bBad.length+': '+bBad.slice(0,3).join(', '));
}

w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.view='ratio';
w.CF.state.drill=null;w.CF.state.drillSrc=null;w.CF.state.btagCut=20;w.CF.render();

// --- collapsible sections ---------------------------------------------------
// The fold is set up once, outside render(), because render() rebuilds table
// contents on every period click and would otherwise reset it.
const secs=[...doc.querySelectorAll('h2[data-sec]')];
ok('every section has a fold control',secs.length===6&&
   secs.every(h=>h.querySelector('.tg')&&doc.getElementById(h.getAttribute('data-sec'))),
   secs.length+' sections');
// Sections now open COLLAPSED -- four long tables otherwise bury the controls.
// A browser that has deliberately opened one keeps it open; a fresh one, and
// jsdom, start folded.
ok('all sections start collapsed',
   secs.every(h=>doc.getElementById(h.getAttribute('data-sec')).style.display==='none'),
   secs.map(h=>h.getAttribute('data-sec')+':'+
     doc.getElementById(h.getAttribute('data-sec')).style.display).join(' '));
ok('and every toggle shows the collapsed glyph',
   secs.every(h=>h.querySelector('.tg').textContent==='+'));
const h2b=doc.querySelector('h2[data-sec="s4"]'), box4=doc.getElementById('s4');
h2b.click();
ok('clicking a heading opens its section',box4.style.display===''&&
   h2b.querySelector('.tg').textContent==='\u2212'&&
   h2b.getAttribute('aria-expanded')==='true',
   box4.style.display+' / '+h2b.querySelector('.tg').textContent);
// the choice must survive a redraw, or changing the period silently re-folds it
w.CF.state.period='2026-07';w.CF.state.mtd=false;w.CF.render();
ok('an opened section stays open across a redraw',box4.style.display==='');
h2b.click();
ok('clicking again folds it',box4.style.display==='none'&&
   h2b.querySelector('.tg').textContent==='+');

// --- rails on the source and campaign tables --------------------------------
// These two tables had no rail split until the data was pulled for them; the
// rail buttons used to do nothing here. Measured against raw/rails-src-btag.txt
// so the page is checked against the pull, not against itself.
const rawRail=path.join(__dirname,'raw','rails-src-btag.txt');
if(!fs.existsSync(rawRail)){
  ok('raw/rails-src-btag.txt is present',false,'missing - rails unverifiable');
}else{
  const S={},B={};
  fs.readFileSync(rawRail,'utf8').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line)return;
    // the key itself contains a '|', so split with a limit, not on the first
    const bits=line.split('|');
    const kind=bits[0], name=bits[1], packed=bits.slice(2).join('|');
    const per={};
    packed.split(' ').forEach(tok=>{
      const [pp,nums]=tok.split('~');
      per[pp]=nums.split(',').map(Number);
    });
    (kind==='S'?S:B)[name]=per;
  });

  const hdr=id=>[...doc.querySelectorAll('#'+id+' thead th')]
    .map(t=>t.textContent.replace(/[▼▲]/g,'').trim());
  const cellsOf=(id,label)=>{
    const tr=[...doc.querySelectorAll('#'+id+' tbody tr')]
      .find(t=>t.cells[0].textContent.indexOf(label)===0);
    return tr?[...tr.cells].map(c=>c.textContent):null;
  };
  const numR=v=>Number(String(v).replace(/,/g,''));

  w.CF.state.drill=null;w.CF.state.drillSrc=null;
  w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.btagCut=20;

  // headers follow the rail on all three tables, exactly as countries do
  ['fiat','crypto'].forEach(r=>{
    w.CF.state.rail=r;w.CF.state.view='abs';w.CF.render();
    const want=r==='fiat'?['Fiat Start','Fiat FTD']:['Copy Address','Crypto FTD'];
    ok('sources numbers/'+r+' swaps the last two columns',
       hdr('tsrc').slice(-2).join('|')===want.join('|'),hdr('tsrc').join('|'));
    // The campaign table gained a Click errors column AFTER the rail pair, so
    // the rail steps are no longer the last two headers -- they are the two
    // before it. Asserting position rather than "last" keeps the check honest.
    ok('campaigns numbers/'+r+' swaps the rail columns',
       hdr('tbtag').slice(-3,-1).join('|')===want.join('|')&&
       hdr('tbtag').slice(-1)[0]==='Click errors',
       hdr('tbtag').join('|'));
  });

  // and the figures are the pulled ones
  w.CF.state.view='abs';
  [['fiat',0,1],['crypto',2,3]].forEach(([r,i0,i1])=>{
    w.CF.state.rail=r;w.CF.render();
    const c=cellsOf('tsrc','fortunejack.com');
    const want=S['fortunejack.com']['all'];
    ok('sources '+r+' figures match the pull',
       numR(c[5])===want[i0]&&numR(c[6])===want[i1],
       c[5]+'/'+c[6]+' vs '+want[i0]+'/'+want[i1]);
    const b=cellsOf('tbtag','97460169_493965');
    const wantB=B['97460169_493965']['all'];
    ok('campaigns '+r+' figures match the pull',
       numR(b[5])===wantB[i0]&&numR(b[6])===wantB[i1],
       b[5]+'/'+b[6]+' vs '+wantB[i0]+'/'+wantB[i1]);
  });

  // the first four steps are rail-independent on these tables too
  const four=(id,label,r)=>{w.CF.state.rail=r;w.CF.render();
    return cellsOf(id,label).slice(1,5).join('|');};
  ok('source steps 1-4 do not move with the rail',
     four('tsrc','fortunejack.com','all')===four('tsrc','fortunejack.com','fiat')&&
     four('tsrc','fortunejack.com','all')===four('tsrc','fortunejack.com','crypto'));
  ok('campaign steps 1-4 do not move with the rail',
     four('tbtag','97460169_493965','all')===four('tbtag','97460169_493965','fiat')&&
     four('tbtag','97460169_493965','all')===four('tbtag','97460169_493965','crypto'));

  // a row with no rail figures shows dashes, never a fabricated zero
  w.CF.state.rail='fiat';w.CF.state.view='abs';w.CF.state.btagCut=0;w.CF.render();
  const dashed=[...doc.querySelectorAll('#tbtag tbody tr')]
    .filter(t=>t.cells[5]&&t.cells[5].textContent==='—');
  ok('campaigns with no fiat row show dashes, not zeros',dashed.length>0,
     dashed.length+' dashed rows');
  w.CF.state.rail='all';w.CF.state.view='ratio';w.CF.state.btagCut=20;w.CF.render();
}

// --- clicking a source filters the campaign table ---------------------------
w.CF.state.drill=null;w.CF.state.drillGsrc=null;w.CF.state.period='all';
w.CF.state.mtd=false;w.CF.state.view='ratio';w.CF.state.rail='all';
w.CF.state.btagCut=0;w.CF.render();

const srcRowFor=n=>[...doc.querySelectorAll('#tsrc tbody tr')]
  .find(r=>r.cells[0].textContent.indexOf(n)===0);
const btagRows=()=>[...doc.querySelectorAll('#tbtag tbody tr')];
const cellNum=v=>Number(String(v).replace(/,/g,''));

const wide=btagRows().length;
const odds=srcRowFor('www.oddspodden.com');
ok('a source with campaign detail is clickable',!!odds.onclick);
odds.onclick();
ok('clicking a source narrows the campaign table',btagRows().length<wide,
   wide+' -> '+btagRows().length);
ok('the clicked source is marked',
   srcRowFor('www.oddspodden.com').className==='sel');
ok('the campaign table says what is filtering it',
   /Campaigns under www\.oddspodden\.com/.test(doc.getElementById('bnote').textContent),
   doc.getElementById('bnote').textContent);

// The drilled table must foot to the source row exactly. The residual row is
// the source's own total minus its listed campaigns -- mostly untagged
// traffic -- so a source that is only 10% campaign-tagged still adds up.
['www.oddspodden.com','www.google.com','m.facebook.com'].forEach(n=>{
  w.CF.state.drillGsrc=n;w.CF.render();
  const last=btagRows().slice(-1)[0];
  const src=srcRowFor(n);
  ok('the drilled total equals the source row for '+n,
     [1,2,3].every(i=>last.cells[i].textContent===src.cells[i].textContent),
     [1,2,3].map(i=>last.cells[i].textContent).join('/')+' vs '+
     [1,2,3].map(i=>src.cells[i].textContent).join('/'));
});

// and the campaigns plus the residual must equal that total
w.CF.state.drillGsrc='www.google.com';w.CF.render();
(()=>{
  const rows=btagRows();
  const tot=rows[rows.length-1], resid=rows[rows.length-2];
  const camps=rows.slice(0,-2);
  [1,2,3].forEach(i=>{
    const sum=camps.reduce((a,r)=>a+cellNum(r.cells[i].textContent),0)
      +cellNum(resid.cells[i].textContent);
    ok('google column '+i+': campaigns + residual = total',
       sum===cellNum(tot.cells[i].textContent),
       sum+' vs '+cellNum(tot.cells[i].textContent));
  });
})();

// The residual must absorb whatever the CUT-OFF hides, not just what the
// cross-tab threshold hides. The first version subtracted every cross-tab row
// including hidden ones, so agomuk.com at "20+ regs" showed a residual of 3
// against a total of 1,141. Checked at every cut-off, on a source whose only
// campaign sits below the default one.
['agomuk.com','www.google.com','m.facebook.com'].forEach(n=>{
  [20,5,1,0].forEach(cut=>{
    w.CF.state.drillGsrc=n;w.CF.state.btagCut=cut;w.CF.render();
    const rows=btagRows();
    const tot=rows[rows.length-1], resid=rows[rows.length-2];
    const camps=rows.slice(0,-2);
    const bad=[1,2,3].filter(i=>{
      const sum=camps.reduce((a,r)=>a+cellNum(r.cells[i].textContent),0)
        +cellNum(resid.cells[i].textContent);
      return sum!==cellNum(tot.cells[i].textContent);
    });
    ok('drilled table foots at cut-off '+cut+' for '+n,bad.length===0,
       'columns '+bad.join(',')+' -- '+rows.map(r=>r.cells[0].textContent+':'
         +r.cells[1].textContent).join('  '));
  });
});
w.CF.state.btagCut=0;

// clicking the same source again clears the filter
w.CF.state.drillGsrc=null;w.CF.render();
srcRowFor('www.oddspodden.com').onclick();
srcRowFor('www.oddspodden.com').onclick();
ok('clicking the source again clears the filter',
   w.CF.state.drillGsrc===null&&btagRows().length===wide,
   w.CF.state.drillGsrc+' / '+btagRows().length);

// a source with no campaign detail must not be clickable -- a click that
// emptied the table below would read as a bug rather than as an absence
ok('a source with no campaign detail is not clickable',
   [...doc.querySelectorAll('#tsrc tbody tr')].some(r=>!r.onclick));
w.CF.state.drillGsrc=null;w.CF.state.btagCut=20;w.CF.render();

// --- section 04 follows a source or a campaign ------------------------------
w.CF.state.drill=null;w.CF.state.drillSrc=null;w.CF.state.drillGsrc=null;
w.CF.state.drillBtag=null;w.CF.state.period='all';w.CF.state.mtd=false;
w.CF.state.view='ratio';w.CF.state.rail='all';w.CF.state.btagCut=20;w.CF.render();

const plyRows=()=>[...doc.querySelectorAll('#tply tbody tr')];
const pnote=()=>doc.getElementById('pnote2').textContent;
ok('with nothing selected, players invites all three',
   plyRows().length===0&&/country, a source or a campaign/.test(pnote()),pnote());

// a source
const sRow=[...doc.querySelectorAll('#tsrc tbody tr')]
  .find(r=>r.cells[0].textContent.indexOf('www.oddspodden.com')===0);
sRow.onclick();
ok('clicking a source lists its registrants',plyRows().length>0,plyRows().length);
ok('and names the source',/www\.oddspodden\.com/.test(pnote()),pnote());
// the count must match the source row's own registrant figure
(()=>{
  const src=[...doc.querySelectorAll('#tsrc tbody tr')]
    .find(r=>r.cells[0].textContent.indexOf('www.oddspodden.com')===0);
  ok('the list length equals the source registrant count',
     String(plyRows().length)===src.cells[2].textContent,
     plyRows().length+' vs '+src.cells[2].textContent);
})();

// a campaign
w.CF.state.drillGsrc=null;w.CF.state.drillBtag=null;w.CF.render();
const cRow=[...doc.querySelectorAll('#tbtag tbody tr')]
  .find(r=>r.cells[0].textContent==='97460169_493965');
ok('a campaign with a list is clickable',!!cRow.onclick);
cRow.onclick();
ok('clicking a campaign lists its registrants',plyRows().length>0,plyRows().length);
ok('and names the campaign',/campaign 97460169_493965/.test(pnote()),pnote());
ok('the clicked campaign is marked',
   [...doc.querySelectorAll('#tbtag tbody tr')]
     .find(r=>r.cells[0].textContent==='97460169_493965').className==='sel');

// the two narrowings are mutually exclusive -- both live at once would leave
// section 04 showing one thing while two rows above claim to have selected it
sRow.onclick===null;
[...doc.querySelectorAll('#tsrc tbody tr')]
  .find(r=>r.cells[0].textContent.indexOf('www.oddspodden.com')===0).onclick();
ok('selecting a source clears a campaign selection',
   w.CF.state.drillBtag===null&&/www\.oddspodden\.com/.test(pnote()),
   w.CF.state.drillBtag+' / '+pnote().slice(0,40));

// clicking the same campaign again clears it
w.CF.state.drillGsrc=null;w.CF.state.drillBtag=null;w.CF.render();
const c2=()=>[...doc.querySelectorAll('#tbtag tbody tr')]
  .find(r=>r.cells[0].textContent==='97460169_493965');
c2().onclick();c2().onclick();
ok('clicking the campaign again clears the list',
   w.CF.state.drillBtag===null&&plyRows().length===0,
   w.CF.state.drillBtag+' / '+plyRows().length);

w.CF.state.drillGsrc=null;w.CF.state.drillBtag=null;w.CF.state.btagCut=20;
w.CF.render();

// --- section 04: clicks followed by an error --------------------------------
// Measured against the pull, and required to follow the period buttons -- the
// defect section 02 shipped with was a table that ignored them while looking
// like it did not.
const rawErrP=path.join(__dirname,'raw','click-errors-periods.txt');
const rawErrS=path.join(__dirname,'raw','click-error-sessions.txt');
if(!fs.existsSync(rawErrP)||!fs.existsSync(rawErrS)){
  ok('the click-error raw files are present',false,'missing');
}else{
  const pulled={};
  fs.readFileSync(rawErrP,'utf8').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line)return;
    const cut=line.indexOf('|');
    const btn=line.slice(0,cut), packed=line.slice(cut+1);
    if(!btn)return;
    packed.split(' ').forEach(tok=>{
      const b=tok.split('~');
      if(b.length!==3)return;
      (pulled[btn+'\u0000'+b[0]]=pulled[btn+'\u0000'+b[0]]||{})[b[1]]=
        b[2].split(',').map(Number);
    });
  });
  const qualifying=Object.keys(pulled).filter(k=>{
    const w2=pulled[k]['all'];return w2&&w2[0]>=60&&w2[1]>=20;});
  ok('the page carries exactly the qualifying pairs',
     qualifying.length===w.CF.ERRS.length,
     qualifying.length+' vs '+w.CF.ERRS.length);
  ok('unlabelled controls are excluded',w.CF.ERRS.every(e=>e.b!==''));
  ok('every sampled session parses',
     w.CF.ERRS.every(e=>e.ss.every(x=>/^[0-9a-f-]{20,}$/.test(x.s)&&/^\d\d-\d\d$/.test(x.d))));

  const eRows=()=>[...doc.querySelectorAll('#terr tbody tr')];
  const num2=v=>Number(String(v).replace(/,/g,''));
  // the rendered figures must be the pulled figures FOR THAT PERIOD
  let eBad=[];
  [['all',false],['2026-06',false],['2026-07',false],['2026-08',true],
   ['2026-08-14',false]].forEach(([p2,m])=>{
    w.CF.state.period=p2;w.CF.state.mtd=m;w.CF.state.drillErr=null;w.CF.render();
    // MTD rows live under their own key in the pull ("2026-08M"), not the
    // whole-month key. This read the month key in MTD mode and still passed,
    // because MTD used to be 30 days against a window ending on the 30th, so
    // the two were the same numbers. At MTD 1-2 they are nothing like it.
    const key=p2==='all'?'all'
             :m?p2+'M'
             :(p2.length===10?p2.slice(5):p2);
    eRows().slice(0,25).forEach(r=>{
      const k=r.cells[0].textContent.replace(/ /g,'_')+'\u0000'+r.cells[1].textContent;
      const want=pulled[k]&&pulled[k][key];
      if(!want){eBad.push(p2+' '+k+': no pulled row');return;}
      if(num2(r.cells[2].textContent)!==want[0]||num2(r.cells[3].textContent)!==want[1])
        eBad.push(p2+' '+k+': '+r.cells[2].textContent+'/'+r.cells[3].textContent
          +' vs '+want[0]+'/'+want[1]);
    });
  });
  ok('the error table matches the pull in every period',eBad.length===0,
     eBad.length+': '+eBad.slice(0,3).join(' | '));

  // and it must actually change between periods
  w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();
  const allTop=eRows()[0].cells[2].textContent;
  w.CF.state.period='2026-06';w.CF.render();
  const junTop=eRows()[0].cells[2].textContent;
  ok('the error table follows the period buttons',allTop!==junTop,
     allTop+' vs '+junTop);

  // sessions are filtered by their own date, so a day shows only that day
  w.CF.state.period='all';w.CF.render();
  eRows()[0].onclick();
  const allSess=doc.querySelectorAll('#tsess tbody tr').length;
  w.CF.state.period='2026-06';w.CF.render();
  const junSess=[...doc.querySelectorAll('#tsess tbody tr')];
  ok('sessions narrow with the period',junSess.length<=allSess&&junSess.length>0,
     allSess+' -> '+junSess.length);
  ok('and every listed session falls inside it',
     junSess.every(r=>r.cells[1].textContent.indexOf('2026-06')===0),
     junSess.map(r=>r.cells[1].textContent).slice(0,4).join(','));
  ok('every session offers a replay link',
     junSess.every(r=>r.querySelector('a.replay')&&
       r.querySelector('a.replay').href.indexOf(w.CF.D.replayBase)===0));
  // Every row with any sample must be clickable in EVERY period. Gating the
  // click on "has a sample inside the current period" left about half the rows
  // inert on a single day, with nothing on screen explaining why.
  let inert=[];
  [['all',false],['2026-05',false],['2026-08',true],['2026-08-14',false]].forEach(([p3,m3])=>{
    w.CF.state.period=p3;w.CF.state.mtd=m3;w.CF.state.drillErr=null;w.CF.render();
    const rs=[...doc.querySelectorAll('#terr tbody tr')];
    const dead=rs.filter(r=>!r.onclick).length;
    if(dead)inert.push(p3+': '+dead+' of '+rs.length);
  });
  ok('every error row is clickable in every period',inert.length===0,inert.join(' | '));

  // and a row whose sample misses the period explains itself rather than
  // opening an empty panel
  w.CF.state.period='2026-08-14';w.CF.state.mtd=false;w.CF.state.drillErr=null;
  w.CF.render();
  const thin=[...doc.querySelectorAll('#terr tbody tr')]
    .find(r=>r.title.indexOf('No sampled')===0);
  ok('rows with no sample in the period are marked',!!thin,
     [...doc.querySelectorAll('#terr tbody tr')].slice(0,3).map(r=>r.title).join(' | '));
  if(thin){
    thin.onclick();
    ok('and clicking one explains the gap',
       /none of the \d+ sampled sessions/.test(doc.getElementById('esub').textContent),
       doc.getElementById('esub').textContent);
    ok('the counts in that message are still the real ones',
       /\d+ clicks were followed by an error/.test(doc.getElementById('esub').textContent));
  }
  w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.drillErr=null;w.CF.render();
  ok('the note is gone',doc.getElementById('enote').textContent==='');
  ok('the column never claims causation',
     /Followed by error/.test([...doc.querySelectorAll('#terr thead th')]
       .map(t=>t.textContent).join('|')));
  w.CF.state.drillErr=null;w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();
}

// --- click errors per campaign ----------------------------------------------
// Measured per CLICK. Per person it measures engagement instead: registration
// runs HIGHER among people who hit an error in every campaign, because you have
// to use the site to encounter one. Checked against the pull, and guarded
// against the small-sample artefact that put a 17-person campaign top.
const rawBE=path.join(__dirname,'raw','btag-errors.txt');
if(!fs.existsSync(rawBE)){
  ok('raw/btag-errors.txt is present',false,'missing');
}else{
  const pulledBE={};
  fs.readFileSync(rawBE,'utf8').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line)return;
    const cut=line.indexOf('|');
    const per={};
    line.slice(cut+1).split(' ').forEach(tok=>{
      const [k,v]=tok.split('~');
      per[k]=v.split(',').map(Number);
    });
    pulledBE[line.slice(0,cut)]=per;
  });
  ok('every listed campaign carries error data',
     w.CF.BTAGS.filter(r=>!r.rest).every(r=>!!pulledBE[r.t]&&!!r.ce),
     (w.CF.BTAGS.find(r=>!r.rest&&!r.ce)||{}).t);
  ok('errors never exceed clicks',
     w.CF.BTAGS.every(r=>!r.ce||Object.keys(r.ce.m).every(k=>r.ce.m[k][1]<=r.ce.m[k][0])));

  w.CF.state.drill=null;w.CF.state.drillGsrc=null;w.CF.state.drillBtag=null;
  w.CF.state.period='all';w.CF.state.mtd=false;w.CF.state.rail='all';
  w.CF.state.btagCut=0;w.CF.state.sortBtag={key:null,dir:-1};

  const beCol=()=>[...doc.querySelectorAll('#tbtag thead th')]
    .findIndex(t=>t.textContent.replace(/[▼▲]/g,'').trim()==='Click errors');
  ['ratio','abs'].forEach(v=>{
    w.CF.state.view=v;w.CF.render();
    ok('the campaign table has a click-error column in '+v+' view',beCol()>=0,
       [...doc.querySelectorAll('#tbtag thead th')].map(t=>t.textContent).join('|'));
  });

  // the rendered rate must recompute from the pulled counts, per period
  w.CF.state.view='ratio';
  let beBad=[];
  [['all',false],['2026-06',false],['2026-08',true]].forEach(([p4,m4])=>{
    w.CF.state.period=p4;w.CF.state.mtd=m4;w.CF.render();
    // as above: in MTD mode the pull's key carries the M suffix. The old
    // "m4?p4:p4" was a no-op that only looked like a branch.
    const kk=p4==='all'?'all':(m4?p4+'M':p4);
    [...doc.querySelectorAll('#tbtag tbody tr')].slice(0,40).forEach(r=>{
      const tag=r.cells[0].textContent;
      const shown=r.cells[beCol()].textContent;
      if(shown==='—'||!pulledBE[tag])return;
      const raw=pulledBE[tag][kk];
      if(!raw)return;
      const want=(raw[1]/raw[0]*100);
      const got=Number(shown.replace('%',''));
      if(Math.abs(got-want)>0.06)beBad.push(p4+' '+tag+': '+shown+' vs '+want.toFixed(1));
    });
  });
  ok('the click-error rate recomputes from the pull',beBad.length===0,
     beBad.length+': '+beBad.slice(0,3).join(' | '));

  // the small-sample guard: no campaign under 50 visits may show a rate
  w.CF.state.period='all';w.CF.state.mtd=false;w.CF.render();
  const bad=[...doc.querySelectorAll('#tbtag tbody tr')].filter(r=>{
    const vis=Number(r.cells[1].textContent.replace(/,/g,''));
    return r.cells[beCol()].textContent!=='—'&&vis<50;});
  ok('campaigns with too few visitors show no rate',bad.length===0,
     bad.slice(0,3).map(r=>r.cells[0].textContent+' '+r.cells[1].textContent).join(', '));
  // and the artefact that motivated it is actually suppressed
  const artefact=[...doc.querySelectorAll('#tbtag tbody tr')]
    .find(r=>r.cells[0].textContent==='106545748_501694');
  ok('the 17-person campaign no longer tops the table',
     !artefact||artefact.cells[beCol()].textContent==='—',
     artefact?artefact.cells[beCol()].textContent:'(absent)');
  w.CF.state.sortBtag={key:null,dir:-1};w.CF.state.btagCut=20;w.CF.render();
}

// --- the refresh actually reached every period ------------------------------
// The day series used to be a separate older pull, so a refresh moved the
// window, the months and the MTD label forward while the day list quietly
// stayed behind. This pins them to each other.
(()=>{
  const last=D.days[D.days.length-1];
  const lastMonth=D.months[D.months.length-1];
  ok('the day series reaches the end of the window',
     last.slice(0,7)===lastMonth&&Number(last.slice(8))>=D.mtdDay,
     'last day '+last+', mtdDay '+D.mtdDay);
  ok('the MTD label matches the data',
     [...doc.querySelectorAll('#period .seg button')]
       .some(b=>b.textContent==='MTD (1\u2013'+D.mtdDay+')'),
     [...doc.querySelectorAll('#period .seg button')].map(b=>b.textContent).join('|'));
  // and the newest day must actually render rows
  w.CF.state.period=last;w.CF.state.mtd=false;w.CF.state.drill=null;
  w.CF.state.drillGsrc=null;w.CF.state.drillBtag=null;w.CF.render();
  ok('the newest day has data in the country table',
     [...doc.querySelectorAll('#tratio tbody tr')].length>1,
     last+': '+doc.querySelectorAll('#tratio tbody tr').length+' rows');
  w.CF.state.period='all';w.CF.render();
})();

// --- first deposits by channel ---------------------------------------------
(function(){
  const CH=D.channels||[];
  const ftd=a=>(a||[0,0,0,0,0])[4];
  ok('the data carries channel bands',CH.length>0,CH.length+' bands');
  ok('every band is named and has a funnel',
     CH.every(c=>typeof c.c==='string'&&c.c&&Array.isArray(c.f)&&c.f.length===5));

  // Sources are first-touch and disjoint, so bands partition the site exactly.
  // If a referring domain ever falls through the builder's rules this is what
  // catches it -- the whole reason the bands are worth trusting.
  const site=CH.reduce((s,c)=>s+ftd(c.f),0);
  const pull=(D.sources||[]).reduce((s,r)=>s+ftd(r.f),0);
  ok('bands foot to the source pull',site===pull,site+' vs '+pull);

  // ...and each step, not just the last, or a band could be right on deposits
  // and wrong everywhere above it
  let stepBad=[];
  for(let i=0;i<5;i++){
    const a=CH.reduce((s,c)=>s+c.f[i],0);
    const b=(D.sources||[]).reduce((s,r)=>s+r.f[i],0);
    if(a!==b)stepBad.push('step'+i+': '+a+' vs '+b);
  }
  ok('bands foot at every funnel step',stepBad.length===0,stepBad.join(' | '));

  ok('bands are mutually exclusive',
     new Set(CH.map(c=>c.c)).size===CH.length);
  ok('the attribution-lost band is carried, not spread',
     CH.some(c=>c.c==='Self-referred'),CH.map(c=>c.c).join(', '));

  w.CF.state.drill=null;w.CF.render();
  const crow=[...doc.querySelectorAll('#tchan tbody tr')];
  ok('the channel table renders a row per band plus a total',
     crow.length===CH.length+1,crow.length+' rows for '+CH.length+' bands');
  const chead=[...doc.querySelectorAll('#tchan thead th')].map(t=>t.textContent);
  ok('the channel table has a column per month',
     D.months.every(m=>chead.length&&chead.slice(3).length===D.months.length),
     chead.join('|'));
  ok('the newest month reached the channel table',
     chead[chead.length-1]!=='2026-09'&&chead.length===3+D.months.length,
     chead.join('|'));

  // the rendered total must be the computed total, not a stale literal
  const totCells=[...crow[crow.length-1].cells].map(c=>c.textContent);
  ok('the channel total row shows the site FTD total',
     totCells[1].replace(/,/g,'')===String(site),totCells[1]+' vs '+site);

  // Month columns legitimately sum to LESS than the window, because the funnel
  // is cumulative within a period. Assert the direction so nobody "fixes" the
  // gap by loosening the period rule, and assert the page says so.
  const monSum=D.months.reduce((s,m)=>
    s+CH.reduce((t,c)=>t+ftd((c.m||{})[m]),0),0);
  ok('month columns sum to less than the window',monSum<site&&monSum>site*0.9,
     monSum+' vs '+site);
  ok('the page explains the month gap',
     (doc.getElementById('cnote').textContent||'').includes('deposited in another'));
})();

// --- the 29 August tracking break ------------------------------------------
// Visitors are not comparable across 29 August, so the page must say so, and
// must say it louder when the selected period actually straddles the date. The
// danger this guards against is the page quietly showing a ~25x jump in every
// conversion rate as though it were a result.
(function(){
  const brk=doc.getElementById('brk');
  ok('the data carries a break day',!!D.breakDay,String(D.breakDay));
  ok('the break banner exists',!!brk);
  const set=(p,mtd,view)=>{w.CF.state.period=p;w.CF.state.mtd=mtd;
                           w.CF.state.view=view;w.CF.render();};

  // the full window covers both regimes
  set('all',false,'ratio');
  ok('the full window warns in Ratios',brk.className.includes('warn'),brk.className);
  // Numbers are absolute counts, which ARE comparable across the break
  set('all',false,'abs');
  ok('the full window does not warn in Numbers',!brk.className.includes('warn'));

  // the break month straddles it; the months either side do not
  const bm=D.breakDay.slice(0,7);
  set(bm,false,'ratio');
  ok('the break month warns in Ratios',brk.className.includes('warn'),bm);
  const before=D.months[0], after=D.months[D.months.length-1];
  set(before,false,'ratio');
  ok('a month wholly before the break does not warn',
     !brk.className.includes('warn'),before);
  set(after,false,'ratio');
  ok('a month wholly after the break does not warn',
     !brk.className.includes('warn'),after);

  // MTD is days 1-2, so it can never straddle a break on the 29th
  set(bm,true,'ratio');
  ok('MTD never warns',!brk.className.includes('warn'),bm+' MTD');
  // a single day sits on exactly one side by construction
  set(D.days[D.days.length-1],false,'ratio');
  ok('a single day does not warn',!brk.className.includes('warn'));

  // the banner must always carry the explanation, warning or not
  ok('the banner explains the break',
     (brk.textContent||'').includes('29 August'),
     (brk.textContent||'').slice(0,60));
  set('all',false,'ratio');
})();

console.log(fail?'\n'+fail+' FAILED':'\nall passed');
process.exit(fail?1:0);
