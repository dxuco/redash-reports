import json as _json, os as _os
_BASE=_os.path.dirname(_os.path.abspath(__file__))
_P=_json.load(open(_os.path.join(_BASE,"params.json")))
def _lp(name): return _os.path.join(_BASE,name)
#!/usr/bin/env python3
import pickle, collections, html as _h
C=pickle.load(open(_lp("ctx.pkl"),"rb"))
cohort=C['cohort']; AFF=C['AFF']; REG=C['REG']; TOT=C['TOT']
def eur(x): return '&euro;'+format(int(round(x)),',')
def comma(x): return format(int(round(x)),',')
def E(s): return _h.escape(str(s))
def cell(disp,sort,cls=''):
    c=f' class="{cls}"' if cls else ''; return f'<td{c} data-sort="{sort}">{disp}</td>'
def namecell(disp,sort=None):
    if sort is None: sort=disp
    return f'<td class="aff-name" data-sort="{E(sort)}">{E(disp)}</td>'
def th(label,typ='num'): return f'<th class="sortable" data-type="{typ}">{label} <span class="sort-arrow"></span></th>'
def ngrcls(v): return 'pos' if v>0 else ('neg' if v<0 else '')

# ============ SECTION 3: Affiliates We Don't Pay ============
unp=collections.defaultdict(lambda:{'ftd':0,'dep':0.0,'agr':0.0,'ngr':0.0,'bonus':0.0,'r7':0,'r30':0,'name':''})
for d in cohort:
    if d['S']!='Unpaid/Organic': continue
    k=d['affu'].lower() or '(none)'
    u=unp[k]; u['name']=d['affu'] or '(no username)'
    u['ftd']+=1; u['dep']+=d['dep']; u['agr']+=d['agr']; u['ngr']+=d['ngr']; u['bonus']+=d['bonus']
    if d.get('r7'): u['r7']+=1
    if d.get('r30'): u['r30']+=1
def sec3():
    h=['<section>']
    h.append('<div style="font-size:1.3rem;font-weight:600;color:#8B93A1;margin-bottom:0.2rem;">Affiliates We Don\'t Pay</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">No matching entry in the cost file &middot; 2026, Jan 1 &ndash; Jul 23 &middot; karolik777 excluded</div>')
    h.append(f'<div class="stat-row" style="margin-bottom:1rem;"><div class="stat-card"><div class="stat-value">{comma(len(unp))}</div><div class="stat-label">Unpaid Affiliates</div></div>'
             f'<div class="stat-card"><div class="stat-value">{comma(sum(u["ftd"] for u in unp.values()))}</div><div class="stat-label">FTDs (no cost)</div></div>'
             f'<div class="stat-card"><div class="stat-value">{eur(sum(u["ngr"] for u in unp.values()))}</div><div class="stat-label">Total NGR 2026</div></div></div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
        +th('Affiliate (aff_username)','str')+th('All FTDs')+th('Cost')+th('Deposit')+th('Adjusted GGR')+th('NGR 2026')+th('BC / Adj GGR')+th('7D Retention')+th('30D Retention')+'</tr></thead><tbody>')
    rows=sorted(unp.items(), key=lambda kv:-kv[1]['ngr'])
    tf=0; tdep=0.0; tngr=0.0; tb=0.0; tg=0.0
    for i,(k,u) in enumerate(rows):
        alt=' class="row-alt"' if i%2 else ' class=""'
        bg=u['bonus']/u['agr'] if u['agr']>0 else None
        r7r=u['r7']/u['ftd'] if u['ftd'] else 0; r30r=u['r30']/u['ftd'] if u['ftd'] else 0
        h.append(f'<tr{alt}>'+namecell(u['name'])+cell(comma(u['ftd']),u['ftd'])+cell('&mdash;',0)
            +cell(eur(u['dep']),u['dep'])+cell(eur(u['agr']),u['agr'],ngrcls(u['agr']))
            +cell(eur(u['ngr']),u['ngr'],ngrcls(u['ngr']))
            +cell(f'{bg*100:.1f}%' if bg is not None else 'n/a',bg if bg is not None else 0)
            +cell(f'{r7r*100:.1f}%',r7r)+cell(f'{r30r*100:.1f}%',r30r)+'</tr>')
        tf+=u['ftd']; tdep+=u['dep']; tngr+=u['ngr']; tb+=u['bonus']; tg+=u['agr']
    bg=tb/tg if tg>0 else 0
    h.append('<tr class="total-row">'+namecell('TOTAL')+cell(comma(tf),tf)+cell('&mdash;',0)
        +cell(eur(tdep),tdep)+cell(eur(tg),tg)
        +cell(eur(tngr),tngr,ngrcls(tngr))+cell(f'{bg*100:.1f}%',bg)+cell('',0)+cell('',0)+'</tr>')
    h.append('</tbody></table></div>')
    h.append('<div class="footnote">Affiliate usernames present in the transaction data with no matching entry (by username, case-insensitive) anywhere in CPA_File_CPA_4_0.xlsx. Sorted by 2026 NGR, highest first. <b>Deposit / Adjusted GGR / NGR</b> cover that username&#39;s 2026 FTD cohort. <b>BC / Adj GGR</b> = bonus cost as a share of adjusted GGR.</div>')
    h.append('<div class="footnote warn"><b>Retention caveat:</b> 7D/30D retention = deposited again 1&ndash;7 / 1&ndash;30 days after FTD. Treat FTD counts, NGR and bonus ratio as solid; retention % as directional.</div>')
    h.append('</section>')
    return ''.join(h)

