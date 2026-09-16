const D=window.__DATA__;
const KAR=new Set(D.karIdx);
const NAMEBIDS={}; D.bids.forEach((m,i)=>{(NAMEBIDS[m[0]]||(NAMEBIDS[m[0]]=new Set())).add(i);});
const bonusCode=name=>{const c=[...(NAMEBIDS[name]||[])].map(i=>D.bids[i][3]).filter(Boolean); return c.length?c.join(', '):'—';};
const CATS=['Cashback','Free spin','Rakeback','Free bet','Deposit bonus','Sport Offer','World Cup','CRM Flow','Wager Bonus','Monthly Promo','Leaderboard','Tournament','Free chips','Welcome','Community','Comeback','Reload','Sport Campaign','Acquisition','Lootbox','VIP Transfer','Minigame','Other'];
const segLabel=s=>{s=String(s==null?'':s).trim(); return (s===''||s==='nan'||s==='None'||s==='(none)'||s==='NaN')?'Unknown':s;};
const SEGS=D.segments.slice(); const SEGI={}; SEGS.forEach((s,i)=>SEGI[s]=i);
const PSEG=D.pseg.map(i=>SEGS[i]);
const SEGRANK={'Vip':0,'Elit':1,'Pre Elit':2,'Regular':3,'Mass':4,'Risk':5,'One Timer':6,'Free Rider':7,'Churn':8,'Unknown':99};
const segRank=lbl=>SEGRANK[lbl]!==undefined?SEGRANK[lbl]:50;
function catIdx(b){const n=String(b[0]).toLowerCase(), sub=String(b[2]||'').toLowerCase(), grp=String(b[1]||'').toLowerCase();
 if(/discord|twitter|telegram|telegam|community/.test(n)||sub==='community')return 14;
 if(grp==='acquisition')return 18;
 if(/loot\s*box/.test(n))return 19;
 if(/transfer/.test(n))return 20;
 if(/mini[\s-]?game/.test(n))return 21;
 if(/comeback/.test(n))return 15;
 if(/re-?load/.test(n))return 16;
 if(/sport/.test(n)&&/campaign/.test(n))return 17;
 if(/sport/.test(n))return 5;
 if(/\bdep/.test(n) && !/\bno[ -]?deposit/.test(n))return 4;
 if(/world\s*cup|worldcup/.test(n))return 6;
 if(/jrny|retention|churn/.test(n)||/flow/.test(sub))return 7;
 if(/wager/.test(n))return 8;
 if(/tournament/.test(n)||/tournament/.test(sub))return 11;
 if(/leaderboard/.test(n)||/leaderboard/.test(sub))return 10;
 if(/monthly\s*promo/.test(sub))return 9;
 if(/welcome/.test(n)||/welcome/.test(sub))return 13;
 if(/rake\s*back/.test(n))return 2;
 if(/cash\s*back|bank\s*back|loyalty\s*reward/.test(n))return 0;
 if(/free\s*bet/.test(n))return 3;
 if(/free\s*spin/.test(n))return 1;
 if(/free\s*chips/.test(n))return 12;
 return 22;}
const CAT=D.bids.map(b=>catIdx(b));
let S='without', sortKey='cost', sortAsc=false, ddRows=[], ddCtx=null;
/* How many player rows the drill-down draws. Every cell now lists its whole
   population rather than only the bonused players, so a Total column can be
   138,000 rows — built as a single innerHTML string, that is seconds of freeze
   for a list nobody scrolls. Totals and CSV are unaffected. */
const DD_ROW_CAP=2000;
const collapsed=new Set(D.rows.map(r=>r.group));
/* Subgroups whose flow rows are hidden, keyed "group|subgroup". Starts as
   everything, so a subgroup opens only when asked - the flows are detail,
   not something to wade through on the way down the table. */
const collapsedSub=new Set();
/* Seeded per subgroup the first time it is rendered, not on a single global
   pass: the four variants of this table filter rows differently, so a subgroup
   with no cost but some players first appears in the player-count table.
   Seeding stops the moment the user touches a toggle, so their choice sticks. */
const seenSub=new Set();
let subSeeding=true;
let selPlayer=null, selBonus=null, ddMode='bonuses', ddBonusCache=null, seg='ALL', mtdOn=true;
let msortCol=null, msortAsc=false;
const V=()=>mtdOn?D.mtd:D;
const isPartial=i=>!mtdOn&&D.partial.includes(i);
const curData=()=> seg==='ALL'?V().data[S]:V().dataS[seg][S];
const segMatch=p=> seg==='ALL'||D.pseg[p]===+seg;
const sum=a=>a.reduce((x,y)=>x+y,0);
const money=v=>v===0?'<span class="z">&mdash;</span>'
 :(v<0?'<span class="neg">-$'+Math.abs(Math.round(v)).toLocaleString('en-US')+'</span>'
      :'$'+Math.round(v).toLocaleString('en-US'));
const moneyc=v=>(v<0?'-$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const rate=(c,a)=>a<=0?'<span class="z">n/m</span>':c===0?'<span class="z">&mdash;</span>':(100*c/a).toFixed(1)+'%';
const rate2=(c,a)=>a<=0?'<span class="z">n/m</span>':c===0?'<span class="z">&mdash;</span>':(100*c/a).toFixed(2)+'%';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- aggregate tables ---------- */
/* ---- CRM flow rows -------------------------------------------------------
   build.js stores each flow as an ordinary entry under its group, named
   "<subgroup><sep><flow>". That keeps costVal's two-part lookup working, and
   means a report built before this feature simply has no such keys and
   renders exactly as it did. */
const FSEP = D.flowSep || '\u203A';
const BFLOW = D.bflow || [];
/* Flow rows sitting under one subgroup, biggest first. */
function flowsUnder(grp, sub){
 const g = curData().g[grp]; if(!g) return [];
 const pre = sub + FSEP;
 return Object.keys(g).filter(k => k.slice(0, pre.length) === pre)
   .map(k => ({ key: k, name: k.slice(pre.length) }))
   .filter(f => sum(g[f.key]) !== 0)
   .sort((a, b) => sum(g[b.key]) - sum(g[a.key]));
}

function costVal(key,mi){
 let arr;
 const DT=curData();
 if(key==='__ALL__') arr=DT.total;
 else if(key.indexOf('|')>=0){const p=key.split('|'); arr=DT.g[p[0]][p[1]];}
 else arr=DT.g[key]['_'];
 return mi<0? sum(arr): arr[mi];
}
function playersIn(key,mi){
 const c=V().cells[key]; const set=new Set(); if(!c) return set;
 const months = mi<0 ? Object.keys(c) : (c[mi]?[mi]:[]);
 months.forEach(m=>(c[m]||[]).forEach(a=>{const p=a[0]; if(S==='without'&&KAR.has(p))return; if(!segMatch(p))return; set.add(p);}));
 return set;
}
const countCell=(key,mi)=>playersIn(key,mi).size;

function hdr(first){const ar=i=>msortCol===i?(msortAsc?' \u25B2':' \u25BC'):'';
 const mo=D.labels.map((l,i)=>`<th class="hs${isPartial(i)?' pm':''}" data-sc="${i}">${l}${isPartial(i)?'*':''}${ar(i)}</th>`).join('');
 return `<thead><tr><th class="hs" data-sc="null">${first}</th>${mo}<th class="hs tcol" data-sc="-1">Total${ar(-1)}</th></tr></thead>`;}
function sortIdx(order,val){ if(msortCol===null) return order;
 return order.slice().sort((a,b)=>{const d=val(a)-val(b); return msortAsc?d:-d;}); }
function buildCatTable(id,kind){
 const nM=D.months.length, M=CATS.map(()=>new Array(nM).fill(0));
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p))continue; if(!segMatch(p))continue;
   const recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ M[CAT[recs[i][1]]][recs[i][0]]+=recs[i][2]; } }
 const aggr=curData().aggr, grandA=sum(aggr), rt=a=>a.reduce((x,y)=>x+y,0);
 const fmt=(v,i)=> kind==='rate' ? rate(v, i<0?grandA:aggr[i]) : money(v);
 let h=hdr('Keyword')+'<tbody>';
 let order=CATS.map((c,ci)=>ci).filter(ci=>rt(M[ci])!==0);
 order=sortIdx(order, ci=> msortCol<0?rt(M[ci]):M[ci][msortCol]);
 order.forEach(ci=>{ const arr=M[ci];
   const cells=arr.map((v,i)=>`<td class="k" data-key="CAT:${ci}" data-m="${i}">${fmt(v,i)}</td>`).join('')+
     `<td class="k tcol" data-key="CAT:${ci}" data-m="-1">${fmt(rt(arr),-1)}</td>`;
   h+=`<tr class="g"><td>${CATS[ci]}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>CATS.reduce((s,_c,ci)=>s+M[ci][i],0)), grand=rt(colTot);
 h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+
    colTot.map((v,i)=>`<td>${fmt(v,i)}</td>`).join('')+`<td class="tcol">${fmt(grand,-1)}</td></tr>`;
 /* The denominator row is clickable too. It is every player in scope, not just
    the bonused ones, so it uses ALLP rather than a bonus-group key — the
    figure here includes players who never took a bonus and the list has to
    match it. */
 if(kind==='rate') h+=`<tr class="ref"><td>Adjusted GGR</td>`+aggr.map((v,i)=>`<td class="k" data-key="ALLP" data-m="${i}">${money(v)}</td>`).join('')+`<td class="k tcol" data-key="ALLP" data-m="-1">${money(grandA)}</td></tr>`;
 h+=`</tfoot>`;
 document.getElementById(id).innerHTML=h;
}
/* ---------- bonus group by user type ----------
 *
 * Rows are bonus groups, columns are the four user types. That is the one
 * table on this page whose columns are not months, so it does not use hdr()
 * and it does not take part in the month sorting.
 *
 * The four types are mutually exclusive by construction — see USER_TYPES in
 * build.js. A player who first deposited in 2026 is counted there even if they
 * are also Vip, which is why the Vip column here is smaller than the Vip row
 * in the segment tables further down. The note under the first table says so
 * on the page, because the two numbers sitting near each other and disagreeing
 * is exactly the kind of thing that costs someone an afternoon.
 *
 *   kind 'cost'   dollars
 *        'rate'   % of that column's own adjusted GGR
 *        'share'  % of that row's total, so each row reads across to 100%
 */
const UT = () => (V().dataU || null);

function buildUserTable(id,kind){
 const box=document.getElementById(id); if(!box) return;
 const U=UT();
 if(!U){ box.innerHTML='<tbody><tr><td class="z">This report was built before the '+
   'user-type breakdown existed. Run a rebuild to populate it.</td></tr></tbody>'; return; }

 const types=D.userTypes||['FTD 2026','Vip','Regular','All other'];
 const nT=types.length;
 const groups=D.rows.map(r=>r.group);

 /* group -> cost per type, and the adjusted GGR of each type, both summed
    across every month in the build = year to date. */
 const M={}, aggr=new Array(nT).fill(0);
 groups.forEach(g=>M[g]=new Array(nT).fill(0));
 for(let ui=0;ui<nT;ui++){
  const blk=U[String(ui)] && U[String(ui)][S]; if(!blk) continue;
  aggr[ui]=sum(blk.aggr||[]);
  for(const g in (blk.g||{})){ if(!M[g]) M[g]=new Array(nT).fill(0); M[g][ui]+=sum(blk.g[g]); }
 }

 const rowsOut=Object.keys(M).filter(g=>M[g].some(v=>v!==0));
 rowsOut.sort((a,b)=>sum(M[b])-sum(M[a]));

 const colTot=new Array(nT).fill(0);
 rowsOut.forEach(g=>M[g].forEach((v,i)=>colTot[i]+=v));
 const grand=sum(colTot), grandA=sum(aggr);

 const cell=(v,ui,rowTotal)=>
   kind==='rate'  ? rate(v, ui<0?grandA:aggr[ui]) :
   kind==='share' ? rate(v, rowTotal) :
                    money(v);

 let h='<thead><tr><th>Bonus group</th>'+
   types.map(t=>`<th>${esc(t)}</th>`).join('')+
   '<th class="tcol">Total</th></tr></thead><tbody>';

 /* Clickable only when the build carried putype — an older data.json has the
    costs but no way to say which players they belong to, and a cell that opens
    an empty list is worse than one that does not open. */
 const drill=!!(D.putype&&D.putype.length);
 rowsOut.forEach(g=>{
  const arr=M[g], rt=sum(arr);
  h+=`<tr class="g"><td>${esc(g)}</td>`+
     arr.map((v,i)=>drill
       ? `<td class="k" data-key="UT:${i}|${esc(g)}" data-m="-1">${cell(v,i,rt)}</td>`
       : `<td>${cell(v,i,rt)}</td>`).join('')+
     `<td class="tcol">${cell(rt,-1,rt)}</td></tr>`;
 });

 h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+
    colTot.map((v,i)=>`<td>${cell(v,i,grand)}</td>`).join('')+
    `<td class="tcol">${cell(grand,-1,grand)}</td></tr>`;
 if(kind==='rate')
  h+=`<tr class="ref"><td>Adjusted GGR</td>`+
     aggr.map((v,i)=>drill?`<td class="k" data-key="UTA:${i}" data-m="-1">${money(v)}</td>`:`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(grandA)}</td></tr>`;
 if(kind==='cost')
  h+=`<tr class="ref"><td>Share of all bonus cost</td>`+
     colTot.map(v=>`<td>${rate(v,grand)}</td>`).join('')+
     `<td class="tcol">${grand?'100.0%':'<span class="z">&mdash;</span>'}</td></tr>`;
 h+=`</tfoot>`;
 box.innerHTML=h;
}

function buildUserNote(){
 const el=document.getElementById('tutnote'); if(!el) return;
 const U=UT(); if(!U){ el.textContent=''; return; }
 const types=D.userTypes||[];
 el.innerHTML='Each player counts once. A player whose first deposit was in 2026 is '+
  'counted under <b>'+esc(types[0]||'FTD 2026')+'</b> even if they are also Vip or Regular, '+
  'so the columns add up to the row total. That also means the <b>Vip</b> column here is '+
  'smaller than the Vip row in the segment tables below — those count every Vip, this one '+
  'counts Vips who first deposited before 2026.'+
  (mtdOn?' Month-to-date, days 1&ndash;'+D.mtdDay+' of each month.':'');
}

/* ---------- player win / loss ----------
 *
 * The same bands the monthly FTD page draws as a chart, as a table here.
 *
 * The sign convention is the thing to keep straight: adjusted GGR is what the
 * house kept, so a player with NEGATIVE adjusted GGR is one who is AHEAD, and
 * the "players ahead" total is a sum of negative numbers. Reading it the other
 * way round inverts the whole table and it still looks entirely plausible,
 * which is why the caption on the card spells it out.
 *
 * Break-even is its own row rather than being folded into either side. On this
 * data it is a real population — players who registered, deposited and never
 * placed a bet — and burying them in "ahead" would overstate it.
 */
const WL_BANDS=[
 {lab:'&lt; -$1k',      side:'ahead', test:v=>v<-1000},
 {lab:'-$1k..-250',    side:'ahead', test:v=>v>=-1000&&v<-250},
 {lab:'-$250..-50',    side:'ahead', test:v=>v>=-250&&v<-50},
 {lab:'-$50..0',       side:'ahead', test:v=>v>=-50&&v<0},
 {lab:'$0',            side:'even',  test:v=>v===0},
 {lab:'$0..50',        side:'behind',test:v=>v>0&&v<=50},
 {lab:'$50..250',      side:'behind',test:v=>v>50&&v<=250},
 {lab:'$250..1k',      side:'behind',test:v=>v>250&&v<=1000},
 {lab:'&gt; $1k',      side:'behind',test:v=>v>1000},
];
const SIDE_LAB={ahead:'player ahead',behind:'player behind',even:'break-even'};

/* Band colours, dark at the extremes and pale towards the middle, so the tails
   read first. Navy for players ahead, amber for players behind, grey for level.
   Every value is from theme.css. */
const WL_FILL=['#0F2A43','#4A6480','#5B7285','#A8BAC9','#B7C3CF','#F2C48E','#ECA255','#E67E22','#A85410'];
let wlMode='count';

/* This whole section covers the LATEST MONTH only, not the whole build range.
   "How is August going" is a different question from "how has the year gone",
   and mixing eight months of players into one distribution answers neither. */
const wlMonth=()=>D.months.length-1;

/* A player's total for the period, and whether they played at all.
 *
 * The second part matters more than it sounds. 78,253 of the 88,641 players in
 * this period have an adjusted GGR of exactly zero because they never placed a
 * bet or made a deposit — they registered and stopped. Counting them as
 * "break-even" put 88% of the table in one row and made every percentage in it
 * describe registration rather than play. They are excluded and reported
 * separately instead, which is also what the monthly FTD page's version of
 * this chart does by only covering that month's depositors.
 */
function wlTotals(p){
 const r=(V().pm[p]||{})[wlMonth()]; if(!r) return null;
 const ggr=r[0],aggr=r[1],dep=r[2];
 return {aggr,played:!(ggr===0&&dep===0&&aggr===0)};
}

/* Everyone who played in the month, with their adjusted GGR and bonus cost. */
function wlPlayers(){
 const mi=wlMonth(), out=[], pm=V().pm, det=V().detail;
 for(const pis in pm){ const p=+pis;
   if(S==='without'&&KAR.has(p))continue;
   if(!segMatch(p))continue;
   const t=wlTotals(p); if(!t||!t.played)continue;
   let c=0; const recs=det[pis];
   if(recs) for(let i=0;i<recs.length;i++) if(recs[i][0]===mi) c+=recs[i][2];
   out.push({p,aggr:t.aggr,cost:c});
 }
 return out;
}

function wlBandOf(p){
 const t=wlTotals(p);
 if(!t||!t.played) return -1;
 return WL_BANDS.findIndex(b=>b.test(t.aggr));
}

/* One pass over the population, bucketed. Shared by the table and the
   drill-down so the two cannot disagree about where a player belongs. */
function wlBuckets(){
 const rows=WL_BANDS.map(()=>({n:0,aggr:0,cost:0}));
 let idle=0;
 const pm=V().pm;
 for(const pis in pm){ const p=+pis;
   if(S==='without'&&KAR.has(p))continue;
   if(!segMatch(p))continue;
   const t=wlTotals(p); if(!t)continue;
   if(!t.played) idle++;
 }
 for(const q of wlPlayers()){
   const bi=WL_BANDS.findIndex(b=>b.test(q.aggr));
   if(bi<0)continue;
   const r=rows[bi]; r.n++; r.aggr+=q.aggr; r.cost+=q.cost;
 }
 rows.idle=idle;
 return rows;
}

/* The four headline tiles, the diverging chart and the two top-12 lists. */
function buildWinLossViz(){
 const box=document.getElementById('wlChart'); if(!box) return;
 const fmtN=v=>Math.round(v).toLocaleString('en-US');
 const mi=wlMonth(), label=(D.labels&&D.labels[mi])||D.months[mi];
 const rows=wlBuckets(), players=wlPlayers();
 const tot=players.length;
 const ahead=players.filter(q=>q.aggr<0), behind=players.filter(q=>q.aggr>0);
 const mid=players.filter(q=>Math.abs(q.aggr)<=50);
 const sumA=a=>a.reduce((x,y)=>x+y.aggr,0);
 const net=sumA(players);

 const cap=document.getElementById('wlCap');
 if(cap) cap.innerHTML=
   `Every player who played in <b>${esc(label)}</b> placed on a range by their adjusted GGR for that month`+
   (mtdOn?` (days 1&ndash;${D.mtdDay})`:'')+
   ` &middot; <b style="color:#0F2A43">navy = players ahead</b> (house paid out) &middot; `+
   `<b style="color:#A85410">amber = players behind</b> (house kept it) &middot; grey = break-even &middot; `+
   `${S==='without'?'karolik777 excluded':'karolik777 included'}. `+
   `The grey figure above each bar is the <b>bonus cost</b> that band received.`+
   /* Said here rather than left implicit. These are 58% of everyone with a row
      this month, and a reader who assumes the chart covers the whole book will
      read every count in it as far too small. */
   (rows.idle?` A further <b>${rows.idle.toLocaleString()}</b> players are not shown: they registered but never bet or deposited this month.`:'');

 const K=document.getElementById('wlKpis');
 if(K) K.innerHTML=[
  ['Players ahead', fmtN(ahead.length), 'won '+money(Math.abs(sumA(ahead)))+' from the house', '#0F2A43'],
  ['Players behind', fmtN(behind.length), 'lost '+money(sumA(behind))+' to the house', '#A85410'],
  ['Middle class · ±$50', fmtN(mid.length), (tot?Math.round(100*mid.length/tot):0)+'% of players · net '+money(sumA(mid)), 'var(--text-primary)'],
  ['Net adj GGR', money(net), net<0?'house down overall':'house up overall', net<0?'#C0392B':'#0B6E3A'],
 ].map(k=>`<div class="wlkpi"><div class="lab">${k[0]}</div>`+
          `<div class="val" style="color:${k[3]}">${k[1]}</div><div class="sub">${k[2]}</div></div>`).join('');

 /* Diverging bars: ahead to the left of the zero rule, behind to the right. */
 const vals=rows.map(r=>wlMode==='count'?r.n:r.aggr);
 const W=1000,H=250,pl=64,pr=16,pt=26,pb=44,iw=W-pl-pr,ih=H-pt-pb,bw=iw/WL_BANDS.length;
 const peak=Math.max(1,...vals.map(Math.abs));
 const niceTop2=m=>{const p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;
   return ([1,1.5,2,2.5,3,4,5,6,8,10].find(x=>f<=x)||10)*p;};
 /* Extra headroom because each bar carries three labels now — the measure,
    the bonus cost, and that cost against the band's adjusted GGR. Without it
    the taller bars clip their own text. */
 const top=niceTop2(peak*1.32);
 const yy=v=>pt+ih*(1-v/top);
 /* Plain text, not money(). That helper wraps negatives in <span class="neg">
    and zero in <span class="z">, which is fine in a table cell and invalid
    inside an SVG <text> — the browser drops it and the label vanishes. The
    "< -$1k" bar lost its figure that way, on the one band that most wanted it. */
 const m0=v=>(v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US');
 /* bonus cost as a share of the band's adjusted GGR */
 const wlRatio=r=>r.aggr>0?(100*r.cost/r.aggr).toFixed(1)+'%':'n/m';
 const fmtV=v=>wlMode==='count'?fmtN(v):m0(v);
 /* Gridlines get the compact form. "$1,000,000" up the side of a chart is
    three times the width of "$1.0M" and no more informative. */
 const fmtAxis=v=>{ if(wlMode==='count') return fmtN(v);
   const a=Math.abs(v),sg=v<0?'-':'';
   return a>=1e6?sg+'$'+(a/1e6).toFixed(1)+'M':a>=1000?sg+'$'+Math.round(a/1000)+'k':sg+'$'+Math.round(a); };
 let g='';
 for(let k=0;k<=2;k++){ const gv=top*k/2, gy=yy(gv);
   g+=`<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`+
      `<text class="gll" x="${pl-8}" y="${(gy+3).toFixed(1)}" text-anchor="end">${fmtAxis(gv)}</text>`; }
 /* The divider between the two halves sits between the $0 band and the first
    "behind" band, matching where the sign actually changes. */
 const dx=pl+bw*5;
 g+=`<line x1="${dx.toFixed(1)}" y1="${pt}" x2="${dx.toFixed(1)}" y2="${(pt+ih).toFixed(1)}" stroke="var(--grey-3)" stroke-width="1" stroke-dasharray="3 3"/>`;
 WL_BANDS.forEach((b,i)=>{
  const v=Math.abs(vals[i]), cx=pl+i*bw, h=v/top*ih, by=yy(v);
  g+=`<rect class="k" data-key="WL:${i}" data-m="-1" x="${(cx+bw*0.16).toFixed(1)}" y="${by.toFixed(1)}" width="${(bw*0.68).toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2" fill="${WL_FILL[i]}" style="cursor:pointer">`+
     `<title>${b.lab.replace(/&lt;/g,'<').replace(/&gt;/g,'>')} · ${fmtN(rows[i].n)} players · ${m0(rows[i].aggr)} adjusted GGR · ${m0(rows[i].cost)} bonus · ${wlRatio(rows[i])} of adj GGR</title></rect>`;
  if(v>0){
   g+=`<text x="${(cx+bw/2).toFixed(1)}" y="${(by-5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${WL_FILL[i]}">${fmtV(vals[i])}</text>`;
   /* The bonus cost that band received, above its own figure. This is the
      point of having the chart on a bonus cost report at all: it says what
      each slice of the win/loss curve was paid to get there. Muted, so it
      reads as a second fact rather than competing with the first. */
   if(rows[i].cost) g+=`<text x="${(cx+bw/2).toFixed(1)}" y="${(by-18).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--muted)">${m0(rows[i].cost)}</text>`;
   /* Bonus cost against that band's own adjusted GGR. Only meaningful where
      the house is ahead: on the winning half the GGR is negative, and a ratio
      against it would read as a small positive number while actually meaning
      the opposite. Those bands say n/m, as the tables do. */
   if(rows[i].cost) g+=`<text x="${(cx+bw/2).toFixed(1)}" y="${(by-31).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--slate)">${wlRatio(rows[i])}</text>`;
  }
  g+=`<text class="axl" x="${(cx+bw/2).toFixed(1)}" y="${(pt+ih+14).toFixed(1)}" text-anchor="middle">${b.lab}</text>`;
 });
 g+=`<text x="${(pl+bw*2.5).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="11" font-weight="700" fill="#0F2A43">&#9664; players won</text>`;
 g+=`<text x="${(pl+bw*7).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="11" font-weight="700" fill="#A85410">players lost &#9654;</text>`;
 box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">${g}</svg>`;

 const list=(el,arr,colour,align)=>{
  const t=document.getElementById(el); if(!t) return;
  const mx=Math.max(1,...arr.map(q=>Math.abs(q.aggr)));
  t.innerHTML=arr.map((q,i)=>{
   const P=D.players[q.p], w=(100*Math.abs(q.aggr)/mx).toFixed(1);
   const bar=`<span class="wlbar${align==='r'?' r':''}" style="width:${w}%;background:${colour}"></span>`;
   return `<tr class="prow" data-p="${q.p}" style="cursor:pointer"><td class="rk">${i+1}</td>`+
     `<td class="nm">${esc(P[0])}</td><td class="ct">${esc(P[1])}</td>`+
     (align==='r'?`<td class="br">${bar}</td><td class="vl" style="color:${colour}">${money(q.aggr)}</td>`
                 :`<td class="br">${bar}</td><td class="vl" style="color:${colour}">${money(q.aggr)}</td>`)+
     `</tr>`;
  }).join('');
 };
 list('wlWon',[...ahead].sort((a,b)=>a.aggr-b.aggr).slice(0,12),'#0F2A43','r');
 list('wlLost',[...behind].sort((a,b)=>b.aggr-a.aggr).slice(0,12),'#E67E22','l');
}


