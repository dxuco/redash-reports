import json as _json, os as _os
_BASE=_os.path.dirname(_os.path.abspath(__file__))
_P=_json.load(open(_os.path.join(_BASE,"params.json")))
def _lp(name): return _os.path.join(_BASE,name)
#!/usr/bin/env python3
import pickle, collections, html as _h
C=pickle.load(open(_lp("ctx.pkl"),"rb"))
cohort=C['cohort']; AFF=C['AFF']; srcAgg=C['srcAgg']; affAgg=C['affAgg']; costsrc=C['costsrc']
partners=C['partners']; liveN=C['liveN']; upcN=C['upcN']; REG=C['REG']; COST_ROWS=C['COST_ROWS']; TOT=C['TOT']
def eur(x): return '&euro;'+format(int(round(x)),',')
def comma(x): return format(int(round(x)),',')
def E(s): return _h.escape(str(s))
def cell(disp,sort,cls=''):
    c=f' class="{cls}"' if cls else ''; return f'<td{c} data-sort="{sort}">{disp}</td>'
def namecell(disp,sort=None):
    if sort is None: sort=disp
    return f'<td class="aff-name" data-sort="{E(sort)}">{E(disp)}</td>'
def th(label,typ='num',extra=''): return f'<th class="sortable" data-type="{typ}"{extra}>{label} <span class="sort-arrow"></span></th>'
def ngrcls(v): return 'pos' if v>0 else ('neg' if v<0 else '')
def badge(txt):
    col={'Live':('#E3F3E8','#0B6E3A'),'Upcoming':('#FDF0DC','#B9770E'),'Finished':('#EEF1F4','#5B7285')}.get(txt,('#EEF1F4','#5B7285'))
    return f'<span style="display:inline-block;padding:0.12rem 0.5rem;border-radius:10px;font-size:0.72rem;font-weight:700;background:{col[0]};color:{col[1]};white-space:nowrap;">{txt}</span>'
SORTV={'Live':2,'Upcoming':1,'Finished':0}
def keyname(k):
    m={'media & seo':'Media & Seo','community':'Community','tornikez':'TornikeZ','maisuradze':'Maisuradze','(none)':'(no username)'}
    if k in m: return m[k]
    return AFF[k]['name'] if k in AFF else k

# ================= SECTION 1: By Affiliate Manager =================
def mgr_disp(m):
    m=(m or '').strip()
    if not m: return 'Unassigned (incl. Media & Seo)'
    return m.split('_')[0].strip().capitalize()
def mgr_row(a):
    # unmanaged spend is grouped by its source, shown like a manager row
    m=(a['mgr'] or '').strip()
    if m: return m.split('_')[0].strip().capitalize()
    p=(a.get('prim') or '').strip()
    if p in ('Direct','Community'): return p
    return (p+' (no manager)') if p else 'Direct'
# manager -> affiliate keys (cost file)
mgr_affs=collections.defaultdict(set); mgr_cost=collections.defaultdict(float)
for k,a in AFF.items():
    md=mgr_row(a); mgr_affs[md].add(k); mgr_cost[md]+=a['cost']
# no cost entry (organic) affiliates = unmatched cohort usernames
noco=set()
for d in cohort:
    if d['M']=='No cost entry (organic)': noco.add(d['affu'].lower() or '(none)')
# cohort aggregates by manager
magg=collections.defaultdict(lambda:{'ftd':0,'dep':0.0,'ngr':0.0,'agr':0.0})
for d in cohort:
    m=d['M']; magg[m]['ftd']+=1; magg[m]['dep']+=d['dep']; magg[m]['ngr']+=d['ngr']; magg[m]['agr']+=d['agr']
# live/upcoming/finished per manager, with live split by source
def mgr_counts(md):
    live=collections.Counter(); upc=0; fin=0; n=len(mgr_affs.get(md,()))
    for k in mgr_affs.get(md,()):
        a=AFF[k]; st=a['statusF']
        if st=='Live':
            src=a['prim']; bucket='SEO' if src=='SEO' else ('Influence' if src=='Influence' else 'Other')
            live[bucket]+=1
        elif st=='Upcoming': upc+=1
        else: fin+=1
    return n,live,upc,fin
