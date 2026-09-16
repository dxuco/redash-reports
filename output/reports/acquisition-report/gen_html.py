import json as _json, os as _os
_BASE=_os.path.dirname(_os.path.abspath(__file__))
_P=_json.load(open(_os.path.join(_BASE,"params.json")))
def _lp(name): return _os.path.join(_BASE,name)
#!/usr/bin/env python3
import html as _h
import pickle, collections, openpyxl, html as _h
from datetime import datetime, date, timedelta

CUT=date(*_P["cut"]); REF=date(*_P["ref"])
ORIG=_lp("acquisition-template.html")
def num(x):
    try: return float(x)
    except: return 0.0

# ===== load players =====
D=pickle.load(open(_lp("full.pkl"),"rb")); P=D['P']; REG=D['reg_by_aff']
cohort=[d for d in P.values() if d['ftd'] and d['ftdate'] and d['ftdate']<=CUT and d['affu'].lower()!='karolik777']
TOT_GGR_ALL=sum(d['agr'] for d in P.values() if d['affu'].lower()!='karolik777')

# ===== cost file =====
wb=openpyxl.load_workbook(_P["cost_xlsx"], read_only=True, data_only=True)
# the 2026 deal sheet was called 'Data' until Aug 2026, then renamed 'Data2026'
# when a separate 'Data2025' sheet was added — accept either name
_dsn=next((n for n in ('Data2026','Data') if n in wb.sheetnames),None)
if _dsn is None: raise SystemExit("Cost file has no 'Data2026' or 'Data' sheet — found: "+", ".join(wb.sheetnames))
ws=wb[_dsn]; crows=list(ws.iter_rows(min_row=1,values_only=True))
ch=[(h or '').strip() for h in crows[0]]; ci={h:i for i,h in enumerate(ch) if h}
def cg(r,k):
    i=ci.get(k); return '' if i is None or i>=len(r) or r[i] is None else str(r[i]).strip()
def cdate(r,k):
    i=ci.get(k)
    if i is None or i>=len(r) or r[i] is None: return None
    v=r[i]
    if isinstance(v,datetime): return v.date()
    s=str(v).split(' ')[0]
    for f in ("%Y-%m-%d","%m/%d/%Y","%m/%d/%y"):
        try: return datetime.strptime(s,f).date()
        except: pass
    return None
COST_ROWS=[]
AFF=collections.defaultdict(lambda:{'name':'','mgr':'','cost':0.0,'windows':[],'statuses':[],'rowsrc':collections.Counter()})
for r in crows[1:]:
    if not any((c is not None and str(c).strip()!='') for c in r[:11]): continue
    name=cg(r,'Affiliate Name')
    if not name: continue
    key=name.lower(); src=cg(r,'Source'); mgr=cg(r,'Partner'); cost=num(cg(r,'Cost'))
    # Sep 2026 restructure of the cost sheet: the old 'Media & Seo' house lump
    # (mapped to Direct) is now split into 'Media Buying' and 'General SEO'
    # Source values - keep them in the Direct channel like before
    if src.strip().lower() in ('media buying','general seo'): src='Direct'
    st=cg(r,'Status'); s=cdate(r,'Starting date'); e=cdate(r,'End Date')
    COST_ROWS.append(dict(name=name,key=key,src=src,cost=cost,start=s,end=e))
    a=AFF[key]; a['name']=name; a['cost']+=cost
    a['windows'].append((s,e)); a['statuses'].append((st,s,e))
    if src: a['rowsrc'][src]+=cost
    if not a['mgr'] and mgr: a['mgr']=mgr
for k,a in AFF.items():
    if a['name']=='Media & Seo': a['prim']='Direct'
    elif a['name']=='Community': a['prim']='Community'
    elif a['rowsrc']: a['prim']=a['rowsrc'].most_common(1)[0][0]
    else: a['prim']='Direct'
def _fixd(d):
    if d and d.year>2026:  # date typo (e.g. 2926) -> intended 2026
        try: return date(2026,d.month,d.day)
        except: return d
    return d
def deal_status(st,s,e):
    stl=(st or '').strip().lower()
    if stl.startswith('ongoing'): return 'Live'      # explicit Status from cost file wins
    if stl.startswith('finish'): return 'Finished'
    s=_fixd(s); e=_fixd(e)                            # blank Status -> derive from window
    if s and e:
        if s<=REF<=e: return 'Live'
        if s>REF: return 'Upcoming'
        return 'Finished'
    if s and not e:
        return 'Live' if s<=REF else 'Upcoming'
    return 'Finished'
