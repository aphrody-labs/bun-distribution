#!/usr/bin/env bash
# Infra SSH owner: execute on VPS; private RDB streams directly to DBFR.
set -Eeuo pipefail
[[ $# = 0 || ( $# = 1 && "$1" = --apply ) ]] || { echo 'usage: shenron-redis-transfer.sh [--apply]' >&2; exit 2; }
if [[ $# = 0 ]]; then
  echo 'plan: quiesced Shenron writers; fresh full Redis RDB; direct private DBFR staging; empty/version/AOF gates; target-only restart; preserved persistence and rollback; aggregate expiry-aware verification'
  exit 0
fi
sudo -n python3 - <<'PY'
import hashlib, io, json, os, pathlib, re, shlex, shutil, subprocess, tarfile, tempfile

def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=600).strip()
def info(section): return run(['redis-cli', '--raw', 'INFO', section])
def counts(text):
    return {m[0]: [int(m[1]), int(m[2])] for m in re.findall(r'^db(\d+):keys=(\d+),expires=(\d+),', text, re.M)}
def inactive():
    for unit in ('shenron-site.service', 'shenron-bot.service'):
        state = run(['systemctl', 'show', '-p', 'ActiveState', '--value', unit])
        if state not in ('inactive', 'failed'): raise RuntimeError('Shenron writers must be inactive')
def cfg(name): return run(['redis-cli', '--raw', 'CONFIG', 'GET', name]).splitlines()[-1]
inactive()
if cfg('appendonly') != 'no': raise SystemExit('source AOF configuration unsupported')
version = re.search(r'^redis_version:(.+)$', info('server'), re.M).group(1).strip()
root = pathlib.Path('/srv/aphrody-infra/migrations')
if root.is_symlink(): raise SystemExit('migration root must not be a symlink')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
if shutil.disk_usage(root).free < 2 * 1024**3: raise SystemExit('source private snapshot disk floor not met')
os.umask(0o077)
stage = pathlib.Path(tempfile.mkdtemp(prefix='shenron-redis-', dir=root))
before = counts(info('keyspace'))
# Capture diagnostic output privately: redis-check-rdb can include key names on errors.
with (stage / 'snapshot.log').open('wb') as log:
    subprocess.run(['redis-cli', '--rdb', str(stage / 'dump.rdb')], stdout=log, stderr=log, check=True, timeout=600)
    subprocess.run(['redis-check-rdb', str(stage / 'dump.rdb')], stdout=log, stderr=log, check=True, timeout=600)
os.chmod(stage / 'dump.rdb', 0o600)
inactive()
after = counts(info('keyspace'))
if {db: k-e for db,(k,e) in before.items() if k-e} != {db: k-e for db,(k,e) in after.items() if k-e}:
    raise SystemExit('source nonexpiring key counts changed; snapshot retained, import refused')
digest = hashlib.file_digest((stage / 'dump.rdb').open('rb'), 'sha256').hexdigest()
metadata = dict(version=version, before=before, after=after, sha256=digest)
snapshot_size = (stage / 'dump.rdb').stat().st_size
(stage / 'metadata.json').write_text(json.dumps(metadata))
TARGET = r'''
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tarfile,tempfile
os.umask(0o077)
def run(args): return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL,timeout=600).strip()
def info(s): return run(['redis-cli','--raw','INFO',s])
def counts(s): return {m[0]:[int(m[1]),int(m[2])] for m in re.findall(r'^db(\d+):keys=(\d+),expires=(\d+),',s,re.M)}
def empty():
    if counts(info('keyspace')): raise RuntimeError('target Redis is not empty')
def cfg(n): return run(['redis-cli','--raw','CONFIG','GET',n]).splitlines()[-1]
for unit in ('shenron-site.service','shenron-bot.service'):
    if run(['systemctl','show','-p','ActiveState','--value',unit]) not in ('inactive','failed'): raise RuntimeError('target writers active')
if run(['systemctl','is-active','redis-server.service'])!='active': raise RuntimeError('target Redis must already be active')
empty()
if cfg('appendonly')!='no' or cfg('dir')!='/var/lib/redis' or cfg('dbfilename')!='dump.rdb': raise RuntimeError('target persistence configuration unsupported')
root=pathlib.Path('/srv/aphrody-infra/migrations')
if root.is_symlink(): raise RuntimeError('unsafe migration root')
root.mkdir(mode=0o700,parents=True,exist_ok=True)
if shutil.disk_usage(root).free < 2 * 1024**3 + 3 * int(sys.argv[1]): raise RuntimeError('target snapshot disk floor not met')
stage=pathlib.Path(tempfile.mkdtemp(prefix='shenron-redis-',dir=root))
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:
    seen=set()
    for member in archive:
        if member.name not in ('dump.rdb','metadata.json') or member.name in seen or not member.isfile(): raise RuntimeError('invalid snapshot envelope')
        seen.add(member.name)
        with (stage/member.name).open('wb') as out: shutil.copyfileobj(archive.extractfile(member),out)
    if seen!={'dump.rdb','metadata.json'}: raise RuntimeError('incomplete snapshot')
m=json.loads((stage/'metadata.json').read_text())
version=re.search(r'^redis_version:(.+)$',info('server'),re.M).group(1).strip()
if version!=m['version']: raise RuntimeError('Redis versions differ')
if hashlib.file_digest((stage/'dump.rdb').open('rb'),'sha256').hexdigest()!=m['sha256']: raise RuntimeError('snapshot checksum mismatch')
with (stage/'check.log').open('wb') as log: subprocess.run(['redis-check-rdb',str(stage/'dump.rdb')],stdout=log,stderr=log,check=True,timeout=600)
empty()
data=pathlib.Path('/var/lib/redis'); target=data/'dump.rdb'
if data.is_symlink() or target.is_symlink(): raise RuntimeError('unsafe persistence path')
backup=stage/'original'; backup.mkdir(mode=0o700)
old=False
oldstat=None
backup_ready=False
subprocess.run(['systemctl','stop','redis-server.service'],check=True)
try:
    old=target.exists()
    oldstat=target.stat() if old else None
    if old: shutil.copy2(target,backup/'dump.rdb')
    aof=data/'appendonlydir'
    if aof.exists():
        if aof.is_symlink(): raise RuntimeError('unsafe AOF path')
        shutil.copytree(aof,backup/'appendonlydir',symlinks=True)
    backup_ready=True
    run(['install','-o','redis','-g','redis','-m','0600',str(stage/'dump.rdb'),str(data/'dump.rdb.shenron-next')])
    os.replace(data/'dump.rdb.shenron-next',target)
    subprocess.run(['systemctl','start','redis-server.service'],check=True)
    if run(['redis-cli','PING'])!='PONG': raise RuntimeError('target Redis readiness failed')
    actual=counts(info('keyspace'))
    expected=m['after']
    for db in set(actual)|set(expected):
        k,e=expected.get(db,[0,0]); ak,ae=actual.get(db,[0,0])
        if ak-ae!=k-e or not k-e<=ak<=max(k,m['before'].get(db,[0,0])[0]): raise RuntimeError('aggregate Redis key count qualification failed')
    (stage/'verification.json').write_text(json.dumps(dict(sha256=m['sha256'],databases=actual,source=expected)))
    print('Redis full snapshot verified; private evidence='+str(stage)+'; per-DB counts='+json.dumps(actual))
except BaseException:
    subprocess.run(['systemctl','stop','redis-server.service'],check=True)
    if backup_ready and old:
        shutil.copy2(backup/'dump.rdb',target)
        os.chown(target,oldstat.st_uid,oldstat.st_gid)
    elif backup_ready and target.exists(): target.unlink() # Only the new imported file, never source data.
    subprocess.run(['systemctl','start','redis-server.service'],check=True)
    raise
'''
ssh = ['runuser','-u','ubuntu','--','ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes','dbfr', 'sudo -n python3 -c '+shlex.quote(TARGET)+' '+str(snapshot_size)]
with subprocess.Popen(ssh, stdin=subprocess.PIPE) as process:
    with tarfile.open(fileobj=process.stdin, mode='w|') as archive:
        for name in ('dump.rdb','metadata.json'): archive.add(stage/name,arcname=name,recursive=False)
    process.stdin.close()
    if process.wait(timeout=900): raise SystemExit('target import failed; private snapshot retained: '+str(stage))
print('Source generic Redis stayed active; private snapshot retained: '+str(stage))
PY
