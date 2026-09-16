import json as _json, os as _os
_BASE=_os.path.dirname(_os.path.abspath(__file__))
_P=_json.load(open(_os.path.join(_BASE,"params.json")))
def _lp(name): return _os.path.join(_BASE,name)
#!/usr/bin/env python3
# gen_2025.py — builds acquisition-2025.html.
#   Cost:        Data2025 sheet of the cost file (channel x month matrix).
#   FTD/GGR/NGR: the 2025-*.json Redash cache files (query 1732), same source
#                as the FTD report. Life-to-date ("Tot") also scans the 2026
#                caches so a 2025 cohort's later activity is included.
# The channel table stays cost-only: the 2025 cost sheet is aggregated by
# channel with no affiliate names, so players cannot be attributed to it.
import openpyxl, html as _h, glob as _glob, collections as _cl
from datetime import datetime as _dt

MN={1:'January',2:'February',3:'March',4:'April',5:'May',6:'June',7:'July',
    8:'August',9:'September',10:'October',11:'November',12:'December'}

def eur(x): return '&euro;'+format(int(round(x)),',')
def E(s): return _h.escape(str(s))
def cell(disp,sort,cls=''):
    c=f' class="{cls}"' if cls else ''; return f'<td{c} data-sort="{sort}">{disp}</td>'
def namecell(disp,sort=None):
    if sort is None: sort=disp
    return f'<td class="aff-name" data-sort="{E(sort)}">{E(disp)}</td>'
def th(label,typ='num'):
    return f'<th class="sortable" data-type="{typ}">{label} <span class="sort-arrow"></span></th>'
def ngrcls(v): return 'pos' if v>0 else ('neg' if v<0 else '')

def val(v):
    if v is None: return 0.0
    if isinstance(v,str):
        v=v.replace(',','').replace('€','').strip()
        if v in ('','-'): return 0.0
        try: return float(v)
        except ValueError: return 0.0
    try: return float(v)
    except (TypeError,ValueError): return 0.0

wb=openpyxl.load_workbook(_P["cost_xlsx"], read_only=True, data_only=True)
if 'Data2025' not in wb.sheetnames:
    print("  gen_2025: no 'Data2025' sheet in the cost file - 2025 page skipped")
    raise SystemExit(0)
rows=[r for r in wb['Data2025'].iter_rows(values_only=True)]

# find the header row: first cell 2025 (or '2025'), followed by month labels
hdr_i=None
for i,r in enumerate(rows):
    if r and str(r[0]).strip().rstrip('.0') in ('2025',) or (r and val(r[0])==2025 and r[1]):
        hdr_i=i; break
if hdr_i is None:
    for i,r in enumerate(rows):
        if r and r[1] and str(r[1]).strip()[:3] in ('Jan',): hdr_i=i; break
if hdr_i is None:
    print("  gen_2025: Data2025 sheet is empty - 2025 page skipped")
    raise SystemExit(0)

# channel rows until (and excluding) the 'Total' row; months = 12 columns after the name
CH=[]      # (name, [12 monthly costs], total)
sheet_total_row=None
for r in rows[hdr_i+1:]:
    if not r or r[0] is None or not str(r[0]).strip(): continue
    name=str(r[0]).strip()
    m=[val(r[1+j]) for j in range(12)]
    if name.lower()=='total':
        sheet_total_row=m; break
    CH.append((name,m,sum(m)))

grand=sum(t for _,_,t in CH)
mt=[sum(m[j] for _,m,_ in CH) for j in range(12)]
LAST_M=max((j+1 for j in range(12) if mt[j]>0), default=12)

# ---------------- 2025 FTD cohort from the Redash cache ----------------
import json as _json2
CACHE=_P.get("cache_dir","")
EXCl='karolik777'
def _num(x):
    if x in (None,''): return 0.0
    try: return float(x)
    except (TypeError,ValueError): return 0.0
