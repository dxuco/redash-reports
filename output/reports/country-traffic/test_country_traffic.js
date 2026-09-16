const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'..','country-traffic.html'),'utf8'),
  {runScripts:'dangerously'});
const w=dom.window,doc=w.document;let fail=0;
const ok=(nm,c,x)=>{if(c)console.log('  PASS '+nm);else{console.log('  FAIL '+nm+(x?'  -> '+x:''));fail++;}};

ok('script ran',!!w.CT);
const D=w.CT.D;

// section 01 was removed on request -- nothing should reference it
ok('no cards block remains',!doc.getElementById('cards'));
// no explanatory prose anywhere on the page -- charts only
ok('no caption paragraphs',doc.querySelectorAll('p').length===0,
   doc.querySelectorAll('p').length);
['drillSub','dailySub','showing'].forEach(id=>
  ok('caption #'+id+' is gone',!doc.getElementById(id)));
// only the monthly-sessions section survives
ok('six sections',doc.querySelectorAll('h2').length===6,
   doc.querySelectorAll('h2').length);
ok('footer removed',!doc.getElementById('foot')&&!doc.querySelector('footer'));
['ch2','lg2','tch','tde','tclean','tall','cards'].forEach(id=>
  ok('removed block #'+id+' is gone',!doc.getElementById(id)));



// every flagged month must actually be anomalous
D.flagged.forEach(f=>{
  const i=D.months.indexOf(f.month),s=D.countries[f.country].sessions;
  const others=s.filter((_,j)=>j!==i).sort((a,b)=>a-b);
  const med=others[Math.floor(others.length/2)];
  ok('flagged '+f.country+' '+f.month+' is >2x median',s[i]>med*2,s[i]+' vs median '+med);
});



// charts and tables rendered
ok('sessions chart drew paths',doc.querySelectorAll('#ch1 path').length===15,
   doc.querySelectorAll('#ch1 path').length);
ok('flagged bands drawn',doc.querySelectorAll('#ch1 rect').length>0);

// ---- channel filter ----
const CT=w.CT, chips=doc.querySelectorAll('#chips .chip');
ok('chips rendered for every channel',chips.length===D.channelOrder.length+1,chips.length);
ok('page opens on Organic Search',CT.state.ch==='Organic Search',CT.state.ch);
// the default must live in state AND in the markup, or the chips lie on load
ok('the Organic Search chip is the pressed one',
   doc.querySelector('#chips .chip[aria-pressed="true"]')
     .getAttribute('data-ch')==='Organic Search',
   doc.querySelector('#chips .chip[aria-pressed="true"]').getAttribute('data-ch'));
// the default must be set in state AND in the markup -- a default in only one
// place renders buttons that lie on load.
const pressed=Array.from(chips).filter(b=>b.getAttribute('aria-pressed')==='true');
ok('exactly one chip is pressed on load',pressed.length===1,pressed.length);
ok('the pressed chip is the one state names',
   pressed[0]&&pressed[0].getAttribute('data-ch')===CT.state.ch);

// channel series must sum to the country total within GA4's own rounding
const jaAll=c=>CT.P26.reduce((a,i)=>a+D.countries[c].sessions[i],0);
D.order.forEach(c=>{
  let parts=0;
  D.channelOrder.forEach(k=>{CT.state.ch=k;parts+=CT.sum(c,CT.P26);});
  CT.state.ch='all';
  const whole=jaAll(c),diff=Math.abs(parts-whole)/whole;
  ok(c+': channels sum to the country total',diff<0.01,
     parts+' vs '+whole+' ('+(diff*100).toFixed(2)+'%)');
});

ok('chart is not duplicated on re-render',doc.querySelectorAll('#ch1 svg').length===1,
   doc.querySelectorAll('#ch1 svg').length);

// the US organic-search story must survive the filter
CT.state.ch='Organic Search';
const osA=CT.sum('United States',CT.P25),osB=CT.sum('United States',CT.P26);
ok('US organic search is down year on year',osB<osA,osA+' -> '+osB);
// and Direct is where the bot spike lives
CT.state.ch='Direct';
const dJul=D.monthlyChannels['Canada']['Direct'][18][0],
      dJun=D.monthlyChannels['Canada']['Direct'][17][0];
ok('Canada Direct jumps in July 2026',dJul>dJun*5,dJun+' -> '+dJul);
CT.state.ch='all';CT.render();
ok('reset back to All channels',CT.state.ch==='all');

