import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const loadCompose = name => parse(fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'));
const staging = loadCompose('docker-compose.staging.yml');
const production = loadCompose('docker-compose.prod.yml');

test('staging uses the production resource budgets, pools, readiness and database settings', () => {
  assert.deepEqual(Object.keys(staging.services).sort(), Object.keys(production.services).sort());
  for (const name of Object.keys(production.services)) {
    for (const field of ['cpus', 'mem_limit', 'pids_limit', 'healthcheck', 'depends_on', 'command']) {
      assert.deepEqual(staging.services[name][field], production.services[name][field], `${name}.${field}`);
    }
  }
  for (const name of ['backend', 'worker']) {
    const actual = staging.services[name];
    for (const key of Object.keys(production.services[name].environment)) {
      assert.equal(actual.environment[key], production.services[name].environment[key], `${name}.${key}`);
    }
    assert.equal(actual.environment.BACKGROUND_JOBS_IN_API, 'false');
    assert.deepEqual(actual.build, production.services[name].build);
  }
});

test('staging worker keeps staging configuration, storage and private network', () => {
  for (const [name, service] of Object.entries(staging.services)) {
    assert.notEqual(service.container_name, production.services[name].container_name);
    assert.equal(service.ports, undefined, `${name} must not expose a host port`);
  }
  for (const name of ['backend', 'worker']) {
    const service = staging.services[name];
    assert.equal(service.environment.APP_ENV, 'staging');
    assert.equal(service.environment.SEND_CLIENT_EMAILS, 'false');
    assert.deepEqual(service.env_file, ['backend/.env.staging']);
    assert.deepEqual(service.networks, ['filtrovali-staging-net']);
    assert.deepEqual(service.volumes, staging.services.backend.volumes);
    assert.ok(service.volumes.every(volume => !volume.includes('filtrovali_relatorios:')));
  }
  assert.equal(staging.services.worker.environment.COMERCIALAPP_ALLOW_STAGING_HTTP,
    staging.services.backend.environment.COMERCIALAPP_ALLOW_STAGING_HTTP);
});