f25=sorted(_glob.glob(_os.path.join(CACHE,"2025-*.json"))) if CACHE else []
f26=sorted(_glob.glob(_os.path.join(CACHE,"2026-*.json"))) if CACHE else []
HAVE_TX=bool(f25)
m_ftd=_cl.Counter()
m_sm={k:_cl.defaultdict(float) for k in ('dep','agr','ngr','bon')}
m_tot={k:_cl.defaultdict(float) for k in ('dep','agr','ngr','bon')}
cm_ftd=_cl.Counter()     # (channel, month) -> FTDs, channel names match the cost sheet
ch_ftd=_cl.Counter()     # channel -> FTDs
unattr=0                 # FTDs that cannot be tied to a cost channel
# Today's aff_type/aff_source for a row's affiliate, corrected for both a
# source re-categorisation (e.g. GetBlue2024: SEO -> Retargeting in 2025) and
# a hand-verified correction (e.g. Fluxrise) the source has not made yet --
# every cached row otherwise freezes whatever aff_source said the day its
# month was pulled. See ../affiliate_channel.py.
import sys as _sys
_sys.path.insert(0,_os.path.dirname(_BASE))
from affiliate_channel import current_of as _current_of
def _chan(r):
    """Map an FTD row to a Data2025 cost channel, where the tagging allows it.
    aff_type Affiliate + aff_source SEO/Meta/Tipster/PPC/DSP -> 'Affiliate <src>';
    Streamers / aff_source Influence -> Influence; aff_source Community -> Community.
    Direct, blank and Uncategorized FTDs have no matching cost channel (SEO /
    Brand / Media / Other are untagged media buys) and stay unattributed."""
    at,src=_current_of(r.get('aff_username'),r.get('aff_type'),r.get('aff_source'))
    at=(at or '').strip(); src=(src or '').strip()
    if at=='Streamer' or src=='Influence': return 'Influence'
    if src=='Community': return 'Community'
    if at=='Affiliate' and src in ('SEO','Meta','Tipster','PPC','DSP'): return 'Affiliate '+src
    return None
if HAVE_TX:
    # pass 1: who FTD'd in 2025, in which month, and on which channel
    coh={}   # pid -> (ftd month, channel or None)
    for fp in f25:
        for r in _json2.load(open(fp,encoding='utf-8')):
            if r.get('ftd') in (None,''): continue
            if (r.get('aff_username') or '').lower()==EXCl: continue
            td=str(r.get('transaction_date') or '')[:10]
            if not td.startswith('2025'): continue
            coh[r.get('player_id')]=(int(td[5:7]),_chan(r))
    # pass 2: 2025 activity of the cohort — same-month + life-to-date
    for fp in f25:
        for r in _json2.load(open(fp,encoding='utf-8')):
            e=coh.get(r.get('player_id'))
            if e is None: continue
            mo=e[0]
            td=str(r.get('transaction_date') or '')[:10]
            if not td.startswith('2025'): continue
            dep=_num(r.get('deposit')); agr=_num(r.get('adjusted_ggr'))
            ngr=_num(r.get('ngr')); bon=_num(r.get('bonus_cost'))
            for k,v in (('dep',dep),('agr',agr),('ngr',ngr),('bon',bon)):
                m_tot[k][mo]+=v
                if int(td[5:7])==mo: m_sm[k][mo]+=v
    for mo,chan in coh.values():
        m_ftd[mo]+=1
        if chan: cm_ftd[(chan,mo)]+=1; ch_ftd[chan]+=1
        else: unattr+=1
    # pass 3: the cohort's 2026 activity feeds life-to-date only
    for fp in f26:
        for r in _json2.load(open(fp,encoding='utf-8')):
            e=coh.get(r.get('player_id'))
            if e is None: continue
            mo=e[0]
            for k,fld in (('dep','deposit'),('agr','adjusted_ggr'),('ngr','ngr'),('bon','bonus_cost')):
                m_tot[k][mo]+=_num(r.get(fld))
    print(f"  gen_2025: cohort {sum(m_ftd.values()):,} FTDs from {len(f25)} cache months (+{len(f26)} of 2026 for life-to-date); {unattr:,} unattributed to a channel")
else:
    print("  gen_2025: no 2025-*.json cache files - monthly table will be cost-only")

# ---------------- page ----------------
orig=open(_lp("acquisition-template.html"),encoding='utf-8').read()
PRE=orig.split('<!--SECTIONS-->')[0]
TAIL=orig.split('<!--SECTIONS-->')[1].lstrip()
PRE=PRE.replace('Acquisition Performance — 2026 (through Jul 23)','Acquisition Cost — 2025')
PRE=PRE.replace('<!--PAGE_TITLE-->','Cost 2025')
PRE=PRE.replace('<!--PAGE_SUB-->','Acquisition cost by channel &middot; 2025')