function buildSegTable(id,kind){
 const nM=D.months.length, M=SEGS.map(()=>new Array(nM).fill(0));
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p))continue;
   const si=SEGI[PSEG[p]], recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ M[si][recs[i][0]]+=recs[i][2]; } }
 const aggr=curData().aggr, grandA=sum(aggr), rt=a=>a.reduce((x,y)=>x+y,0);
 const fmt=(v,i)=> kind==='rate' ? rate(v, i<0?grandA:aggr[i]) : money(v);
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>rt(M[ci])!==0);
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=> msortCol<0?rt(M[ci]):M[ci][msortCol]);
 order.forEach(ci=>{ const arr=M[ci];
   const cells=arr.map((v,i)=>`<td class="k" data-key="SEG:${ci}" data-m="${i}">${fmt(v,i)}</td>`).join('')+
     `<td class="k tcol" data-key="SEG:${ci}" data-m="-1">${fmt(rt(arr),-1)}</td>`;
   h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>SEGS.reduce((s,_c,ci)=>s+M[ci][i],0)), grand=rt(colTot);
 h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+
    colTot.map((v,i)=>`<td>${fmt(v,i)}</td>`).join('')+`<td class="tcol">${fmt(grand,-1)}</td></tr>`;
 /* The denominator row is clickable too. It is every player in scope, not just
    the bonused ones, so it uses ALLP rather than a bonus-group key — the
    figure here includes players who never took a bonus and the list has to
    match it. */
 if(kind==='rate') h+=`<tr class="ref"><td>Adjusted GGR</td>`+aggr.map((v,i)=>`<td class="k" data-key="ALLP" data-m="${i}">${money(v)}</td>`).join('')+`<td class="k tcol" data-key="ALLP" data-m="-1">${money(grandA)}</td></tr>`;
 h+=`</tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildSegGGR(id){
 const nM=D.months.length;
 const SA=(V().segAggr&&V().segAggr[S])||{};
 const arr=lbl=>SA[lbl]||new Array(nM).fill(0);
 const rt=a=>a.reduce((x,y)=>x+y,0);
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>rt(arr(SEGS[ci]))!==0);
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=> msortCol<0?rt(arr(SEGS[ci])):arr(SEGS[ci])[msortCol]);
 /* SEGA, not SEG. The SEG drill-down lists players who received a bonus,
    which is right for a bonus cost cell and wrong for this one: Mass shows
    -$266,813 of adjusted GGR but its bonused players alone account for
    -$74,578, and One Timer has 2,797 players of whom 671 took a bonus. Reusing
    SEG here would open a list that does not add up to the number clicked. */
 order.forEach(ci=>{ const a=arr(SEGS[ci]);
   const cells=a.map((v,i)=>`<td class="k" data-key="SEGA:${ci}" data-m="${i}">${money(v)}</td>`).join('')+
     `<td class="k tcol" data-key="SEGA:${ci}" data-m="-1">${money(rt(a))}</td>`;
   h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>order.reduce((s,ci)=>s+arr(SEGS[ci])[i],0)), grand=rt(colTot);
 h+=`</tbody><tfoot><tr class="tot"><td>Total adjusted GGR</td>`+colTot.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(grand)}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
/* ---- deposits and cost share, by segment ---------------------------------
   Deposits are not pre-aggregated per segment the way adjusted GGR is, so they
   are summed here from the per-player monthly rows - the same source the
   segment player counts already use, so the two agree.

   kind: 'dep'      deposit amount per segment
         'depshare' that segment's share of the month's deposits (columns = 100%)
         'share'    that segment's share of the month's bonus cost (columns = 100%)
         'cdr'      bonus cost against that segment's own deposits
         'perplayer' average bonus cost per bonused player in that segment  */
function buildSegDep(id,kind){
 const el=document.getElementById(id); if(!el) return;
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const dep=SEGS.map(()=>new Array(nM).fill(0));
 const cost=SEGS.map(()=>new Array(nM).fill(0));
 const pm=V().pm;
 for(const pis in pm){ const p=+pis;
  if(S==='without'&&KAR.has(p)) continue;
  if(!segMatch(p)) continue;
  const si=SEGI[PSEG[p]]; if(si===undefined) continue;
  const q=pm[pis];
  for(const m in q) dep[si][+m]+=q[m][2];
 }
 /* Distinct players, not records: one player can take several bonuses in a
    month and must still count once, or the average per player is understated. */
 const seen=SEGS.map(()=>D.months.map(()=>new Set()));
 for(const pis in V().detail){ const p=+pis;
  if(S==='without'&&KAR.has(p)) continue;
  if(!segMatch(p)) continue;
  const si=SEGI[PSEG[p]]; if(si===undefined) continue;
  for(const r of V().detail[pis]){ cost[si][r[0]]+=r[2]; if(r[2]>0) seen[si][r[0]].add(p); }
 }
 const np=seen.map(row=>row.map(st=>st.size));
 const colDep=D.months.map((_,i)=>dep.reduce((a,r)=>a+r[i],0));
 const colCost=D.months.map((_,i)=>cost.reduce((a,r)=>a+r[i],0));
 const val=(si,i)=>kind==='dep'?dep[si][i]:kind==='share'?cost[si][i]:cost[si][i];
 const pct=(a,b)=>b>0?(100*a/b).toFixed(1)+'%':'<span class="z">&mdash;</span>';
 const cell=(si,i)=>{
  if(kind==='dep') return money(dep[si][i]);
  if(kind==='depshare') return pct(dep[si][i],colDep[i]);
  if(kind==='share') return pct(cost[si][i],colCost[i]);
  if(kind==='perplayer') return np[si][i]>0?money(cost[si][i]/np[si][i]):'<span class="z">&mdash;</span>';
  return pct(cost[si][i],dep[si][i]);
 };
 const tot=si=>{
  if(kind==='dep') return money(rt(dep[si]));
  if(kind==='depshare') return pct(rt(dep[si]),rt(colDep));
  if(kind==='share') return pct(rt(cost[si]),rt(colCost));
  if(kind==='perplayer'){
   /* Divide by the number of DISTINCT players over the period, not by the sum
      of the monthly counts - the same player active in six months would
      otherwise count six times and halve the figure. */
   const all=new Set(); seen[si].forEach(st=>st.forEach(p=>all.add(p)));
   return all.size>0?money(rt(cost[si])/all.size):'<span class="z">&mdash;</span>';
  }
  return pct(rt(cost[si]),rt(dep[si]));
 };
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>rt(dep[ci])!==0||rt(cost[ci])!==0);
 if(kind==='perplayer') order=order.filter(ci=>rt(np[ci])!==0);
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=> msortCol<0
   ? rt(kind==='dep'||kind==='depshare'?dep[ci]:cost[ci])
   : (kind==='dep'||kind==='depshare'?dep[ci][msortCol]:cost[ci][msortCol]));
 order.forEach(ci=>{
  h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>`+
     D.months.map((_,i)=>`<td>${cell(ci,i)}</td>`).join('')+
     `<td class="tcol">${tot(ci)}</td></tr>`;
 });
 if(kind==='dep'){
  h+=`</tbody><tfoot><tr class="tot"><td>Total deposits</td>`+colDep.map(v=>`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(rt(colDep))}</td></tr></tfoot>`;
 } else if(kind==='perplayer'){
  const colP=D.months.map((_,i)=>order.reduce((a,ci)=>a+np[ci][i],0));
  const allP=new Set(); order.forEach(ci=>seen[ci].forEach(st=>st.forEach(p=>allP.add(p))));
  h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+D.months.map((_,i)=>
      `<td>${colP[i]>0?money(colCost[i]/colP[i]):'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${allP.size>0?money(rt(colCost)/allP.size):'<span class="z">&mdash;</span>'}</td></tr>`+
     `<tr class="ref first"><td>Players who received a bonus</td>`+colP.map(v=>
      `<td>${v?v.toLocaleString('en-US'):'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${allP.size.toLocaleString('en-US')}</td></tr></tfoot>`;
 } else if(kind==='depshare'){
  h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+D.months.map((_,i)=>
      `<td>${colDep[i]>0?'100.0%':'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${rt(colDep)>0?'100.0%':'<span class="z">&mdash;</span>'}</td></tr>`+
     `<tr class="ref first"><td>Total deposits</td>`+colDep.map(v=>`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(rt(colDep))}</td></tr></tfoot>`;
 } else if(kind==='share'){
  /* Adds to 100% by construction, shown so a column that does not is visible. */
  h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+D.months.map((_,i)=>
      `<td>${colCost[i]>0?'100.0%':'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${rt(colCost)>0?'100.0%':'<span class="z">&mdash;</span>'}</td></tr>`+
     `<tr class="ref first"><td>Total bonus cost</td>`+colCost.map(v=>`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(rt(colCost))}</td></tr></tfoot>`;
 } else {
  h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+D.months.map((_,i)=>
      `<td>${colDep[i]>0?(100*colCost[i]/colDep[i]).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${rt(colDep)>0?(100*rt(colCost)/rt(colDep)).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td></tr>`+
     `<tr class="ref first"><td>Total deposits</td>`+colDep.map(v=>`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(rt(colDep))}</td></tr></tfoot>`;
 }
 el.innerHTML=h;
}
function buildProdRate(id){
 const PS=(D.prodSplit&&D.prodSplit[S])||{}, PG=(D.prodGGR&&D.prodGGR[S])||{};
 const PB=['Slot','Live Casino','Sport','Other'];
 const KEY={'Slot':'slot','Live Casino':'live_casino','Sport':'sport','Other':'other'};
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const num=b=>PS[KEY[b]]||new Array(nM).fill(0), den=b=>PG[b]||new Array(nM).fill(0);
 let h=hdr('Product')+'<tbody>';
 let order=PB.filter(b=>rt(num(b))!==0);
 if(msortCol!==null) order=order.slice().sort((a,b)=>{
   const da=msortCol<0?rt(den(a)):den(a)[msortCol], db=msortCol<0?rt(den(b)):den(b)[msortCol];
   const va=da>0?(msortCol<0?rt(num(a)):num(a)[msortCol])/da:-Infinity, vb=db>0?(msortCol<0?rt(num(b)):num(b)[msortCol])/db:-Infinity;
   return msortAsc?va-vb:vb-va;});
 order.forEach(b=>{ const n=num(b), d=den(b);
   const cells=n.map((v,i)=>`<td>${rate(v,d[i])}</td>`).join('')+`<td class="tcol">${rate(rt(n),rt(d))}</td>`;
   h+=`<tr class="g"><td>${b}</td>${cells}</tr>`; });
 const colN=D.months.map((_,i)=>order.reduce((s,b)=>s+num(b)[i],0));
 const colD=D.months.map((_,i)=>order.reduce((s,b)=>s+den(b)[i],0));
 h+=`</tbody><tfoot><tr class="tot"><td>All products</td>`+colN.map((v,i)=>`<td>${rate(v,colD[i])}</td>`).join('')+`<td class="tcol">${rate(rt(colN),rt(colD))}</td></tr>`;
 h+=`<tr class="ref first"><td>GGR (all products)</td>`+colD.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(rt(colD))}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildProdGGR(id){
 const PG=(V().prodGGR&&V().prodGGR[S])||{};
 const PB=['Slot','Live Casino','Sport','Other'];
 const rt=a=>a.reduce((x,y)=>x+y,0), av=b=>PG[b]||new Array(D.months.length).fill(0);
 let h=hdr('Product')+'<tbody>';
 let order=PB.filter(b=>rt(av(b))!==0);
 if(msortCol!==null) order=order.slice().sort((a,b)=>{const va=msortCol<0?rt(av(a)):av(a)[msortCol], vb=msortCol<0?rt(av(b)):av(b)[msortCol]; return msortAsc?va-vb:vb-va;});
 order.forEach(b=>{ const arr=av(b); const pk=PRODKEYS[['Slot','Live Casino','Sport','Other'].indexOf(b)];
   const dk=`PROD:${PRODKEYS.indexOf(pk)}`;
   const cells=arr.map((v,i)=>`<td class="k" data-key="${dk}" data-m="${i}">${money(v)}</td>`).join('')+
     `<td class="k tcol" data-key="${dk}" data-m="-1">${money(rt(arr))}</td>`;
   h+=`<tr class="g"><td>${b}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>order.reduce((s,b)=>s+av(b)[i],0)), grand=rt(colTot);
 h+=`</tbody><tfoot><tr class="tot"><td>Total GGR</td>`+colTot.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(grand)}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildProdSplit(id){
 const PS=(V().prodSplit&&V().prodSplit[S])||(D.prodSplit&&D.prodSplit[S])||{};
 const PR=D.prodSplitProds||[], PLBL={slot:'Slot',live_casino:'Live Casino',sport:'Sport',other:'Other'};
 const rt=a=>a.reduce((x,y)=>x+y,0), av=p=>PS[p]||new Array(D.months.length).fill(0);
 let h=hdr('Product')+'<tbody>';
 let order=PR.filter(p=>rt(av(p))!==0);
 if(msortCol===null) order.sort((a,b)=>rt(av(b))-rt(av(a)));
 else order=order.slice().sort((a,b)=>{const va=msortCol<0?rt(av(a)):av(a)[msortCol], vb=msortCol<0?rt(av(b)):av(b)[msortCol]; return msortAsc?va-vb:vb-va;});
 order.forEach(p=>{ const arr=av(p); const dk=`PROD:${PRODKEYS.indexOf(p)}`;
   const cells=arr.map((v,i)=>`<td class="k" data-key="${dk}" data-m="${i}">${money(v)}</td>`).join('')+
     `<td class="k tcol" data-key="${dk}" data-m="-1">${money(rt(arr))}</td>`;
   h+=`<tr class="g"><td>${PLBL[p]||p}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>order.reduce((s,p)=>s+av(p)[i],0)), grand=rt(colTot);
 h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+colTot.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(grand)}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
/* ---- deposit x result matrix ------------------------------------------
   kind: 'players' | 'cost' */
const MXROWS=[
 ['depPos','Deposited &middot; positive adj GGR'],
 ['depNeg','Deposited &middot; negative adj GGR'],
 ['noDepPos','No deposit &middot; positive adj GGR'],
 ['noDepNeg','No deposit &middot; negative adj GGR'],
 ['depFlat','Deposited &middot; no GGR'],
 ['noDepFlat','No deposit &middot; no GGR'],
];
function buildMatrix(id,kind){
 const el=document.getElementById(id); if(!el) return;
 const M=D.matrix&&D.matrix[S];
 if(!M){ el.innerHTML='<tbody><tr><td class="dim">Not in this build \u2014 rerun 3-build-everything.bat.</td></tr></tbody>'; return; }
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const cnt=v=>v?Math.round(v).toLocaleString('en-US'):'<span class="z">&mdash;</span>';
 const sum=f=>D.months.map((_,i)=>MXROWS.reduce((a,[k])=>a+((M[k]&&M[k][f][i])||0),0));

 let h=hdr(kind==='players'?'Group':'Group')+'<tbody>';
 for(const [k,label] of MXROWS){
  const c=M[k]; if(!c) continue;
  /* Rows that never happen are noise, so drop them. */
  if(rt(c.players)===0) continue;
  if(kind==='players'){
   h+=`<tr class="g"><td>${label}</td>`+c.players.map(v=>`<td>${cnt(v)}</td>`).join('')+
      `<td class="tcol">${cnt(rt(c.players))}</td></tr>`;
   h+=`<tr class="s"><td>of which bonused</td>`+c.bonused.map(v=>`<td>${cnt(v)}</td>`).join('')+
      `<td class="tcol">${cnt(rt(c.bonused))}</td></tr>`;
  } else {
   h+=`<tr class="g"><td>${label}</td>`+c.cost.map(v=>`<td>${money(v)}</td>`).join('')+
      `<td class="tcol">${money(rt(c.cost))}</td></tr>`;
   h+=`<tr class="s"><td>per bonused player</td>`+c.cost.map((v,i)=>
      `<td>${c.bonused[i]>0?money(v/c.bonused[i]):'<span class="z">&mdash;</span>'}</td>`).join('')+
      `<td class="tcol">${rt(c.bonused)>0?money(rt(c.cost)/rt(c.bonused)):'<span class="z">&mdash;</span>'}</td></tr>`;
  }
 }
 const tp=sum('players'), tb=sum('bonused'), tc=sum('cost');
 if(kind==='players'){
  h+=`</tbody><tfoot><tr class="tot"><td>All active players</td>`+tp.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(rt(tp))}</td></tr>`+
     `<tr class="ref"><td>of which bonused</td>`+tb.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(rt(tb))}</td></tr></tfoot>`;
 } else {
  h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+tc.map(v=>`<td>${money(v)}</td>`).join('')+
     `<td class="tcol">${money(rt(tc))}</td></tr></tfoot>`;
 }
 el.innerHTML=h;
}
/* ---- FTD cohort tables -------------------------------------------------
   kind: 'count' | 'cost' | 'aggr' | 'rate'  */
function buildFtd(id,kind){
 const el=document.getElementById(id); if(!el) return;
 const F=D.ftdCohort;
 if(!F||!F.types||!F.types.length){ el.innerHTML='<tbody><tr><td class="dim">No FTD data in this build — rerun 3-build-everything.bat.</td></tr></tbody>'; return; }
 const B=F[S]||F.with;
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const cnt=v=>v?Math.round(v).toLocaleString('en-US'):'<span class="z">&mdash;</span>';
 const drill=!!(D.ftdCohortIdx&&D.ftdCohortIdx.length);
 let h=hdr('FTD type')+'<tbody>';
 let types=F.types.filter(t=>rt(B.count[t]||[])!==0);
 if(msortCol!==null){
   const val=(t,i)=>{
     if(kind==='rate'){const c=i<0?rt(B.cost[t]):B.cost[t][i], g=i<0?rt(B.aggr[t]):B.aggr[t][i]; return g>0?c/g:-Infinity;}
     const a=kind==='count'?B.count[t]:kind==='cost'?B.cost[t]:B.aggr[t];
     return i<0?rt(a):a[i];};
   types=types.slice().sort((a,b)=>msortAsc?val(a,msortCol)-val(b,msortCol):val(b,msortCol)-val(a,msortCol));
 }
 types.forEach(t=>{
   const C=B.count[t]||new Array(nM).fill(0), K=B.cost[t]||new Array(nM).fill(0), G=B.aggr[t]||new Array(nM).fill(0);
   const cell=i=>kind==='count'?cnt(C[i]):kind==='cost'?money(K[i]):kind==='aggr'?money(G[i]):rate(K[i],G[i]);
   const tot=kind==='count'?cnt(rt(C)):kind==='cost'?money(rt(K)):kind==='aggr'?money(rt(G)):rate(rt(K),rt(G));
   /* Clickable only once the build carries the per-player cohort index. */
   const ti=F.types.indexOf(t), kk=drill?` class="k" data-key="FTD:${ti}"`:'';
   h+=`<tr class="g"><td>${esc(t)}</td>`+
      D.months.map((_,i)=>`<td${kk}${drill?` data-m="${i}"`:''}>${cell(i)}</td>`).join('')+
      `<td${drill?` class="k tcol" data-key="FTD:${ti}" data-m="-1"`:' class="tcol"'}>${tot}</td></tr>`;
   /* How many of the arrivals actually took a bonus that month. Without it the
      count and the cost tables sit next to each other with no way to tell
      whether a big cost came from many players or a few. */
   if(kind==='count'&&B.bonused){
    const N=B.bonused[t]||new Array(nM).fill(0);
    h+=`<tr class="s"><td>of which received a bonus</td>`+
       D.months.map((_,i)=>`<td>${cnt(N[i])}</td>`).join('')+
       `<td class="tcol">${cnt(rt(N))}</td></tr>`;
    h+=`<tr class="s"><td>share of the cohort</td>`+
       D.months.map((_,i)=>`<td>${C[i]>0?(100*N[i]/C[i]).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td>`).join('')+
       `<td class="tcol">${rt(C)>0?(100*rt(N)/rt(C)).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td></tr>`;
   }});
 const sum=f=>D.months.map((_,i)=>types.reduce((a,t)=>a+((B[f][t]||[])[i]||0),0));
 const tc=sum('count'), tk=sum('cost'), tg=sum('aggr');
 const footCell=i=>kind==='count'?cnt(tc[i]):kind==='cost'?money(tk[i]):kind==='aggr'?money(tg[i]):rate(tk[i],tg[i]);
 const footTot=kind==='count'?cnt(rt(tc)):kind==='cost'?money(rt(tk)):kind==='aggr'?money(rt(tg)):rate(rt(tk),rt(tg));
 h+=`</tbody><tfoot><tr class="tot"><td>${kind==='count'?'Total FTDs':kind==='cost'?'Total bonus cost':kind==='aggr'?'Total adjusted GGR':'All FTDs'}</td>`+
    D.months.map((_,i)=>`<td>${footCell(i)}</td>`).join('')+`<td class="tcol">${footTot}</td></tr>`;
 if(kind==='count'&&B.bonused){
  const tn=D.months.map((_,i)=>types.reduce((a,t)=>a+((B.bonused[t]||[])[i]||0),0));
  h+=`<tr class="ref first"><td>of which received a bonus</td>`+tn.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(rt(tn))}</td></tr>`+
     `<tr class="ref"><td>share of all FTDs</td>`+D.months.map((_,i)=>
       `<td>${tc[i]>0?(100*tn[i]/tc[i]).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${rt(tc)>0?(100*rt(tn)/rt(tc)).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td></tr>`;
  /* Running totals since January. A player belongs to exactly one cohort month,
     so these are distinct people and a plain running sum is safe - nobody is
     counted twice on the way across. */
  const run=a=>{let s=0;return a.map(v=>s+=v);};
  const cc=run(tc), cb=run(tn);
  h+=`<tr class="tot"><td>Cumulative FTDs since Jan</td>`+cc.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(cc[cc.length-1])}</td></tr>`+
     `<tr class="ref"><td>of which received a bonus</td>`+cb.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(cb[cb.length-1])}</td></tr>`+
     `<tr class="ref"><td>share, cumulative</td>`+cc.map((v,i)=>
       `<td>${v>0?(100*cb[i]/v).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td>`).join('')+
     `<td class="tcol">${cc[cc.length-1]>0?(100*cb[cb.length-1]/cc[cc.length-1]).toFixed(1)+'%':'<span class="z">&mdash;</span>'}</td></tr>`;
 }
 h+=`</tfoot>`;
 el.innerHTML=h;
}
/* ---- FTD cohorts, lifetime to date --------------------------------------
   Same shape as the tables above, but each column is the month a cohort
   ARRIVED and the figure covers every month since. So the January column is
   what the January intake has cost and produced across the whole period.

   kind: 'cost' | 'bonused' | 'aggr' | 'rate' | 'dep'   */
/* ---- cohort retention -----------------------------------------------------
   Rows are arrival months, columns are calendar months. Each cohort shows how
   many of it were active that month, what share of the intake that is, and
   what it cost in bonuses that month.

   Months before a cohort's first deposit are shown greyed rather than blank:
   some of these players were registered, betting and taking bonuses before
   they deposited, and blanking those cells would drop real cost. */
function buildFtdRet(id){
 const el=document.getElementById(id); if(!el) return;
 const R=D.ftdRetention&&(D.ftdRetention[S]||D.ftdRetention.with);
 if(!R){ el.innerHTML='<tbody><tr><td class="dim">Not in this build \u2014 rerun 3-build-everything.bat.</td></tr></tbody>'; return; }
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const cnt=v=>v?Math.round(v).toLocaleString('en-US'):'<span class="z">&mdash;</span>';
 /* before the cohort's own month: real, but not retention - shown quietly */
 const pre=v=>`<td class="z">${v}</td>`;

 let h=hdr('FTD cohort')+'<tbody>';
 D.months.forEach((ym,c)=>{
  const size=R.size[c]; if(!size) return;
  const act=R.active[c]||[], bon=R.bonused[c]||[], cost=R.cost[c]||[];
  const cell=(i,fn)=>i<c?pre(fn(i)):`<td>${fn(i)}</td>`;
  h+=`<tr class="g"><td>${esc(D.labels[c])} &middot; ${cnt(size)} FTDs</td>`+
     D.months.map((_,i)=>cell(i,j=>cnt(act[j]))).join('')+
     `<td class="tcol">${cnt(size)}</td></tr>`;
  h+=`<tr class="s"><td>still active</td>`+
     D.months.map((_,i)=>cell(i,j=>size>0?(100*act[j]/size).toFixed(0)+'%':'&mdash;')).join('')+
     `<td class="tcol">&mdash;</td></tr>`;
  h+=`<tr class="s"><td>bonus cost</td>`+
     D.months.map((_,i)=>cell(i,j=>money(cost[j]))).join('')+
     `<td class="tcol">${money(rt(cost))}</td></tr>`;
 });

 /* Column totals: everyone active in that calendar month who first deposited
    this year, and what the whole 2026 intake cost in that month. */
 const colAct=D.months.map((_,i)=>D.months.reduce((a,_,c)=>a+((R.active[c]||[])[i]||0),0));
 const colCost=D.months.map((_,i)=>D.months.reduce((a,_,c)=>a+((R.cost[c]||[])[i]||0),0));
 h+=`</tbody><tfoot><tr class="tot"><td>All 2026 FTDs active</td>`+
    colAct.map(v=>`<td>${cnt(v)}</td>`).join('')+`<td class="tcol">${cnt(rt(R.size))}</td></tr>`+
    `<tr class="ref first"><td>their bonus cost</td>`+colCost.map(v=>`<td>${money(v)}</td>`).join('')+
    `<td class="tcol">${money(rt(colCost))}</td></tr></tfoot>`;
 el.innerHTML=h;
}
function buildFtdLife(id,kind){
 const el=document.getElementById(id); if(!el) return;
 const F=D.ftdCohort;
 if(!F||!F.types||!F.types.length||!(F[S]||F.with).lcost){
   el.innerHTML='<tbody><tr><td class="dim">Not in this build \u2014 rerun 3-build-everything.bat.</td></tr></tbody>'; return; }
 const B=F[S]||F.with;
 const nM=D.months.length, rt=a=>a.reduce((x,y)=>x+y,0);
 const cnt=v=>v?Math.round(v).toLocaleString('en-US'):'<span class="z">&mdash;</span>';
 const arr=(f,t)=>B[f][t]||new Array(nM).fill(0);
 const pct=(a,b)=>b>0?(100*a/b).toFixed(1)+'%':'<span class="z">&mdash;</span>';

 let types=F.types.filter(t=>rt(arr('count',t))!==0);
 if(msortCol!==null){
   const val=(t,i)=>{
     const g=(f)=>i<0?rt(arr(f,t)):arr(f,t)[i];
     if(kind==='rate'){const a=g('laggr'); return a>0?g('lcost')/a:-Infinity;}
     if(kind==='bonused'){const c=g('count'); return c>0?g('lbonused')/c:-Infinity;}
     return g(kind==='cost'?'lcost':kind==='dep'?'ldep':'laggr');};
   types=types.slice().sort((a,b)=>msortAsc?val(a,msortCol)-val(b,msortCol):val(b,msortCol)-val(a,msortCol));
 }

 const drill=!!(D.ftdCohortIdx&&D.ftdCohortIdx.length);
 let h=hdr('FTD type')+'<tbody>';
 types.forEach(t=>{
  const C=arr('count',t), K=arr('lcost',t), G=arr('laggr',t), P=arr('ldep',t), N=arr('lbonused',t);
  const cell=i=>kind==='cost'?money(K[i]):kind==='aggr'?money(G[i]):kind==='dep'?money(P[i])
    :kind==='bonused'?cnt(N[i]):rate(K[i],G[i]);
  const tot=kind==='cost'?money(rt(K)):kind==='aggr'?money(rt(G)):kind==='dep'?money(rt(P))
    :kind==='bonused'?cnt(rt(N)):rate(rt(K),rt(G));
  const ti=F.types.indexOf(t), kk=drill?` class="k" data-key="FTDL:${ti}"`:'';
  h+=`<tr class="g"><td>${esc(t)}</td>`+
     D.months.map((_,i)=>`<td${kk}${drill?` data-m="${i}"`:''}>${cell(i)}</td>`).join('')+
     `<td${drill?` class="k tcol" data-key="FTDL:${ti}" data-m="-1"`:' class="tcol"'}>${tot}</td></tr>`;
  if(kind==='bonused')
   h+=`<tr class="s"><td>share of the cohort</td>`+D.months.map((_,i)=>`<td>${pct(N[i],C[i])}</td>`).join('')+
      `<td class="tcol">${pct(rt(N),rt(C))}</td></tr>`;
  if(kind==='cost')
   h+=`<tr class="s"><td>per player in the cohort</td>`+D.months.map((_,i)=>`<td>${C[i]>0?money(K[i]/C[i]):'<span class="z">&mdash;</span>'}</td>`).join('')+
      `<td class="tcol">${rt(C)>0?money(rt(K)/rt(C)):'<span class="z">&mdash;</span>'}</td></tr>`;
 });

 const sum=f=>D.months.map((_,i)=>types.reduce((a,t)=>a+(arr(f,t)[i]||0),0));
 const tc=sum('count'), tk=sum('lcost'), tg=sum('laggr'), tp=sum('ldep'), tn=sum('lbonused');
 const fc=i=>kind==='cost'?money(tk[i]):kind==='aggr'?money(tg[i]):kind==='dep'?money(tp[i])
   :kind==='bonused'?cnt(tn[i]):rate(tk[i],tg[i]);
 const ft=kind==='cost'?money(rt(tk)):kind==='aggr'?money(rt(tg)):kind==='dep'?money(rt(tp))
   :kind==='bonused'?cnt(rt(tn)):rate(rt(tk),rt(tg));
 const label=kind==='cost'?'Total bonus cost to date':kind==='aggr'?'Total adjusted GGR to date'
   :kind==='dep'?'Total deposits to date':kind==='bonused'?'Received a bonus':'All cohorts';
 h+=`</tbody><tfoot><tr class="tot"><td>${label}</td>`+D.months.map((_,i)=>`<td>${fc(i)}</td>`).join('')+
    `<td class="tcol">${ft}</td></tr>`;
 if(kind==='bonused')
  h+=`<tr class="ref first"><td>of a cohort of</td>`+tc.map(v=>`<td>${cnt(v)}</td>`).join('')+
     `<td class="tcol">${cnt(rt(tc))}</td></tr>`+
     `<tr class="ref"><td>share of the cohort</td>`+D.months.map((_,i)=>`<td>${pct(tn[i],tc[i])}</td>`).join('')+
     `<td class="tcol">${pct(rt(tn),rt(tc))}</td></tr>`;
 h+=`</tfoot>`;
 el.innerHTML=h;
}
function buildSegCount(id){
 const nM=D.months.length;
 const Msets=SEGS.map(()=>Array.from({length:nM},()=>new Set()));
 const Utot=SEGS.map(()=>new Set());
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p))continue;
   const si=SEGI[PSEG[p]], recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ Msets[si][recs[i][0]].add(p); Utot[si].add(p); } }
 const cnt=(v)=>v===0?'<span class="z">&mdash;</span>':v.toLocaleString('en-US');
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>Utot[ci].size!==0);
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=> msortCol<0?Utot[ci].size:Msets[ci][msortCol].size);
 order.forEach(ci=>{
   const cells=Msets[ci].map((s,i)=>`<td class="k" data-key="SEG:${ci}" data-m="${i}">${cnt(s.size)}</td>`).join('')+
     `<td class="k tcol" data-key="SEG:${ci}" data-m="-1">${cnt(Utot[ci].size)}</td>`;
   h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>${cells}</tr>`; });
 const colTot=D.months.map((_,i)=>{const u=new Set(); order.forEach(ci=>Msets[ci][i].forEach(p=>u.add(p))); return u.size;});
 const grand=new Set(); order.forEach(ci=>Utot[ci].forEach(p=>grand.add(p)));
 h+=`</tbody><tfoot><tr class="tot"><td>Distinct players (any segment)</td>`+
    colTot.map(v=>`<td>${cnt(v)}</td>`).join('')+`<td class="tcol">${cnt(grand.size)}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildSegShareTotal(id){
 const nM=D.months.length, M=SEGS.map(()=>new Array(nM).fill(0));
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p))continue;
   const si=SEGI[PSEG[p]], recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ M[si][recs[i][0]]+=recs[i][2]; } }
 const den=V().data[S].aggr, grandDen=sum(den), rt=a=>a.reduce((x,y)=>x+y,0);
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>rt(M[ci])!==0);
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=> msortCol<0?(grandDen>0?rt(M[ci])/grandDen:-Infinity):(den[msortCol]>0?M[ci][msortCol]/den[msortCol]:-Infinity));
 order.forEach(ci=>{ const arr=M[ci];
   const cells=arr.map((v,i)=>`<td class="k" data-key="SEG:${ci}" data-m="${i}">${rate(v,den[i])}</td>`).join('')+
     `<td class="k tcol" data-key="SEG:${ci}" data-m="-1">${rate(rt(arr),grandDen)}</td>`;
   h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>${cells}</tr>`; });
 const colCost=D.months.map((_,i)=>order.reduce((s,ci)=>s+M[ci][i],0));
 h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+
    colCost.map((v,i)=>`<td>${rate(v,den[i])}</td>`).join('')+`<td class="tcol">${rate(rt(colCost),grandDen)}</td></tr>`;
 h+=`<tr class="ref first"><td>Total adjusted GGR</td>`+den.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(grandDen)}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildSegRateTable(id,denField,refLabel){
 const nM=D.months.length, M=SEGS.map(()=>new Array(nM).fill(0));
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p))continue;
   const si=SEGI[PSEG[p]], recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ M[si][recs[i][0]]+=recs[i][2]; } }
 const SA=(V()[denField]&&V()[denField][S])||{};
 const den=lbl=>SA[lbl]||new Array(nM).fill(0);
 const rt=a=>a.reduce((x,y)=>x+y,0);
 let h=hdr('Segment')+'<tbody>';
 let order=SEGS.map((c,ci)=>ci).filter(ci=>rt(M[ci])!==0);
 const totRate=ci=>{const d=rt(den(SEGS[ci])); return d>0?rt(M[ci])/d:-Infinity;};
 if(msortCol===null) order.sort((a,b)=>segRank(SEGS[a])-segRank(SEGS[b]));
 else order=sortIdx(order, ci=>{const dd=den(SEGS[ci]); if(msortCol<0){const d=rt(dd);return d>0?rt(M[ci])/d:-Infinity;} const d=dd[msortCol]; return d>0?M[ci][msortCol]/d:-Infinity;});
 order.forEach(ci=>{ const arr=M[ci], dn=den(SEGS[ci]);
   const cells=arr.map((v,i)=>`<td class="k" data-key="SEG:${ci}" data-m="${i}">${rate(v,dn[i])}</td>`).join('')+
     `<td class="k tcol" data-key="SEG:${ci}" data-m="-1">${rate(rt(arr),rt(dn))}</td>`;
   h+=`<tr class="g"><td>${esc(SEGS[ci])}</td>${cells}</tr>`; });
 const colCost=D.months.map((_,i)=>order.reduce((s,ci)=>s+M[ci][i],0));
 const colDen=D.months.map((_,i)=>order.reduce((s,ci)=>s+den(SEGS[ci])[i],0));
 h+=`</tbody><tfoot><tr class="tot"><td>All segments</td>`+
    colCost.map((v,i)=>`<td>${rate(v,colDen[i])}</td>`).join('')+`<td class="tcol">${rate(rt(colCost),rt(colDen))}</td></tr>`;
 h+=`<tr class="ref first"><td>${refLabel}</td>`+
    colDen.map((v,i)=>`<td class="k" data-key="ALLP" data-m="${i}">${money(v)}</td>`).join('')+
    `<td class="k tcol" data-key="ALLP" data-m="-1">${money(rt(colDen))}</td></tr></tfoot>`;
 document.getElementById(id).innerHTML=h;
}
function buildTable(id,kind){
 const aggr=curData().aggr, grandA=sum(aggr), bet=curData().bet||[], grandBet=sum(bet);
 let h=hdr('Bonus group')+'<tbody>';
 const sv=(key)=>{ if(kind==='count') return countCell(key,msortCol);
   const c=costVal(key,msortCol);
   if(kind==='rate'){const a=msortCol<0?grandA:aggr[msortCol]; return a>0?c/a:-Infinity;}
   return c; };
 const fmtCell=(key,mi)=>{
   if(kind==='count'){const n=countCell(key,mi);return n===0?'<span class="z">&mdash;</span>':n.toLocaleString('en-US');}
   const c=costVal(key,mi);
   if(kind==='rate') return rate(c, mi<0?grandA:aggr[mi]);
   if(kind==='betrate') return rate2(c, mi<0?grandBet:bet[mi]);
   return money(c);
 };
 const cells=(key)=>D.labels.map((_,i)=>
    `<td class="k" data-key="${esc(key)}" data-m="${i}">${fmtCell(key,i)}</td>`).join('')+
    `<td class="k tcol" data-key="${esc(key)}" data-m="-1">${fmtCell(key,-1)}</td>`;
 let grows=D.rows.filter(r=>costVal(r.group,-1)!==0);
 grows=sortIdx(grows.map((r,i)=>i), i=>sv(grows[i].group)).map(i=>grows[i]);
 grows.forEach(r=>{
  const open=!collapsed.has(r.group);
  const tg=`<span class="tg" data-grp="${esc(r.group)}" role="button" title="${open?'Collapse':'Expand'}">${open?'&minus;':'+'}</span>`;
  h+=`<tr class="g"><td>${tg}${esc(r.group)}</td>`+cells(r.group)+`</tr>`;
  if(open){ let subs=r.subs.filter(sname=>costVal(r.group+'|'+sname,-1)!==0);
   subs=sortIdx(subs.map((s,i)=>i), i=>sv(r.group+'|'+subs[i])).map(i=>subs[i]);
   subs.forEach(sname=>{
    const fl=flowsUnder(r.group,sname), sk=r.group+'|'+sname;
    /* First render seeds the collapsed set, so flows start hidden. */
    if(subSeeding&&fl.length&&!seenSub.has(sk)){ seenSub.add(sk); collapsedSub.add(sk); }
    const sOpen=fl.length&&!collapsedSub.has(sk);
    const stg=fl.length
      ? `<span class="tg sub" data-sub="${esc(sk)}" role="button" title="${sOpen?'Hide':'Show'} flows">${sOpen?'&minus;':'+'}</span>`
      : '';
    h+=`<tr class="s"><td>${stg}${esc(sname)}</td>`+cells(sk)+`</tr>`;
    /* Third level: which flow inside this subgroup the money went to. */
    if(sOpen) fl.forEach(f=>{
     h+=`<tr class="f"><td>${esc(f.name)}</td>`+cells(r.group+'|'+f.key)+`</tr>`; }); }); }
 });
 if(kind==='count'){
  h+=`</tbody><tfoot><tr class="tot"><td>Distinct players (any bonus)</td>`+cells('__ALL__')+`</tr></tfoot>`;
 }else{
  h+=`</tbody><tfoot><tr class="tot"><td>Total bonus cost</td>`+cells('__ALL__')+`</tr>`;
  const refL=kind==='betrate'?'Bet amount':'Adjusted GGR', refV=kind==='betrate'?bet:aggr, refG=kind==='betrate'?grandBet:grandA;
  /* The denominator row is clickable, like the cells above it. It counts every
     player in scope rather than only the bonused ones, so it opens ALLP — a
     bonus-group key here would list a subset and disagree with the figure. */
  h+=`<tr class="ref first"><td>${refL}</td>`+
     refV.map((v,i)=>`<td class="k" data-key="ALLP" data-m="${i}">${money(v)}</td>`).join('')+
     `<td class="k tcol" data-key="ALLP" data-m="-1">${money(refG)}</td></tr>`;
  if(S==='with'&&seg==='ALL'&&kind!=='betrate'){
   h+=`<tr class="ref"><td>of which karolik777 &mdash; bonus cost</td>`+V().kar.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(sum(V().kar))}</td></tr>`;
   h+=`<tr class="ref"><td>of which karolik777 &mdash; adjusted GGR</td>`+V().karAggr.map(v=>`<td>${money(v)}</td>`).join('')+`<td class="tcol">${money(sum(V().karAggr))}</td></tr>`;
  }
  h+=`</tfoot>`;
 }
 document.getElementById(id).innerHTML=h;
}

/* ---------- drill-down ---------- */
/* Is this drill-down context an FTD cohort, and is it the lifetime cut? */
function ctxFtd(key){
 if(typeof key!=='string') return null;
 if(key.slice(0,5)==='FTDL:') return {ti:+key.slice(5),life:true};
 if(key.slice(0,4)==='FTD:')  return {ti:+key.slice(4),life:false};
 return null;
}
/* Which players the context admits, separately from which bonuses it admits.
   A bonus group restricts the bonuses; a segment or an FTD cohort restricts the
   players. Without this an FTD cell lists every player in the report, because
   every bonus legitimately matches an FTD key. */
function segCtxMatch(p){
 if(!ddCtx||typeof ddCtx.key!=='string') return true;
 const f=ctxFtd(ddCtx.key);
 if(f){
  const CI=D.ftdCohortIdx||[], TI=D.ftdTypeIdx||[];
  const cm=CI[p];
  if(cm===undefined||cm<0||TI[p]!==f.ti) return false;
  return ddCtx.mi<0||cm===ddCtx.mi;
 }
 if(ddCtx.key.slice(0,4)!=='SEG:') return true;
 return PSEG[p]===SEGS[+ddCtx.key.slice(4)]; }
/* Which of a player's monthly records count. For a cohort the column is the
   month they ARRIVED, not the month the cost landed, so the two must not be
   compared directly: the first-month cut keeps that player's own FTD month,
   the lifetime cut keeps every month. */
function ctxMonthOK(p,mm,key,mi){
 const f=ctxFtd(key);
 if(f) return f.life || mm===(D.ftdCohortIdx||[])[p];
 return mi<0||mm===mi; }
/* ---------- who a cell is about ----------
 *
 * Every cell lists the whole population behind it, not only the players who
 * received a bonus. Those are very different groups: 7,727 players took a
 * bonus this year out of 137,991 who did anything at all, and reading a
 * segment's GGR off a list of only the bonused ones understated Mass by 3.6x.
 *
 * So the shape of every branch below is the same:
 *
 *   population(mi, keep)   everyone active in the month(s), cost 0
 *   + the cost this cell attributes to them
 *
 * A player with cost but somehow no activity row still gets added, so the
 * column always adds up to the cell that was clicked.
 */
function population(mi,keep){
 const out=new Map(), pm=V().pm;
 for(const pis in pm){ const p=+pis;
   if(S==='without'&&KAR.has(p))continue;
   if(!segMatch(p))continue;
   if(keep&&!keep(p))continue;
   const rows=pm[pis];
   let ggr=0,aggr=0,dep=0,seen=false;
   for(const m in rows){ if(mi>=0&&+m!==mi)continue; const q=rows[m];
     ggr+=q[0]; aggr+=q[1]; dep+=q[2]; seen=true; }
   if(!seen)continue;
   out.set(p,{p,cost:0,ggr,aggr,dep});
 }
 return out;
}

/* Merge per-player cost into the population and return the rows.
 *
 * `keep` has to be the SAME filter the population was built with. A player
 * carrying cost but no activity row still belongs in the list, or the column
 * stops adding up to the cell — but only if they are in this cell's population
 * to begin with. Without that check every user-type column showed the whole
 * group's cost, because the cost map is not itself filtered by user type. */
function withCost(pop,costs,keep){
 costs.forEach((c,p)=>{ const e=pop.get(p);
   if(e){ e.cost+=c; return; }
   if(keep&&!keep(p)) return;
   if(S==='without'&&KAR.has(p)) return;
   if(!segMatch(p)) return;
   pop.set(p,{p,cost:c,ggr:0,aggr:0,dep:0}); });
 return [...pop.values()];
}

/* The one shape every cell uses: its population, plus the cost it attributes. */
function cellRows(mi,keep,pick){
 return withCost(population(mi,keep),costsFrom(mi,pick,keep),keep);
}

/* Per-player cost from the detail records, for whichever cell was clicked.
   `pick` decides whether one record counts and what it contributes. */
function costsFrom(mi,pick,keep){
 const costs=new Map();
 const det=V().detail;
 for(const pis in det){ const p=+pis;
   if(S==='without'&&KAR.has(p))continue;
   if(!segMatch(p))continue;
   if(keep&&!keep(p))continue;
   const recs=det[pis]; let c=0;
   for(let i=0;i<recs.length;i++){ const r=recs[i];
     if(mi>=0&&r[0]!==mi)continue;
     const v=pick(r); if(v) c+=v; }
   if(c) costs.set(p,c);
 }
 return costs;
}

function rowsFor(key,mi){
 /* SEGA: the GGR-by-segment cells. */
 if(key.slice(0,5)==='SEGA:'){ const si=+key.slice(5);
   return cellRows(mi,p=>PSEG[p]===SEGS[si],r=>r[2]); }
 /* UT: one cell of the bonus-group-by-user-type table. */
 if(key.slice(0,3)==='UT:'){ const cut=key.indexOf('|');
   const ui=+key.slice(3,cut<0?undefined:cut), grp=cut<0?null:key.slice(cut+1);
   const PUT=D.putype||[]; if(!PUT.length) return [];
   return cellRows(mi,p=>PUT[p]===ui,
     r=>(!grp||(D.bids[r[1]]&&D.bids[r[1]][1]===grp))?r[2]:0); }
 if(key.slice(0,4)==='SEG:'){ const si=+key.slice(4);
   return cellRows(mi,p=>PSEG[p]===SEGS[si],r=>r[2]); }
/* FTD cohort cells. The column is the month the cohort ARRIVED, not the month
    the cost landed, so mi is matched against the player's cohort rather than
    against the record's month.
      FTD:<t>   cost in that same first month, as the tables above show
      FTDL:<t>  cost across every month since, as the lifetime tables show
    The whole cohort is listed, including players who never took a bonus, so
    the player-count tables drill into something meaningful. */
 if(key.slice(0,4)==='FTD:'||key.slice(0,5)==='FTDL:'){
   const life=key.slice(0,5)==='FTDL:';
   const ti=+key.slice(life?5:4);
   const CI=D.ftdCohortIdx||[], TI=D.ftdTypeIdx||[];
   if(!CI.length) return [];
   const out=[];
   for(let p=0;p<CI.length;p++){
     const cm=CI[p];
     if(cm<0||TI[p]!==ti) continue;
     if(mi>=0&&cm!==mi) continue;
     if(S==='without'&&KAR.has(p)) continue;
     if(!segMatch(p)) continue;
     /* These tables are whole-period, so read D rather than the MTD view. */
     let c=0; const recs=D.detail[p];
     if(recs) for(let i=0;i<recs.length;i++){ if(life||recs[i][0]===cm) c+=recs[i][2]; }
     const e={p,cost:c,ggr:0,aggr:0,dep:0};
     const pm=D.pm[p]||{};
     if(life){ for(const m in pm){ e.ggr+=pm[m][0]; e.aggr+=pm[m][1]; e.dep+=pm[m][2]; } }
     else { const q=pm[cm]; if(q){ e.ggr=q[0]; e.aggr=q[1]; e.dep=q[2]; } }
     out.push(e);
   }
   return out; }
 /* WL: one band of the win/loss table. The band is decided by the player's
    adjusted GGR across the WHOLE period, so it ignores mi — a player is
    "ahead" or not on the period the table covers, not month by month. */
 if(key.slice(0,3)==='WL:'){ const bi=+key.slice(3);
   if(!WL_BANDS[bi]) return [];
   /* Scoped to the same month the section covers, not the whole range. */
   return cellRows(wlMonth(),p=>wlBandOf(p)===bi,r=>r[2]); }
 /* ALLP: every player in scope for the month. Used by the "Adjusted GGR"
    denominator rows, which count everyone rather than only the bonused. */
 if(key==='ALLP') return cellRows(mi,null,r=>r[2]);
 /* UTA: the same, narrowed to one user type. */
 if(key.slice(0,4)==='UTA:'){ const ui=+key.slice(4);
   const PUT=D.putype||[]; if(!PUT.length) return [];
   return cellRows(-1,p=>PUT[p]===ui,r=>r[2]); }
 if(key.slice(0,5)==='PROD:')
   return cellRows(mi,null,r=>costOf(r,key));
 if(key.slice(0,4)==='CAT:'){ const ci=+key.slice(4);
   return cellRows(mi,null,r=>CAT[r[1]]===ci?r[2]:0); }
 /* A bonus group or subgroup. Cost comes from the pre-built cells index rather
    than from detail, because the key may be a subgroup or a flow and cells
    already carries that split. */
 const c=V().cells[key]; if(!c) return [];
 const costs=new Map();
 const months = mi<0 ? Object.keys(c).map(Number) : (c[mi]?[mi]:[]);
 months.forEach(m=>(c[m]||[]).forEach(([p,v])=>{
   if(S==='without'&&KAR.has(p)) return;
   if(!segMatch(p)) return;
   costs.set(p,(costs.get(p)||0)+v);
 }));
 return withCost(population(mi,null),costs,null);
}
function ddSort(rows){
 const k=sortKey, s=sortAsc?1:-1;
 return rows.slice().sort((a,b)=>{
  const F={name:0,country:1,segment:2}[k];
  if(F!==undefined) return s*String(D.players[a.p][F]).localeCompare(String(D.players[b.p][F]));
  if(k==='ftd') return s*String((D.ftd&&D.ftd[a.p])||'').localeCompare(String((D.ftd&&D.ftd[b.p])||''));
  if(k==='ratio'){const av=a.aggr>0?a.cost/a.aggr:Infinity, bv=b.aggr>0?b.cost/b.aggr:Infinity; return s*(av-bv);}
  /* No deposits means no ratio, so those sort to the bottom either way rather
     than pretending to be zero. */
  if(k==='lastdep'){const av=(D.lastDep&&D.lastDep[a.p])||"", bv=(D.lastDep&&D.lastDep[b.p])||""; return s*av.localeCompare(bv);}
  if(k==='cdr'){const av=a.dep>0?a.cost/a.dep:-Infinity, bv=b.dep>0?b.cost/b.dep:-Infinity; return s*(av-bv);}
  return s*(a[k]-b[k]);
 });
}
function dayPlayers(di){const acc=new Map();
 /* Start from everyone active that day, not only those who received a bonus,
    so the listed GGR reconciles with the chart bar. Bonus cost is then added
    for whoever got one. */
 const add=p=>{ if(S==='without'&&KAR.has(p))return null; if(!segMatch(p))return null;
   let e=acc.get(p); if(!e){e={p,cost:0,ggr:0,aggr:0,dep:0}; acc.set(p,e);} return e; };
 if(D.dayPm){ for(const pk in D.dayPm){ const q=D.dayPm[pk][di]; if(!q) continue;
   const e=add(+pk); if(!e) continue; e.ggr=q[0]; e.aggr=q[1]; e.dep=q[2]; } }
 for(const a of (D.dayDet[di]||[])){ const e=add(a[0]); if(!e) continue;
   if(!D.dayPm||!D.dayPm[a[0]]||!D.dayPm[a[0]][di]){ /* no revenue row that day */ }
   e.cost+=a[2]; }
 return [...acc.values()];}
function dayBonuses(di){const rows=D.dayDet[di]||[], acc=new Map();
 for(const a of rows){const p=a[0]; if(S==='without'&&KAR.has(p))continue; if(!segMatch(p))continue;
   const nm=D.bids[a[1]][0]; let e=acc.get(nm); if(!e){e={name:nm,cost:0,pl:new Set()};acc.set(nm,e);} e.cost+=a[2]; e.pl.add(p);}
 return [...acc.values()];}
/* Days between two YYYY-MM-DD dates, ignoring time zones entirely. */
function daysBetween(a,b){
 const pa=Date.parse(a+"T00:00:00Z"), pb=Date.parse(b+"T00:00:00Z");
 if(isNaN(pa)||isNaN(pb)) return null;
 return Math.round((pb-pa)/86400000);
}
/* Last deposit, reddened once it is older than STALE_DAYS. Measured against the
   last date the data covers rather than the clock, so the colouring does not
   change just because the page was opened later. */
const STALE_DAYS=10;
function lastDepCell(p){
 const d=(D.lastDep&&D.lastDep[p])||"";
 if(!d) return '<span class="z">&mdash;</span>';
 const ref=D.dataThrough||(D.dailyLast?D.dailyLast.month+"-"+String(D.dailyLast.days[D.dailyLast.days.length-1]).padStart(2,"0"):"");
 const age=ref?daysBetween(d,ref):null;
 if(age===null) return esc(d);
 const label=`${esc(d)}`;
 return age>STALE_DAYS
   ? `<span class="stale" title="${age} days before ${esc(ref)}">${label}</span>`
   : `<span title="${age} day${age===1?'':'s'} before ${esc(ref)}">${label}</span>`;
}

/* Country names shortened to ISO-2 so the column stops eating the table width.
   The full name stays as a tooltip, and anything unrecognised falls back to the
   first three letters rather than being hidden. */
const CC={
 "afghanistan":"AF","albania":"AL","algeria":"DZ","andorra":"AD","angola":"AO","argentina":"AR","armenia":"AM",
 "australia":"AU","austria":"AT","azerbaijan":"AZ","bahamas":"BS","bahrain":"BH","bangladesh":"BD","barbados":"BB",
 "belarus":"BY","belgium":"BE","belize":"BZ","benin":"BJ","bolivia":"BO","bosnia and herzegovina":"BA","botswana":"BW",
 "brazil":"BR","brunei":"BN","bulgaria":"BG","burkina faso":"BF","cambodia":"KH","cameroon":"CM","canada":"CA",
 "chile":"CL","china":"CN","colombia":"CO","congo":"CG","costa rica":"CR","croatia":"HR","cuba":"CU","cyprus":"CY",
 "czechia":"CZ","czech republic":"CZ","denmark":"DK","dominican republic":"DO","ecuador":"EC","egypt":"EG",
 "el salvador":"SV","estonia":"EE","ethiopia":"ET","finland":"FI","france":"FR","georgia":"GE","germany":"DE",
 "ghana":"GH","greece":"GR","guatemala":"GT","honduras":"HN","hong kong":"HK","hungary":"HU","iceland":"IS",
 "india":"IN","indonesia":"ID","iran":"IR","iraq":"IQ","ireland":"IE","israel":"IL","italy":"IT","jamaica":"JM",
 "japan":"JP","jordan":"JO","kazakhstan":"KZ","kenya":"KE","kuwait":"KW","kyrgyzstan":"KG","latvia":"LV",
 "lebanon":"LB","libya":"LY","liechtenstein":"LI","lithuania":"LT","luxembourg":"LU","macedonia":"MK",
 "north macedonia":"MK","malaysia":"MY","maldives":"MV","malta":"MT","mexico":"MX","moldova":"MD","monaco":"MC",
 "mongolia":"MN","montenegro":"ME","morocco":"MA","myanmar":"MM","namibia":"NA","nepal":"NP","netherlands":"NL",
 "new zealand":"NZ","nicaragua":"NI","nigeria":"NG","norway":"NO","oman":"OM","pakistan":"PK","panama":"PA",
 "paraguay":"PY","peru":"PE","philippines":"PH","poland":"PL","portugal":"PT","qatar":"QA","romania":"RO",
 "russia":"RU","russian federation":"RU","saudi arabia":"SA","senegal":"SN","serbia":"RS","singapore":"SG",
 "slovakia":"SK","slovenia":"SI","south africa":"ZA","south korea":"KR","korea":"KR","spain":"ES","sri lanka":"LK",
 "sweden":"SE","switzerland":"CH","syria":"SY","taiwan":"TW","tajikistan":"TJ","tanzania":"TZ","thailand":"TH",
 "tunisia":"TN","turkey":"TR","turkiye":"TR","turkmenistan":"TM","uganda":"UG","ukraine":"UA",
 "united arab emirates":"AE","uae":"AE","united kingdom":"GB","great britain":"GB",
 "united states of america":"US","united states":"US","usa":"US","uruguay":"UY","uzbekistan":"UZ",
 "venezuela":"VE","vietnam":"VN","viet nam":"VN","zambia":"ZM","zimbabwe":"ZW",
 "vpn player":"VPN","unknown":"—"
};
function cc(name){
 const raw=String(name==null?"":name).trim();
 if(!raw) return '<span class="z">&mdash;</span>';
 const hit=CC[raw.toLowerCase()];
 const short=hit||raw.slice(0,3).toUpperCase();
 return `<span title="${esc(raw)}">${esc(short)}</span>`;
}
/* Bonus cost as a share of what the player deposited. Unlike cost/GGR this
   keeps a sane denominator when the player is winning, so it stays readable
   where the GGR ratio goes n/m. */
function costPerDep(cost,dep){ return dep>0 ? (100*cost/dep).toFixed(1)+'%' : '<span class="z">n/m</span>'; }

function dayRenderPlayers(){
 const q=document.getElementById('ddSearch').value.trim().toLowerCase();
 let rs=ddRows; if(q) rs=rs.filter(r=>D.players[r.p].some(f=>String(f).toLowerCase().includes(q)));
 rs=ddSort(rs);
 const H=[['name','Player','l'],['country','Country','l'],['segment','Segment','l'],['ftd','FTD date','l'],
          ['lastdep','Last deposit','l'],['dep','Deposits','r'],['aggr','Adjusted GGR','r'],
          ['cost','Bonus cost','r'],['ratio','Bonus cost / adj GGR','r'],['cdr','Bonus cost / deposits','r']];
 let h='<thead><tr>'+H.map(([k,l,al])=>`<th data-k="${k}" class="${sortKey===k?'sorted'+(sortAsc?' asc':''):''}" style="text-align:${al==='l'?'left':'right'}">${l}</th>`).join('')+'</tr></thead><tbody>';
 rs.forEach(r=>{const P=D.players[r.p];
   h+=`<tr class="prow${selPlayer===r.p?' psel':''}" data-p="${r.p}"><td>${esc(P[0])}${KAR.has(r.p)?'<span class="pill">whale</span>':''}</td><td class="dim">${cc(P[1])}</td><td class="dim">${esc(P[2])}</td><td class="dim">${esc((D.ftd&&D.ftd[r.p])||'—')}</td><td class="dim">${lastDepCell(r.p)}</td><td>${money(r.dep)}</td><td>${money(r.aggr)}</td><td>${money(r.cost)}</td><td>${rate(r.cost,r.aggr)}</td><td>${costPerDep(r.cost,r.dep)}</td></tr>`;});
 const T=k=>rs.reduce((a,b)=>a+b[k],0);
 h+=`</tbody><tfoot><tr><td>${rs.length.toLocaleString()} player${rs.length===1?'':'s'}</td><td></td><td></td><td></td><td></td><td>${money(T('dep'))}</td><td>${money(T('aggr'))}</td><td>${money(T('cost'))}</td><td>${rate(T('cost'),T('aggr'))}</td><td>${costPerDep(T('cost'),T('dep'))}</td></tr></tfoot>`;
 document.getElementById('ddt').innerHTML=h;
 document.querySelectorAll('#ddt th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(!k)return;if(sortKey===k)sortAsc=!sortAsc;else{sortKey=k;sortAsc=['name','country','segment','ftd','lastdep'].includes(k);}ddRender();});}
function dayRenderBonuses(){
 if(!ddBonusCache) ddBonusCache=dayBonuses(ddCtx.di);
 const q=document.getElementById('ddSearch').value.trim().toLowerCase();
 let rs=ddBonusCache; if(q) rs=rs.filter(r=>r.name.toLowerCase().includes(q));
 const k=sortKey,sg=sortAsc?1:-1;
 rs=rs.slice().sort((a,b)=>{if(k==='name')return sg*a.name.localeCompare(b.name); if(k==='players')return sg*(a.pl.size-b.pl.size); if(k==='cpp')return sg*((a.cost/a.pl.size)-(b.cost/b.pl.size)); return sg*(a.cost-b.cost);});
 const cc=ddBonusCache.reduce((a,b)=>a+b.cost,0);
 const H=[['name','Bonus name','l'],['code','Code','l'],['gs','Group / subgroup','l'],['players','Players','r'],['cost','Cost','r'],['cpp','Cost / player','r'],['share','Share','r']];
 let h='<thead><tr>'+H.map(([k2,l,al])=>`<th data-k="${k2}" class="${sortKey===k2?'sorted'+(sortAsc?' asc':''):''}" style="text-align:${al==='l'?'left':'right'}">${l}</th>`).join('')+'</tr></thead><tbody>';
 rs.forEach(r=>{const enc=encodeURIComponent(r.name);
   h+=`<tr class="brow2${selBonus===r.name?' psel':''}" data-nm="${enc}"><td>${esc(r.name)}</td><td class="dim">${esc(bonusCode(r.name))}</td><td class="dim">${bonusGS(r.name)}</td><td>${r.pl.size.toLocaleString()}</td><td>${money(r.cost)}</td><td>${money(r.cost/r.pl.size)}</td><td>${cc?(100*r.cost/cc).toFixed(1)+'%':'—'}</td></tr>`;});
 const tc=rs.reduce((a,b)=>a+b.cost,0), tp=new Set(); rs.forEach(r=>r.pl.forEach(x=>tp.add(x)));
 h+=`</tbody><tfoot><tr><td>${rs.length} bonus${rs.length===1?'':'es'}</td><td></td><td></td><td>${tp.size.toLocaleString()}</td><td>${money(tc)}</td><td>${tp.size?money(tc/tp.size):'—'}</td><td>${cc?(100*tc/cc).toFixed(0)+'%':'—'}</td></tr></tfoot>`;
 document.getElementById('ddt').innerHTML=h;
 document.querySelectorAll('#ddt th').forEach(th=>th.onclick=()=>{const k2=th.dataset.k;if(!k2||k2==='gs'||k2==='code')return;if(sortKey===k2)sortAsc=!sortAsc;else{sortKey=k2;sortAsc=(k2==='name');}ddRender();});}
function openDayPlayer(pi){
 selPlayer=pi; document.querySelectorAll('#ddt tbody tr').forEach(tr=>tr.classList.toggle('psel',+tr.dataset.p===pi));
 const di=ddCtx.di, dl=D.dailyLast, acc=new Map();
 (D.dayDet[di]||[]).forEach(a=>{if(a[0]!==pi)return; const e=acc.get(a[1])||{bidx:a[1],cost:0}; e.cost+=a[2]; acc.set(a[1],e);});
 const list=[...acc.values()].sort((a,b)=>b.cost-a.cost), P=D.players[pi];
 document.getElementById('dd2Title').innerHTML=`${esc(P[0])} <span class="crumb">— bonuses on ${dl.label} ${dl.days[di]} 2026</span>`;
 let h='<thead><tr><th>Bonus name</th><th>Code</th><th>Group / subgroup</th><th>Cost</th></tr></thead><tbody>';
 list.forEach(r=>{const m=D.bids[r.bidx]; h+=`<tr><td>${esc(m[0])}</td><td class="sub">${esc(m[3]||'—')}</td><td class="sub">${esc(m[1])}${m[2]&&m[2]!=='Not in bonus list'?' › '+esc(m[2]):''}</td><td>${moneyc(r.cost)}</td></tr>`;});
 const tot=list.reduce((a,b)=>a+b.cost,0);
 h+=`</tbody><tfoot><tr><td>${list.length} bonus${list.length===1?'':'es'}</td><td></td><td></td><td>${moneyc(tot)}</td></tr></tfoot>`;
 document.getElementById('dd2t').innerHTML=h; document.getElementById('dd2').classList.add('on');}
function openDayBonusPlayers(name){
 selBonus=name; const enc=encodeURIComponent(name);
 document.querySelectorAll('#ddt tbody tr').forEach(tr=>tr.classList.toggle('psel',tr.dataset.nm===enc));
 const di=ddCtx.di, dl=D.dailyLast, bset=NAMEBIDS[name]||new Set(), acc=new Map();
 (D.dayDet[di]||[]).forEach(a=>{const p=a[0]; if(S==='without'&&KAR.has(p))return; if(!segMatch(p))return; if(!bset.has(a[1]))return;
   let e=acc.get(p); if(!e){e={p,cost:0,ggr:0,aggr:0}; const qq=(D.dayPm&&D.dayPm[p])?D.dayPm[p][di]:null; if(qq){e.ggr=qq[0];e.aggr=qq[1];} acc.set(p,e);} e.cost+=a[2];});
 const list=[...acc.values()].sort((a,b)=>b.cost-a.cost);
 document.getElementById('dd2Title').innerHTML=`${esc(name)} <span class="crumb">— players on ${dl.label} ${dl.days[di]} 2026</span>`;
 let h='<thead><tr><th>Player</th><th>Country</th><th>Segment</th><th>FTD date</th><th>Cost</th><th>Adjusted GGR</th></tr></thead><tbody>';
 list.forEach(r=>{const P=D.players[r.p]; h+=`<tr><td>${esc(P[0])}${KAR.has(r.p)?'<span class="pill">whale</span>':''}</td><td class="sub">${cc(P[1])}</td><td class="sub">${esc(P[2])}</td><td class="sub">${esc((D.ftd&&D.ftd[r.p])||'—')}</td><td>${money(r.cost)}</td><td>${money(r.aggr)}</td></tr>`;});
 const tot=list.reduce((a,b)=>a+b.cost,0), ta=list.reduce((a,b)=>a+b.aggr,0);
 h+=`</tbody><tfoot><tr><td>${list.length} player${list.length===1?'':'s'}</td><td></td><td></td><td></td><td>${money(tot)}</td><td>${money(ta)}</td></tr></tfoot>`;
 document.getElementById('dd2t').innerHTML=h; document.getElementById('dd2').classList.add('on');}
function openDayDD(di){
 const dl=D.dailyLast; if(!dl||!D.dayDet) return;
 document.querySelectorAll('rect.dbar.sel').forEach(x=>x.classList.remove('sel'));
 document.querySelectorAll(`rect.dbar[data-di="${di}"]`).forEach(x=>x.classList.add('sel'));
 ddCtx={kind:'day', di, key:'__DAY__', mi:-1}; ddBonusCache=null; selBonus=null; selPlayer=null;
 ddRows=dayPlayers(di);
 document.getElementById('ddTitle').innerHTML=`${dl.label} ${dl.days[di]}, 2026 <span class="crumb">— daily bonus cost</span>`;
 sortKey='cost'; sortAsc=false; document.getElementById('ddSearch').value='';
 document.getElementById('dd2').classList.remove('on');
 ddRender(); document.getElementById('dd').classList.add('on'); document.getElementById('bClear').style.display='';}
function ddRender(){
 const isBonusCtx = ddCtx && ddCtx.kind==='bonus';
 const isDay = ddCtx && ddCtx.kind==='day';
 document.getElementById('ddModeSeg').style.display = isBonusCtx ? 'none' : '';
 const bonusMode = ddMode==='bonuses' && !isBonusCtx;
 document.getElementById('ddSearch').placeholder = bonusMode?'Filter bonuses…':'Filter players…';
 if(isDay){
  const c=ddRows.reduce((a,b)=>a+b.cost,0);
  /* Only players who received a bonus that day are stored, but the chart bar
     covers every player. State that gap instead of leaving the reader to
     wonder why the listed GGR does not add up to the bar. */
  const listedAggr=ddRows.reduce((a,b)=>a+b.aggr,0);
  const dayArr=D.dailyLast&&D.dailyLast[S+'_aggr'];
  const dayTotal=dayArr?dayArr[ddCtx.di]:null;
  const m0=v=>(v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US');
  const recon=(dayTotal===null||dayTotal===undefined)?''
    :` · adjusted GGR ${m0(listedAggr)} from these players, ${m0(dayTotal-listedAggr)} from players with no bonus that day, ${m0(dayTotal)} in total`;
  document.getElementById('ddMeta').textContent=
   `${ddRows.length.toLocaleString()} players who received a bonus · $${Math.round(c).toLocaleString('en-US')} bonus cost`+
   (S==='without'?' · karolik777 excluded':'')+
   (bonusMode?' · Bonus names paid this day. Click a bonus for its players.'
             :recon+' · Click a player for their bonuses.');
  if(bonusMode) dayRenderBonuses(); else dayRenderPlayers();
  return;
 }
 if(!isBonusCtx){
  const c=ddRows.reduce((a,b)=>a+b.cost,0);
  /* Every cell now lists its whole population, so the adjusted GGR here is the
     population's and reconciles with the source tables. Worth saying, because
     for most of this report's life the list was bonused players only and
     anyone who remembers that will read the GGR wrongly. */
  const withBonus=ddRows.reduce((n,r)=>n+(r.cost?1:0),0);
  const a=ddRows.reduce((x,y)=>x+y.aggr,0);
  const m0=v=>(v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US');
  document.getElementById('ddMeta').textContent=
   `${ddRows.length.toLocaleString()} players · ${m0(a)} adjusted GGR · `+
   `$${Math.round(c).toLocaleString('en-US')} bonus cost`+
   (S==='without'?' · karolik777 excluded':'')+
   (bonusMode
     ? ' · Bonus names received by these players here. Click a bonus for the players who got it.'
     : ` · Every player behind this cell, including the ${(ddRows.length-withBonus).toLocaleString()} who received no bonus. Adjusted GGR and deposits are each player’s whole-month totals. Click a player for their bonus breakdown.`);
 }
 if(bonusMode) renderBonuses(); else renderPlayers();
}
function renderPlayers(){
 const q=document.getElementById('ddSearch').value.trim().toLowerCase();
 let rs=ddRows;
 if(q) rs=rs.filter(r=>D.players[r.p].some(f=>String(f).toLowerCase().includes(q)));
 rs=ddSort(rs);
 const H=[['name','Player','l'],['country','Country','l'],['segment','Segment','l'],['ftd','FTD date','l'],
          ['lastdep','Last deposit','l'],['dep','Deposits','r'],['aggr','Adjusted GGR','r'],
          ['cost','Bonus cost','r'],['ratio','Bonus cost / adj GGR','r'],['cdr','Bonus cost / deposits','r']];
 let h='<thead><tr>'+H.map(([k,l,al])=>
   `<th data-k="${k}" class="${sortKey===k?'sorted'+(sortAsc?' asc':''):''}" style="text-align:${al==='l'?'left':'right'}">${l}</th>`).join('')+
   '</tr></thead><tbody>';
 /* Now that every player is listed rather than only the bonused ones, a Total
    column can be 138,000 rows. The table is one innerHTML string, so that is
    seconds of freeze and a lot of memory for a list nobody scrolls to the end
    of. Only the top slice is drawn — sorted by whichever column is active, so
    the rows that matter are the ones you get — and the footer totals and the
    CSV export both still cover everything. */
 const shown=rs.length>DD_ROW_CAP?rs.slice(0,DD_ROW_CAP):rs;
 shown.forEach(r=>{
  const P=D.players[r.p];
  h+=`<tr class="prow${selPlayer===r.p?' psel':''}" data-p="${r.p}"><td>${esc(P[0])}${KAR.has(r.p)?'<span class="pill">whale</span>':''}`+
     (P[3]?`<span class="pill" title="previously known as">was ${esc(P[3])}</span>`:'')+`</td>`+
     `<td class="dim">${cc(P[1])}</td><td class="dim">${esc(P[2])}</td><td class="dim">${esc((D.ftd&&D.ftd[r.p])||'—')}</td><td class="dim">${lastDepCell(r.p)}</td><td>${money(r.dep)}</td><td>${money(r.aggr)}</td><td>${money(r.cost)}</td><td>${rate(r.cost,r.aggr)}</td><td>${costPerDep(r.cost,r.dep)}</td></tr>`;
 });
 const T=k=>rs.reduce((a,b)=>a+b[k],0);
 const capped=rs.length>shown.length;
 h+=`</tbody><tfoot><tr><td>${rs.length.toLocaleString()} player${rs.length===1?'':'s'}`+
    (capped?`<span class="pill" title="Sorted by the active column, so the rows that matter are here. The totals on this line and the CSV cover all ${rs.length.toLocaleString()}.">top ${shown.length.toLocaleString()} listed</span>`:'')+
    `</td><td></td><td></td><td></td><td></td><td>${money(T('dep'))}</td><td>${money(T('aggr'))}</td><td>${money(T('cost'))}</td><td>${rate(T('cost'),T('aggr'))}</td><td>${costPerDep(T('cost'),T('dep'))}</td></tr></tfoot>`;
 document.getElementById('ddt').innerHTML=h;
 document.querySelectorAll('#ddt th').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; if(!k) return;
  if(sortKey===k) sortAsc=!sortAsc; else {sortKey=k;sortAsc=['name','country','segment','ftd','lastdep'].includes(k);}
  ddRender();
 });
}
function bonusesForCell(key,mi){
 const acc=new Map();
 /* The FTD tables are whole-period, so read D rather than the MTD view. */
 const DET=ctxFtd(key)?D.detail:V().detail;
 for(const pis in DET){ const p=+pis; if(S==='without'&&KAR.has(p)) continue; if(!segMatch(p)) continue; if(!segCtxMatch(p)) continue;
   const recs=DET[pis];
   for(let i=0;i<recs.length;i++){ const mm=recs[i][0],bx=recs[i][1],c=costOf(recs[i],key);
     if(!ctxMonthOK(p,mm,key,mi)) continue; if(!keyMatch(key,bx)) continue; if(c<=0) continue;
     const nm=D.bids[bx][0]; let e=acc.get(nm); if(!e){e={name:nm,cost:0,pl:new Set()};acc.set(nm,e);} e.cost+=c; e.pl.add(p); } }
 return [...acc.values()];
}
function renderBonuses(){
 if(!ddBonusCache) ddBonusCache=bonusesForCell(ddCtx.key,ddCtx.mi);
 const q=document.getElementById('ddSearch').value.trim().toLowerCase();
 let rs=ddBonusCache; if(q) rs=rs.filter(r=>r.name.toLowerCase().includes(q));
 const k=sortKey,sg=sortAsc?1:-1;
 rs=rs.slice().sort((a,b)=>{ if(k==='name')return sg*a.name.localeCompare(b.name);
   if(k==='players')return sg*(a.pl.size-b.pl.size);
   if(k==='cpp')return sg*((a.cost/a.pl.size)-(b.cost/b.pl.size)); return sg*(a.cost-b.cost); });
 const cellCost=ddBonusCache.reduce((a,b)=>a+b.cost,0);
 const H=[['name','Bonus name','l'],['code','Code','l'],['gs','Group / subgroup','l'],['players','Players','r'],['cost','Cost','r'],['cpp','Cost / player','r'],['share','Share','r']];
 let h='<thead><tr>'+H.map(([k2,l,al])=>
   `<th data-k="${k2}" class="${sortKey===k2?'sorted'+(sortAsc?' asc':''):''}" style="text-align:${al==='l'?'left':'right'}">${l}</th>`).join('')+
   '</tr></thead><tbody>';
 rs.forEach(r=>{const enc=encodeURIComponent(r.name);
   h+=`<tr class="brow2${selBonus===r.name?' psel':''}" data-nm="${enc}"><td>${esc(r.name)}</td>`+
      `<td class="dim">${esc(bonusCode(r.name))}</td>`+
      `<td class="dim">${bonusGS(r.name)}</td><td>${r.pl.size.toLocaleString()}</td>`+
      `<td>${money(r.cost)}</td><td>${money(r.cost/r.pl.size)}</td><td>${cellCost?(100*r.cost/cellCost).toFixed(1)+'%':'—'}</td></tr>`;});
 const tc=rs.reduce((a,b)=>a+b.cost,0), tp=new Set(); rs.forEach(r=>r.pl.forEach(x=>tp.add(x)));
 h+=`</tbody><tfoot><tr><td>${rs.length} bonus${rs.length===1?'':'es'}</td><td></td><td></td><td>${tp.size.toLocaleString()}</td>`+
    `<td>${money(tc)}</td><td>${tp.size?money(tc/tp.size):'—'}</td><td>${cellCost?(100*tc/cellCost).toFixed(0)+'%':'—'}</td></tr></tfoot>`;
 document.getElementById('ddt').innerHTML=h;
 document.querySelectorAll('#ddt th').forEach(th=>th.onclick=()=>{const k2=th.dataset.k; if(!k2||k2==='gs'||k2==='code')return;
   if(sortKey===k2) sortAsc=!sortAsc; else {sortKey=k2;sortAsc=(k2==='name');} ddRender();});
}
const PRODKEYS=['slot','live_casino','sport','other'];
const PRODLABEL={slot:'Slot',live_casino:'Live Casino',sport:'Sport',other:'Other'};
/* Cost carried by one detail record for the current context. Product cells use
   the per-product split appended to each record; everything else the total. */
function costOf(rec,key){
 if(typeof key==='string'&&key.slice(0,5)==='PROD:'){ const i=+key.slice(5); return rec[3+i]||0; }
 return rec[2];
}
function keyMatch(key,bidx){
 if(key.slice(0,5)==='PROD:') return true;
 if(key.slice(0,4)==='SEG:') return true;
 if(key.slice(0,4)==='FTD:'||key.slice(0,5)==='FTDL:') return true;
 if(key.slice(0,4)==='CAT:') return CAT[bidx]===+key.slice(4);
 const m=D.bids[bidx];
 if(key==='__ALL__') return true;
 if(key.indexOf('|')>=0){const p=key.split('|');
   const fi=p[1].indexOf(FSEP);
   /* A flow row matches on group + subgroup + the bonus's own flow label. */
   if(fi>=0) return m[1]===p[0] && m[2]===p[1].slice(0,fi) && BFLOW[bidx]===p[1].slice(fi+FSEP.length);
   return m[1]===p[0]&&m[2]===p[1];}
 return m[1]===key;
}
function openPlayer(pi){
 if(ddCtx&&ddCtx.kind==='day') return openDayPlayer(pi);
 selPlayer=pi;
 document.querySelectorAll('#ddt tbody tr').forEach(tr=>tr.classList.toggle('psel',+tr.dataset.p===pi));
 const recs=V().detail[pi]||[];
 const byMonth = ddCtx.mi>=0;
 const acc=new Map();
 recs.forEach(rec=>{const mi=rec[0],bidx=rec[1],c=costOf(rec,ddCtx.key);
   if(byMonth && mi!==ddCtx.mi) return;
   if(!keyMatch(ddCtx.key,bidx)) return;
   if(c<=0) return;
   const e=acc.get(bidx)||{bidx,cost:0,mset:new Set()}; e.cost+=c; e.mset.add(mi); acc.set(bidx,e);});
 const rows=[...acc.values()].sort((a,b)=>b.cost-a.cost);
 const P=D.players[pi];
 const scope=ddCtx.key==='__ALL__'?'all bonus groups'
   /* normalise both separators to one before joining, so a flow key reads
      "CRM › Smartico - FLOW › Churn" rather than running the last two together */
   :ddCtx.key.split(FSEP).join('|').split('|').join(' › ');
 const period=ddCtx.mi<0?('Jan – Aug '+D.mtdDay+' 2026'):D.labels[ddCtx.mi]+' 2026';
 document.getElementById('dd2Title').innerHTML=
   `${esc(P[0])} <span class="crumb">— bonuses in ${esc(scope)} · ${period}</span>`;
 const showM=ddCtx.mi<0;
 let h=`<thead><tr><th>Bonus name</th><th>Code</th><th>Group / subgroup</th>${showM?'<th>Months</th>':''}<th>Cost</th></tr></thead><tbody>`;
 rows.forEach(r=>{const m=D.bids[r.bidx];
   h+=`<tr><td>${esc(m[0])}</td><td class="sub">${esc(m[3]||'—')}</td><td class="sub">${esc(m[1])}${m[2]&&m[2]!=='Not in bonus list'?' › '+esc(m[2]):(m[1]==='Unmapped'?' › '+esc(m[2]):'')}</td>`+
      (showM?`<td>${r.mset.size}</td>`:'')+`<td>${moneyc(r.cost)}</td></tr>`;});
 const tot=rows.reduce((a,b)=>a+b.cost,0);
 h+=`</tbody><tfoot><tr><td>${rows.length} bonus${rows.length===1?'':'es'}</td><td></td><td></td>${showM?'<td></td>':''}<td>${moneyc(tot)}</td></tr></tfoot>`;
 document.getElementById('dd2t').innerHTML=h;
 const dd2=document.getElementById('dd2'); dd2.classList.add('on');
}
document.getElementById('dd2Close').onclick=()=>{document.getElementById('dd2').classList.remove('on');
 selPlayer=null; document.querySelectorAll('#ddt tbody tr.psel').forEach(t=>t.classList.remove('psel'));};
document.addEventListener('click',e=>{
 /* The win/loss top-12 lists sit outside the drill-down panel but their rows
    behave the same way: click a player, get their bonuses. */
 const wl=e.target.closest('#wlWon tr[data-p],#wlLost tr[data-p]');
 if(wl){ openPlayer(+wl.dataset.p); return; }
 const tr=e.target.closest('#ddt tbody tr'); if(!tr)return;
 if(tr.dataset.p!==undefined) openPlayer(+tr.dataset.p);
 else if(tr.dataset.nm!==undefined) openBonusPlayers(decodeURIComponent(tr.dataset.nm));});
function openBonusPlayers(name){
 if(ddCtx&&ddCtx.kind==='day') return openDayBonusPlayers(name);
 selBonus=name; const enc=encodeURIComponent(name);
 document.querySelectorAll('#ddt tbody tr').forEach(tr=>tr.classList.toggle('psel',tr.dataset.nm===enc));
 const bset=NAMEBIDS[name]||new Set(), acc=new Map();
 const DET=ctxFtd(ddCtx.key)?D.detail:V().detail;
 for(const pis in DET){ const p=+pis; if(S==='without'&&KAR.has(p)) continue; if(!segMatch(p)) continue; if(!segCtxMatch(p)) continue;
   let c=0; const ms=new Set(); const recs=DET[pis];
   for(let i=0;i<recs.length;i++){ const mm=recs[i][0],bx=recs[i][1],cc=recs[i][2];
     if(!ctxMonthOK(p,mm,ddCtx.key,ddCtx.mi)) continue; if(!keyMatch(ddCtx.key,bx)) continue; if(!bset.has(bx)) continue; c+=cc; ms.add(mm);}
   if(c<=0) continue;
   const e={p,cost:c,ggr:0,aggr:0,dep:0}; ms.forEach(m=>{const qq=(V().pm[p]||{})[m]; if(qq){e.ggr+=qq[0];e.aggr+=qq[1];e.dep+=qq[2];}}); acc.set(p,e);}
 const rows=[...acc.values()].sort((a,b)=>b.cost-a.cost);
 const scope=ddCtx.key==='__ALL__'?'all bonus groups'
   /* normalise both separators to one before joining, so a flow key reads
      "CRM › Smartico - FLOW › Churn" rather than running the last two together */
   :ddCtx.key.split(FSEP).join('|').split('|').join(' › ');
 const period=ddCtx.mi<0?('Jan – Aug '+D.mtdDay+' 2026'):D.labels[ddCtx.mi]+' 2026';
 document.getElementById('dd2Title').innerHTML=`${esc(name)} <span class="crumb">— players in ${esc(scope)} · ${period}</span>`;
 let h='<thead><tr><th>Player</th><th>Country</th><th>Segment</th><th>FTD date</th><th>Cost</th><th>Adjusted GGR</th><th>Deposits</th><th>Bonus cost / adj GGR</th><th>Bonus cost / deposits</th></tr></thead><tbody>';
 rows.forEach(r=>{const P=D.players[r.p];
   h+=`<tr><td>${esc(P[0])}${KAR.has(r.p)?'<span class="pill">whale</span>':''}</td><td class="sub">${cc(P[1])}</td><td class="sub">${esc(P[2])}</td><td class="sub">${esc((D.ftd&&D.ftd[r.p])||'—')}</td>`+
      `<td>${money(r.cost)}</td><td>${money(r.aggr)}</td><td>${money(r.dep)}</td><td>${rate(r.cost,r.aggr)}</td></tr>`;});
 const T=k=>rows.reduce((a,b)=>a+b[k],0);
 h+=`</tbody><tfoot><tr><td>${rows.length} player${rows.length===1?'':'s'}</td><td></td><td></td><td></td><td></td><td>${money(T('dep'))}</td><td>${money(T('aggr'))}</td><td>${money(T('cost'))}</td><td>${rate(T('cost'),T('aggr'))}</td><td>${costPerDep(T('cost'),T('dep'))}</td></tr></tfoot>`;
 document.getElementById('dd2t').innerHTML=h;
 const dd2=document.getElementById('dd2'); dd2.classList.add('on');}
function rowsForBonusName(name){
 const bset=NAMEBIDS[name]||new Set(), acc=[];
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p)) continue; if(!segMatch(p)) continue;
   let c=0; const ms=new Set(); const recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ if(bset.has(recs[i][1])){ c+=recs[i][2]; ms.add(recs[i][0]); } }
   if(c<=0) continue;
   const e={p,cost:c,ggr:0,aggr:0,dep:0};
   ms.forEach(m=>{const q=(V().pm[p]||{})[m]; if(q){e.ggr+=q[0];e.aggr+=q[1];e.dep+=q[2];}});
   acc.push(e);
 }
 return acc;
}
function bonusGS(name){
 let g=null,sub=null,multi=false;
 (NAMEBIDS[name]||new Set()).forEach(i=>{const m=D.bids[i];
   if(g===null){g=m[1];sub=m[2];} else if(g!==m[1]||sub!==m[2]){multi=true;}});
 if(multi) return 'multiple groups';
 return esc(g)+((sub&&sub!=='Not in bonus list')?' › '+esc(sub):(g==='Unmapped'?' › '+esc(sub):''));
}
function openBonus(name){
 selPlayer=null; document.getElementById('dd2').classList.remove('on');
 document.querySelectorAll('td.sel').forEach(x=>x.classList.remove('sel'));
 document.querySelectorAll('tr.brow.bsel').forEach(x=>x.classList.remove('bsel'));
 const enc=encodeURIComponent(name);
 document.querySelectorAll(`tr.brow[data-nm="${enc}"]`).forEach(x=>x.classList.add('bsel'));
 ddCtx={kind:'bonus',name:name,key:'__ALL__',mi:-1};
 ddRows=rowsForBonusName(name);
 document.getElementById('ddTitle').innerHTML=`${esc(name)} <span class="crumb">— ${bonusGS(name)} · Jan – Aug 9 2026</span>`;
 const c=ddRows.reduce((a,b)=>a+b.cost,0);
 document.getElementById('ddMeta').textContent=
   `${ddRows.length.toLocaleString()} players · $${Math.round(c).toLocaleString('en-US')} bonus cost`+
   (S==='without'?' · karolik777 excluded':'')+
   ' · GGR and deposits are whole-month totals for the months each player got this bonus. Click a player for their full breakdown.';
 sortKey='cost'; sortAsc=false; document.getElementById('ddSearch').value='';
 ddRender();
 const dd=document.getElementById('dd'); dd.classList.add('on');
 document.getElementById('bClear').style.display='';
}
function buildTopBonuses(){
 const agg=new Map();
 for(const pis in V().detail){ const p=+pis; if(S==='without'&&KAR.has(p)) continue;
   const recs=V().detail[pis];
   for(let i=0;i<recs.length;i++){ const name=D.bids[recs[i][1]][0], c=recs[i][2];
     let e=agg.get(name); if(!e){e={name,cost:0,pl:new Set()};agg.set(name,e);} e.cost+=c; e.pl.add(p); } }
 const arr=[...agg.values()].filter(e=>e.cost>0.005).sort((a,b)=>b.cost-a.cost);
 const grand=sum(D.data[S].total), N=25, top=arr.slice(0,N), rest=arr.slice(N);
 let h='<thead><tr><th class="rank">#</th><th>Bonus name</th><th>Group / subgroup</th><th>Players</th><th>Total cost</th><th>Share</th></tr></thead><tbody>';
 top.forEach((e,i)=>{
   h+=`<tr class="brow" data-nm="${encodeURIComponent(e.name)}"><td class="rank">${i+1}</td><td>${esc(e.name)}</td>`+
      `<td class="sub2">${bonusGS(e.name)}</td><td>${e.pl.size.toLocaleString()}</td><td>${money(e.cost)}</td>`+
      `<td>${grand?(100*e.cost/grand).toFixed(1)+'%':'—'}</td></tr>`;});
 if(rest.length){const rc=rest.reduce((a,b)=>a+b.cost,0); const rp=new Set(); rest.forEach(e=>e.pl.forEach(x=>rp.add(x)));
   h+=`<tr class="oth"><td class="rank"></td><td>Other</td><td class="sub2">${rest.length} more bonuses</td>`+
      `<td>${rp.size.toLocaleString()}</td><td>${money(rc)}</td><td>${grand?(100*rc/grand).toFixed(1)+'%':'—'}</td></tr>`;}
 const tp=playersIn('__ALL__',-1).size;
 h+=`</tbody><tfoot><tr class="tot"><td class="rank"></td><td>All bonuses</td><td class="sub2">${arr.length} distinct</td>`+
    `<td>${tp.toLocaleString()}</td><td>${money(grand)}</td><td>100%</td></tr></tfoot>`;
 document.getElementById('tbn').innerHTML=h;
}
function openDD(td){
 const key=td.dataset.key, mi=+td.dataset.m;
 document.querySelectorAll('td.sel').forEach(x=>x.classList.remove('sel'));
 document.querySelectorAll(`td.k[data-key="${CSS.escape(key)}"][data-m="${mi}"]`).forEach(x=>x.classList.add('sel'));
 ddCtx={key,mi,kind:'cell'};
 ddBonusCache=null; selBonus=null;
 ddRows=rowsFor(key,mi);
 const FT=(D.ftdCohort&&D.ftdCohort.types)||[];
 const parts=key.slice(0,5)==='FTDL:'?[(FT[+key.slice(5)]||'FTD')+' FTDs — lifetime to date']
   :key.slice(0,4)==='FTD:'?[(FT[+key.slice(4)]||'FTD')+' FTDs']
   :key.slice(0,5)==='PROD:'?[PRODLABEL[PRODKEYS[+key.slice(5)]]+' — bonus cost']
   /* Just "All players" — this key also backs the Bet amount denominator row,
      so naming a measure in the breadcrumb would be wrong half the time. */
   :key==='ALLP'?['All players']
   :key.slice(0,4)==='UTA:'?[((D.userTypes||[])[+key.slice(4)]||'User type'),'adjusted GGR']
   :key.slice(0,3)==='WL:'?['Player win / loss',
      (WL_BANDS[+key.slice(3)]||{}).lab.replace(/&lt;/g,'<').replace(/&gt;/g,'>')+
      ' — '+SIDE_LAB[(WL_BANDS[+key.slice(3)]||{}).side]]
   :key.slice(0,5)==='SEGA:'?[SEGS[+key.slice(5)]+' segment','adjusted GGR — every player']
   :key.slice(0,3)==='UT:'?(function(){const cut=key.indexOf('|');
      const t=(D.userTypes||[])[+key.slice(3,cut<0?undefined:cut)]||'User type';
      return cut<0?[t]:[t,key.slice(cut+1)];})()
   :key.slice(0,4)==='SEG:'?[SEGS[+key.slice(4)]+' segment']:key.slice(0,4)==='CAT:'?[CATS[+key.slice(4)]+(/bonus$/i.test(CATS[+key.slice(4)])?'':' bonuses')]:(key==='__ALL__'?['All bonus groups']:key.split('|'));
 const period=mi<0?('Jan – Aug '+D.mtdDay+' 2026'):D.labels[mi]+' 2026'+(isPartial(mi)?(' (1–'+D.mtdDay+' Aug only)'):'');
 document.getElementById('ddTitle').innerHTML=
   parts.map((p,i)=>i?`<span class="crumb"> › </span>${esc(p)}`:esc(p)).join('')+
   `<span class="crumb"> › </span>${period}`;
 const c=ddRows.reduce((a,b)=>a+b.cost,0);
 document.getElementById('ddMeta').textContent=
   `${ddRows.length.toLocaleString()} players · $${Math.round(c).toLocaleString('en-US')} bonus cost`+
   (S==='without'?' · karolik777 excluded':'')+
   ' · GGR and deposits are each player’s whole-month totals, not just this bonus group. Click a player for their bonus breakdown.';
 /* A GGR cell opens sorted by GGR; everything else by bonus cost. */
 sortKey=key.slice(0,5)==='SEGA:'?'aggr':'cost'; sortAsc=false; selPlayer=null;
 document.getElementById('ddSearch').value='';
 document.getElementById('dd2').classList.remove('on');
 ddRender();
 const dd=document.getElementById('dd'); dd.classList.add('on');
 document.getElementById('bClear').style.display='';
}
document.addEventListener('click',e=>{
 const tg=e.target.closest('.tg[data-grp]');
 if(tg){const g=tg.dataset.grp; collapsed.has(g)?collapsed.delete(g):collapsed.add(g); render(); return;}
 const ts=e.target.closest('.tg[data-sub]');
 if(ts){subSeeding=false; const k=ts.dataset.sub;
   collapsedSub.has(k)?collapsedSub.delete(k):collapsedSub.add(k); render(); return;}
 const sp=e.target.closest('.secsep');
 if(sp){setSection(sp,!sp.classList.contains('secclosed')); return;}
 const ch=e.target.closest('.chead');
 /* A heading in a single-card section has had its data-card and toggle removed
    and is not collapsible, so there is nothing to find and nothing to do. */
 if(ch){const card=ch.dataset.card&&document.getElementById(ch.dataset.card);
   if(!card) return;
   card.classList.toggle('closed');
   const t=ch.querySelector('.tg');
   if(t) t.innerHTML=card.classList.contains('closed')?'+':'\u2212';
   return;}
 const br=e.target.closest('tr.brow'); if(br&&br.dataset.nm){openBonus(decodeURIComponent(br.dataset.nm));return;}
 const td=e.target.closest('td.k'); if(td) openDD(td);
});
(function(){
 const bc=document.getElementById('wlByCount'), ba=document.getElementById('wlByAggr');
 if(!bc||!ba) return;
 const set=m=>{ wlMode=m;
  bc.setAttribute('aria-pressed',m==='count'); ba.setAttribute('aria-pressed',m==='aggr');
  buildWinLossViz(); };
 bc.onclick=()=>set('count'); ba.onclick=()=>set('aggr');
})();
document.getElementById('expAll').onclick=()=>{subSeeding=false;collapsed.clear();collapsedSub.clear();
 /* A section left folded would swallow tables the user just asked to see, and
    they would be expanded but invisible. Opening everything means everything. */
 document.querySelectorAll('.secsep.secclosed').forEach(s=>setSection(s,false));
 render();};
document.getElementById('colAll').onclick=()=>{subSeeding=false;D.rows.forEach(r=>collapsed.add(r.group));
 D.rows.forEach(r=>r.subs.forEach(sn=>collapsedSub.add(r.group+'|'+sn)));render();};
document.addEventListener('click',e=>{const th=e.target.closest('#t1 th.hs,#tseg th.hs,#tsegr th.hs,#tseggr th.hs,#tsegg th.hs,#tsegn th.hs,#tprod th.hs,#tpggr th.hs,#tprate th.hs,#t2 th.hs,#t3 th.hs,#tbet th.hs,#tcat th.hs,#tcatr th.hs'); if(!th)return;
 const sc=th.dataset.sc;
 if(sc==='null'){msortCol=null;} else {const v=+sc; if(msortCol===v) msortAsc=!msortAsc; else {msortCol=v; msortAsc=false;}}
 render();});
document.getElementById('ddSearch').oninput=ddRender;
function setDDMode(m){ ddMode=m;
 document.getElementById('ddmPlayers').setAttribute('aria-pressed',m==='players');
 document.getElementById('ddmBonuses').setAttribute('aria-pressed',m==='bonuses');
 sortKey='cost'; sortAsc=false; selPlayer=null; selBonus=null;
 document.getElementById('dd2').classList.remove('on');
 document.getElementById('ddSearch').value=''; ddRender();
}
document.getElementById('ddmPlayers').onclick=()=>setDDMode('players');
document.getElementById('ddmBonuses').onclick=()=>setDDMode('bonuses');
document.getElementById('ddClose').onclick=()=>{
 document.getElementById('dd').classList.remove('on');
 document.getElementById('dd2').classList.remove('on');
 document.querySelectorAll('td.sel,tr.bsel').forEach(x=>x.classList.remove('sel','bsel'));
 document.querySelectorAll('rect.dbar.sel').forEach(x=>x.classList.remove('sel'));
 ddCtx=null; selPlayer=null; selBonus=null;
 document.getElementById('bClear').style.display='none';};
function rawGS(name){let g=null,sub=null,multi=false;(NAMEBIDS[name]||new Set()).forEach(i=>{const m=D.bids[i];
 if(g===null){g=m[1];sub=m[2];}else if(g!==m[1]||sub!==m[2])multi=true;});
 return multi?['multiple','']:[g||'',(sub&&sub!=='Not in bonus list')?sub:''];}
document.getElementById('ddCsv').onclick=()=>{
 const q=document.getElementById('ddSearch').value.trim().toLowerCase();
 const esc2=s=>`"${String(s).replace(/"/g,'""')}"`;
 let csv, base;
 if(ddMode==='bonuses'&&ddCtx&&ddCtx.kind!=='bonus'){
   if(!ddBonusCache) ddBonusCache=bonusesForCell(ddCtx.key,ddCtx.mi);
   let rs=ddBonusCache; if(q) rs=rs.filter(r=>r.name.toLowerCase().includes(q));
   rs=rs.slice().sort((a,b)=>b.cost-a.cost);
   csv=[['bonus_name','bonus_id','group','subgroup','players','cost'].join(',')]
     .concat(rs.map(r=>{const gs=rawGS(r.name); return [esc2(r.name),esc2(bonusCode(r.name)),esc2(gs[0]),esc2(gs[1]),r.pl.size,r.cost.toFixed(2)].join(',');})).join('\n');
   base=(ddCtx.key==='__ALL__'?'all':ddCtx.key)+'-'+(ddCtx.mi<0?'total':D.labels[ddCtx.mi])+'-bonuses';
 } else {
   let rs=ddRows; if(q) rs=rs.filter(r=>D.players[r.p].some(f=>String(f).toLowerCase().includes(q)));
   rs=ddSort(rs);
   csv=[['player','country','segment','ftd_date','bonus_cost','adjusted_ggr','deposits'].join(',')]
    .concat(rs.map(r=>[esc2(D.players[r.p][0]),esc2(D.players[r.p][1]),esc2(D.players[r.p][2]),esc2((D.ftd&&D.ftd[r.p])||''),
      r.cost.toFixed(2),(r.aggr||0).toFixed(2),(r.dep||0).toFixed(2)].join(','))).join('\n');
   base=ddCtx.kind==='bonus'?('bonus-'+ddCtx.name):((ddCtx.key==='__ALL__'?'all':ddCtx.key)+'-'+(ddCtx.mi<0?'total':D.labels[ddCtx.mi]));
 }
 const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
 a.download=base.replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-+|-+$/g,'')+'.csv';
 a.click(); URL.revokeObjectURL(a.href);
};

