import openpyxl, json, sys
wb=openpyxl.load_workbook(sys.argv[1],data_only=True)
out=[];bad=[]
for i,ws in enumerate(wb.worksheets):
    rows=list(ws.iter_rows(min_row=1,max_row=80,max_col=12,values_only=True))
    if len(rows)<5 or rows[0][1]!='Υλικά': bad.append((ws.title,'hdr',rows[0][:3] if rows else None)); continue
    r2=rows[1]; lines=[]
    for r in rows[2:]:
        n=r[1]
        if n is None or str(n).strip()=='': continue
        lines.append({'name':str(n).strip(),'raw':r[2],'cooked':r[3]})
    out.append({'tab':ws.title,'idx':i,'title':str(r2[0]).strip() if r2[0] else None,'raw_total':r2[5],'cooked_total':r2[6],'cost_total':r2[11],
                'cost100':rows[4][11] if len(rows)>4 else None,'lines':lines})
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=0,default=lambda o:"DATE:"+str(o))
print(len(out),'parsed; bad',len(bad)); [print(b) for b in bad]
import collections
nl=[len(o['lines']) for o in out]; print('lines total',sum(nl),'empty tabs',sum(1 for x in nl if x==0))
names=collections.Counter(l['name'] for o in out for l in o['lines']); print('distinct line names',len(names))
nonnum=[(o['tab'],l) for o in out for l in o['lines'] if not isinstance(l['raw'],(int,float)) or not isinstance(l['cooked'],(int,float))]
print('non-numeric lines',len(nonnum)); [print(x) for x in nonnum[:15]]