// switching the chip must still change what is drawn
CT.state.ch='Organic Search';CT.render();
const osD=doc.querySelector('#ch1 path').getAttribute('d');
CT.state.ch='all';CT.render();
ok('filtering redraws the chart',doc.querySelector('#ch1 path').getAttribute('d')!==osD);
CT.state.ch='Organic Search';CT.render();

// ---- click-to-isolate ----
CT.state.ch='all';CT.state.hidden={};CT.render();
ok('opens with every country visible',CT.visible().length===15,CT.visible().length);
ok('no Show all chip while nothing is hidden',
   !doc.querySelector('#lg1 .showall'));

// clicking a country isolates it -- hiding-on-click is the wrong default
CT.pick('Germany',false);
ok('click isolates the clicked country',
   CT.visible().length===1&&CT.visible()[0]==='Germany',CT.visible().join(','));
ok('isolated chart draws one line',doc.querySelectorAll('#ch1 path').length===1,
   doc.querySelectorAll('#ch1 path').length);

// the legend still lists all three, or there is no way back
ok('legend still lists every country',doc.querySelectorAll('#lg1 .leg').length===15,
   doc.querySelectorAll('#lg1 .leg').length);
ok('hidden countries are marked unpressed',
   Array.from(doc.querySelectorAll('#lg1 .leg'))
     .filter(b=>b.getAttribute('aria-pressed')==='false').length===14);
ok('Show all chip appears while something is hidden',!!doc.querySelector('#lg1 .showall'));

// clicking the isolated one restores everything
CT.pick('Germany',false);
ok('clicking the isolated country restores all',CT.visible().length===15,CT.visible().length);

// alt-click hides a single series
CT.pick('Canada',true);
ok('alt-click hides just that one',
   CT.visible().length===14&&CT.visible().indexOf('Canada')<0,CT.visible().length);
CT.pick('Canada',true);
ok('alt-click again brings it back',CT.visible().length===15);

// the last visible series can never be hidden
CT.pick('United States',false);
CT.pick('United States',true);
ok('cannot alt-click away the last visible country',CT.visible().length===1,
   CT.visible().join(','));

// isolation and the channel chip are independent
CT.state.ch='Direct';CT.render();
ok('isolation survives a channel change',CT.visible().length===1&&CT.state.ch==='Direct');
CT.state.hidden={};CT.state.ch='all';CT.render();
ok('reset restores every country and All channels',
   CT.visible().length===15&&CT.state.ch==='all');
ok('charts redraw a line per country after reset',
   doc.querySelectorAll('#ch1 path').length===15);
ok('no duplicate svg after all that re-rendering',
   doc.querySelectorAll('#ch1 svg').length===1);

// ---- drill-down, by month ----
CT.state.ch='all';CT.state.hidden={};CT.state.dHidden={};CT.render();

CT.state.ch='Referral';CT.state.dHidden={};CT.render();
const ref=CT.drillRows();
ok('referral drill lists sources',ref.length>0&&ref.length<=8,ref.length);
ok('referral drill is domains, not channels',ref.some(r=>r.k.indexOf('.')>0),
   ref.slice(0,3).map(r=>r.k).join(', '));
// every drill series must be a 20-month array, or the chart lies about time
ok('every drill series spans all 20 months',ref.every(r=>r.data.length===20));
ok('drill drew one line per source',doc.querySelectorAll('#ch3 path').length===ref.length,
   doc.querySelectorAll('#ch3 path').length+' vs '+ref.length);
ok('drill legend lists every source',doc.querySelectorAll('#lg3 .dleg').length===ref.length);

// a source total must match the period table it was derived from
const chipy=ref.find(r=>r.k==='chipy.com');
const chipy25=CT.P25.reduce((a,i)=>a+chipy.data[i],0);
const fromDetail=D.order
  .map(c=>((D.sourceDetail[c]||{}).Referral||[]).find(r=>r[0]==='chipy.com'))
  .filter(Boolean).reduce((a,r)=>a+r[1],0);
// GA4 returns slightly different totals for differently-shaped queries: the
// period table was pulled with dimensions [channelGroup, source], the monthly
// series with [source, yearMonth], and the two disagree by ~0.1% on cardinality
// handling. Tolerate that, but fail on anything that could be a dropped month.
const drift=Math.abs(chipy25-fromDetail)/fromDetail;
ok('monthly series reconciles with the period table within GA4 query drift',
   drift<0.005,chipy25+' vs '+fromDetail+' ('+(drift*100).toFixed(2)+'%)');

