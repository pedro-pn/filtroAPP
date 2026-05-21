import assert from 'node:assert/strict';
import test from 'node:test';

import { isRdoDraftPayload, rdoDraftItems } from '../src/routes/resources/drafts.js';

test('RDO draft filtering keeps legacy untagged drafts visible', () => {
  const items = [
    { id: 'legacy', payload: { projectId: 'project-1' } },
    { id: 'rdo', payload: { __module: 'rdo', projectId: 'project-1' } },
    { id: 'romaneio', payload: { __module: 'romaneio', projectId: 'project-1' } }
  ];

  assert.deepEqual(rdoDraftItems(items).map(item => item.id), ['legacy', 'rdo']);
});

test('RDO draft payload check only excludes romaneio drafts', () => {
  assert.equal(isRdoDraftPayload({ projectId: 'project-1' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'rdo' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'romaneio' }), false);
});
