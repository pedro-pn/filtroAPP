#!/usr/bin/env python3
"""Exercise Nginx liveness in a disposable local container without networks/ports."""
import json
from pathlib import Path
import subprocess
import uuid


def docker(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def main():
    context = json.loads(docker('context', 'inspect'))[0]
    import os
    endpoint = os.environ.get('DOCKER_HOST') or context['Endpoints']['docker']['Host']
    if not endpoint.startswith('unix://'):
        raise RuntimeError('This test requires a local Docker Unix socket.')
    config = Path(__file__).resolve().parent / 'nginx/default.conf'
    name = 'filtro-performance-nginx-health-' + uuid.uuid4().hex[:10]
    try:
        docker('run', '--detach', '--name', name, '--network', 'none',
               '--mount', f'type=bind,source={config},target=/etc/nginx/conf.d/default.conf,readonly',
               'nginx:1.27-alpine')
        docker('exec', name, 'nginx', '-t')
        import time
        for attempt in range(30):
            try:
                response = docker('exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1/nginx-health')
                if response != 'ok':
                    raise AssertionError(response)
                break
            except subprocess.CalledProcessError:
                if attempt == 29:
                    raise
                time.sleep(.1)
        print('Nginx health: HTTP 200, no upstream, network or host ports required.')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, capture_output=True)


if __name__ == '__main__':
    main()