# ============ SECTION 4: Influence Channel by Country ============
# influence affiliates with cost
infl_aff=[k for k,a in AFF.items() if a['prim']=='Influence']
# players attributed to influence, per affiliate & country
by_aff=collections.defaultdict(lambda:collections.Counter())    # affkey -> country -> ftd
country=collections.defaultdict(lambda:{'ftd':0,'sq':0,'agr':0.0,'ngr':0.0,'bonus':0.0,'r7':0,'r30':0,'alloc':0.0})
infl_ftd=0; active_affs=set()
for d in cohort:
    if d['S']!='Influence': continue
    ctry=d['ctry'] or 'Unknown'; k=d['affu'].lower()
    by_aff[k][ctry]+=1
    c=country[ctry]; c['ftd']+=1; c['agr']+=d['agr']; c['ngr']+=d['ngr']; c['bonus']+=d['bonus']
    if d['ftdtype']=='Super Qualified': c['sq']+=1
    if d.get('r7'): c['r7']+=1
    if d.get('r30'): c['r30']+=1
    infl_ftd+=1; active_affs.add(k)
# allocate each influence affiliate's cost across its countries proportional to FTDs
for k in by_aff:
    cost=AFF[k]['cost'] if k in AFF else 0.0
    tot=sum(by_aff[k].values())
    if not tot: continue
    for ctry,n in by_aff[k].items():
        country[ctry]['alloc']+=cost*(n/tot)