def aff_status(a):
    ds=[deal_status(st,s,e) for st,s,e in a['statuses']]
    if not ds: return 'Finished'
    if any(x=='Live' for x in ds): return 'Live'
    if all(x=='Upcoming' for x in ds): return 'Upcoming'
    return 'Finished'
for k,a in AFF.items(): a['statusF']=aff_status(a)

# ---- monthly accrued cost (day-proportional across campaign window, clipped to report window) ----
from datetime import timedelta as _tdelta
MN={1:'January',2:'February',3:'March',4:'April',5:'May',6:'June',7:'July',8:'August',9:'September',10:'October',11:'November',12:'December'}
LAST_M=CUT.month
MONTH_COST=collections.defaultdict(float)
CM_COST=collections.defaultdict(float)   # (channel, month) -> accrued cost
UNACC=collections.defaultdict(lambda:{'tot':0.0,'acc':0.0,'src':'','end':None,'st':None})
for row in COST_ROWS:
    cost=row['cost']
    if not cost: continue
    ch='Direct' if row['name']=='Media & Seo' else ('Community' if row['name']=='Community' else (row['src'] or 'Direct'))
    u=UNACC[row['name']]; u['tot']+=cost; u['src']=ch
    s=row['start']; e=row['end']
    if not s: continue
    if e and e.year>2026:  # date typo (e.g. 2926) -> intended 2026
        try: e=date(2026,e.month,e.day)
        except: e=s
    if not e or e<s: e=s
    if u['end'] is None or e>u['end']: u['end']=e
    if u['st'] is None or s<u['st']: u['st']=s
    days=(e-s).days+1; per=cost/days; d=s
    while d<=e:
        if date(2026,1,1)<=d<=CUT:
            MONTH_COST[d.month]+=per; CM_COST[(ch,d.month)]+=per; u['acc']+=per
        d+=_tdelta(days=1)

# ===== attribution =====
def source_of(d):
    a=d['affu'].lower()
    if a in ('tornikez','maisuradze'): return 'Direct'
    if d['affs']=='Community': return 'Community'
    if a in AFF: s=AFF[a]['prim']; return s if s else 'Direct'
    if d['isaff']=='Direct': return 'Direct'
    if a=='': return 'Direct'
    return 'Unpaid/Organic'
def affkey(d,s):
    a=d['affu'].lower()
    if s=='Community': return 'community'
    if s=='Direct':
        if a in ('tornikez','maisuradze'): return a
        return 'media & seo'
    return a or '(none)'
def mgr_norm(m):
    # 'Elene_Gh', 'Elene_gh', 'elene', 'Elene ' -> 'Elene' (same person, any spelling)
    m=(m or '').strip()
    if not m: return ''
    return m.split('_')[0].strip().capitalize()
def mgr_of(d):
    # unmanaged spend is shown by its source (Direct / Community / ...), like a manager row
    a=d['affu'].lower(); s=source_of(d)
    if s=='Community': return 'Community'
    if a in AFF:
        m=mgr_norm(AFF[a]['mgr'])
        if m: return m
        return 'Direct' if s=='Direct' else (s+' (no manager)' if s else 'Direct')
    if s=='Direct': return 'Direct'
    return 'No cost entry (organic)'
for d in cohort:
    d['S']=source_of(d); d['K']=affkey(d,d['S']); d['M']=mgr_of(d)

# ===== aggregates =====
def newagg(): return {'ftd':0,'sq':0,'in':0,'out':0,'dep':0.0,'ggr':0.0,'ngr':0.0,'bonus':0.0,'r7':0,'r30':0}
srcAgg=collections.defaultdict(newagg); affAgg=collections.defaultdict(newagg)
for d in cohort:
    for tgt,key in ((srcAgg[d['S']],None),(affAgg[(d['S'],d['K'])],1)):
        tgt['ftd']+=1; tgt['dep']+=d['dep']; tgt['ggr']+=d['agr']; tgt['ngr']+=d['ngr']; tgt['bonus']+=d['bonus']
        if d['ftdtype']=='Super Qualified': tgt['sq']+=1
        if d.get('r7'): tgt['r7']+=1
        if d.get('r30'): tgt['r30']+=1
    y=affAgg[(d['S'],d['K'])]; kk=d['affu'].lower()
    if kk in AFF and d['ftdate'] and any(s0 and e0 and s0<=d['ftdate']<=e0 for s0,e0 in AFF[kk]['windows']): y['in']+=1
    else: y['out']+=1

costsrc=collections.defaultdict(float); partners=collections.defaultdict(set)
liveN=collections.defaultdict(int); upcN=collections.defaultdict(int)
for row in COST_ROWS:
    tgt='Direct' if row['name']=='Media & Seo' else ('Community' if row['name']=='Community' else (row['src'] or 'Direct'))
    costsrc[tgt]+=row['cost']; partners[tgt].add(row['key'])