h=['<section>']
h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:0 0 0.2rem;">Cost by Channel &mdash; 2025</div>')
h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:1rem;">Cost from the <code>Data2025</code> sheet &middot; FTDs from the 2025 transaction data, attributed by affiliate tagging (Affiliate SEO/Meta/Tipster/PPC/DSP, Influence, Community) &middot; Direct and untagged FTDs cannot be tied to the SEO / Brand / Media / Other media buys, so those show cost only</div>')
h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
         +th('Source','str')+th('Total Cost')+th('% of Total')+th("FTD's")+th('CPA')+'</tr></thead><tbody>')
_tf1=0
for i,(name,m,tot) in enumerate(CH):
    alt=' class="row-alt"' if i%2 else ' class=""'
    sh=tot/grand if grand else 0
    f=ch_ftd.get(name,0); _tf1+=f
    cpa=tot/f if f and tot else None
    h.append(f'<tr{alt}>'+namecell(name)+cell(eur(tot),tot)+cell(f'{sh*100:.1f}%',sh)
             +cell(format(f,',') if f else ('&mdash;' if not HAVE_TX else '0'),f)
             +cell(eur(cpa) if cpa is not None else 'n/a',cpa if cpa is not None else 0)+'</tr>')
if HAVE_TX and unattr:
    h.append('<tr class="">'+namecell('Direct / Unattributed')+cell('&mdash;',0)+cell('&mdash;',0)
             +cell(format(unattr,','),unattr)+cell('n/a',0)+'</tr>')
tot_ftd=sum(m_ftd.values())
h.append('<tr class="total-row">'+namecell('TOTAL')+cell(eur(grand),grand)+cell('100.0%',1)
         +cell(format(tot_ftd,','),tot_ftd)
         +cell(eur(grand/tot_ftd) if tot_ftd else 'n/a',grand/tot_ftd if tot_ftd else 0)+'</tr>')
h.append('</tbody></table></div>')

