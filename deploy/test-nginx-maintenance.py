#!/usr/bin/env python3
"""Exercise the runtime maintenance page of deploy/nginx/default.conf in disposable containers.

Runs only in CI (Docker job). An isolated bridge network holds the nginx under test
and a curl client, so requests arrive from a non-loopback address like Caddy's.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

NGINX_IMAGE = 'nginx:1.27-alpine'
CURL_IMAGE = 'curlimages/curl:8.11.1'


def docker(*args, check=True):
    result = subprocess.run(['docker', *args], text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(f'docker {" ".join(args)} failed: {result.stderr.strip()}')
    return result


def fetch(network, host, path, headers=()):
    args = ['run', '--rm', '--network', network, CURL_IMAGE, '-s', '-i', '--max-time', '5']
    for header in headers:
        args += ['-H', header]
    raw = docker(*args, f'http://{host}{path}').stdout
    head, _, body = raw.replace('\r\n', '\n').partition('\n\n')
    lines = head.split('\n')
    status = int(lines[0].split()[1])
    response_headers = {}
    for line in lines[1:]:
        name, _, value = line.partition(':')
        response_headers[name.strip().lower()] = value.strip()
    return status, response_headers, body


def wait_until_ready(name):
    for _ in range(50):
        if docker('exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1/nginx-health', check=False).returncode == 0:
            return
        time.sleep(0.1)
    raise RuntimeError('nginx did not become ready')


def main():
    repo = Path(__file__).resolve().parent
    config = repo / 'nginx/default.conf'
    page_dir = repo / 'nginx/maintenance'
    suffix = uuid.uuid4().hex[:10]
    network = f'filtro-maint-net-{suffix}'
    name = f'filtro-maint-nginx-{suffix}'
    with tempfile.TemporaryDirectory() as flag_dir:
        Path(flag_dir).chmod(0o755)
        try:
            docker('network', 'create', '--internal', network)
            docker('run', '--detach', '--name', name, '--network', network,
                   '--mount', f'type=bind,source={config},target=/etc/nginx/conf.d/default.conf,readonly',
                   '--mount', f'type=bind,source={page_dir},target=/usr/share/nginx/maintenance,readonly',
                   '--mount', f'type=bind,source={flag_dir},target=/maintenance,readonly',
                   NGINX_IMAGE)
            docker('exec', name, 'nginx', '-t')
            wait_until_ready(name)

            status, _, _ = fetch(network, name, '/')
            assert status == 200, f'maintenance off: / returned {status}'

            Path(flag_dir, 'on').write_text('ci\n')

            status, headers, body = fetch(network, name, '/projetos/123')
            assert status == 503, f'SPA route returned {status}'
            assert 'Sistema em atualização' in body, body[:200]
            assert headers.get('content-type', '').startswith('text/html'), headers
            assert headers.get('retry-after') == '120', headers
            assert headers.get('cache-control') == 'no-store', headers
            assert "frame-ancestors 'none'" in headers.get('content-security-policy', ''), headers
            assert headers.get('x-frame-options') == 'DENY', headers
            assert 'max-age=' in headers.get('strict-transport-security', ''), headers

            status, headers, body = fetch(network, name, '/api/reports?x=1')
            assert status == 503, f'/api returned {status}'
            assert headers.get('content-type', '').startswith('application/json'), headers
            assert json.loads(body)['code'] == 'MAINTENANCE', body

            # Um cliente não vira "interno" mandando X-Forwarded-For.
            status, _, _ = fetch(network, name, '/api/reports', headers=['X-Forwarded-For: 127.0.0.1'])
            assert status == 503, f'spoofed X-Forwarded-For bypassed maintenance ({status})'

            status, _, body = fetch(network, name, '/nginx-health')
            assert status == 200 and body.strip() == 'ok', (status, body)
            status, _, _ = fetch(network, name, '/assets/Logo/LOGO_LOGIN.png')
            assert status != 503, 'static assets must bypass maintenance'

            local = docker('exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1/', check=False)
            assert local.returncode == 0, 'internal checks from 127.0.0.1 must bypass maintenance'

            Path(flag_dir, 'on').unlink()
            status, _, _ = fetch(network, name, '/')
            assert status == 200, f'maintenance removed: / returned {status}'
            print('Nginx maintenance: 503 page/JSON with security headers; health, assets and local checks bypass.')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], check=False, capture_output=True)
            subprocess.run(['docker', 'network', 'rm', network], check=False, capture_output=True)


if __name__ == '__main__':
    main()
