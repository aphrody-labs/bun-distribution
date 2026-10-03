import importlib.util
from pathlib import Path
p = Path(__file__).with_name('shenron-compute-dbfr-tunnel.py')
spec = importlib.util.spec_from_file_location('tunnel', p)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.compute_port('APHRODY_AI_HTTP_URL=http://127.0.0.1:8123\nPRIVATE_TOKEN=fake') == 8123
for url in ('http://remote:8123', 'http://user:fake@127.0.0.1:8123', 'https://127.0.0.1:8123', 'http://127.0.0.1:8123?token=fake', 'http://127.0.0.1:80'):
    try:
        m.compute_port('APHRODY_AI_HTTP_URL='+url)
    except ValueError:
        pass
    else:
        raise AssertionError('unsafe endpoint accepted')
s = p.read_text()
assert "os.setuid(user.pw_uid)" in s and '-oExitOnForwardFailure=yes' in s
assert "f'127.0.0.1:{port}:127.0.0.1:{port}'" in s
print('Compute tunnel private parsing, endpoint validation, privilege drop and loopback-only forwarding: PASS')
