const SNAP=require('./snapshot.js');
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const click=id=>doc.getElementById(id).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const on=id=>doc.getElementById(id).classList.contains('active');

// ---- state defaults
ok(D.state.era==='all','default era = all history');
ok(D.state.whale==='inc','default whale = included');
ok(D.state.email==='yes','default email = verified');
ok(D.state.phone==='yes','default phone = verified');
ok(D.state.status==='all','default status = all');
ok(D.state.fraud==='no','default fraud = No (fraud & abuse excluded)');
ok(doc.getElementById('btnFNo').classList.contains('active'),'fraud No button is lit on load');
ok(!doc.getElementById('btnFAll').classList.contains('active')&&!doc.getElementById('btnFYes').classList.contains('active'),'fraud All/Yes not lit on load');
ok(D.state.prod===-1,'default product = all products');
ok(D.state.churn==='','default recency = any');

// ---- markup must agree with state, or the buttons lie on load
ok(on('btnAll')&&!on('btnNew')&&!on('btnOld'),'era buttons: only All history is lit');
ok(on('btnWInc')&&!on('btnWEx'),'whale buttons: only Included is lit');
ok(on('btnEYes')&&!on('btnEAll')&&!on('btnENo'),'email buttons: only Verified is lit');
ok(on('btnPYes')&&!on('btnPAll')&&!on('btnPNo'),'phone buttons: only Verified is lit');
ok(on('btnSAll')&&!on('btnSActive')&&!on('btnSBlocked'),'status buttons: only All is lit');
ok(doc.getElementById('selProd').value==='-1','product select shows All products');
ok(doc.getElementById('selChurn').value==='','churn select shows Any year');

// ---- the opening figures match the screenshot
const T=D.AGG.T;
ok(T.p===SNAP.defaultPlayers,'opens on the snapshot default count (got '+T.p+')');
const val=Math.round(T.c/100/1e6);
ok(val>=370&&val<=385,'opens on roughly EUR 376m with fraud excluded (got '+val+'m)');
const sm=doc.getElementById('filterSummary').textContent;
ok(sm.includes(SNAP.defaultPlayers.toLocaleString('en-US'))&&sm.includes(SNAP.eras['all|inc'][0].toLocaleString('en-US')),'summary reads the filtered count of the whole base');
ok((sm.match(/%/g)||[]).length>=2,'summary reports both shares as percentages');
ok(sm.includes('excluding fraud & abuse'),'summary names the fraud exclusion');
ok(doc.getElementById('btnReset').style.display==='','Clear filters visible on load, since the page opens filtered');
ok(/karolik777 is/.test(doc.getElementById('filterMeta').textContent),'context line quantifies the whale');

// ---- meta strip, callouts and footnote list all removed on request
ok(doc.querySelectorAll('.meta-strip').length===0,'meta strip removed');
ok(!html.includes('.meta-strip {'),'dead meta-strip CSS removed too');
ok(doc.querySelectorAll('.callout').length===0,'summary and rate callouts removed');
ok(!html.includes('.callout {'),'dead callout CSS removed too');
ok(!html.includes('renderCallout'),'renderCallout function removed');
ok(doc.querySelectorAll('.footnote ul').length===0,'footnote list removed');
ok(doc.querySelectorAll('.footnote').length===3,'three table notes: both cross-tabs and the drill panel');
ok(!doc.getElementById('tblNote'),'the buckets-table note is gone');
ok(!html.includes('Each player falls in exactly one bucket'),'its text is not lurking in the file either');
ok(doc.querySelectorAll('svg').length===0,'both charts removed - no svg left on the page');

// ---- compact filter bar
ok(doc.querySelectorAll('.fgroup').length===9,'nine filter groups in one wrapping grid');
ok(doc.querySelectorAll('.filter-row').length===0,'the old one-per-row layout is gone');
ok(doc.querySelectorAll('.fgrid').length===1,'a single grid holds them all');
ok([...doc.querySelectorAll('.fgroup')].every(g=>g.title&&g.title.length>20),'every group carries an explanatory tooltip');
ok(!!doc.getElementById('filterMeta').textContent.trim(),'the shared context line is populated');
const meta=doc.getElementById('filterMeta').textContent;
ok(meta.includes('23 May 2018')&&meta.includes('karolik777')&&meta.includes(SNAP.anchor),
   'context line still carries era range, whale size and the recency anchor');
ok(doc.querySelectorAll('.chart-card').length===0,'chart cards removed');
ok(!html.includes('.chart-card {'),'dead chart CSS removed too');
ok(!html.includes('function drawShare')&&!html.includes('function drawAvg'),'chart drawers removed');
ok(!html.includes('function niceStep'),'SVG axis helper removed with them');

// ---- page renders correctly at the new default
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'13 metric rows on load');
ok([...doc.querySelectorAll('#tbl thead th')].map(e=>e.textContent).slice(1,11).join(',')==='1,2,3,4,5,6-10,11-20,21-50,51-100,100+','buckets horizontal on load');
ok(doc.querySelectorAll('.stat-card').length===0,'stat cards still gone');
ok(D.AGG.B.reduce((a,b)=>a+b.p,0)===T.p,'buckets partition the default selection');
ok(D.AGG.B.reduce((a,b)=>a+b.c,0)===T.c,'bucket value partitions exactly at the default');
ok(doc.getElementById('selChurn').options.length>=19,'churn list built for all history (any + 5 bands + 4 thresholds + 9 years)');

// ---- Clear filters widens to the whole base, and keeps era/whale
click('btnReset');
ok(D.state.email==='all'&&D.state.phone==='all'&&D.state.churn==='','Clear filters drops the verification filters');
ok(D.state.era==='all'&&D.state.whale==='inc','Clear filters leaves era and whale alone');
ok(D.AGG.T.p===SNAP.eras['all|inc'][0],'cleared view is the whole base (got '+D.AGG.T.p+')');
ok(on('btnEAll')&&!on('btnEYes'),'email buttons follow the reset');
ok(doc.getElementById('btnReset').style.display==='none','Clear filters hides itself once nothing is filtered');

// ---- and the defaults are reachable again by clicking
click('btnEYes'); click('btnPYes');
ok(D.AGG.T.p>SNAP.defaultPlayers,'clearing the fraud filter widens the selection');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