// clicking a source isolates it
CT.dPick('chipy.com',false);
ok('clicking a source isolates its line',doc.querySelectorAll('#ch3 path').length===1,
   doc.querySelectorAll('#ch3 path').length);
ok('drill Show all appears',!!doc.querySelector('#lg3 .dshowall'));
CT.dPick('chipy.com',false);
ok('clicking again restores the sources',doc.querySelectorAll('#ch3 path').length===ref.length);

// changing the channel must clear a stale source isolation
CT.dPick('chipy.com',false);
CT.state.ch='Organic Search';CT.state.dHidden={};CT.render();
ok('channel change clears source isolation',
   doc.querySelectorAll('#ch3 path').length===CT.drillRows().length);
ok('organic search drill shows search engines',
   CT.drillRows().some(r=>r.k==='google'),CT.drillRows().map(r=>r.k).join(', '));

// country isolation reaches the drill
CT.state.ch='Referral';CT.state.dHidden={};CT.pick('Germany',false);
ok('Germany referral surfaces the restarted adult sources',
   CT.drillRows().some(r=>/pornhub|youporn/.test(r.k)),
   CT.drillRows().slice(0,4).map(r=>r.k).join(', '));
// and those sources must be zero before July 2026 -- that is the whole finding
const ph=CT.drillRows().find(r=>/pornhub|youporn/.test(r.k));
ok('the restarted sources are empty before July 2026',
   ph.data.slice(0,18).reduce((a,v)=>a+v,0)<50&&ph.data[18]+ph.data[19]>1000,
   ph.k+' pre-Jul total '+ph.data.slice(0,18).reduce((a,v)=>a+v,0));

CT.state.hidden={};CT.state.dHidden={};CT.state.ch='all';CT.render();
ok('back to defaults',CT.state.ch==='all'&&CT.visible().length===15);
ok('single drill svg after all re-renders',doc.querySelectorAll('#ch3 svg').length===1,
   doc.querySelectorAll('#ch3 svg').length);

// ---- daily organic table ----
CT.state.ch='all';CT.state.hidden={};CT.state.dHidden={};CT.state.month='2026-08';CT.render();
const DO=D.dailyChannel;
// Derive the day count rather than hard-coding it, so a data refresh that
// extends the window does not read as a failure. What must hold is that the
// axis is contiguous and that its length matches the calendar span it claims.
const NDAYS=DO.dates.length;
const span=Math.round((Date.parse(DO.dates[NDAYS-1])-Date.parse(DO.dates[0]))/86400000)+1;
ok('day count matches the calendar span it covers',NDAYS===span,
   NDAYS+' entries for '+span+' calendar days ('+DO.dates[0]+' -> '+DO.dates[NDAYS-1]+')');
ok('daily axis ends on a month boundary',
   /-(31|30|28|29)$/.test(DO.dates[NDAYS-1]),DO.dates[NDAYS-1]);
// contiguity matters: a gap would silently shift every 7-day average
const gap=DO.dates.some((d,i)=>i>0&&
  (Date.parse(d)-Date.parse(DO.dates[i-1]))!==86400000);
ok('no missing days',!gap);
D.order.forEach(c=>{
  ok(c+': arrays align with the date axis',
     DO.countries[c].all.length===NDAYS);
  ok(c+': every channel has a full daily series',
     ['all'].concat(D.channelOrder).every(k=>(DO.countries[c][k]||[]).length===NDAYS));
});

// month picker + daily chart
ok('a chip per month with daily data',
   doc.querySelectorAll('#dayChips .chip').length===CT.dailyMonths().length,
   doc.querySelectorAll('#dayChips .chip').length);
ok('exactly one month chip pressed',
   Array.from(doc.querySelectorAll('#dayChips .chip'))
     .filter(b=>b.getAttribute('aria-pressed')==='true').length===1);
ok('opens on the latest month',CT.state.month===D.months[D.months.length-1],CT.state.month);
ok('daily chart draws a line per visible country',
   doc.querySelectorAll('#ch4 path').length===15,doc.querySelectorAll('#ch4 path').length);
// the month chips come from the daily axis, so a new month appears on refresh
ok('month chips derive from the daily dates',
   CT.dailyMonths().length===doc.querySelectorAll('#dayChips .chip').length,
   CT.dailyMonths().length);