MORDER=['Direct','Community','Nini','Elene','Ani','Giorgi','Nugi','No cost entry (organic)']
# make sure any other managers included
for md in mgr_affs:
    if md not in MORDER: MORDER.insert(-1,md)
def sec1():
    h=['<section>']
    h.append('<div style="font-size:1.3rem;font-weight:600;color:#8B93A1;margin-bottom:0.2rem;">By Affiliate Manager</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">From the <code>Partner</code> column of the cost file &middot; 2026, Jan 1 &ndash; Jul 23 &middot; deal status as of Jul 24</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
        +th('Affiliate Manager','str')+th('Affiliates')
        +th('Cost')+th('FTDs')+th('Cost / FTD')+th('Deposit')+th('Adjusted GGR')+th('NGR')+'</tr></thead><tbody>')
    tot=dict(aff=0,seo=0,inf=0,oth=0,liv=0,upc=0,fin=0,cost=0.0,ftd=0,dep=0.0,ngr=0.0)
    for i,md in enumerate(MORDER):
        if md=='No cost entry (organic)':
            n=len(noco); live=collections.Counter(); upc=0; fin=0; cost=0.0
        else:
            n,live,upc,fin=mgr_counts(md); cost=mgr_cost.get(md,0.0)
        seo=live['SEO']; inf=live['Influence']; oth=live['Other']; livtot=seo+inf+oth
        ag=magg.get(md,{'ftd':0,'dep':0,'ngr':0,'agr':0}); ftd=ag['ftd']; dep=ag['dep']; ngr=ag['ngr']; agr=ag.get('agr',0.0)
        cpf=cost/ftd if ftd and cost else None
        nmc=ngr-cost
        alt=' class="row-alt"' if i%2 else ' class=""'
        def dash(v): return badge('') if False else (comma(v) if v else '&mdash;')
        badgetot=f'<span style="display:inline-block;padding:0.12rem 0.5rem;border-radius:10px;font-size:0.72rem;font-weight:700;background:#E3F3E8;color:#0B6E3A;">{livtot}</span>'
        h.append(f'<tr{alt}>'+namecell(md)+cell(comma(n),n)
            +cell(eur(cost) if cost else eur(0),cost)+cell(comma(ftd),ftd)
            +cell(eur(cpf) if cpf is not None else 'n/a',cpf if cpf is not None else 0)
            +cell(eur(dep),dep)+cell(eur(agr),agr)+cell(eur(ngr),ngr,ngrcls(ngr))+'</tr>')
        tot['aff']+=n; tot['seo']+=seo; tot['inf']+=inf; tot['oth']+=oth; tot['liv']+=livtot
        tot['upc']+=upc; tot['fin']+=fin; tot['cost']+=cost; tot['ftd']+=ftd; tot['dep']+=dep; tot['ngr']+=ngr; tot['agr']=tot.get('agr',0.0)+agr
    bt=f'<span style="display:inline-block;padding:0.12rem 0.5rem;border-radius:10px;font-size:0.72rem;font-weight:700;background:#E3F3E8;color:#0B6E3A;">{tot["liv"]}</span>'
    nmc=tot['ngr']-tot['cost']
    h.append('<tr class="total-row">'+namecell('TOTAL')+cell(comma(tot['aff']),tot['aff'])
        +cell(eur(tot['cost']),tot['cost'])+cell(comma(tot['ftd']),tot['ftd'])
        +cell(eur(tot['cost']/tot['ftd']),tot['cost']/tot['ftd'])+cell(eur(tot['dep']),tot['dep'])+cell(eur(tot.get('agr',0.0)),tot.get('agr',0.0))+cell(eur(tot['ngr']),tot['ngr'],ngrcls(tot['ngr']))+'</tr>')
    h.append('</tbody></table></div>')
    h.append('<div class="footnote"><b>Live / Upcoming / Finished</b> count that manager\'s affiliates, not individual deals &mdash; an affiliate counts as Live if any of its campaigns is running. <b>Cost</b> is every deal in the file for that manager. <b>FTDs / Deposit / NGR</b> cover Jan 1 &ndash; Jul 23 2026 activity for the 2026 FTD cohort brought by those affiliates.</div>')
    h.append('<div class="footnote warn"><b>Coverage:</b> the only affiliates without a manager are the two house campaigns &mdash; Media &amp; Seo and Community &mdash; shown as Unassigned. <b>No cost entry (organic)</b> is the unpaid group, shown so the FTD total ties back to platform-wide; it has no manager and no cost.</div>')
    h.append('</section>')
    return ''.join(h)

