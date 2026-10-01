import re,sys,glob,collections
def parse(path):
    txt=open(path).read()
    pk=[]
    for blk in txt.split('[[package]]')[1:]:
        n=re.search(r'^name = "(.*)"',blk,re.M); v=re.search(r'^version = "(.*)"',blk,re.M)
        s=re.search(r'^source = "(.*)"',blk,re.M)
        deps=re.findall(r'^ "([^"]+)"',blk,re.M)
        if n and v: pk.append((n.group(1),v.group(1),s.group(1) if s else 'path',deps))
    return pk
if __name__=='__main__':
    names=set(sys.argv[2].split(','))
    for path in glob.glob(sys.argv[1]):
        pk=parse(path)
        hit=[(n,v,s[:60]) for n,v,s,d in pk if n in names]
        print(path.replace('/home/aphro/',''), sorted(hit))
