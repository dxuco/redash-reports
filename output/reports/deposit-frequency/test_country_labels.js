const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const short=D.RAW.meta.countries, full=D.RAW.meta.countriesFull;

// ---- both lists present and aligned
ok(Array.isArray(full)&&full.length===short.length,'short and full country lists are the same length');
ok(short.length===216,'216 countries');

// ---- nothing is long any more
const longest=short.reduce((a,b)=>b.length>a.length?b:a);
ok(longest.length<=20,'longest label is now '+longest.length+' chars ("'+longest+'")');
ok(!short.some(c=>c.length>24),'no label over 24 chars');
ok(full.some(c=>c.length>40),'the full names are still kept alongside');

// ---- the specific offenders
const map={};
full.forEach((f,i)=>map[f]=short[i]);
ok(map['United Kingdom of Great Britain and Northern Ireland']==='United Kingdom','UK shortened');
ok(map['United States of America']==='United States','USA shortened');
ok(map['Korea (Republic of)']==='South Korea'&&map["Korea (Democratic People's Republic of)"]==='North Korea','the two Koreas are distinguished, not both "Korea"');
ok(map['Congo (Democratic Republic of the)']==='DR Congo','DR Congo shortened');
ok(map['Iran (Islamic Republic of)']==='Iran','parenthetical qualifier stripped');
ok(map['Tanzania, United Republic of']==='Tanzania','comma inversion stripped');
ok(map['Lao People’s Democratic Republic']==='Laos'||map["Lao People's Democratic Republic"]==='Laos','Laos shortened');

// ---- uniqueness: no two countries collapsed into one label
ok(new Set(short).size===short.length,'every short label is still unique - no country silently merged');
// the near-miss pair that a naive rule would have merged
ok(map['Saint Martin (French part)']!==map['Sint Maarten (Dutch part)'],'St. Martin and St. Maarten stay distinct');
ok(map['Congo']!==map['Congo (Democratic Republic of the)'],'Congo and DR Congo stay distinct');

// ---- VPN Player survives untouched
ok(short.includes('VPN Player'),'VPN Player is left alone');

// ---- rendering: short shown, full on hover
D.openDrill(9);
const cells=[...doc.querySelectorAll('#drill tbody tr')].map(r=>r.querySelectorAll('td')[3]);
ok(cells.every(c=>c.textContent.length<=24),'rendered country cells are short');
ok(cells.every(c=>c.hasAttribute('title')),'every country cell carries the official name as a tooltip');
const uk=cells.find(c=>c.textContent==='United Kingdom');
if(uk) ok(uk.getAttribute('title').includes('Great Britain'),'hovering UK shows the full ISO name');
else ok(true,'no UK player in this cell - skipped');

// ---- sorting still by the displayed name
const col=[...doc.querySelectorAll('#drill th.sortable')].find(t=>t.getAttribute('data-key')==='country');
col.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const cs=[...doc.querySelectorAll('#drill tbody tr')].map(r=>r.querySelectorAll('td')[3].textContent.toLowerCase());
ok(cs.every((x,i)=>i===0||cs[i-1]<=x),'country still sorts A-Z on the short label');

// ---- nothing else broke
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'buckets table intact');
ok(doc.querySelectorAll('#xtab td[data-xd]').length>0,'cross-tab still clickable');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
