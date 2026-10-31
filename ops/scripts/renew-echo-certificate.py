#!/www/server/panel/pyenv/bin/python
"""Renew only echo.miningqwq.cn using the panel's existing ACME account."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOMAIN = 'echo.miningqwq.cn'
PANEL = Path('/www/server/panel')
DEST = PANEL / 'vhost/cert/www.echo.miningqwq.cn'
NGINX = '/www/server/nginx/sbin/nginx'

def valid(path, seconds):
    return subprocess.call(['openssl','x509','-checkend',str(seconds),'-noout','-in',str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0

if valid(DEST / 'fullchain.pem', 30 * 86400):
    print('echo certificate remains valid for more than 30 days')
    sys.exit(0)

os.chdir(str(PANEL))
sys.path.insert(0, str(PANEL / 'class'))
import acme_v2
config = json.loads((PANEL / 'config/letsencrypt_v2.json').read_text())
matches = [key for key, order in config.get('orders', {}).items() if order.get('domains') == [DOMAIN]]
if len(matches) != 1:
    raise RuntimeError('Expected one existing echo certificate order')
client = acme_v2.acme_v2()
client._verify = True
result = client.renew_cert(matches[0], 30)
if not result or result.get('status') is not True:
    raise RuntimeError('Echo ACME renewal failed; inspect panel logs/letsencrypt.log')

source = PANEL / 'vhost/letsencrypt' / DOMAIN
if not valid(source / 'fullchain.pem', 7 * 86400):
    raise RuntimeError('Refusing to install an invalid certificate')
cert_public = subprocess.check_output(['openssl','x509','-in',str(source/'fullchain.pem'),'-pubkey','-noout'])
key_public = subprocess.check_output(['openssl','pkey','-in',str(source/'privkey.pem'),'-pubout'])
if cert_public != key_public:
    raise RuntimeError('Certificate key mismatch')
for destination in [DEST, PANEL / 'vhost/ssl' / DOMAIN]:
    destination.mkdir(parents=True, exist_ok=True)
    for name, mode in [('fullchain.pem',0o644),('privkey.pem',0o600)]:
        fd, staging = tempfile.mkstemp(prefix='renew-',dir=str(destination))
        os.close(fd)
        shutil.copyfile(str(source/name), staging)
        os.chmod(staging, mode)
        os.replace(staging,str(destination/name))
subprocess.check_call([NGINX,'-t'])
subprocess.check_call([NGINX,'-s','reload'])
print('Echo certificate renewed, installed and nginx reloaded')
