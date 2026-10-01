exec(open('analyze.py').read().split("if __name__")[0])
import sys
def find_path(start, targetname, include=('normal',)):
    # BFS shortest path
    from collections import deque
    q=deque([start]); prev={start:None}
    while q:
        x=q.popleft()
        if pk[x]['name']==targetname: 
            path=[]
            while x: path.append(short(x)); x=prev[x]
            return path[::-1]
        n=nodes.get(x)
        if not n: continue
        for dep in n['deps']:
            ks={k['kind'] for k in dep['dep_kinds']}
            if (None in ks and 'normal' in include) or ('build' in ks and 'build' in include):
                if dep['pkg'] not in prev:
                    prev[dep['pkg']]=x; q.append(dep['pkg'])
    return None
byname={}
for i in ws: byname[pk[i]['name']]=i
if __name__=='__main__':
    for crate in sys.argv[1].split(','):
        for t in sys.argv[2].split(','):
            print(crate,'->',t,':',' > '.join(find_path(byname[crate],t) or ['NONE']))