if HAVE_TX:
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Monthly CPA</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:0.8rem;">Cost from the Data2025 sheet &middot; FTDs by first-deposit month &middot; <b>SM</b> = same month (that cohort&rsquo;s activity within its FTD month) &middot; <b>Tot</b> = that cohort&rsquo;s total from Jan 2025 until today (2026 activity included) &middot; <b>GGR</b> = adjusted GGR &middot; <b>BC</b> = bonus cost &middot; karolik777 excluded</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
             +th('Month','str')+th('Cost')+th('FTDs')+th('CPA')
             +th('Dep SM')+th('GGR SM')+th('NGR SM')+th('NGR/Dep SM')+th('BC SM')+th('BC/GGR SM')
             +th('Dep Tot')+th('GGR Tot')+th('NGR Tot')+th('NGR/Dep Tot')+th('BC Tot')+th('BC/GGR Tot')+'</tr></thead><tbody>')
    tc=0.0; tf=0; T={k:0.0 for k in ('sdep','sagr','sngr','sbon','dep','agr','ngr','bon')}
    for i,mo in enumerate(range(1,13)):
        c=mt[mo-1]; f=m_ftd.get(mo,0); cpa=c/f if f else None
        sdep=m_sm['dep'][mo]; sagr=m_sm['agr'][mo]; sngr=m_sm['ngr'][mo]; sbon=m_sm['bon'][mo]
        dep=m_tot['dep'][mo]; agr=m_tot['agr'][mo]; ngr=m_tot['ngr'][mo]; bon=m_tot['bon'][mo]
        alt=' class="row-alt"' if i%2 else ' class=""'
        h.append(f'<tr{alt}>'+namecell(MN[mo],mo)+cell(eur(c),c)+cell(format(f,','),f)
                 +cell(eur(cpa) if cpa is not None else 'n/a',cpa if cpa is not None else 0)
                 +cell(eur(sdep),sdep)+cell(eur(sagr),sagr,ngrcls(sagr))+cell(eur(sngr),sngr,ngrcls(sngr))
                 +cell(f'{sngr/sdep*100:.1f}%' if sdep else 'n/a', sngr/sdep if sdep else 0, ngrcls(sngr))
                 +cell(eur(sbon),sbon)
                 +cell(f'{sbon/sagr*100:.1f}%' if sagr>0 else 'n/a', sbon/sagr if sagr>0 else 0)
                 +cell(eur(dep),dep)+cell(eur(agr),agr,ngrcls(agr))+cell(eur(ngr),ngr,ngrcls(ngr))
                 +cell(f'{ngr/dep*100:.1f}%' if dep else 'n/a', ngr/dep if dep else 0, ngrcls(ngr))
                 +cell(eur(bon),bon)
                 +cell(f'{bon/agr*100:.1f}%' if agr>0 else 'n/a', bon/agr if agr>0 else 0)+'</tr>')
        tc+=c; tf+=f
        T['sdep']+=sdep; T['sagr']+=sagr; T['sngr']+=sngr; T['sbon']+=sbon
        T['dep']+=dep; T['agr']+=agr; T['ngr']+=ngr; T['bon']+=bon
    h.append('<tr class="total-row">'+namecell('TOTAL',13)+cell(eur(tc),tc)+cell(format(tf,','),tf)
             +cell(eur(tc/tf) if tf else 'n/a',tc/tf if tf else 0)
             +cell(eur(T['sdep']),T['sdep'])+cell(eur(T['sagr']),T['sagr'],ngrcls(T['sagr']))+cell(eur(T['sngr']),T['sngr'],ngrcls(T['sngr']))
             +cell(f"{T['sngr']/T['sdep']*100:.1f}%" if T['sdep'] else 'n/a', T['sngr']/T['sdep'] if T['sdep'] else 0)
             +cell(eur(T['sbon']),T['sbon'])
             +cell(f"{T['sbon']/T['sagr']*100:.1f}%" if T['sagr']>0 else 'n/a', T['sbon']/T['sagr'] if T['sagr']>0 else 0)
             +cell(eur(T['dep']),T['dep'])+cell(eur(T['agr']),T['agr'],ngrcls(T['agr']))+cell(eur(T['ngr']),T['ngr'],ngrcls(T['ngr']))
             +cell(f"{T['ngr']/T['dep']*100:.1f}%" if T['dep'] else 'n/a', T['ngr']/T['dep'] if T['dep'] else 0)
             +cell(eur(T['bon']),T['bon'])
             +cell(f"{T['bon']/T['agr']*100:.1f}%" if T['agr']>0 else 'n/a', T['bon']/T['agr'] if T['agr']>0 else 0)+'</tr>')
    h.append('</tbody></table></div>')
else:
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Monthly Cost</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:0.8rem;">All channels combined, by month &middot; 2025</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'
             +th('Month','str')+th('Cost')+th('% of Year')+'</tr></thead><tbody>')
    for i,mo in enumerate(range(1,13)):
        c=mt[mo-1]; sh=c/grand if grand else 0
        alt=' class="row-alt"' if i%2 else ' class=""'
        h.append(f'<tr{alt}>'+namecell(MN[mo],mo)+cell(eur(c),c)+cell(f'{sh*100:.1f}%',sh)+'</tr>')
    h.append('<tr class="total-row">'+namecell('TOTAL',13)+cell(eur(grand),grand)+cell('100.0%',1)+'</tr>')
    h.append('</tbody></table></div>')

# ---- Cost by Channel & Month matrix (channels vertical, months horizontal) ----
h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">Cost by Channel &amp; Month</div>')
h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:0.8rem;">Channels vertically, months horizontally &middot; 2025</div>')
h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'+th('Source','str')
         +''.join(th(MN[m][:3]) for m in range(1,13))+th('Total')+'</tr></thead><tbody>')
for i,(name,m,tot) in enumerate(CH):
    alt=' class="row-alt"' if i%2 else ' class=""'
    h.append(f'<tr{alt}>'+namecell(name)
             +''.join(cell(eur(m[j]) if m[j] else '&mdash;', m[j]) for j in range(12))
             +cell(eur(tot),tot)+'</tr>')
h.append('<tr class="total-row">'+namecell('TOTAL')
         +''.join(cell(eur(mt[j]),mt[j]) for j in range(12))+cell(eur(grand),grand)+'</tr>')