def sec4():
    top=sorted(country.items(), key=lambda kv:-kv[1]['ftd'])[:25]
    h=['<section>']
    h.append('<div style="font-size:1.3rem;font-weight:600;color:#8B93A1;margin-bottom:0.2rem;">Influence Channel by Country</div>')
    h.append(f'<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">Cost-tracked Influence-source affiliates only &middot; {comma(infl_ftd)} FTDs across {len(active_affs)} active affiliates &middot; top 25 countries by FTD count</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
        +th('Country','str')+th('FTD Count')+th('SQ FTD Count')+th('CPA')+th('Adjusted GGR')+th('NGR')+th('Bonus Cost / GGR')+th('NGR / FTD')+th('7D Retention')+th('30D Retention')+'</tr></thead><tbody>')
    for i,(ctry,c) in enumerate(top):
        alt=' class="row-alt"' if i%2 else ' class=""'
        cpa=c['alloc']/c['ftd'] if c['ftd'] else 0
        bg=c['bonus']/c['agr'] if c['agr']>0 else None
        nf=c['ngr']/c['ftd'] if c['ftd'] else 0
        r7r=c['r7']/c['ftd'] if c['ftd'] else 0; r30r=c['r30']/c['ftd'] if c['ftd'] else 0
        h.append(f'<tr{alt}>'+namecell(ctry)+cell(comma(c['ftd']),c['ftd'])+cell(comma(c['sq']),c['sq'])
            +cell(eur(cpa),cpa)+cell(eur(c['agr']),c['agr'])+cell(eur(c['ngr']),c['ngr'],ngrcls(c['ngr']))
            +cell(f'{bg*100:.1f}%' if bg is not None else 'n/a',bg if bg is not None else 0)
            +cell(eur(nf),nf)+cell(f'{r7r*100:.1f}%',r7r)+cell(f'{r30r*100:.1f}%',r30r)+'</tr>')
    # TOTAL row across ALL Influence countries (not just top 25)
    T=dict(ftd=0,sq=0,alloc=0.0,agr=0.0,ngr=0.0,bonus=0.0,r7=0,r30=0)
    for c in country.values():
        for k in T: T[k]+=c[k]
    tcpa=T['alloc']/T['ftd'] if T['ftd'] else 0
    tbg=T['bonus']/T['agr'] if T['agr']>0 else None
    tnf=T['ngr']/T['ftd'] if T['ftd'] else 0
    tr7=T['r7']/T['ftd'] if T['ftd'] else 0; tr30=T['r30']/T['ftd'] if T['ftd'] else 0
    h.append('<tr class="total-row">'+namecell('TOTAL (all countries)')+cell(comma(T['ftd']),T['ftd'])+cell(comma(T['sq']),T['sq'])
        +cell(eur(tcpa),tcpa)+cell(eur(T['agr']),T['agr'])+cell(eur(T['ngr']),T['ngr'],ngrcls(T['ngr']))
        +cell(f'{tbg*100:.1f}%' if tbg is not None else 'n/a',tbg if tbg is not None else 0)
        +cell(eur(tnf),tnf)+cell(f'{tr7*100:.1f}%',tr7)+cell(f'{tr30*100:.1f}%',tr30)+'</tr>')
    h.append('</tbody></table></div>')
    h.append('<div class="footnote">Population = 2026 FTDs whose affiliate username matches a cost-tracked Influence-source entry, grouped by player country. <b>CPA</b> is allocated per country: each affiliate\'s cost is split across countries in proportion to where its FTDs landed, then divided by that country\'s FTD count. <b>SQ FTD</b> = Super Qualified first deposits. <b>NGR / FTD</b> = NGR per first deposit.</div>')
    h.append('<div class="footnote warn"><b>Retention caveat:</b> 7D/30D retention = deposited again 1&ndash;7 / 1&ndash;30 days after FTD; treat as directional.</div>')
    h.append('</section>')
    return ''.join(h)