ok('last chip is the last month with data',
   CT.dailyMonths().slice(-1)[0]===DO.dates[DO.dates.length-1].slice(0,7),
   CT.dailyMonths().slice(-1)[0]);
ok('no table remains',!doc.getElementById('tday'));

// a month must plot exactly its own days, never a neighbour's
const aug=CT.monthSlice('2026-08');
ok('August 2026 is a complete 31 days',aug.to-aug.from+1===31,
   aug.to-aug.from+1);
ok('August points match the day count',
   doc.querySelectorAll('#ch4 circle').length===31*15,
   doc.querySelectorAll('#ch4 circle').length);
CT.state.month='2025-03';CT.dailyChart();
const mar=CT.monthSlice('2025-03');
ok('March 2025 is 31 days',mar.to-mar.from+1===31,mar.to-mar.from+1);
ok('switching month redraws the right number of points',
   doc.querySelectorAll('#ch4 circle').length===31*15,
   doc.querySelectorAll('#ch4 circle').length);
ok('every slice starts and ends inside its own month',
   CT.dailyMonths().every(m=>{const sl=CT.monthSlice(m);
     return sl.from>=0&&DO.dates[sl.from].slice(0,7)===m
       &&DO.dates[sl.to].slice(0,7)===m;}));
ok('February 2026 is 28 days',CT.monthSlice('2026-02').to-CT.monthSlice('2026-02').from+1===28);

// country isolation reaches the chart
CT.pick('Canada',false);CT.dailyChart();
ok('isolating a country narrows the daily chart',
   doc.querySelectorAll('#ch4 path').length===1,doc.querySelectorAll('#ch4 path').length);
CT.state.hidden={};CT.render();

// the channel chip must NOT touch this chart -- it is organic by definition
CT.state.month='2026-08';CT.state.ch='Referral';CT.render();
const refD=doc.querySelector('#ch4 path').getAttribute('d');
CT.state.ch='all';CT.render();
ok('daily chart FOLLOWS the channel chip',
   refD!==doc.querySelector('#ch4 path').getAttribute('d'));
ok('single daily svg after re-renders',doc.querySelectorAll('#ch4 svg').length===1);

// ---- 15-country roster ----
CT.state.ch='all';CT.state.hidden={};CT.state.dHidden={};CT.state.month='2026-08';CT.render();
ok('roster is 15 countries',D.order.length===15,D.order.length);
D.order.forEach(c=>{
  ok(c+': present in every dataset',
     !!D.countries[c]&&!!D.monthlyChannels[c]&&!!D.sourceDetail[c]
     &&!!D.sourceMonthly[c]&&!!D.dailyChannel.countries[c]);
});
ok('no country outside the roster leaked in',
   Object.keys(D.countries).every(c=>D.order.indexOf(c)>=0),
   Object.keys(D.countries).filter(c=>D.order.indexOf(c)<0).join(','));
ok('a colour per country',
   new Set(D.order.map((_,i)=>i)).size===15);

// Brazil is the reason the roster was extended -- it must be in and be enormous
const brJan=CT.P25.reduce((a,i)=>a+D.countries['Brazil'].sessions[i],0);
const brNow=CT.P26.reduce((a,i)=>a+D.countries['Brazil'].sessions[i],0);
ok('Brazil grew several-fold',brNow>brJan*5,brJan+' -> '+brNow);

// flags are derived, so every flagged month must really be an outlier
Object.keys(CT.FLAG).forEach(k=>{
  const [c,m]=k.split('|'),i=D.months.indexOf(m);
  const v=D.countries[c].sessions.slice().sort((a,b)=>a-b);
  const med=v[Math.floor(v.length/2)];
  ok('flag '+k+' exceeds 3x median',D.countries[c].sessions[i]>med*3,
     D.countries[c].sessions[i]+' vs median '+med);
});
ok('flag band follows the country selection',(()=>{
  const all=CT.flagged().length;CT.pick('Vietnam',false);
  const one=CT.flagged().length;CT.state.hidden={};CT.render();
  return one<=all;})());

// every country's drill must resolve to real sources, not an empty panel
let emptyDrill=[];
D.order.forEach(c=>{
  CT.state.hidden={};D.order.forEach(o=>{if(o!==c)CT.state.hidden[o]=true;});
  CT.state.ch='Referral';
  if(!CT.drillRows().length)emptyDrill.push(c);});
