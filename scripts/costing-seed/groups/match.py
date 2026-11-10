import json,unicodedata,re,difflib,collections,sys
G=json.load(open('groups/groups.json')); C=json.load(open('groups/db_components.json'))
def norm(s):
    s=unicodedata.normalize('NFD',str(s)); s=''.join(ch for ch in s if unicodedata.category(ch)!='Mn')
    s=s.lower().replace('ς','σ'); s=re.sub(r'\s+',' ',s); s=re.sub(r'\s*,\s*',', ',s).strip(' ."\'')
    return s
grp={};idx={}
for k,n,c in C:
    (grp if k=='Group' else idx).setdefault(norm(n),[]).append((n,c))
tabmap={};used=collections.Counter();unm=[]
for t in G:
    cands=[t['tab'],t['title']]
    hit=None;how=None
    for c in cands:
        if c and norm(c) in grp: hit=grp[norm(c)][0];how='exact';break
    if not hit:
        tn=norm(t['tab'])
        pre=[v[0] for k,v in grp.items() if k.startswith(tn[:28])]
        if len(pre)>1 and t['cost100'] is not None:
            pre=[x for x in pre if abs(x[1]-t['cost100'])<0.002] or pre
        if len(pre)==1: hit=pre[0];how='prefix'
    if not hit:
        best=difflib.get_close_matches(norm(t['title'] or t['tab']),list(grp),1,0.85)
        if best: hit=grp[best[0]][0];how='fuzzy'
    t['comp']=hit;t['how']=how
    if hit: used[hit[0]]+=1
    else: unm.append(t)
print('tabs',len(G),'matched',sum(1 for t in G if t['comp']),collections.Counter(t['how'] for t in G))
print('dup comp targets',[k for k,v in used.items() if v>1])
print('unmatched tabs:');[print('  ',repr(t['tab']),'|',t['title']) for t in unm]
gnames={n for k,n,c in C if k=='Group'}
print('Group comps with no tab:',sorted(gnames-set(used)))
# lines
lm={};miss=collections.Counter()
for t in G:
    for l in t['lines']:
        n=norm(l['name'])
        if n in idx: l['m']=('Index',)+idx[n][0]
        elif n in grp: l['m']=('Group',)+grp[n][0]
        else: l['m']=None; miss[l['name']]+=1
print('lines',sum(len(t['lines']) for t in G),'unmatched lines',sum(miss.values()),'distinct',len(miss))
allnames=list(idx)+list(grp)
for n,c in miss.most_common():
    sug=difflib.get_close_matches(norm(n),allnames,2,0.6)
    print(f'   {c:3d}× {n!r} -> {sug}')

ok=bad=0
for t in G:
    if t['comp'] and isinstance(t['cost100'],(int,float)):
        d=abs(t['comp'][1]-t['cost100'])
        if d<0.0015: ok+=1
        else: bad+=1; print('  c100 differs',repr(t['tab']),'->',t['comp'][0],'db',t['comp'][1],'sheet',round(t['cost100'],4))
print('c100 agree',ok,'differ',bad)
json.dump(G,open('groups/matched.json','w'),ensure_ascii=False,default=str)