# ============ SECTION 5: Streamer Segmentation (all Influence streamers, scored & grouped) ============
def sec5():
    AFF=C['AFF']; affAgg=C['affAgg']; TOT=C['TOT']
    blended=TOT['COST']/TOT['FTD'] if TOT['FTD'] else 0
    def clamp(v): return max(0.0,min(100.0,v))
    streamers=[]
    for k,a in AFF.items():
        if a['prim']!='Influence': continue
        cost=a['cost']; ag=affAgg.get(('Influence',k),{})
        ftd=ag.get('ftd',0); ggr=ag.get('ggr',0.0); ngr=ag.get('ngr',0.0)
        r7c=ag.get('r7',0); r30c=ag.get('r30',0)
        cpa=cost/ftd if ftd else None
        r7=r7c/ftd if ftd else 0; r30=r30c/ftd if ftd else 0
        roi=ngr/cost if (ftd and cost) else 0
        streamers.append(dict(name=a['name'],status=a.get('statusF','Finished'),cost=cost,ftd=ftd,ggr=ggr,ngr=ngr,cpa=cpa,r7=r7,r30=r30,roi=roi))
    # weighted score: NGR 30%, FTD count 20%, ROI 30%, Retention 20%
    W=dict(ngr=0.30,ftd=0.20,roi=0.30,ret=0.20)
    scored=[s for s in streamers if s['ftd']>0]
    ngrs=[s['ngr'] for s in scored]; ftds=[s['ftd'] for s in scored]
    def pctrank(v,vals):
        n=len(vals)
        return 50.0 if n==0 else 100.0*(sum(1 for o in vals if o<v)+0.5*sum(1 for o in vals if o==v))/n
    for s in streamers:
        if s['ftd']>0:
            s['s_ngr']=pctrank(s['ngr'],ngrs)
            s['s_ftd']=pctrank(s['ftd'],ftds)
            s['s_roi']=clamp((s['roi']+0.5)/1.5*100)
            s['s_ret']=clamp((0.4*s['r7']+0.6*s['r30'])/0.30*100)
            s['score']=W['ngr']*s['s_ngr']+W['ftd']*s['s_ftd']+W['roi']*s['s_roi']+W['ret']*s['s_ret']
        else:
            s['score']=None
    # segment assignment
    def seg_of(s):
        if s['score'] is None: return 'Dormant'
        v=s['score']
        return 'Star' if v>=80 else 'Strong' if v>=65 else 'Average' if v>=50 else 'Weak' if v>=35 else 'Cut'
    for s in streamers: s['seg']=seg_of(s)
    SEGS=[('Star','★ Star Streamers','Score &ge; 80 &mdash; profitable, sticky and cost-efficient','#0B6E3A'),
          ('Strong','Strong Performers','Score 65&ndash;79 &mdash; solid all-round','#2E7D46'),
          ('Average','Average','Score 50&ndash;64 &mdash; middling, watch closely','#5B7285'),
          ('Weak','Underperformers','Score 35&ndash;49 &mdash; weak on profit or retention','#B9770E'),
          ('Cut','Cut Candidates','Score &lt; 35 &mdash; poor profit and retention','#C0392B'),
          ('Dormant','Dormant','Has cost but 0 FTDs in the 2026 window','#8B93A1')]
    gradecol={'Star':'#0B6E3A','Strong':'#2E7D46','Average':'#5B7285','Weak':'#B9770E','Cut':'#C0392B','Dormant':'#8B93A1'}
    STV={'Live':2,'Upcoming':1,'Finished':0}
    def stbadge(t):
        c={'Live':('#E3F3E8','#0B6E3A'),'Upcoming':('#FDF0DC','#B9770E'),'Finished':('#EEF1F4','#5B7285')}.get(t,('#EEF1F4','#5B7285'))
        return f'<span style="display:inline-block;padding:0.12rem 0.5rem;border-radius:10px;font-size:0.72rem;font-weight:700;background:{c[0]};color:{c[1]};white-space:nowrap;">{t}</span>'
    def scorepill(s):
        if s['score'] is None: return '&mdash;'
        col=gradecol[s['seg']]
        gr={'Star':'A','Strong':'B','Average':'C','Weak':'D','Cut':'E'}[s['seg']]
        return f'<span style="display:inline-block;padding:0.12rem 0.55rem;border-radius:10px;font-size:0.72rem;font-weight:700;background:{col};color:#fff;">{s["score"]:.0f} &middot; {gr}</span>'
    h=['<section>']
    h.append('<div style="font-size:1.3rem;font-weight:600;color:#8B93A1;margin-bottom:0.2rem;">Streamer Segmentation</div>')
    h.append(f'<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">All {len(streamers)} Influence streamers scored and grouped by criteria &middot; 2026 FTD cohort, Jan 1 &ndash; Jul 23 &middot; weighted score: NGR 30%, FTD count 20%, ROI 30%, Retention 20%</div>')
    # summary chips
    cnt=collections.Counter(s['seg'] for s in streamers)
    chips=''.join(f'<div class="stat-card"><div class="stat-value" style="color:{c}">{cnt.get(key,0)}</div><div class="stat-label">{name}</div></div>' for key,name,crit,c in SEGS)
    h.append(f'<div class="stat-row" style="margin-bottom:1.2rem;">{chips}</div>')
    for key,name,crit,col in SEGS:
        grp=[s for s in streamers if s['seg']==key]
        if not grp: continue
        grp.sort(key=lambda s:(-(s['score'] if s['score'] is not None else -1), -s['cost']))
        gcost=sum(s['cost'] for s in grp); gftd=sum(s['ftd'] for s in grp); gngr=sum(s['ngr'] for s in grp); gggr=sum(s['ggr'] for s in grp)
        gr7=sum(s['r7']*s['ftd'] for s in grp); gr30=sum(s['r30']*s['ftd'] for s in grp)
        h.append('<div class="source-block"><div class="grp-header" style="background:'+col+';">'
            f'<span class="grp-title">{name}</span><span class="grp-sep">&middot;</span> {len(grp)} streamers'
            f'<span class="grp-sep">&middot;</span> {crit}<span class="grp-sep">&middot;</span> {eur(gcost)} cost'
            f'<span class="grp-sep">&middot;</span> {comma(gftd)} FTDs<span class="grp-sep">&middot;</span> NGR {eur(gngr)}</div>')
        h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
            +th('Streamer','str')+th('Status','str')+th('FTDs')+th('Cost')+th('CPA')+th('Adjusted GGR')+th('NGR')+th('7D Retention')+th('30D Retention')+th('Final Score')+'</tr></thead><tbody>')
        for i,s in enumerate(grp):
            alt=' class="row-alt"' if i%2 else ' class=""'
            h.append(f'<tr{alt}>'+namecell(s['name'])+cell(stbadge(s['status']),STV.get(s['status'],0))+cell(comma(s['ftd']),s['ftd'])+cell(eur(s['cost']),s['cost'])
                +cell(eur(s['cpa']) if s['cpa'] is not None else 'n/a',s['cpa'] if s['cpa'] is not None else 0)
                +cell(eur(s['ggr']),s['ggr'],ngrcls(s['ggr']))+cell(eur(s['ngr']),s['ngr'],ngrcls(s['ngr']))
                +cell(f'{s["r7"]*100:.1f}%',s['r7'])+cell(f'{s["r30"]*100:.1f}%',s['r30'])
                +cell(scorepill(s),s['score'] if s['score'] is not None else -1)+'</tr>')
        tcpa=gcost/gftd if gftd else 0; tr7=gr7/gftd if gftd else 0; tr30=gr30/gftd if gftd else 0
        h.append('<tr class="total-row">'+namecell('TOTAL')+cell('',0)+cell(comma(gftd),gftd)+cell(eur(gcost),gcost)
            +cell(eur(tcpa) if gftd else 'n/a',tcpa)+cell(eur(gggr),gggr,ngrcls(gggr))+cell(eur(gngr),gngr,ngrcls(gngr))
            +cell(f'{tr7*100:.1f}%',tr7)+cell(f'{tr30*100:.1f}%',tr30)+cell('',0)+'</tr>')
        h.append('</tbody></table></div></div>')
    h.append(f'<div style="font-size:0.8rem;color:#5B7285;font-style:italic;">Final Score = weighted average of four 0&ndash;100 sub-scores per streamer: '
        f'<b>NGR 30%</b> and <b>FTD count 20%</b> (each scored by percentile rank across the {len(scored)} active streamers), '
        f'<b>ROI 30%</b> (= NGR &divide; cost; breakeven = 100, &minus;0.5 = 0), and '
        f'<b>Retention 20%</b> (40/60 blend of 7D/30D vs a 30% target). CPA is shown for reference but not scored. '
        f'Segments: Star A&ge;80, Strong B&ge;65, Average C&ge;50, Underperformers D&ge;35, Cut Candidates E&lt;35; Dormant = cost but no 2026 FTDs.</div>')
    h.append('</section>')
    return ''.join(h)

