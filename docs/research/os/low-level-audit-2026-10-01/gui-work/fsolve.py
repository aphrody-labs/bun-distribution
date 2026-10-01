import json, collections, re, sys
d=json.load(open('/tmp/stack-dedup/metadata-after.json'))
pk={p['id']:p for p in d['packages']}
nodes={n['id']:n for n in d['resolve']['nodes']}
ws=set(d['workspace_members'])
root=d['workspace_root']
def rel(i):
    return pk[i]['manifest_path'].replace(root+'/','').replace('/Cargo.toml','')
byname={pk[i]['name']:i for i in ws}
# cfg evaluator
def tokenize(s):
    return re.findall(r'[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|[(),=]',s)
def parse(tokens):
    def expr(i):
        t=tokens[i]
        if t in('all','any','not'):
            assert tokens[i+1]=='('
            i+=2; args=[]
            while tokens[i]!=')':
                a,i=expr(i); args.append(a)
                if tokens[i]==',': i+=1
            return (t,args),i+1
        if i+1<len(tokens) and tokens[i+1]=='=':
            return ('kv',t,tokens[i+2].strip('"')),i+3
        return ('flag',t),i+1
    e,_=expr(0); return e
def ev(e,env):
    k=e[0]
    if k=='all': return all(ev(a,env) for a in e[1])
    if k=='any': return any(ev(a,env) for a in e[1])
    if k=='not': return not ev(e[1][0],env)
    if k=='kv': return env.get(e[1])==e[2]
    if k=='flag': return e[1] in env.get('_flags',())
ENVS={
 'linux':{'target_os':'linux','target_family':'unix','target_arch':'x86_64','target_env':'gnu','target_pointer_width':'64','target_endian':'little','target_vendor':'unknown','_flags':('unix',)},
 'windows':{'target_os':'windows','target_family':'windows','target_arch':'x86_64','target_env':'msvc','target_pointer_width':'64','target_endian':'little','target_vendor':'pc','_flags':('windows',)},
 'macos':{'target_os':'macos','target_family':'unix','target_arch':'aarch64','target_env':'','target_pointer_width':'64','target_endian':'little','target_vendor':'apple','_flags':('unix',)},
}
TRIPLES={'x86_64-unknown-linux-gnu':'linux','x86_64-pc-windows-msvc':'windows','aarch64-apple-darwin':'macos','x86_64-pc-windows-gnu':'windows'}
def target_ok(t,osn):
    if not t: return True
    if t.startswith('cfg('):
        inner=t[4:-1]
        try: return ev(parse(tokenize(inner)),ENVS[osn])
        except Exception as ex: return True
    for tr,o in TRIPLES.items():
        if t==tr: return o==osn
    return False
def normname(s): return s.replace('-','_')
def node_dep_map(pid):
    m={}
    for dep in nodes[pid]['deps']:
        m.setdefault(normname(dep['name']),[]).append(dep['pkg'])
    return m
