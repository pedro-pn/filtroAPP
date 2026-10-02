#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const directory = process.env.REDESIGN_WORK_DIR;
const image = process.env.REDESIGN_CONVERTER_IMAGE;
if (!directory?.includes('/output/validation/filtrovali_redesign_validation_') || !image) throw new Error('Isolated conversion environment required.');
const args = process.argv.slice(2).map(arg => arg.startsWith('-env:UserInstallation=') ? '-env:UserInstallation=file:///tmp/validation-profile' : arg);
const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp', '--mount', `type=bind,source=${directory},target=${directory}`, '--entrypoint', '/usr/bin/soffice', image, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