s3=sec3(); s4=sec4(); s5=sec5()
open(_lp("_sec3.html"),"w",encoding="utf-8").write(s3)
open(_lp("_sec4.html"),"w",encoding="utf-8").write(s4)
open(_lp("_sec5.html"),"w",encoding="utf-8").write(s5)
print("unpaid affs:", len(unp), " unpaid ftd:", sum(u['ftd'] for u in unp.values()))
print("influence ftd:", infl_ftd, " active affs:", len(active_affs), " countries:", len(country))
print("sec3/sec4 built")

# ============ ASSEMBLE ============
PRE=C['PRE']; TAIL=C['TAIL']; SEC0=C['SEC0']
s1=open(_lp("_sec1.html"),encoding="utf-8").read()
s2=open(_lp("_sec2.html"),encoding="utf-8").read()
full=PRE+SEC0+s1+s2+s3+s4+'\n'+TAIL   # streamer segmentation (s5) removed per request
full=full.replace('Jul 23',_P['cut_label']).replace('Jul 24',_P['ref_label'])
import re as _re
full=_re.sub(r'<div class="footnote[^"]*">.*?</div>', '', full, flags=_re.S)
full=_re.sub(r'<div class="meta-strip"[^>]*>.*?</div>', '', full, flags=_re.S)
# italic subtitle lines under table/section titles - removed per request
full=_re.sub(r'<div style="font-size:0\.8(?:5)?rem;color:#5B7285;font-style:italic;[^"]*">.*?</div>', '', full, flags=_re.S)
COLLAPSE_JS = """
<script>
(function(){
  function isHeader(el){ return el && el.tagName==='DIV' && el.style && (el.style.fontSize==='1.3rem'||el.style.fontSize==='1.05rem'); }
  document.querySelectorAll('section').forEach(function(sec){
    var kids=Array.prototype.slice.call(sec.children);
    kids.forEach(function(el,idx){
      if(!isHeader(el)) return;
      var controlled=[];
      for(var j=idx+1;j<kids.length;j++){ if(isHeader(kids[j])) break; controlled.push(kids[j]); }
      if(!controlled.length) return;
      el.style.cursor='pointer'; el.style.userSelect='none';
      var caret=document.createElement('span'); caret.textContent=' \\u25be'; caret.style.color='#8B93A1'; caret.style.fontSize='0.8em';
      el.appendChild(caret);
      el.addEventListener('click',function(){
        var vis = controlled.filter(function(c){ return !c.hasAttribute('data-msrc')||c.getAttribute('data-msrc')===((window.__srcCur&&window.__srcCur())||'All'); });
        var probe = vis.length?vis[0]:controlled[0];
        var hide = probe.style.display!=='none';
        controlled.forEach(function(c){ c.dataset.clps = hide?'1':''; c.style.display = hide?'none':''; });
        caret.textContent = hide?' \\u25b8':' \\u25be';
        if(window.__srcApply) window.__srcApply();
      });
    });
  });
  document.querySelectorAll('.source-block').forEach(function(blk){
    var gh=blk.querySelector('.grp-header'), tw=blk.querySelector('.table-wrap');
    if(!gh||!tw) return;
    gh.style.cursor='pointer'; gh.style.userSelect='none';
    var caret=document.createElement('span'); caret.style.opacity='0.85'; caret.style.marginLeft='0.35rem'; caret.style.fontWeight='700';
    tw.style.display='none'; caret.textContent=' [+]';   // start collapsed
    gh.appendChild(caret);
    gh.addEventListener('click',function(){
      var hide = tw.style.display!=='none';
      tw.style.display=hide?'none':'';
      caret.textContent=hide?' [+]':' [\\u2212]';
    });
  });
})();
</script>
"""
FILTER_JS = """
<script>
(function(){
  function isSrcTable(t){
    var th=t.querySelector('thead th'); if(!th) return false;
    var lbl=th.textContent.trim().toLowerCase();
    return lbl.indexOf('source')===0||lbl.indexOf('channel')===0;
  }
  var firstTable=null;
  document.querySelectorAll('table.sortable-table').forEach(function(t){
    if(!firstTable&&isSrcTable(t)) firstTable=t;
  });
  if(!firstTable) return;
  var SRC=[];
  firstTable.querySelectorAll('tbody tr').forEach(function(r){
    if(r.classList.contains('total-row')) return;
    var c=r.querySelector('td'); if(!c) return;
    var v=c.textContent.trim(); if(v&&SRC.indexOf(v)===-1) SRC.push(v);
  });
  if(!SRC.length) return;
  var current='';
  var onGreen=false;
  var bar=document.createElement('div');
  var lab=document.createElement('span');
  lab.textContent='Sources:';
  lab.style.cssText='font-weight:700;font-size:0.85rem;margin-right:0.3rem;color:#0F2A43;';
  bar.appendChild(lab);
  var btns=[];
  function mkbtn(name){
    var b=document.createElement('button');
    b.textContent=name||'All';
    b.style.cssText='padding:0.28rem 0.8rem;border-radius:14px;font-weight:700;font-size:0.74rem;cursor:pointer;';
    b.addEventListener('click',function(){ current=name; apply(); paint(); });
    b._name=name; btns.push(b); bar.appendChild(b);
  }
  mkbtn(''); SRC.forEach(mkbtn);
  function paint(){
    btns.forEach(function(b){
      var on=(b._name===current);
      if(onGreen){
        b.style.border='1px solid rgba(255,255,255,0.75)';
        b.style.background=on?'#fff':'transparent';
        b.style.color=on?'#0B6E3A':'#fff';
      } else {
        b.style.border='1px solid #0B6E3A';
        b.style.background=on?'#0B6E3A':'#fff';
        b.style.color=on?'#fff':'#0B6E3A';
      }
    });
  }
  function apply(){
    document.querySelectorAll('table.sortable-table').forEach(function(t){
      if(!isSrcTable(t)) return;
      t.querySelectorAll('tbody tr').forEach(function(r){
        if(r.classList.contains('total-row')) return;
        var c=r.querySelector('td'); if(!c) return;
        r.style.display=(!current||c.textContent.trim()===current)?'':'none';
      });
    });
    document.querySelectorAll('.source-block').forEach(function(blk){
      var gt=blk.querySelector('.grp-title'); if(!gt) return;
      blk.style.display=(!current||gt.textContent.trim().toLowerCase()===current.toLowerCase())?'':'none';
    });
    document.querySelectorAll('[data-msrc]').forEach(function(el){
      var match=(el.getAttribute('data-msrc')===(current||'All'));
      el.style.display=(match&&el.dataset.clps!=='1')?'':'none';
    });
  }
  window.__srcApply=apply;
  window.__srcCur=function(){return current;};
  var slot=document.querySelector('.cover-inner');
  if(slot){
    onGreen=true;
    lab.style.color='#fff';
    bar.style.cssText='display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;margin-left:auto;';
    var left=document.createElement('div');
    while(slot.firstChild) left.appendChild(slot.firstChild);
    slot.appendChild(left); slot.appendChild(bar);
    slot.style.height='auto'; slot.style.minHeight='60px'; slot.style.display='flex';
    slot.style.flexWrap='wrap'; slot.style.alignItems='center'; slot.style.gap='1rem';
    slot.style.justifyContent='space-between';
  } else {
    bar.style.cssText='max-width:1500px;margin:0 auto;padding:1rem 1.5rem 0;display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;';
    var firstSection=document.querySelector('section');
    if(firstSection) firstSection.parentNode.insertBefore(bar,firstSection);
  }
  paint();
})();
</script>
"""