# ================= SECTION 2: Cost by Source — Affiliate Detail =================
GROUPS=['Direct','Influence','SEO','Community','Tipster','Meta','PPC','DSP']
def group_keys(src):
    ks=set()
    for k,a in AFF.items():
        if a['prim']==src and a['name'] not in ('Media & Seo','Community'): ks.add(k)
    if src=='Direct': ks.update({'media & seo','tornikez','maisuradze'})
    if src=='Community': ks.add('community')
    for (s,k) in affAgg:
        if s==src: ks.add(k)
    return ks
def sec2():
    h=['<section>']
    h.append('<div style="font-size:1.3rem;font-weight:600;color:#8B93A1;margin-bottom:0.2rem;">Cost by Source &mdash; Affiliate Detail</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">Every deal in the cost file, regardless of Deal Type &middot; 2026, Jan 1 &ndash; Jul 23 &middot; karolik777 excluded &middot; click any header to sort within a source table</div>')
    h.append('<div class="meta-strip" style="margin-bottom:1.2rem;"><b>Platform-Wide</b> = all 2026 new FTDs, whoever their affiliate is. <b>Traceable</b> = FTDs attributed to a cost-tracked source below. <b>Unpaid/Organic</b> = FTDs from a named affiliate with no cost entry anywhere in the file.</div>')
    for src in GROUPS:
        ks=group_keys(src)
        rows=[]
        gcost=0.0; gftd=0; gngr=0.0; naff=0; live=0; upc=0; pos=0; neg=0; zero=0; possum=0.0
        gin=0; gout=0; gsq=0; gdep=0.0; gr7=0; gr30=0
        for k in ks:
            a=AFF.get(k); cost=a['cost'] if a else 0.0; status=a['statusF'] if a else 'Finished'
            ag=affAgg.get((src,k),{}); allftd=ag.get('ftd',0); inw=ag.get('in',0); outw=ag.get('out',0)
            sq=ag.get('sq',0); ngr=ag.get('ngr',0.0); dep=ag.get('dep',0.0); r7=ag.get('r7',0); r30=ag.get('r30',0)
            rows.append((k,a['name'] if a else keyname(k),status,cost,inw,outw,allftd,sq,ngr,dep,r7,r30))
            gcost+=cost; gftd+=allftd; gngr+=ngr; naff+=1
            gin+=inw; gout+=outw; gsq+=sq; gdep+=dep; gr7+=r7; gr30+=r30
            if status=='Live': live+=1
            elif status=='Upcoming': upc+=1
            if ngr>0.005: pos+=1; possum+=ngr
            elif ngr<-0.005: neg+=1
            else: zero+=1
        rows.sort(key=lambda r:(-r[6],-r[3]))
        blended=gcost/gftd if gftd else 0
        h.append('<div class="source-block"><div class="grp-header">'
            f'<span class="grp-title">{src.upper()}</span><span class="grp-sep">&middot;</span> {naff} affiliates'
            f'<span class="grp-sep">&middot;</span> <span style="color:#0B6E3A;font-weight:700;">{live} live</span>'
            f'<span class="grp-sep">&middot;</span> {upc} upcoming<span class="grp-sep">&middot;</span> {eur(gcost)} total'
            f'<span class="grp-sep">&middot;</span> {comma(gftd)} FTDs<span class="grp-sep">&middot;</span> {eur(blended)} blended'
            f'<span class="grp-sep">&middot;</span> NGR: {pos} positive ({eur(possum)}), {zero} zero, {neg} negative'
            f'<span class="grp-sep">&middot;</span> Total NGR: {eur(gngr)}</div>')
        h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
            +th('Affiliate','str')+th('Status','str')+th('Cost')+th('FTD In Window')+th('FTD Outside Window')+th('All FTD')
            +th('All Super Qualified FTDs')+th('Cost / All FTD')+th('NGR of All FTDs')+th('NGR/DEP')+th('7D Retention')+th('30D Retention')+'</tr></thead><tbody>')
        for i,(k,name,status,cost,inw,outw,allftd,sq,ngr,dep,r7,r30) in enumerate(rows):
            alt=' class="row-alt"' if i%2 else ' class=""'
            cpf=cost/allftd if (allftd and cost) else None
            ndep=ngr/dep if dep else 0
            r7r=r7/allftd if allftd else 0; r30r=r30/allftd if allftd else 0
            h.append(f'<tr{alt} data-dep="{dep:.2f}" data-r7="{r7}" data-r30="{r30}">'+namecell(name)+cell(badge(status),SORTV.get(status,0))+cell(eur(cost),cost)
                +cell(comma(inw),inw)+cell(comma(outw),outw)+cell(comma(allftd),allftd)+cell(comma(sq),sq)
                +cell(eur(cpf) if cpf is not None else 'n/a',cpf if cpf is not None else 0)
                +cell(eur(ngr),ngr,ngrcls(ngr))+cell(f'{ndep:.1%}' if dep else 'n/a',ndep)
                +cell(f'{r7r*100:.1f}%',r7r)+cell(f'{r30r*100:.1f}%',r30r)+'</tr>')
        tcpf=gcost/gftd if gftd else 0; tndep=gngr/gdep if gdep else 0
        tr7=gr7/gftd if gftd else 0; tr30=gr30/gftd if gftd else 0
        h.append('<tr class="total-row">'+namecell('TOTAL')+cell('',0)+cell(eur(gcost),gcost)
            +cell(comma(gin),gin)+cell(comma(gout),gout)+cell(comma(gftd),gftd)+cell(comma(gsq),gsq)
            +cell(eur(tcpf) if gftd else 'n/a',tcpf)+cell(eur(gngr),gngr,ngrcls(gngr))
            +cell(f'{tndep:.1%}' if gdep else 'n/a',tndep)+cell(f'{tr7*100:.1f}%',tr7)+cell(f'{tr30*100:.1f}%',tr30)+'</tr>')
        h.append('</tbody></table></div></div>')
    h.append('<div class="footnote"><b>FTD In Window</b> = FTDs whose first deposit fell inside one of that affiliate\'s campaign windows (Starting date&ndash;End Date in the cost file); <b>Outside Window</b> = the rest. <b>Cost / All FTD</b> divides total cost by every FTD the affiliate brought, in or out of window. <b>NGR of All FTDs</b> and <b>NGR/DEP</b> cover Jan 1 &ndash; Jul 23 2026 activity for that affiliate\'s 2026 FTD cohort. <b>Status</b> = Live if any campaign is running as of Jul 24 2026, Upcoming if all campaigns start later, otherwise Finished.</div>')
    h.append('<div class="footnote warn"><b>Window note:</b> the cost file windows end Jul 10&ndash;12 while the transaction data runs to Jul 23, so the last days of July FTDs land in the Outside Window column for generic campaigns. Cost totals per source reconcile to the cost file.</div>')
    h.append('</section>')
    return ''.join(h)

s1=sec1(); s2=sec2()
open(_lp("_sec1.html"),"w",encoding="utf-8").write(s1)
open(_lp("_sec2.html"),"w",encoding="utf-8").write(s2)
# quick reconciliation
print("MGR total ftd:", sum(magg[m]['ftd'] for m in magg), " (expect", TOT['FTD'],")")
print("SEC2 traceable ftd sum:", sum(affAgg[(s,k)]['ftd'] for (s,k) in affAgg if s in GROUPS), " (expect", TOT['TRACE'],")")
print("sec1/sec2 built")
