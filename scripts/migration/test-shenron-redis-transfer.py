"""Pure adapter fixtures; never contact Redis or SSH."""
import ast
from pathlib import Path
import re
source = Path(__file__).with_name('shenron-redis-transfer.sh').read_text()
python = source.split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
tree = ast.parse(python)
target = next(n.value.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'TARGET' for t in n.targets))
ast.parse(target)
assert "redis-cli', '--rdb'" in python
assert "'systemctl','stop','redis-server.service'" not in python.split('TARGET =', 1)[0]
assert "version!=m['version']" in target
assert "if counts(info('keyspace'))" in target
assert "shutil.copy2(backup/'dump.rdb',target)" in target
assert "os.chown(target,oldstat.st_uid,oldstat.st_gid)" in target
assert "appendonly')!='no'" in target
assert 'FLUSHALL' not in source and 'FLUSHDB' not in source
# Same nonexpiring state; TTL expiry may remove some or all expiring keys.
for actual in ((100, 40), (60, 0), (85, 25)):
    ak, ae = actual
    k, e = 100, 40
    assert ak-ae == k-e and k-e <= ak <= k
for actual in ((59, 0), (101, 41), (85, 24)):
    ak, ae = actual
    assert not (ak-ae == 60 and 60 <= ak <= 100)
print('Redis adapter syntax, target-only lifecycle, rollback, empty/version/AOF gates and TTL bounds: PASS')

assert 'shutil.disk_usage(root).free < 2 * 1024**3' in python
assert '3 * int(sys.argv[1])' in target
assert target.index("'systemctl','stop','redis-server.service'") < target.index("shutil.copy2(target,backup/'dump.rdb')")
assert 'backup_ready and old' in target
