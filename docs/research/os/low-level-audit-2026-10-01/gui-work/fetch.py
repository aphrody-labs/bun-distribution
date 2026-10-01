import json,subprocess,sys,time,os
UA="aphrody-audit (read-only)"
names=sys.argv[1:]
def get(url):
    for i in range(3):
        r=subprocess.run(['curl','-s','-m','30','-A',UA,url],capture_output=True,text=True)
        if r.stdout.strip():
            try: return json.loads(r.stdout)
            except Exception: pass
        time.sleep(2)
    return None
for n in names:
    out=f'crates/{n}.json'
    if os.path.exists(out): continue
    c=get(f'https://crates.io/api/v1/crates/{n}')
    time.sleep(1.0)
    if not c or 'crate' not in c:
        json.dump({'error':True,'raw':c},open(out,'w')); continue
    ver=c['crate']['max_stable_version'] or c['crate']['max_version']
    maxv=c['crate']['max_version']
    # latest versions list: first 8
    vs=[(v['num'],v['created_at'],v['license'],v['rust_version'],v['yanked']) for v in c['versions'][:8]]
    deps=get(f'https://crates.io/api/v1/crates/{n}/{maxv}/dependencies')
    time.sleep(1.0)
    dl=[]
    if deps and 'dependencies' in deps:
        dl=[(d['crate_id'],d['req'],d['kind'],d['optional'],d['target'],d['default_features'],d['features']) for d in deps['dependencies']]
    json.dump({'name':n,'max':maxv,'stable':c['crate']['max_stable_version'],'updated':c['crate']['updated_at'],'created':c['crate']['created_at'],'downloads':c['crate']['downloads'],'recent':c['crate']['recent_downloads'],'repo':c['crate'].get('repository'),'desc':c['crate'].get('description'),'versions':vs,'deps':dl,'owners':None},open(out,'w'))
    print(n,maxv,vs[0][1][:10],vs[0][2],vs[0][3],flush=True)
