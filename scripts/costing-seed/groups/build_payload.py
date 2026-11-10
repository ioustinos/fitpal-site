"""WEC-864 (composite recipes) — build compact payloads from the «Groups» Google Sheet.
   python3 -I build_payload.py groups.xlsx matched/plan.json db_components.json out_dir"""
import json,openpyxl,unicodedata,re,hashlib,os,sys,collections
def norm(s):
    s=unicodedata.normalize('NFD',str(s)); s=''.join(ch for ch in s if unicodedata.category(ch)!='Mn')
    s=s.lower().replace('ς','σ'); s=re.sub(r'\s+',' ',s); s=re.sub(r'\s*,\s*',', ',s).strip(' ."\'')
    return s
xlsx,plan,dbc,out=sys.argv[1:5]; os.makedirs(out,exist_ok=True)
G=json.load(open(plan)); C=json.load(open(dbc))
SKIP={'Pulled pork με γλάσο (street)','Bisque','ΨΑΡΟΣΟΥΠΑ ΒΕΛΟΥΤΕ (λιανική)'}
byn={}
for k,n,c in C: byn.setdefault(norm(n),(k,n))
rec=[];skipped=[];zero=0
for t in G:
    if not t['comp']: skipped.append((t['tab'],'no matching component')); continue
    name=t['comp'][0]
    if name in SKIP: skipped.append((t['tab'],'kept fixed (broken in sheet)')); continue
    lines=[]
    for l in t['lines']:
        hit=byn.get(norm(l['name'])); q=l['cooked']
        if not hit or not isinstance(q,(int,float)): raise SystemExit('unexpected line '+t['tab']+' '+l['name'])
        if q<=0: zero+=1; continue
        lines.append([hit[1],round(q,4)])
    outg=t['cooked_total']; assert isinstance(outg,(int,float)) and outg>0, t['tab']
    rec.append([name,round(outg,3),lines])
wb=openpyxl.load_workbook(xlsx,data_only=True,read_only=True); pl=[]; seen=set()
for r in wb['New Index Υλικών'].iter_rows(min_row=2,max_col=9,values_only=True):
    if not r[1]: continue
    hit=byn.get(norm(r[1]))
    if hit and hit[0]=='Index' and hit[1] not in seen and isinstance(r[6],(int,float)):
        seen.add(hit[1]); pl.append([hit[1],r[6],r[7]])
def dump(x): return json.dumps(x,ensure_ascii=False,separators=(',',':'))
files=[]
def emit(kind,rows,limit=12000):
    chunk=[]
    for r in rows+[None]:
        if r is not None: chunk.append(r)
        if r is None or len(dump(chunk))>limit:
            if r is not None and len(chunk)>1: last=chunk.pop()
            else: last=None
            if chunk:
                p=dump(chunk); m=hashlib.md5(p.encode()).hexdigest()
                fn=f'{out}/{len(files)+1:02d}_{kind}.sql'
                open(fn,'w').write(f"select costing_seed.load_groups('{kind}', '{m}', $payload${p}$payload$);\n")
                files.append((fn,len(chunk),m))
            chunk=[last] if last else []
emit('grp_recipes',rec); emit('price_list',pl)
print('recipes',len(rec),'lines',sum(len(r[2]) for r in rec),'zero-qty dropped',zero,'price rows',len(pl))
for f in files: print(f, os.path.getsize(f[0]))
json.dump(skipped,open(out+'/skipped.json','w'),ensure_ascii=False,indent=1)
