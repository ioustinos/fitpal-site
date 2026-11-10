import json,unicodedata,re,collections,statistics,sys
def norm(s):
    s=unicodedata.normalize('NFD',str(s)); s=''.join(ch for ch in s if unicodedata.category(ch)!='Mn')
    s=s.lower().replace('ς','σ'); s=re.sub(r'\s+',' ',s); s=re.sub(r'\s*,\s*',', ',s).strip(' ."\'')
    return s
G=json.load(open('groups/matched.json')); C=json.load(open('groups/db_components.json'))
# manual tab overrides (stale titles)
OVR={'Σάλτσα αυγολέμονο (για γιουβαρλ':'Σάλτσα αυγολέμονο (για γιουβαρλάκια)',
     'Χορτόπιτα με φυλλο ολικής, χόρτ':'Χορτόπιτα με φυλλο ολικής, χόρτα επόχης και μυρωδικα'}
byname={n:(k,c) for k,n,c in C}
for t in G:
    if t['tab'] in OVR: n=OVR[t['tab']]; t['comp']=[n,byname[n][1]]; t['how']='manual'
tgt=collections.Counter(t['comp'][0] for t in G if t['comp'])
assert max(tgt.values())==1, [k for k,v in tgt.items() if v>1]
simple={norm(n):c for k,n,c in C if k=='Index'}
comp_tab={norm(t['comp'][0]):t for t in G if t['comp']}
memo={}
def c100(t,stack=()):
    key=t['tab']
    if key in memo: return memo[key]
    if key in stack: raise Exception('cycle '+key)
    tot=0;miss=[]
    for l in t['lines']:
        n=norm(l['name']); q=l['cooked'] if isinstance(l['cooked'],(int,float)) else None
        if q is None: miss.append(l['name']+' (no cooked g)'); continue
        if n in simple: tot+=q*simple[n]/100
        elif n in comp_tab: tot+=q*c100(comp_tab[n],stack+(key,))/100
        else: miss.append(l['name'])
    ck=t['cooked_total'] if isinstance(t['cooked_total'],(int,float)) and t['cooked_total']>0 else None
    v=tot/ck*100 if ck else None
    memo[key]=v; t['miss']=miss; return v
rows=[]
for t in G:
    if not t['comp']: continue
    new=c100(t); old=t['comp'][1]
    rows.append((t['tab'],old,new,t['cost100'],t.get('miss')))
ch=[(n-o)/o*100 for _,o,n,_,_ in rows if n and o]
print('composites',len(rows),'median change vs fixed %.1f%%'%statistics.median(ch))
print('|chg|<2%',sum(abs(x)<2 for x in ch),' 2-10%',sum(2<=abs(x)<10 for x in ch),' >=10%',sum(abs(x)>=10 for x in ch))
for r in sorted(rows,key=lambda r:-abs((r[2] or 0)-r[1])/r[1])[:15]: print('  ',r[0][:40],'fixed',r[1],'recipe@db',round(r[2] or 0,4),'sheet',r[3] if isinstance(r[3],str) else round(r[3] or 0,4),r[4] or '')
print('with missing lines',[(r[0],r[4]) for r in rows if r[4]])
json.dump(G,open('groups/plan.json','w'),ensure_ascii=False)
