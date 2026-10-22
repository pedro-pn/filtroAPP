#!/usr/bin/env python3
"""Exercise the staging proxy in disposable Docker containers, without ACME or host ports."""

import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid


REPO = Path(__file__).resolve().parent.parent
DOMAIN = "filtrostaging.filtrovali.com.br"
NGINX_IMAGE = "nginx:1.27-alpine"
CADDY_IMAGE = "caddy:2.8-alpine"
NODE_IMAGE = "node:24-alpine"


def docker(*args, **kwargs):
    return subprocess.run(
        ["docker", *args], check=True, text=True, capture_output=True, **kwargs
    ).stdout.strip()


def eventually(check):
    deadline = time.monotonic() + 30
    while True:
        try:
            return check()
        except (AssertionError, subprocess.CalledProcessError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)


def main():
    prefix = f"staging-https-test-{uuid.uuid4().hex[:10]}"
    containers = []
    docker("network", "create", prefix)
    try:
        with tempfile.TemporaryDirectory(prefix=prefix) as directory:
            scratch = Path(directory)
            # Use the real Caddyfile, with a local CA so tests never contact ACME.
            caddyfile = (REPO / "deploy/infra-proxy/Caddyfile").read_text()
            (scratch / "Caddyfile").write_text(caddyfile.replace("{\n", "{\n\tlocal_certs\n", 1))

            def start(suffix, *args):
                name = f"{prefix}-{suffix}"
                containers.append(name)
                docker("run", "-d", "--name", name, "--network", prefix, *args)
                return name

            caddy = start(
                "caddy", "--network-alias", "infra-proxy-caddy",
                "--add-host", "host.docker.internal:127.0.0.1",
                "--tmpfs", "/data", "--tmpfs", "/config",
                "-v", f"{scratch / 'Caddyfile'}:/etc/caddy/Caddyfile:ro", CADDY_IMAGE,
            )
            start(
                "backend", "--network-alias", "backend", "--network-alias", "filtrovali-nginx",
                NODE_IMAGE, "node", "-e",
                "require('http').createServer((req,res)=>{"
                "res.setHeader('Content-Type','application/json');"
                "res.end(JSON.stringify({path:req.url,headers:req.headers}));"
                "}).listen(4000,'0.0.0.0');"
                "require('http').createServer((req,res)=>res.end('production upstream')).listen(80);",
            )
            allowed = start(
                "allowed", "-v", f"{scratch}:/test:ro", NODE_IMAGE, "sleep", "infinity",
            )
            blocked = start(
                "blocked", "-v", f"{scratch}:/test:ro", NODE_IMAGE, "sleep", "infinity",
            )
            allowed_ip = docker(
                "inspect", allowed, "--format",
                "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
            )
            nginx_args = [
                "-v", f"{REPO / 'deploy/nginx/staging.conf'}:/etc/nginx/conf.d/default.conf:ro",
                "-v", f"{REPO / 'deploy/nginx/15-staging-allowlist.sh'}:/docker-entrypoint.d/15-staging-allowlist.sh:ro",
            ]
            nginx = start(
                "nginx", "--network-alias", "filtrovali-staging-nginx", *nginx_args,
                "-e", f"STAGING_ALLOWED_IPS={allowed_ip}/32, 2001:db8::/32", NGINX_IMAGE,
            )
            eventually(lambda: docker(
                "cp", f"{caddy}:/data/caddy/pki/authorities/local/root.crt", str(scratch / "root.crt"),
            ))

            def request(client, path="/", *, tls=True, host=DOMAIN, direct=False, headers=None):
                options = {
                    "tls": tls, "hostname": nginx if direct else caddy,
                    "port": 443 if tls else 80, "path": path, "servername": host,
                    "headers": {"Host": host, **(headers or {})},
                }
                source = """
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
const options = JSON.parse(process.argv[1]);
if (options.tls) options.ca = fs.readFileSync('/test/root.crt');
const req = (options.tls ? https : http).request(options, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => console.log(JSON.stringify({status:res.statusCode,headers:res.headers,body})));
});
req.on('error', error => { console.error(error.message); process.exitCode = 1; });
req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
req.end();
"""
                return json.loads(docker(
                    "exec", "-i", client, "node", "--input-type=module", "-e", source,
                    json.dumps(options),
                ))

            def expect_status(client, status, path="/", **kwargs):
                response = request(client, path, **kwargs)
                assert response["status"] == status, response
                return response

            eventually(lambda: expect_status(allowed, 200, "/health"))
            for path in ["/api", "/api/check", "/uploads/check", "/relatorios/check",
                         "/certificados-calibracao/check", "/health", "/assets/missing-test-asset"]:
                response = expect_status(allowed, 200, path, headers={
                    "X-Forwarded-For": "203.0.113.250", "X-Forwarded-Proto": "http",
                })
                assert response["headers"]["x-environment"] == "staging", response
                upstream = json.loads(response["body"])
                assert upstream["path"] == path, upstream
                assert upstream["headers"]["host"] == DOMAIN, upstream
                assert upstream["headers"]["x-forwarded-proto"] == "https", upstream
                assert upstream["headers"]["x-real-ip"] == allowed_ip, upstream
                assert "203.0.113.250" not in upstream["headers"]["x-forwarded-for"], upstream
            expect_status(allowed, 200)
            print("PASS: trusted TLS, SPA, all upstream routes, client IP and HTTPS headers", flush=True)

            for path in ["/", "/health", "/api/check"]:
                expect_status(blocked, 403, path)
                expect_status(blocked, 403, path, headers={"X-Forwarded-For": "127.0.0.1"})
                expect_status(blocked, 403, path, tls=False, direct=True, headers={
                    "X-Forwarded-For": allowed_ip, "X-Forwarded-Proto": "https",
                })
            print("PASS: denied IPs and forged forwarded headers through Caddy and directly", flush=True)

            redirect = expect_status(allowed, 308, "/test?value=1", tls=False)
            assert redirect["headers"]["location"] == f"https://{DOMAIN}/test?value=1", redirect
            production = expect_status(allowed, 200, host="app.filtrovali.com.br")
            assert production["body"] == "production upstream", production
            legacy = expect_status(allowed, 301, host="relatorios.filtrovali.com.br")
            assert legacy["headers"]["location"] == "https://app.filtrovali.com.br/rdo", legacy
            print("PASS: HTTP redirect and existing production/legacy vhost routing", flush=True)

            for invalid in ["127.0.0.1;", "999.999.999.999"]:
                try:
                    docker("run", "--rm", "--network", prefix, *nginx_args,
                           "-e", f"STAGING_ALLOWED_IPS={invalid}", NGINX_IMAGE, "nginx", "-t")
                except subprocess.CalledProcessError:
                    continue
                raise AssertionError(f"Invalid allowlist accepted: {invalid}")

            docker("exec", "-e", "STAGING_ALLOWED_IPS=", nginx,
                   "/docker-entrypoint.d/15-staging-allowlist.sh")
            docker("exec", nginx, "nginx", "-t")
            docker("exec", nginx, "nginx", "-s", "reload")
            eventually(lambda: expect_status(allowed, 403))
            print("PASS: empty allowlist denies external access; malformed values prevent startup", flush=True)
    except Exception:
        for container in containers:
            logs = subprocess.run(["docker", "logs", "--tail", "15", container], text=True, capture_output=True)
            print(f"{container}:\n{logs.stdout}{logs.stderr}")
        raise
    finally:
        for container in reversed(containers):
            subprocess.run(["docker", "rm", "-f", "--volumes", container], capture_output=True)
        docker("network", "rm", prefix)


if __name__ == "__main__":
    main()