RANGE_JS = """
<script>
(function(){
  var tbl=document.getElementById('ggr-ranges');
  if(!tbl) return;
  function influenceBlock(){
    var found=null;
    document.querySelectorAll('.source-block').forEach(function(blk){
      var gt=blk.querySelector('.grp-title');
      if(gt&&gt.textContent.trim().toLowerCase()==='influence') found=blk;
    });
    return found;
  }
  var selected=null;
  function recompute(blk){
    var table=blk.querySelector('table'); if(!table) return;
    var s={cost:0,inw:0,outw:0,all:0,sq:0,ngr:0,dep:0,r7:0,r30:0};
    table.querySelectorAll('tbody tr').forEach(function(r){
      if(r.classList.contains('total-row')||r.style.display==='none') return;
      var td=r.querySelectorAll('td'); if(td.length<12) return;
      function g(i){ return parseFloat(td[i].getAttribute('data-sort'))||0; }
      s.cost+=g(2); s.inw+=g(3); s.outw+=g(4); s.all+=g(5); s.sq+=g(6); s.ngr+=g(8);
      s.dep+=parseFloat(r.getAttribute('data-dep'))||0;
      s.r7+=parseFloat(r.getAttribute('data-r7'))||0;
      s.r30+=parseFloat(r.getAttribute('data-r30'))||0;
    });
    var tot=table.querySelector('tr.total-row'); if(!tot) return;
    var td=tot.querySelectorAll('td'); if(td.length<12) return;
    function eur(x){ return '\\u20ac'+Math.round(x).toLocaleString('en-US'); }
    function num(x){ return Math.round(x).toLocaleString('en-US'); }
    function set(i,html,sort,cls){ td[i].innerHTML=html; td[i].setAttribute('data-sort',sort); if(cls!==undefined) td[i].className=cls; }
    set(2,eur(s.cost),s.cost); set(3,num(s.inw),s.inw); set(4,num(s.outw),s.outw);
    set(5,num(s.all),s.all); set(6,num(s.sq),s.sq);
    set(7,s.all?eur(s.cost/s.all):'n/a',s.all?s.cost/s.all:0);
    set(8,eur(s.ngr),s.ngr,s.ngr>0.005?'pos':(s.ngr<-0.005?'neg':''));
    set(9,s.dep?(s.ngr/s.dep*100).toFixed(1)+'%':'n/a',s.dep?s.ngr/s.dep:0);
    set(10,s.all?(s.r7/s.all*100).toFixed(1)+'%':'0.0%',s.all?s.r7/s.all:0);
    set(11,s.all?(s.r30/s.all*100).toFixed(1)+'%':'0.0%',s.all?s.r30/s.all:0);
  }
  function setFilter(names){
    var blk=influenceBlock(); if(!blk) return;
    var tw=blk.querySelector('.table-wrap');
    if(tw&&tw.style.display==='none'){
      var gh=blk.querySelector('.grp-header'); if(gh) gh.click();   // expand properly
    }
    blk.querySelectorAll('tbody tr').forEach(function(r){
      if(r.classList.contains('total-row')) return;
      var c=r.querySelector('td'); if(!c) return;
      var nm=c.textContent.trim().toLowerCase();
      r.style.display=(!names||names.indexOf(nm)!==-1)?'':'none';
    });
    recompute(blk);
    if(names) blk.scrollIntoView({behavior:'smooth',block:'start'});
  }
  tbl.querySelectorAll('tbody tr[data-affs]').forEach(function(row){
    row.addEventListener('click',function(){
      if(selected===row){
        selected.style.outline=''; selected=null; setFilter(null); return;
      }
      if(selected) selected.style.outline='';
      selected=row; row.style.outline='2px solid #0B6E3A';
      var names=(row.getAttribute('data-affs')||'').split('|').filter(Boolean);
      setFilter(names);
    });
  });
})();
</script>
"""
full=full.replace('</body>', COLLAPSE_JS+FILTER_JS+RANGE_JS+'</body>')
_did=_P.get('cost_drive_id')
if _did:
    _lnk=(' &middot; <a href="https://docs.google.com/spreadsheets/d/'+_did+'/edit" target="_blank" rel="noopener"'
          ' style="color:#C0DD97;text-decoration:underline;">Cost sheet (Google Drive)</a>')
    full=full.replace('</p></div></div>', _lnk+'</p></div></div>', 1)
open(_P['out_html'],'w',encoding='utf-8').write(full)
print("ASSEMBLED ->", len(full), "chars")