h.append('</tbody></table></div>')

# ---- CPA by Channel & Month matrix ----
if HAVE_TX:
    h.append('<div style="font-size:1.05rem;font-weight:700;color:#0F2A43;margin:1.6rem 0 0.2rem;">CPA by Channel &amp; Month</div>')
    h.append('<div style="font-size:0.85rem;color:#5B7285;font-style:italic;margin-bottom:0.8rem;">Cost per FTD for each channel by month &middot; channel cost &divide; FTDs (by first-deposit month) &middot; 2025</div>')
    h.append('<div class="table-wrap"><table class="sortable-table"><thead><tr>'+th('Channel','str')
             +''.join(th(MN[m][:3]) for m in range(1,13))+th('All')+'</tr></thead><tbody>')
    colc=[0.0]*12; colf=[0]*12
    for i,(name,m,tot) in enumerate(CH):
        alt=' class="row-alt"' if i%2 else ' class=""'
        row=f'<tr{alt}>'+namecell(name)
        rc=0.0; rf=0
        for j in range(12):
            c=m[j]; f=cm_ftd.get((name,j+1),0)
            cpa=c/f if f else None
            row+=cell(eur(cpa) if cpa is not None else ('&mdash;' if c==0 else 'n/a'), cpa if cpa is not None else -1)
            rc+=c; rf+=f; colc[j]+=c; colf[j]+=f
        allcpa=rc/rf if rf else None
        row+=cell(eur(allcpa) if allcpa is not None else ('&mdash;' if rc==0 else 'n/a'), allcpa if allcpa is not None else -1)+'</tr>'
        h.append(row)
    tr='<tr class="total-row">'+namecell('BLENDED')
    trc=0.0; trf=0
    for j in range(12):
        cpa=colc[j]/colf[j] if colf[j] else None
        tr+=cell(eur(cpa) if cpa is not None else '&mdash;', cpa if cpa is not None else -1)
        trc+=colc[j]; trf+=colf[j]
    tr+=cell(eur(trc/trf) if trf else '&mdash;', trc/trf if trf else -1)+'</tr>'
    h.append(tr)
    h.append('</tbody></table></div>')
    h.append('<div style="font-size:0.8rem;color:#5B7285;font-style:italic;margin-top:0.5rem;">Each cell = that channel&rsquo;s cost for the month &divide; its FTDs whose first deposit fell in that month. FTDs are attributed by transaction tagging: <b>Affiliate SEO/Meta/Tipster/PPC/DSP</b> = affiliate FTDs by source, <b>Influence</b> = streamers, <b>Community</b> = community-tagged. &ldquo;&mdash;&rdquo; = no cost that month; &ldquo;n/a&rdquo; = cost but no attributable FTDs (SEO / Brand / Media / Other are untagged media buys, and Direct FTDs cannot be tied to them). &ldquo;BLENDED&rdquo; uses attributable channels only, so treat it as directional.</div>')
h.append('</section>')

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
        var hide = controlled[0].style.display!=='none';
        controlled.forEach(function(c){ c.style.display = hide?'none':''; });
        caret.textContent = hide?' \\u25b8':' \\u25be';
      });
    });
  });
})();
</script>
"""
full=PRE+''.join(h)+'\n'+TAIL
import re as _re25
full=_re25.sub(r'<div style="font-size:0\.8(?:5)?rem;color:#5B7285;font-style:italic;[^"]*">.*?</div>', '', full, flags=_re25.S)
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

full=full.replace('</body>', COLLAPSE_JS+FILTER_JS+'</body>')
_did=_P.get('cost_drive_id')
if _did:
    _lnk=(' &middot; <a href="https://docs.google.com/spreadsheets/d/'+_did+'/edit" target="_blank" rel="noopener"'
          ' style="color:#C0DD97;text-decoration:underline;">Cost sheet (Google Drive)</a>')
    full=full.replace('</p></div></div>', _lnk+'</p></div></div>', 1)
out=_os.path.join(_os.path.dirname(_P['out_html']),'acquisition-2025.html')
open(out,'w',encoding='utf-8').write(full)
print(f"  2025 page: {len(CH)} channels, total cost {grand:,.0f} -> {out}")