cache={}
def solve(rootid, osn='linux', kinds=('normal',), root_features=None, root_default=True, root_dev=False):
    """feature-aware closure. returns dict pid->set(features)"""
    enabled=collections.defaultdict(set)  # pid -> features enabled
    activated_deps=collections.defaultdict(set) # pid-> optional dep names enabled
    queue=[(rootid, set(root_features or []), root_default)]
    expanded={}
    result_edges=collections.defaultdict(set)
    parent={}
    def enable(pid, feats, usedef):
        p=pk[pid]
        newf=set(feats)
        if usedef and 'default' in p['features']: newf.add('default')
        changed=False
        stack=list(newf)
        # expand feature closure
        allf=set(enabled[pid]); 
        before=len(allf)
        deps_on=set(activated_deps[pid]); beforeD=len(deps_on)
        fwd=[]  # (depname, feat)
        while stack:
            f=stack.pop()
            if f in allf and f!='default' and False: continue
            if f in allf: continue
            allf.add(f)
            for item in p['features'].get(f,[]):
                if item.startswith('dep:'):
                    deps_on.add(item[4:])
                elif '/' in item:
                    dn,ff=item.split('/',1)
                    weak=dn.endswith('?'); dn=dn.rstrip('?')
                    if not weak: deps_on.add(dn)
                    fwd.append((dn,ff,weak))
                else:
                    stack.append(item)
                    # implicit feature of optional dep named same
            # if f itself is an optional dep name with no explicit dep: syntax
        # optional deps with implicit feature: feature name == dep name and no 'dep:' used anywhere
        return allf,deps_on,fwd
    # worklist
    work=[(rootid,tuple(sorted(root_features or [])),root_default,True)]
    seenstate=set()
    while work:
        pid,feats,usedef,isroot=work.pop()
        key=(pid,feats,usedef)
        if key in seenstate: continue
        seenstate.add(key)
        p=pk[pid]
        allf,deps_on,fwd=enable(pid,feats,usedef)
        enabled[pid]|=allf; activated_deps[pid]|=deps_on
        # implicit optional dep features
        explicit_dep=set()
        for f,items in p['features'].items():
            for it in items:
                if it.startswith('dep:'): explicit_dep.add(it[4:])
        for f in allf:
            if f in {dd['rename'] or dd['name'] for dd in p['dependencies'] if dd['optional']} and f not in explicit_dep:
                activated_deps[pid].add(f)
        fwdmap=collections.defaultdict(set)
        for dn,ff,weak in fwd: fwdmap[dn].add((ff,weak))
        ndm=node_dep_map(pid) if pid in nodes else {}
        for dd in p['dependencies']:
            k=dd['kind'] or 'normal'
            if k=='dev' and not (isroot and root_dev): continue
            if k not in kinds and not (k=='dev' and isroot and root_dev): continue
            if not target_ok(dd.get('target'),osn): continue
            dname=dd['rename'] or dd['name']
            if dd['optional'] and dname not in activated_deps[pid]: continue
            cands=ndm.get(normname(dname),[])
            # pick candidate matching package name
            tgt=None
            for c in cands:
                if pk[c]['name']==dd['name']: tgt=c; break
            if not tgt: continue
            f=set(dd['features'])
            for ff,weak in fwdmap.get(dname,[]):
                if weak and dname not in activated_deps[pid]: continue
                f.add(ff)
            parent.setdefault(tgt,pid)
            result_edges[pid].add(tgt)
            work.append((tgt,tuple(sorted(f)),dd['uses_default_features'],False))
    # reachable set
    reach=set([rootid]); st=[rootid]
    while st:
        x=st.pop()
        for y in result_edges.get(x,()):
            if y not in reach: reach.add(y); st.append(y)
    return reach,result_edges
GUI=set('''tauri tao wry winit tauri-winit tauri-winit-gtk4 tauri-winit-x11 gtk gtk4 gdk gdk4 webkit2gtk wgpu wgpu-core wgpu-hal raw-window-handle accesskit arboard rfd notify-rust tray-icon global-hotkey muda softbuffer vello cosmic-text parley skrifa tiny-skia wayland-client x11rb tauri-runtime tauri-runtime-wry tauri-runtime-cef cef wl-clipboard-rs ksni ratatui crossterm webview2-com objc2-app-kit windows glow peniko kurbo taffy fontdue'''.split())
def hits(reach):
    o=collections.defaultdict(set)
    for i in reach:
        if pk[i]['name'] in GUI: o[pk[i]['name']].add(pk[i]['version'])
    return {k:sorted(v) for k,v in sorted(o.items())}
def path_to(rootid, edges, tname):
    from collections import deque
    q=deque([rootid]); prev={rootid:None}
    while q:
        x=q.popleft()
        if pk[x]['name']==tname:
            p=[]
            while x: p.append(pk[x]['name']); x=prev[x]
            return p[::-1]
        for y in edges.get(x,()):
            if y not in prev: prev[y]=x; q.append(y)
    return None
if __name__=='__main__':
    names=sys.argv[1].split(',')
    osn=sys.argv[2] if len(sys.argv)>2 else 'linux'
    for n in names:
        r,e=solve(byname[n],osn)
        print('##',n,osn,len(r),hits(r))