partners['Direct'].update({'media & seo','tornikez','maisuradze'})
for d in cohort:
    if d['S']=='Unpaid/Organic': partners['Unpaid/Organic'].add(d['affu'].lower() or '(none)')
for k,a in AFF.items():
    if a['statusF']=='Live': liveN[a['prim']]+=1
    elif a['statusF']=='Upcoming': upcN[a['prim']]+=1

TOT_FTD=len(cohort); TOT_COST=sum(costsrc.values())
TOT_DEP=sum(x['dep'] for x in srcAgg.values()); TOT_GGR=sum(x['ggr'] for x in srcAgg.values()); TOT_NGR=sum(x['ngr'] for x in srcAgg.values()); TOT_BON=sum(x['bonus'] for x in srcAgg.values())
UNPAID_FTD=srcAgg['Unpaid/Organic']['ftd']; TRACE_FTD=TOT_FTD-UNPAID_FTD
ORDER=['Direct','Influence','SEO','Community','Tipster','Meta','PPC','DSP','Unpaid/Organic']

# ===== html helpers =====
def eur(x): return '&euro;'+format(int(round(x)),',')
def comma(x): return format(int(round(x)),',')
def pct1(x): return f'{x*100:.1f}%'
def E(s): return _h.escape(str(s))
def cell(disp,sort,cls=''):
    c=f' class="{cls}"' if cls else ''
    return f'<td{c} data-sort="{sort}">{disp}</td>'
def namecell(disp,sort=None):
    if sort is None: sort=disp
    return f'<td class="aff-name" data-sort="{E(sort)}">{E(disp)}</td>'
def th(label,typ='num'):
    return f'<th class="sortable" data-type="{typ}">{label} <span class="sort-arrow"></span></th>'
def ngrcls(v): return 'pos' if v>0 else ('neg' if v<0 else '')

out=[]
# skeleton
orig=open(ORIG,encoding='utf-8').read()
PRE=orig.split('<!--SECTIONS-->')[0]
PRE=PRE.replace('<!--PAGE_TITLE-->','Acquisition &amp; CPA')
PRE=PRE.replace('<!--PAGE_SUB-->','Cost, FTDs and CPA by source &middot; 2026')
TAIL=orig.split('<!--SECTIONS-->')[1].lstrip()
out.append(PRE)

