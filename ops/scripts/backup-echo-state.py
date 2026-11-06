#!/usr/bin/env python3
"""Back up the live SQLite database, avatars and private configuration locally."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess

ROOT = Path('/var/backups/echo')
DATABASE = Path('/www/wwwroot/miningqwqlogin/prisma/dev.db')
PM2 = '/www/server/nvm/versions/node/v24.15.0/bin/pm2'


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root is required for private state backups')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    ROOT.chmod(0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    pending = ROOT / ('.pending-' + stamp)
    pending.mkdir(mode=0o700)
    # The host ships Python 3.6, which lacks sqlite3.Connection.backup.
    # SQLite's online backup command includes committed WAL data safely.
    snapshot_path = pending / 'account.sqlite'
    subprocess.run(['/usr/bin/sqlite3', '-readonly', str(DATABASE),
                    '.timeout 30000', ".backup '" + str(snapshot_path) + "'"], check=True)
    with sqlite3.connect('file:' + str(snapshot_path) + '?mode=ro', uri=True) as snapshot:
        if snapshot.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise RuntimeError('Backup SQLite integrity check failed')
        if snapshot.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('Backup SQLite foreign key check failed')
    avatars = Path('/www/wwwroot/miningqwqlogin/public/uploads')
    subprocess.run(['tar', '-czf', str(pending / 'avatars.tar.gz'), '-C', str(avatars.parent), avatars.name], check=True)
    processes = json.loads(subprocess.check_output([PM2, 'jlist']))
    login = next(app['pm2_env']['pm_cwd'] for app in processes if app['name'] == 'miningqwqlogin')
    configs = {
        'music.env': '/www/wwwroot/miningqwqmusic/shared/.env.production',
        'account.env': login + '/.env',
        'mail.env': '/www/wwwroot/miningqwqmusic/shared/mail.env',
        'pm2-dump.json': '/root/.pm2/dump.pm2',
        'nginx.conf': '/www/server/panel/vhost/nginx/www.echo.miningqwq.cn.conf',
        'https-safety.conf': '/www/server/panel/vhost/nginx/extension/www.echo.miningqwq.cn/echo-https-safety.conf',
        'deployment.json': '/www/wwwroot/miningqwqmusic/current/public/__deployment.json',
    }
    for name, source in configs.items():
        shutil.copyfile(source, pending / name)
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in pending.iterdir() if p.is_file()}
    (pending / 'manifest.json').write_text(json.dumps({'createdAt': stamp, 'sha256': hashes}, indent=2))
    for p in pending.iterdir():
        p.chmod(0o600)
    destination = ROOT / stamp
    pending.rename(destination)
    # Prune only complete, timestamped backups created by this script.
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=14)
    for p in ROOT.iterdir():
        if p.is_symlink() or not p.is_dir() or not re.fullmatch(r'\d{8}T\d{6}Z', p.name):
            continue
        if p.parent.resolve() != ROOT.resolve() or not (p / 'manifest.json').is_file():
            continue
        created = datetime.datetime.strptime(p.name, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        if created < cutoff:
            shutil.rmtree(p)
    print('ECHO_STATE_BACKUP_VERIFIED', stamp)


if __name__ == '__main__':
    main()