function buildDailyChart(){
 const dl=D.dailyLast; if(!dl) return;
 const src=(seg==='ALL')?dl:((D.dailySeg&&D.dailySeg[seg])||dl);
 const days=dl.days, n=days.length;
 const cost=src[S], ggr=src[S+'_ggr']||[], aggr=src[S+'_aggr']||[];
 const dep=src[S+'_dep']||[], bet=src[S+'_bet']||[];
 const pct=days.map((d,i)=>aggr[i]>0?100*cost[i]/aggr[i]:null);
 /* Cumulative ratio: bonus cost to date over adjusted GGR to date, not the
    average of the daily ratios. Those are two different numbers and only this
    one is the month-to-date figure — a single loss-making day sends the daily
    bar to 428% or off the scale entirely, and averaging that in would carry
    the spike forward for the rest of the month. Running totals do not care.
    The last point equals the ratio quoted in the caption below the charts. */
 const cumPct=(()=>{ let c=0,a=0;
   return days.map((d,i)=>{ c+=cost[i]||0; a+=aggr[i]||0; return a>0?100*c/a:null; }); })();
 /* Running totals of the amounts themselves. These reach 6-13x the tallest
    daily bar by the end of the month, so they get their own axis on the right
    rather than squashing the bars into a strip along the bottom. */
 const runTot=arr=>{ let t=0; return arr.map(v=>{ t+=v||0; return t; }); };
 const cumAggr=runTot(aggr), cumDep=runTot(dep), cumCost=runTot(cost);
 const cumPctDep=(()=>{ let c=0,p=0;
   return days.map((d,i)=>{ c+=cost[i]||0; p+=dep[i]||0; return p>0?100*c/p:null; }); })();
 const cumPctBet=(()=>{ let c=0,b=0;
   return days.map((d,i)=>{ c+=cost[i]||0; b+=bet[i]||0; return b>0?100*c/b:null; }); })();
 const pctDep=days.map((d,i)=>(dep[i]>0?100*cost[i]/dep[i]:null));
 const pctBet=days.map((d,i)=>(bet[i]>0?100*cost[i]/bet[i]:null));
 const hasDep=dep.some(v=>v>0), hasBet=bet.some(v=>v>0);
 const money0=v=>(v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US');
 const kfmt=v=>{const a=Math.abs(v),s=v<0?'-':'';return a>=1000?s+'$'+Math.round(a/1000)+'k':s+'$'+Math.round(a);};
 /* Running totals reach millions where the daily bars are in thousands, and
    "$2206k" is a number you have to stop and count the digits of. */
 const mfmt=v=>{const a=Math.abs(v),s=v<0?'-':'';
   return a>=1e6?s+'$'+(a/1e6).toFixed(a>=1e7?0:1)+'M':a>=1000?s+'$'+Math.round(a/1000)+'k':s+'$'+Math.round(a);};
 const niceTop=m=>{if(m<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;};
 function barSVG(vals,o){
  /* A cumulative line on an amount chart needs its own scale — the running
     total ends 6-13x above the tallest daily bar, and sharing the axis would
     flatten every bar into a strip along the bottom. Room on the right is
     reserved for that second axis only when there is one. */
  const rightAxis=!!(o.line&&o.lineAxis==='right');
  /* Values sit in their own row along the bottom, above the day ticks, rather
     than floating over each bar. On a chart with a line through it the old
     placement put a number on top of the line at every peak. */
  /* The right margin is the same on every chart, whether or not it needs a
     second axis. Sizing it to the content made the three percentage charts
     40px wider than the three amount charts above them — same outer width,
     different plot width, so the bars for day 20 sat in different places on
     charts stacked directly on top of each other. Reserving the gutter
     unconditionally costs a little white space and keeps every column of the
     six charts on one vertical line. */
  const W=880,H=190,pl=56,pr=54,pt=22,pb=34,iw=W-pl-pr,ih=H-pt-pb, bw=iw/n;
  const clean=vals.map(v=>v===null?0:(o.cap?Math.min(v,o.cap):v));
  /* Build the axis from a step size rather than from the extremes, so that
     zero always lands on a tick.
     The old version divided [min,max] into four equal parts, which on a chart
     running -$124k to $97k produced -$200k -$125k -$50k $25k $100k — a zero
     line drawn across the plot with no label anywhere near it, and every
     number on the axis on the wrong side of it. Anchoring the ticks to
     multiples of the step means the zero line is always labelled $0. */
  const rawMax=Math.max(0,...clean), rawMin=Math.min(0,...clean);
  const niceStep=m=>{ if(m<=0) return 1;
    const p=Math.pow(10,Math.floor(Math.log10(m))), f=m/p;
    return ([1,1.5,2,2.5,3,4,5,6,8,10].find(x=>f<=x)||10)*p; };
  const step=niceStep((rawMax-rawMin)/4||Math.abs(rawMax)||1);
  const dmax=Math.max(step,Math.ceil(rawMax/step)*step);
  const dmin=rawMin<0?Math.floor(rawMin/step)*step:0;
  const y=v=>pt+ih*(dmax-v)/(dmax-dmin);
  let g=`<text x="${pl}" y="15" font-size="11.5" font-weight="650" fill="var(--text-primary)">${o.title}</text>`;
  /* Axis labels only — the horizontal gridlines behind the bars were removed.
     One per step, so zero gets a label of its own. */
  for(let gv=dmin;gv<=dmax+step/2;gv+=step){
    const val=Math.abs(gv)<step/1e6?0:gv;
    g+=`<text class="gll" x="${pl-6}" y="${(y(val)+3).toFixed(1)}" text-anchor="end">${o.fmt(val)}</text>`;}
  if(dmin<0){const zy=y(0);g+=`<line x1="${pl}" y1="${zy.toFixed(1)}" x2="${W-pr}" y2="${zy.toFixed(1)}" stroke="var(--axis)" stroke-width="1"/>`;}
  days.forEach((d,i)=>{const cx=pl+i*bw, v=vals[i];
    g+=`<rect x="${cx.toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" data-di="${i}" style="cursor:pointer"></rect>`;
    if(v===null){ g+=`<text x="${(cx+bw/2).toFixed(1)}" y="${(y(0)-3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--muted)">n/m</text>`; }
    else { const vc=o.cap?Math.min(v,o.cap):v, by=y(Math.max(0,vc)), by2=y(Math.min(0,vc));
      g+=`<rect class="dbar" data-di="${i}" x="${(cx+bw*0.2).toFixed(1)}" y="${by.toFixed(1)}" width="${(bw*0.6).toFixed(1)}" height="${Math.max(0,Math.abs(by2-by)).toFixed(1)}" rx="1.5" fill="${o.color}"><title>${dl.label} ${d} · ${o.tip(v)}</title></rect>`;
      /* A clipped bar and a bar exactly at the ceiling are the same shape, so
         say which is which: a chevron cut into the top means "taller than
         shown". The true figure is on the label below either way. */
      if(o.cap&&v>o.cap){ const mx=cx+bw/2;
        g+=`<path d="M ${(mx-3.4).toFixed(1)} ${(by+4.6).toFixed(1)} L ${mx.toFixed(1)} ${(by+1.4).toFixed(1)} L ${(mx+3.4).toFixed(1)} ${(by+4.6).toFixed(1)}" fill="none" stroke="var(--surface-1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`; }
      if(o.lab) g+=`<text x="${(cx+bw/2).toFixed(1)}" y="${H-20}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${o.labColor||o.color}">${o.lab(v)}</text>`;}
    g+=`<text class="axl daytick" data-di="${i}" x="${(cx+bw/2).toFixed(1)}" y="${H-6}" text-anchor="middle">${d}</text>`;});
  /* An optional running-total line over the bars. Drawn last so it sits on
     top, and clamped to the plotted range so a value above the cap bends the
     line to the ceiling rather than escaping the chart — the label still
     reports the true figure. */
  if(o.line){
   const LC=o.lineColor||'#A85410';
   /* Either the bars' own scale, or a second one drawn up the right edge. */
   /* A second scale for the line, pinned so its zero sits on the bars' zero.
      That pinning is the whole trick. An independent right axis puts the
      line's zero on the floor while the bars' zero is partway up the plot,
      which drew a $571k cumulative underneath a $97k bar — the chart said the
      opposite of the data. Sharing the zero means both series are measured
      from the same line and the shapes can be compared. */
   let ly=y;
   if(rightAxis){
    const lv=o.line.filter(v=>v!==null&&v!==undefined&&isFinite(v));
    const peak=Math.max(1e-9,Math.max(0,...lv)*1.06);
    const hi=(function(m){ const p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;
      return ([1,1.5,2,2.5,3,4,5,6,8,10].find(x=>f<=x)||10)*p; })(peak);
    const fz=dmin<0?dmax/(dmax-dmin):1;          // where zero sits, 0=top 1=bottom
    const lo=fz>0?hi*(fz-1)/fz:0;                // makes ly(0) land on y(0)
    ly=v=>pt+ih*(hi-v)/(hi-lo);
    const lfmt=o.lineFmt||o.fmt;
    for(let k=0;k<=2;k++){ const gv=hi*k/2;
      g+=`<text class="gll" x="${W-pr+7}" y="${(ly(gv)+3).toFixed(1)}" text-anchor="start" fill="${LC}">${lfmt(gv)}</text>`; }
   }
   const pts=[];
   o.line.forEach((v,i)=>{ if(v===null||v===undefined||!isFinite(v)) return;
     const vc=rightAxis?v:Math.max(dmin,Math.min(v,dmax));
     pts.push([pl+i*bw+bw/2, ly(vc), i, v]); });
   if(pts.length>1)
     g+=`<polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" `+
        `fill="none" stroke="${LC}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
   pts.forEach(p=>{ g+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.4" fill="${LC}">`+
     `<title>${dl.label} ${days[p[2]]} · ${o.lineTip?o.lineTip(p[3]):p[3]}</title></circle>`; });
   const last=pts[pts.length-1];
   if(last&&o.lineLab){
    /* Near the right edge there is no room for a trailing label, so flip it. */
    const flip=last[0]>W-pr-40;
    g+=`<text x="${(last[0]+(flip?-6:6)).toFixed(1)}" y="${(last[1]-6).toFixed(1)}" `+
       `text-anchor="${flip?'end':'start'}" font-size="9.5" font-weight="700" fill="${LC}">${o.lineLab(last[3])}</text>`;
   }
   if(o.legend)
    g+=`<text x="${W-pr}" y="15" text-anchor="end" font-size="9.5" fill="var(--muted)">`+
       `<tspan fill="${o.color}">&#9632;</tspan> daily  <tspan fill="${LC}">&#9644;</tspan> ${o.legend}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;margin-bottom:4px">${g}</svg>`;
 }
 /* Bars in a tint, the cumulative line in the strong version of the same hue.
    Every value is from theme.css, which check-theme.js gates on. */
 const CH={
  aggr:{bar:'#A3C5AB',line:'#0A5A30'},
  cost:{bar:'#A8BAC9',line:'#081E33'},
  dep :{bar:'#C0DD97',line:'#0B6E3A'},
  pAgg:{bar:'#F2C48E',line:'#A85410'},
  pDep:{bar:'#C6CED4',line:'#5B7285'},
  pBet:{bar:'#F1948A',line:'#C0392B'},
 };
 const sA=barSVG(aggr,{title:'Adjusted GGR',color:CH.aggr.bar,labColor:CH.aggr.line,fmt:kfmt,tip:v=>'Adjusted GGR '+money0(v),lab:kfmt,
   line:cumAggr, lineAxis:'right', lineColor:CH.aggr.line, lineFmt:mfmt, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+money0(v)+' to date', lineLab:mfmt});
 const sC=barSVG(cost,{title:'Bonus cost',color:CH.cost.bar,labColor:CH.cost.line,fmt:kfmt,tip:v=>'Bonus cost '+money0(v),lab:kfmt,
   line:cumCost, lineAxis:'right', lineColor:CH.cost.line, lineFmt:mfmt, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+money0(v)+' to date', lineLab:mfmt});
 const sDep=hasDep?barSVG(dep,{title:'Deposits',color:CH.dep.bar,labColor:CH.dep.line,fmt:kfmt,tip:v=>'Deposits '+money0(v),lab:kfmt,
   line:cumDep, lineAxis:'right', lineColor:CH.dep.line, lineFmt:mfmt, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+money0(v)+' to date', lineLab:mfmt}):'';

 /* ---------- one chart for the running totals ----------
  *
  * The three amounts used to carry their own cumulative line on a second axis.
  * That does not work: the bars run through negative numbers so their zero sits
  * partway down the plot, while a running total starts at zero on the floor.
  * Two zeros at two heights in one frame drew a $571k line beneath a $97k bar.
  * Here every series starts at zero on the same axis and nothing is stacked or
  * rescaled, so the lines can be read against each other directly.
  */
 function lineSVG(series,o){
  const W=880,H=210,pl=64,pr=64,pt=26,pb=22,iw=W-pl-pr,ih=H-pt-pb,bw=iw/n;
  /* niceTop only steps 1, 2, 5, 10, which rounds $2.4M up to $5M and leaves the
     tallest line halfway down an empty chart. Finer steps here. */
  const niceTop2=m=>{ if(m<=0) return 1;
    const p=Math.pow(10,Math.floor(Math.log10(m))), f=m/p;
    const s=[1,1.5,2,2.5,3,4,5,6,8,10].find(x=>f<=x)||10;
    return s*p; };
  const all=[].concat(...series.map(s=>s.vals.filter(v=>isFinite(v))));
  const hiR=Math.max(0,...all), loR=Math.min(0,...all);
  const hi=niceTop2(Math.max(1e-9,hiR*1.06)), lo=loR<0?-niceTop2(-loR*1.06):0;
  const yy=v=>pt+ih*(hi-v)/(hi-lo);
  let g=`<text x="${pl}" y="16" font-size="11.5" font-weight="650" fill="var(--text-primary)">${o.title}</text>`;
  for(let k=0;k<=4;k++){ const gv=lo+(hi-lo)*k/4, gy=yy(gv);
    g+=`<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    g+=`<text class="gll" x="${pl-6}" y="${(gy+3).toFixed(1)}" text-anchor="end">${o.fmt(gv)}</text>`; }
  if(lo<0){ const zy=yy(0);
    g+=`<line x1="${pl}" y1="${zy.toFixed(1)}" x2="${W-pr}" y2="${zy.toFixed(1)}" stroke="var(--axis)" stroke-width="1.25"/>`; }
  /* Legend, top right. */
  let lx=W-pr;
  [...series].reverse().forEach(s=>{
    const w=s.name.length*5.6+16;
    lx-=w;
    g+=`<text x="${(lx+12).toFixed(1)}" y="16" font-size="9.5" fill="var(--muted)">${esc(s.name)}</text>`+
       `<rect x="${lx.toFixed(1)}" y="10" width="7" height="7" rx="1.5" fill="${s.color}"/>`;
  });
  days.forEach((d,i)=>{ const cx=pl+i*bw;
    g+=`<rect x="${cx.toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" data-di="${i}" style="cursor:pointer"></rect>`;
    g+=`<text class="axl daytick" data-di="${i}" x="${(cx+bw/2).toFixed(1)}" y="${H-6}" text-anchor="middle">${d}</text>`; });
  series.forEach(s=>{
    const pts=s.vals.map((v,i)=>[pl+i*bw+bw/2, yy(v)]).filter((_,i)=>isFinite(s.vals[i]));
    if(pts.length>1)
      g+=`<polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p,i)=>{ g+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.3" fill="${s.color}">`+
      `<title>${dl.label} ${days[i]} · ${s.name} ${money0(s.vals[i])} to date</title></circle>`; });
    const last=pts[pts.length-1];
    if(last) g+=`<text x="${(last[0]+7).toFixed(1)}" y="${(last[1]+3).toFixed(1)}" font-size="10" font-weight="700" fill="${s.color}">${o.fmt(s.vals[s.vals.length-1])}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;margin-bottom:4px">${g}</svg>`;
 }

 const sCum=lineSVG([
   {name:'Deposits',    vals:cumDep,  color:'#4E9D5C'},
   {name:'Adjusted GGR',vals:cumAggr, color:'#0B6E3A'},
   {name:'Bonus cost',  vals:cumCost, color:'#0F2A43'},
 ],{title:'Cumulative to date',fmt:mfmt});
 const sP=barSVG(pct,{title:'Bonus cost / adjusted GGR',color:CH.pAgg.bar,labColor:CH.pAgg.line,fmt:v=>Math.round(v)+'%',tip:v=>v.toFixed(1)+'% of adj GGR',lab:v=>Math.round(v)+'%',cap:100,
   line:cumPct, lineAxis:'right', lineColor:CH.pAgg.line, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+v.toFixed(1)+'% of adj GGR to date',
   lineLab:v=>v.toFixed(1)+'%'});
 const sD=hasDep?barSVG(pctDep,{title:'Bonus cost / deposits',color:CH.pDep.bar,labColor:CH.pDep.line,fmt:v=>Math.round(v)+'%',tip:v=>v.toFixed(1)+'% of deposits',lab:v=>v.toFixed(1)+'%',cap:100,
   line:cumPctDep, lineAxis:'right', lineColor:CH.pDep.line, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+v.toFixed(1)+'% of deposits to date',
   lineLab:v=>v.toFixed(1)+'%'}):'';
 const sB=hasBet?barSVG(pctBet,{title:'Bonus cost / bet amount',color:CH.pBet.bar,labColor:CH.pBet.line,fmt:v=>v.toFixed(1)+'%',tip:v=>v.toFixed(2)+'% of bet',lab:v=>v.toFixed(2)+'%',cap:100,
   line:cumPctBet, lineAxis:'right', lineColor:CH.pBet.line, legend:'cumulative (right)',
   lineTip:v=>'cumulative '+v.toFixed(2)+'% of bet to date',
   lineLab:v=>v.toFixed(2)+'%'}):'';
 document.getElementById('chart').innerHTML=sA+sC+sDep+sP+sD+sB;
}
/* ---------- render ---------- */
function render(){
 buildDailyChart();
 buildTable('t1','cost');
 buildUserTable('tut','cost');
 buildUserTable('tutr','rate');
 buildUserTable('tuts','share');
 buildUserNote();
 buildSegTable('tseg','cost');
 buildSegRateTable('tsegr','segAggr','Segment adjusted GGR');
 buildSegShareTotal('tseggr');
 buildSegGGR('tsegg');
 buildSegDep('tsegpp','perplayer');
 buildSegDep('tsegdep','dep');
 buildSegDep('tsegdepshare','depshare');
 buildSegDep('tsegshare','share');
 buildSegCount('tsegn');
 buildProdSplit('tprod');
 buildProdGGR('tpggr');
 buildProdRate('tprate');
 buildTable('t2','rate');
 buildTable('t3','count');
 buildTable('tbet','betrate');
 buildMatrix('tmxp','players');
 buildMatrix('tmxc','cost');
 buildFtd('tftdn','count');
 buildFtd('tftdc','cost');
 buildFtd('tftda','aggr');
 buildFtd('tftdr','rate');
 buildFtdLife('tlifec','cost');
 buildFtdRet('tlifen');
 buildFtdLife('tlifea','aggr');
 buildFtdLife('tlifer','rate');
 buildCatTable('tcat','cost');
 buildCatTable('tcatr','rate');
 buildWinLossViz();
 const inc=S==='with';
 const pnote=seg==='ALL'?'':'Segment: '+SEGS[+seg]+'. ';
 const mnote=mtdOn?'MTD (days 1&ndash;'+D.mtdDay+' of each month). ':'';
/* If the build could not read the bonus sheet it categorised against the
    cached copy, and anything added to the sheet since will sit in "Unmapped".
    That is invisible in the numbers, so say it on the page. */
 (function(){
  /* A month that fell back to its cache is not visibly different in the
     numbers, so it has to be said on the page. */
  const sm=(D.staleMonths||[]);
  if(sm.length){
   const b2=document.getElementById('groupwarnbox');
   if(b2){
    document.getElementById('groupwarn').innerHTML=
     '<b>Some months are not up to date.</b> '+
     sm.map(m=>esc(m.ym)+' (from a '+m.age+'-day-old copy)').join(', ')+
     ' \u2014 Redash could not be re-read for those months, so they show as of the cached date.';
    b2.style.display='';
    return;
   }
  }
  const gm=D.groupsMeta, box=document.getElementById('groupwarnbox');
  if(!box) return;
  if(!gm||!gm.stale){ box.style.display='none'; return; }
  const when=gm.generated?new Date(gm.generated):null;
  const ageH=when?Math.round((Date.now()-when)/3600000):null;
  document.getElementById('groupwarn').innerHTML=
   '<b>Bonus categorisation is stale.</b> This build could not read the Google Drive sheet'+
   (gm.reason?' ('+esc(gm.reason.split("\n")[0])+')':'')+
   ', so it used the cached copy'+
   (when?' from '+when.toLocaleString()+(ageH!==null?' — '+ageH+'h old':''):'')+
   '. Bonuses added to the sheet since then appear under <b>Unmapped</b>.';
  box.style.display='';
 })();
 document.getElementById('augwarn').innerHTML=mtdOn
  ?'MTD &mdash; all months trimmed to days 1&ndash;'+D.mtdDay+'.'
  :'August partial &mdash; 1&ndash;'+D.mtdDay+' Aug only.';
  document.getElementById('note').innerHTML=
  'Bonus cost, GGR and adjusted GGR summed from the <code>bonus_cost</code>, <code>ggr</code> and <code>adjusted_ggr</code> columns of the 9 monthly extracts in the 2026 folder '+
  `(${V().nrows.toLocaleString('en-US')} rows; July uses the updated <code>July New 6.0.csv</code>), mapped to groups by joining <code>bonus_id</code> to Bonus List With Groups.xlsx. `+
  ((()=>{const gAll=sum(D.data['with'].total),un=D.data['with'].g['Unmapped']?sum(D.data['with'].g['Unmapped']['_']):0;return `${(100*(gAll-un)/gAll).toFixed(2)}% of cost maps to a group; the remaining $${Math.round(un).toLocaleString('en-US')} sits in <b>Unmapped</b> (bonus IDs absent from the list, or rows with no bonus ID). `;})())+
  'n/m = not meaningful (adjusted GGR zero or negative). * August covers 1&ndash;'+D.mtdDay+' Aug only.';
 if(ddCtx){
  if(ddCtx.kind==='bonus'){ openBonus(ddCtx.name); }
  else if(ddCtx.kind==='day'){ openDayDD(ddCtx.di); }
  else { const td=document.querySelector(`td.k[data-key="${CSS.escape(ddCtx.key)}"][data-m="${ddCtx.mi}"]`);
   if(td) openDD(td); else document.getElementById('dd').classList.remove('on'); }
 }
}
const a=document.getElementById('bWith'),b=document.getElementById('bWithout');
a.onclick=()=>{S='with';a.setAttribute('aria-pressed','true');b.setAttribute('aria-pressed','false');render()};
b.onclick=()=>{S='without';b.setAttribute('aria-pressed','true');a.setAttribute('aria-pressed','false');render()};
function clearSelection(){
 document.querySelectorAll('td.sel').forEach(x=>x.classList.remove('sel'));
 document.querySelectorAll('tr.bsel').forEach(x=>x.classList.remove('bsel'));
 document.querySelectorAll('rect.dbar.sel').forEach(x=>x.classList.remove('sel'));
 document.querySelectorAll('#ddt tbody tr.psel').forEach(x=>x.classList.remove('psel'));
 document.getElementById('dd').classList.remove('on');
 document.getElementById('dd2').classList.remove('on');
 ddCtx=null; selPlayer=null; selBonus=null;
 document.getElementById('bClear').style.display='none';
}
document.getElementById('bClear').onclick=clearSelection;
(function(){const sel=document.getElementById('segSel');
 let o='<option value="ALL">All segments</option>';
 SEGS.forEach((lbl,i)=>{ if(D.dataS[String(i)]&&sum(D.dataS[String(i)]['with'].total)>0.5) o+=`<option value="${i}">${esc(lbl)}</option>`; });
 sel.innerHTML=o;
 sel.onchange=()=>{seg=sel.value; clearSelection(); render();};
})();
const bf=document.getElementById('bFull'), bm=document.getElementById('bMtd');
function setMtd(on){mtdOn=on; bf.setAttribute('aria-pressed',!on); bm.setAttribute('aria-pressed',on); clearSelection(); render();}
bf.onclick=()=>setMtd(false); bm.onclick=()=>setMtd(true);
document.getElementById('chart').addEventListener('click',e=>{const el=e.target.closest('[data-di]'); if(el) openDayDD(+el.dataset.di);});
document.querySelector('.sub').innerHTML='Bonus cost by group, segment, product &amp; keyword &middot; Jan 1 &ndash; Aug '+D.mtdDay+' 2026 &middot; USD';
render();
/* Everything starts collapsed, the daily chart included, so the page opens as a
   list of headings rather than a wall of tables. Same as the other reports. */