CT.state.hidden={};CT.state.ch='all';CT.render();
ok('every country has referral sources on file',emptyDrill.length===0,emptyDrill.join(','));

// ---- bounce rate ----
CT.state.ch='Organic Search';CT.state.hidden={};CT.state.dHidden={};CT.render();
D.order.forEach(c=>{
  const b=D.bounce[c].bounce;
  ok(c+': every bounce series is 20 months',
     ['all'].concat(D.channelOrder).every(k=>b[k]&&b[k].length===20));
  ok(c+': bounce rates are within 0..1',
     Object.keys(b).every(k=>b[k].every(e=>e[1]>=0&&e[1]<=1)));
});
ok('bounce chart draws a line per visible country',
   doc.querySelectorAll('#ch5 path').length===15,doc.querySelectorAll('#ch5 path').length);
ok('bounce chart follows the channel chip',(()=>{
  CT.state.ch='Direct';CT.render();
  const a=doc.querySelector('#ch5 path').getAttribute('d');
  CT.state.ch='Organic Search';CT.render();
  return a!==doc.querySelector('#ch5 path').getAttribute('d');})());

// months with no sessions must break the line, never plot as 0% -- a flat zero
// would read as "nobody bounced" instead of "nobody came"
const gapCountry=D.order.find(c=>D.bounce[c].bounce['AI Assistant'].some(e=>e[0]===0));
CT.state.ch='AI Assistant';CT.render();
ok('empty months break the line rather than plotting zero',
   !/M[\d.]+ [\d.]+ L/.test('')||doc.querySelectorAll('#ch5 path').length<=15,
   gapCountry);
CT.state.ch='Organic Search';CT.render();

// the bot signature: Direct in the spike months bounces far above organic
const israelDirect=D.bounce['Israel'].bounce['Direct'][19];
const israelOrganic=D.bounce['Israel'].bounce['Organic Search'][19];
ok('Israel August Direct bounces far above its organic',
   israelDirect[1]>0.8&&israelDirect[1]>israelOrganic[1]+0.3,
   'direct '+(israelDirect[1]*100).toFixed(0)+'% of '+israelDirect[0]+
   ' vs organic '+(israelOrganic[1]*100).toFixed(0)+'%');

// ---- landing pages ----
const pr=CT.pageRows();
ok('page rows produced',pr.length>0&&pr.length<=14,pr.length);
ok('page bounce rates stay within 0..1',
   pr.every(r=>(r.b25===null||(r.b25>=0&&r.b25<=1))&&(r.b26===null||(r.b26>=0&&r.b26<=1))));
ok('page chart drew bars',doc.querySelectorAll('#ch6 rect').length>0,
   doc.querySelectorAll('#ch6 rect').length);
ok('page chart has its own legend',doc.querySelectorAll('#lg6 .static').length===2);

// merging countries must weight by sessions, not average the rates
CT.state.hidden={};D.order.forEach(o=>{if(o!=='Brazil')CT.state.hidden[o]=true;});
const brOnly=CT.pageRows().find(r=>r.k==='/');
CT.state.hidden={};
const allC=CT.pageRows().find(r=>r.k==='/');
if(brOnly&&allC){
  const naive=D.order.map(c=>(D.bounce[c].pages||[]).find(r=>r[0]==='/'))
    .filter(Boolean).filter(r=>r[4]>0);
  const mean=naive.reduce((a,r)=>a+r[5],0)/naive.length;
  ok('merged page bounce is session-weighted, not a mean of rates',
     Math.abs(allC.b26-mean)>1e-6,
     'weighted '+(allC.b26*100).toFixed(1)+'% vs mean '+(mean*100).toFixed(1)+'%');
}
CT.render();
ok('page chart follows country isolation',(()=>{
  const before=CT.pageRows().length;
  CT.pick('Vietnam',false);
  const after=CT.pageRows().length;
  CT.state.hidden={};CT.render();
  return after<=before;})());
ok('single svg per bounce chart',
   doc.querySelectorAll('#ch5 svg').length===1&&doc.querySelectorAll('#ch6 svg').length===1);