# ---------------- SECTION 0: Source Summary ----------------
def sec0():
    h=['<section>']
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:0 0 0.2rem;">Channel CPA</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
             +th('Source','str')+th("Partners")+th("Total FTD's")+th('Total Cost')+th('CPA')+th('Dep Amount')+th('GGR')+th('NGR')+th('NGR/DEP')+th('Bonus Cost')+th('BC/Adj GGR')+'</tr></thead><tbody>')
    for i,s in enumerate(ORDER):
        x=srcAgg[s]; ps=partners[s]; cost=costsrc.get(s,0.0)
        pos=sum(1 for k in ps if affAgg.get((s,k),{}).get('ngr',0)>0.005)
        neg=sum(1 for k in ps if affAgg.get((s,k),{}).get('ngr',0)<-0.005)
        zero=len(ps)-pos-neg
        cpa=cost/x['ftd'] if (x['ftd'] and cost) else None
        ndep=x['ngr']/x['dep'] if x['dep'] else 0
        alt=' class="row-alt"' if i%2 else ' class=""'
        cpad=eur(cpa) if cpa is not None else 'n/a'; cpas=cpa if cpa is not None else 0
        h.append(f'<tr{alt}>'+namecell(s)+cell(comma(len(ps)),len(ps))+cell(comma(x['ftd']),x['ftd'])
                 +cell(eur(cost),cost)+cell(cpad,cpas)
                 +cell(eur(x['dep']),x['dep'])+cell(eur(x['ggr']),x['ggr'])+cell(eur(x['ngr']),x['ngr'],ngrcls(x['ngr']))
                 +cell(f'{ndep*100:.1f}%',ndep)
                 +cell(eur(x['bonus']),x['bonus'])
                 +cell(f"{x['bonus']/x['ggr']*100:.1f}%" if x['ggr']>0 else 'n/a', x['bonus']/x['ggr'] if x['ggr']>0 else 0)+'</tr>')
    tp=sum(1 for s in ORDER for k in partners[s] if affAgg.get((s,k),{}).get('ngr',0)>0.005)
    tn=sum(1 for s in ORDER for k in partners[s] if affAgg.get((s,k),{}).get('ngr',0)<-0.005)
    tzero=sum(len(partners[s]) for s in ORDER)-tp-tn
    tpart=sum(len(partners[s]) for s in ORDER)
    ndep=TOT_NGR/TOT_DEP if TOT_DEP else 0
    h.append(f'<tr class="total-row">'+namecell('TOTAL')+cell(comma(tpart),tpart)+cell(comma(TOT_FTD),TOT_FTD)
             +cell(eur(TOT_COST),TOT_COST)+cell(eur(TOT_COST/TOT_FTD),TOT_COST/TOT_FTD)
             +cell(eur(TOT_DEP),TOT_DEP)+cell(eur(TOT_GGR),TOT_GGR)+cell(eur(TOT_NGR),TOT_NGR,ngrcls(TOT_NGR))+cell(f'{ndep*100:.1f}%',ndep)
             +cell(eur(TOT_BON),TOT_BON)
             +cell(f'{TOT_BON/TOT_GGR*100:.1f}%' if TOT_GGR>0 else 'n/a', TOT_BON/TOT_GGR if TOT_GGR>0 else 0)+'</tr>')
    h.append('</tbody></table></div>')
    # ---- Channel CPA on ACCRUED cost (campaign days through the cutoff only) ----
    accsrc={sname:sum(CM_COST.get((sname,m),0.0) for m in range(1,13)) for sname in ORDER}
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Channel CPA &mdash; Accrued through '+_P['cut_label']+'</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
             +th('Source','str')+th("Partners")+th("Total FTD's")+th('Accrued Cost')+th('CPA')+th('Dep Amount')+th('GGR')+th('NGR')+th('NGR/DEP')+th('Bonus Cost')+th('BC/Adj GGR')+'</tr></thead><tbody>')
    acc_tot=0.0
    for i,sname in enumerate(ORDER):
        x=srcAgg[sname]; ps=partners[sname]; cost=accsrc.get(sname,0.0); acc_tot+=cost
        cpa=cost/x['ftd'] if (x['ftd'] and cost) else None
        ndep=x['ngr']/x['dep'] if x['dep'] else 0
        alt=' class="row-alt"' if i%2 else ' class=""'
        h.append(f'<tr{alt}>'+namecell(sname)+cell(comma(len(ps)),len(ps))+cell(comma(x['ftd']),x['ftd'])
                 +cell(eur(cost),cost)+cell(eur(cpa) if cpa is not None else 'n/a',cpa if cpa is not None else 0)
                 +cell(eur(x['dep']),x['dep'])+cell(eur(x['ggr']),x['ggr'])+cell(eur(x['ngr']),x['ngr'],ngrcls(x['ngr']))
                 +cell(f'{ndep*100:.1f}%',ndep)
                 +cell(eur(x['bonus']),x['bonus'])
                 +cell(f"{x['bonus']/x['ggr']*100:.1f}%" if x['ggr']>0 else 'n/a', x['bonus']/x['ggr'] if x['ggr']>0 else 0)+'</tr>')
    ndep=TOT_NGR/TOT_DEP if TOT_DEP else 0
    h.append('<tr class="total-row">'+namecell('TOTAL')+cell(comma(tpart),tpart)+cell(comma(TOT_FTD),TOT_FTD)
             +cell(eur(acc_tot),acc_tot)+cell(eur(acc_tot/TOT_FTD) if TOT_FTD else 'n/a',acc_tot/TOT_FTD if TOT_FTD else 0)
             +cell(eur(TOT_DEP),TOT_DEP)+cell(eur(TOT_GGR),TOT_GGR)+cell(eur(TOT_NGR),TOT_NGR,ngrcls(TOT_NGR))+cell(f'{ndep*100:.1f}%',ndep)
             +cell(eur(TOT_BON),TOT_BON)
             +cell(f'{TOT_BON/TOT_GGR*100:.1f}%' if TOT_GGR>0 else 'n/a', TOT_BON/TOT_GGR if TOT_GGR>0 else 0)+'</tr>')
    h.append('</tbody></table></div>')
    # ---- Monthly CPA sub-tables: one per source, switched by the Sources filter ----
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Monthly CPA</div>')
    def monthly_table(src):
        m_ftd=collections.Counter(); m_dep=collections.defaultdict(float); m_agr=collections.defaultdict(float); m_ngr=collections.defaultdict(float)
        m_smdep=collections.defaultdict(float); m_smagr=collections.defaultdict(float); m_smngr=collections.defaultdict(float)
        m_bon=collections.defaultdict(float); m_smbon=collections.defaultdict(float)
        for d in cohort:
            if src is not None and d['S']!=src: continue
            mo=d['ftdate'].month; m_ftd[mo]+=1; m_dep[mo]+=d['dep']; m_agr[mo]+=d['agr']; m_ngr[mo]+=d['ngr']; m_bon[mo]+=d['bonus']
            m_smdep[mo]+=d.get('depm',[0.0]*13)[mo]; m_smagr[mo]+=d.get('agrm',[0.0]*13)[mo]; m_smngr[mo]+=d.get('ngrm',[0.0]*13)[mo]
            m_smbon[mo]+=d.get('bonm',[0.0]*13)[mo]
        key=src or 'All'
        hide='' if src is None else ' style="display:none"'
        hh=[f'<div class="table-wrap" data-msrc="{E(key)}"{hide}><table class="sortable-table"><thead><tr>'
                 +th('Month','str')+th('Cost')+th('FTDs')+th('CPA')
                 +th('Dep SM')+th('GGR SM')+th('NGR SM')+th('NGR/Dep SM')+th('BC SM')+th('BC/GGR SM')
                 +th('Dep Tot')+th('GGR Tot')+th('NGR Tot')+th('NGR/Dep Tot')+th('BC Tot')+th('BC/GGR Tot')+'</tr></thead><tbody>']
        mc_tot=0.0; mf_tot=0; md_tot=0.0; ma_tot=0.0; mn_tot=0.0
        sd_tot=0.0; sa_tot=0.0; sn_tot=0.0; sb_tot=0.0; b_tot=0.0
        for i,m in enumerate(range(1,LAST_M+1)):
            if src is None: c=MONTH_COST.get(m,0.0)
            else: c=CM_COST.get((src,m),0.0)
            f=m_ftd.get(m,0); cpa=c/f if f else None
            dep=m_dep.get(m,0.0); agr=m_agr.get(m,0.0); ngr=m_ngr.get(m,0.0)
            sdep=m_smdep.get(m,0.0); sagr=m_smagr.get(m,0.0); sngr=m_smngr.get(m,0.0)
            sbon=m_smbon.get(m,0.0); bon=m_bon.get(m,0.0)
            alt=' class="row-alt"' if i%2 else ' class=""'
            hh.append(f'<tr{alt}>'+namecell(MN[m])+cell(eur(c),c)+cell(comma(f),f)
                     +cell(eur(cpa) if cpa is not None else 'n/a',cpa if cpa is not None else 0)
                     +cell(eur(sdep),sdep)+cell(eur(sagr),sagr,ngrcls(sagr))+cell(eur(sngr),sngr,ngrcls(sngr))
                     +cell(f'{sngr/sdep*100:.1f}%' if sdep else 'n/a', sngr/sdep if sdep else 0, ngrcls(sngr))
                     +cell(eur(sbon),sbon)
                     +cell(f'{sbon/sagr*100:.1f}%' if sagr>0 else 'n/a', sbon/sagr if sagr>0 else 0)
                     +cell(eur(dep),dep)+cell(eur(agr),agr,ngrcls(agr))+cell(eur(ngr),ngr,ngrcls(ngr))
                     +cell(f'{ngr/dep*100:.1f}%' if dep else 'n/a', ngr/dep if dep else 0, ngrcls(ngr))
                     +cell(eur(bon),bon)
                     +cell(f'{bon/agr*100:.1f}%' if agr>0 else 'n/a', bon/agr if agr>0 else 0)+'</tr>')
            mc_tot+=c; mf_tot+=f; md_tot+=dep; ma_tot+=agr; mn_tot+=ngr
            sd_tot+=sdep; sa_tot+=sagr; sn_tot+=sngr; sb_tot+=sbon; b_tot+=bon
        hh.append('<tr class="total-row">'+namecell('TOTAL')+cell(eur(mc_tot),mc_tot)+cell(comma(mf_tot),mf_tot)
                 +cell(eur(mc_tot/mf_tot) if mf_tot else 'n/a',mc_tot/mf_tot if mf_tot else 0)
                 +cell(eur(sd_tot),sd_tot)+cell(eur(sa_tot),sa_tot,ngrcls(sa_tot))+cell(eur(sn_tot),sn_tot,ngrcls(sn_tot))
                 +cell(f'{sn_tot/sd_tot*100:.1f}%' if sd_tot else 'n/a', sn_tot/sd_tot if sd_tot else 0, ngrcls(sn_tot))
                 +cell(eur(sb_tot),sb_tot)
                 +cell(f'{sb_tot/sa_tot*100:.1f}%' if sa_tot>0 else 'n/a', sb_tot/sa_tot if sa_tot>0 else 0)
                 +cell(eur(md_tot),md_tot)+cell(eur(ma_tot),ma_tot,ngrcls(ma_tot))+cell(eur(mn_tot),mn_tot,ngrcls(mn_tot))
                 +cell(f'{mn_tot/md_tot*100:.1f}%' if md_tot else 'n/a', mn_tot/md_tot if md_tot else 0, ngrcls(mn_tot))
                 +cell(eur(b_tot),b_tot)
                 +cell(f'{b_tot/ma_tot*100:.1f}%' if ma_tot>0 else 'n/a', b_tot/ma_tot if ma_tot>0 else 0)+'</tr>')
        hh.append('</tbody></table></div>')
        return ''.join(hh)
    h.append(monthly_table(None))
    for _s in ORDER: h.append(monthly_table(_s))
    # ---- partners whose cost is not yet fully accrued (campaign days after the cutoff) ----
    pend=[(n,u) for n,u in UNACC.items() if u['tot']-u['acc']>0.5]
    pend.sort(key=lambda kv:-(kv[1]['tot']-kv[1]['acc']))
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Cost Not Yet Accrued &mdash; Campaigns Running Past '+_P['cut_label']+'</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
             +th('Partner','str')+th('Source','str')+th('Campaign Start','str')+th('Campaign End','str')+th('Total Cost')+th('Accrued So Far')+th('Remaining')+'</tr></thead><tbody>')
    pt=0.0; pa=0.0
    for i,(n,u) in enumerate(pend):
        rem=u['tot']-u['acc']
        alt=' class="row-alt"' if i%2 else ' class=""'
        endtxt=u['end'].strftime('%b %d') if u['end'] else 'no dates'
        sttxt=u['st'].strftime('%b %d') if u['st'] else 'no dates'
        h.append(f'<tr{alt}>'+namecell(n)+namecell(u['src'])
                 +f'<td data-sort="{u["st"].toordinal() if u["st"] else 0}">{sttxt}</td>'
                 +f'<td data-sort="{u["end"].toordinal() if u["end"] else 0}">{endtxt}</td>'
                 +cell(eur(u['tot']),u['tot'])+cell(eur(u['acc']),u['acc'])+cell(eur(rem),rem)+'</tr>')
        pt+=u['tot']; pa+=u['acc']
    h.append('<tr class="total-row">'+namecell('TOTAL')+namecell('')+'<td data-sort="0"></td>'+'<td data-sort="0"></td>'
             +cell(eur(pt),pt)+cell(eur(pa),pa)+cell(eur(pt-pa),pt-pa)+'</tr>')
    h.append('</tbody></table></div>')
    # ---- CPA by Channel (rows) x Month (cols) ----
    MAB={1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'}
    CH_ROWS=[c for c in ORDER if c!='Unpaid/Organic']
    cm_ftd=collections.defaultdict(int)
    for d in cohort: cm_ftd[(d['S'],d['ftdate'].month)]+=1
    months=list(range(1,LAST_M+1))
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">CPA by Channel &amp; Month</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:0.8rem;">Cost per FTD for each channel by month &middot; accrued cost &divide; FTDs (by first-deposit month) &middot; Jan 1 &ndash; Jul 23</div>')
    hd='<div class="table-wrap"><table class="sortable-table"><thead><tr>'+th('Channel','str')
    for m in months: hd+=th(MAB[m])
    hd+=th('All')+'</tr></thead><tbody>'
    h.append(hd)
    col_cost=collections.defaultdict(float); col_ftd=collections.defaultdict(int)
    for i,ch in enumerate(CH_ROWS):
        alt=' class="row-alt"' if i%2 else ' class=""'
        row=f'<tr{alt}>'+namecell(ch)
        rc=0.0; rf=0
        for m in months:
            c=CM_COST.get((ch,m),0.0); f=cm_ftd.get((ch,m),0)
            cpa=c/f if f else None
            row+=cell(eur(cpa) if cpa is not None else ('&mdash;' if c==0 else 'n/a'), cpa if cpa is not None else -1)
            rc+=c; rf+=f; col_cost[m]+=c; col_ftd[m]+=f
        allcpa=rc/rf if rf else None
        row+=cell(eur(allcpa) if allcpa is not None else '&mdash;', allcpa if allcpa is not None else -1)+'</tr>'
        h.append(row)
    # total row: blended per month
    tr='<tr class="total-row">'+namecell('BLENDED')
    trc=0.0; trf=0
    for m in months:
        c=col_cost[m]; f=col_ftd[m]; cpa=c/f if f else None
        tr+=cell(eur(cpa) if cpa is not None else '&mdash;', cpa if cpa is not None else -1)
        trc+=c; trf+=f
    tr+=cell(eur(trc/trf) if trf else '&mdash;', trc/trf if trf else -1)+'</tr>'
    h.append(tr)
    h.append('</tbody></table></div>')
    h.append('<div style="font-size:0.8rem;color:#5B7285;font-style:italic;margin-top:0.5rem;">Each cell = that channel&rsquo;s accrued cost for the month &divide; its FTDs whose first deposit fell in that month. &ldquo;All&rdquo; = channel cost &divide; FTDs across the window; &ldquo;BLENDED&rdquo; = all paid channels combined. &ldquo;&mdash;&rdquo; = no cost that month; &ldquo;n/a&rdquo; = cost but no FTDs.</div>')
    h.append('<div class="footnote"><b>Partners</b> = individual affiliates (usernames) with a cost entry in that source; Direct counts Media &amp; Seo plus TornikeZ/Maisuradze. <b>Positive/Negative/Zero</b> = partners whose own 2026 NGR is positive, negative or exactly zero. <b>Dep Amount / GGR / NGR</b> = Jan 1 &ndash; Jul 23 2026 totals for the 2026 FTD cohort attributed to that source; GGR is adjusted GGR. <b>NGR/DEP</b> = NGR as a share of deposits. <b>Unpaid/Organic</b> has no cost by definition.</div>')
    h.append('<div class="footnote warn"><b>Rebuilt from updated sources:</b> transaction CSVs (Brand New/2026, Jan&ndash;Jul) and <b>CPA File CPA 4.0.xlsx</b>. Affiliates are matched to the cost file by username, case-insensitive; source and cost come from the cost file, FTD counts and NGR from the transaction data. Cost totals per source reconcile to the cost file.</div>')
    # ---- Streamers: NGR ranges vs user NGR outcome (per streamer) ----
    st_agg={}
    for d in cohort:
        if d['S']!='Influence': continue
        k=(d['affu'] or '').strip().lower()
        if not k: k='(no username)'
        a=st_agg.setdefault(k,{'ftd':0,'agr':0.0,'ngr':0.0,'dep':0.0})
        a['ftd']+=1; a['agr']+=d['agr']; a['ngr']+=d['ngr']; a['dep']+=d['dep']
    BUCKETS=[('&lt; &euro;-1,000',lambda g:g<-1000),
             ('&euro;-1,000 &ndash; &euro;-100',lambda g:-1000<=g<-100),
             ('&euro;-100 &ndash; &euro;0',lambda g:-100<=g<0),
             ('&euro;0',lambda g:g==0),
             ('&euro;0 &ndash; &euro;100',lambda g:0<g<=100),
             ('&euro;100 &ndash; &euro;500',lambda g:100<g<=500),
             ('&euro;500 &ndash; &euro;1,000',lambda g:500<g<=1000),
             ('&euro;1,000 &ndash; &euro;5,000',lambda g:1000<g<=5000),
             ('&gt; &euro;5,000',lambda g:g>5000)]
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Streamers &mdash; NGR Ranges</div>')
    h.append('<div class="table-wrap"><table id="ggr-ranges" class="sortable-table"><thead><tr>'
             +th('NGR range','str')+th('Streamers')+th('FTDs')+th('Total Cost')+th('Total NGR')+th('NGR/Dep')+th('Users Positive NGR')+th('Positive NGR &euro;')+th('Dep of Positive Users')+th('Users Negative NGR')+th('Negative NGR &euro;')+th('Dep of Negative Users')+'</tr></thead><tbody>')
    # players (users) with positive / negative NGR, per streamer bucket
    pl_pos=collections.Counter(); pl_neg=collections.Counter(); pl_posamt={}; pl_negamt={}; pl_posdep={}; pl_negdep={}
    def _bidx(g):
        for _i,(_l,_fn) in enumerate(BUCKETS):
            if _fn(g): return _i
        return None
    _kb={k:_bidx(a['ngr']) for k,a in st_agg.items()}
    for d in cohort:
        if d['S']!='Influence': continue
        k=(d['affu'] or '').strip().lower() or '(no username)'
        bi=_kb.get(k)
        if bi is None: continue
        if d['ngr']>0.005:
            pl_pos[bi]+=1; pl_posamt[bi]=pl_posamt.get(bi,0.0)+d['ngr']; pl_posdep[bi]=pl_posdep.get(bi,0.0)+d['dep']
        elif d['ngr']<-0.005:
            pl_neg[bi]+=1; pl_negamt[bi]=pl_negamt.get(bi,0.0)+d['ngr']; pl_negdep[bi]=pl_negdep.get(bi,0.0)+d['dep']
    trs=0; trf=0; trp=0; trn=0; trpa=0.0; trna=0.0; trc=0.0; trng=0.0; trd=0.0; trpd=0.0; trnd=0.0
    for i,(lab,fn) in enumerate(BUCKETS):
        ks=[k for k,a in st_agg.items() if fn(a['ngr'])]
        ns=len(ks); f=sum(st_agg[k]['ftd'] for k in ks)
        bcost=sum(AFF[k]['cost'] for k in ks if k in AFF)
        bngr=sum(st_agg[k]['ngr'] for k in ks); bdep=sum(st_agg[k]['dep'] for k in ks)
        p=pl_pos.get(i,0); n=pl_neg.get(i,0)
        pa=pl_posamt.get(i,0.0); na=pl_negamt.get(i,0.0)
        pd=pl_posdep.get(i,0.0); nd=pl_negdep.get(i,0.0)
        alt=' class="row-alt"' if i%2 else ' class=""'
        affs=_h.escape('|'.join(sorted(ks)))
        h.append(f'<tr{alt} data-affs="{affs}" style="cursor:pointer;" title="Click to show only these streamers in the Influence table below">'
                 +f'<td class="aff-name" data-sort="{i}">{lab}</td>'
                 +cell(comma(ns),ns)+cell(comma(f),f)+cell(eur(bcost),bcost)
                 +cell(eur(bngr),bngr,ngrcls(bngr))+cell(f'{bngr/bdep*100:.1f}%' if bdep else 'n/a', bngr/bdep if bdep else 0, ngrcls(bngr))
                 +cell(comma(p),p,'pos' if p else '')+cell(eur(pa),pa,'pos' if pa>0 else '')+cell(eur(pd),pd)
                 +cell(comma(n),n,'neg' if n else '')+cell(eur(na),na,'neg' if na<0 else '')+cell(eur(nd),nd)+'</tr>')
        trs+=ns; trf+=f; trp+=p; trn+=n; trpa=trpa+pa; trna=trna+na; trc=trc+bcost; trng=trng+bngr; trd=trd+bdep; trpd=trpd+pd; trnd=trnd+nd
    # streamers with cost but no 2026 FTDs — shown so cost ties to the Influence total
    dorm=[k for k,a in AFF.items() if a['prim']=='Influence' and a['cost'] and k not in st_agg]
    dcost=sum(AFF[k]['cost'] for k in dorm)
    if dorm:
        affs=_h.escape('|'.join(sorted(dorm)))
        h.append(f'<tr data-affs="{affs}" style="cursor:pointer;" title="Click to show only these streamers in the Influence table below">'
                 +'<td class="aff-name" data-sort="98">No 2026 FTDs (cost only)</td>'
                 +cell(comma(len(dorm)),len(dorm))+cell('0',0)+cell(eur(dcost),dcost)
                 +cell(eur(0),0)+cell('n/a',0)
                 +cell('0',0)+cell(eur(0),0)+cell(eur(0),0)+cell('0',0)+cell(eur(0),0)+cell(eur(0),0)+'</tr>')
        trs+=len(dorm); trc=trc+dcost
    h.append('<tr class="total-row"><td class="aff-name" data-sort="99">TOTAL</td>'
             +cell(comma(trs),trs)+cell(comma(trf),trf)+cell(eur(trc),trc)
             +cell(eur(trng),trng,ngrcls(trng))+cell(f'{trng/trd*100:.1f}%' if trd else 'n/a', trng/trd if trd else 0, ngrcls(trng))
             +cell(comma(trp),trp)+cell(eur(trpa),trpa,'pos' if trpa>0 else '')+cell(eur(trpd),trpd)
             +cell(comma(trn),trn)+cell(eur(trna),trna,'neg' if trna<0 else '')+cell(eur(trnd),trnd)+'</tr>')
    h.append('</tbody></table></div>')
    h.append('</section>')
    return ''.join(h)
out.append(sec0())
open(_lp("_sec0.html"),"w",encoding="utf-8").write(out[-1])
print("SEC0 built. total cost", TOT_COST, "ftd", TOT_FTD)

# save context for next stages
pickle.dump(dict(cohort=cohort, AFF={k:{'name':v['name'],'mgr':v['mgr'],'cost':v['cost'],'prim':v['prim'],
    'statusF':v['statusF'],'windows':v['windows']} for k,v in AFF.items()},
    srcAgg=dict(srcAgg), affAgg=dict(affAgg), costsrc=dict(costsrc), partners={k:v for k,v in partners.items()},
    liveN=dict(liveN), upcN=dict(upcN), REG=REG, COST_ROWS=COST_ROWS,
    TOT=dict(FTD=TOT_FTD,COST=TOT_COST,DEP=TOT_DEP,GGR=TOT_GGR,NGR=TOT_NGR,TRACE=TRACE_FTD,UNPAID=UNPAID_FTD,GGR_ALL=TOT_GGR_ALL),
    PRE=PRE, TAIL=TAIL, SEC0=out[-1]), open(_lp("ctx.pkl"),"wb"))
print("ctx saved")