document.querySelectorAll('.card').forEach(c=>{c.classList.add('closed');
 const t=c.querySelector('.chead .tg'); if(t)t.innerHTML='+';});

/**
 * The section bands fold too, not just the cards under them.
 *
 * With every card collapsed the page is already a list of headings — but it is
 * a list of twenty-odd headings, and finding "Player win / loss" still means
 * scrolling past all of them. Folding a whole section takes that to seven lines
 * you can see at once.
 *
 * The membership of a section is not marked up anywhere: a band is a sibling of
 * the cards that follow it, and the section ends wherever the next band starts.
 * So it is read off the DOM here rather than hard-coded, which means a card
 * added to report.html joins the right section on its own, with nothing to keep
 * in step.
 */
function setSection(sep,closed){
 sep.classList.toggle('secclosed',closed);
 sep.setAttribute('aria-expanded',String(!closed));
 const t=sep.querySelector('.tg'); if(t)t.innerHTML=closed?'+':'−';
 (sep._cards||[]).forEach(c=>{c.style.display=closed?'none':'';});
}
document.querySelectorAll('.secsep').forEach(sep=>{
 /* Everything up to the next band, not only the cards. A section note or a
    stray paragraph left visible under a folded heading looks like a bug, and
    "fold the section" should mean the section.
    The exception is anything marked data-page-note: the click hint after the
    last card belongs to the page, not to Player win / loss, and folding that
    section should not take the page's instructions with it. */
 const cards=[];
 for(let n=sep.nextElementSibling;n&&!n.classList.contains('secsep');n=n.nextElementSibling){
  if(n.hasAttribute('data-page-note')) continue;
  /* The drill-down is a fixed overlay that happens to live at the end of the
     document, so the last section would otherwise adopt it and fold it away.
     display:none set inline then beats #dd.on, and clicking a cell silently
     does nothing. Excluded by id as well as by the marker, so adding another
     element down there cannot bring the bug back. */
  if(n.id==='dd'||n.id==='dd2') continue;
  cards.push(n);
 }
 sep._cards=cards;
 sep.setAttribute('role','button');
 sep.setAttribute('tabindex','0');
 sep.setAttribute('aria-expanded','true');
 const t=document.createElement('span');
 t.className='tg'; t.innerHTML='−';
 sep.insertBefore(t,sep.firstChild);
 /* Space would otherwise scroll the page out from under the band you just
    focused, which is worse than doing nothing. */
 sep.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ') return;
  e.preventDefault(); setSection(sep,!sep.classList.contains('secclosed'));
 });
});
/* Open on the list of sections rather than the whole report. The cards inside
   are already collapsed, so an expanded section was a column of empty headings
   - the page opened on two screens of nothing much. Folded, the nine bands fit
   at once and you pick where to go.
   Done after the loop above, so every band has its cards and toggle first. */
/* A section holding one card asks for two clicks to reach one thing, and the
   band and the card heading say much the same. So in that case the card is
   left permanently open and its own toggle removed: opening the band shows the
   content straight away. The heading stays, since it carries the month. */
document.querySelectorAll('.secsep').forEach(sep=>{
 const cards=(sep._cards||[]).filter(c=>c.classList&&c.classList.contains('card'));
 if(cards.length!==1) return;
 const card=cards[0];
 card.classList.remove('closed');
 const head=card.querySelector('.chead');
 if(head){
  head.style.cursor='default';
  head.removeAttribute('data-card');          // the click handler keys off this
  const t=head.querySelector('.tg');
  if(t) t.remove();
 }
});
document.querySelectorAll('.secsep').forEach(sep=>setSection(sep,true));