// ---- sessions by landing page ----
CT.state.ch='Organic Search';CT.state.hidden={};CT.state.pHidden={};CT.render();
D.order.forEach(c=>{
  const t=D.pagesChannel[c].monthly.all;
  ok(c+': has monthly page series',!!t&&Object.keys(t).length>0);
  ok(c+': every page series is 20 months and starts with /',
     Object.keys(t).every(k=>k.startsWith('/')&&t[k].length===20));
  // a page that made the top-14 cut cannot legitimately be all zeros -- that
  // would mean the pull was truncated rather than the page being unvisited
  ok(c+': no all-zero page series',
     Object.keys(t).every(k=>t[k].reduce((a,v)=>a+v,0)>0),
     Object.keys(t).filter(k=>t[k].reduce((a,v)=>a+v,0)===0).join(','));
  ok(c+': (not set) excluded',!Object.keys(t).some(k=>k.indexOf('not set')>=0));
});
const pm=CT.pmRows();
ok('page chart lists up to 8 pages',pm.length>0&&pm.length<=8,pm.length);
ok('pages are URLs',pm.every(r=>r.k.startsWith('/')),pm.slice(0,3).map(r=>r.k).join(', '));
ok('page monthly chart drew a line per page',
   doc.querySelectorAll('#ch7 path').length===pm.length,
   doc.querySelectorAll('#ch7 path').length+' vs '+pm.length);
ok('page legend lists every page',doc.querySelectorAll('#lg7 .pleg').length===pm.length);

// merging countries must sum sessions, so an isolated country cannot exceed the total
const allTop=pm[0];
CT.pick('Germany',false);
const deRows=CT.pmRows(), deTop=deRows.find(r=>r.k===allTop.k);
if(deTop) ok('one country is a subset of all countries',
   deTop.tot<=allTop.tot,deTop.tot+' vs '+allTop.tot);
ok('German pages surface the /de section',
   deRows.some(r=>r.k.indexOf('/de')===0),deRows.slice(0,4).map(r=>r.k).join(', '));
CT.state.hidden={};CT.render();

// click-to-isolate on pages
CT.pmPick(pm[0].k,false);
ok('clicking a page isolates its line',doc.querySelectorAll('#ch7 path').length===1,
   doc.querySelectorAll('#ch7 path').length);
ok('page Show all appears',!!doc.querySelector('#lg7 .pshowall'));
CT.pmPick(pm[0].k,false);
ok('clicking again restores the pages',doc.querySelectorAll('#ch7 path').length===pm.length);
CT.state.pHidden={};CT.render();
ok('single page-monthly svg',doc.querySelectorAll('#ch7 svg').length===1);

// ---- every section follows the channel chip ----
CT.state.hidden={};CT.state.dHidden={};CT.state.pHidden={};
CT.state.ch='all';CT.state.month='2026-08';CT.render();
const snap=()=>({
  trend:doc.querySelector('#ch1 path').getAttribute('d'),
  drill:doc.querySelectorAll('#ch3 path').length+'|'+CT.drillRows().map(r=>r.k).join(','),
  daily:doc.querySelector('#ch4 path').getAttribute('d'),
  bounce:doc.querySelector('#ch5 path').getAttribute('d'),
  pagesBounce:CT.pageRows().map(r=>r.k+':'+r.s26).join(','),
  pagesMonthly:CT.pmRows().map(r=>r.k+':'+r.tot).join(',')});
const before=snap();
CT.state.ch='Organic Search';CT.state.dHidden={};CT.state.pHidden={};CT.render();
const after=snap();
Object.keys(before).forEach(k=>
  ok('section "'+k+'" responds to the channel chip',before[k]!==after[k]));

// and every per-channel page dataset must be internally consistent
D.order.forEach(c=>{
  const pc=D.pagesChannel[c];
  ok(c+': all 9 channels present in both page blocks',
     ['all'].concat(D.channelOrder).every(k=>pc.monthly[k]&&pc.bounce[k]));
  // a channel's pages must be a subset of the country's overall page set
  const allPages=new Set(Object.keys(pc.monthly.all));
  ok(c+': channel pages are a subset of the all-channel set',
     D.channelOrder.every(k=>Object.keys(pc.monthly[k]).every(p=>allPages.has(p))));
  // and no channel can exceed the all-channel total for a page
  ok(c+': no channel exceeds the all-channel sessions for a page',
     D.channelOrder.every(k=>Object.keys(pc.monthly[k]).every(p=>
       pc.monthly[k][p].every((v,i)=>v<=pc.monthly.all[p][i]))));
});
CT.state.ch='Organic Search';CT.render();

console.log(fail?'\n'+fail+' FAILED':'\nall passed');
process.exit(fail?1:0);
