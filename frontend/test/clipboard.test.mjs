import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../src/utils/clipboard.ts';

function installGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}
function legacyBrowser(t, outcome = true) {
  const state = { copied: null, children: [], restored: false };
  const dialog = { appendChild(field) { state.children.push(field); } };
  const field = { value: '', style: {}, focus() {}, select() {}, setSelectionRange() {}, remove() { state.children.splice(state.children.indexOf(this), 1); } };
  const doc = { activeElement: { closest: () => dialog, focus: () => { state.restored = true; } },
    body: { appendChild() { assert.fail('A cópia do modal deve permanecer dentro do diálogo'); } },
    createElement: () => field, execCommand(command) { assert.equal(command, 'copy'); state.copied = field.value; if (outcome instanceof Error) throw outcome; return outcome; } };
  installGlobal(t, 'document', doc);
  return { state, field, doc };
}

test('API nativa copia o texto exato sem criar campo temporário', async t => {
  let copied;
  installGlobal(t, 'navigator', { clipboard: { async writeText(text) { copied = text; } } });
  installGlobal(t, 'document', { createElement() { assert.fail('Cópia nativa não precisa de campo temporário'); } });
  assert.equal(await copyTextToClipboard('synthetic-token'), true);
  assert.equal(copied, 'synthetic-token');
});

test('sem Clipboard API copia no diálogo e limpa o valor temporário', async t => {
  installGlobal(t, 'navigator', {});
  const { state, field } = legacyBrowser(t);
  const result = copyTextToClipboard('synthetic-token');
  assert.equal(state.copied, 'synthetic-token', 'Fallback começa durante o clique, sem espera assíncrona');
  assert.equal(await result, true);
  assert.equal(field.value, '');
  assert.deepEqual(state.children, []);
  assert.equal(state.restored, true);
});

test('permissão nativa recusada tenta o fallback e preserva quebras do cURL', async t => {
  installGlobal(t, 'navigator', { clipboard: { async writeText() { throw new Error('NotAllowedError'); } } });
  const { state } = legacyBrowser(t);
  const curl = 'curl --fail-with-body \\\n  -H "Authorization: Bearer $FILTRO_API_TOKEN"';
  assert.equal(await copyTextToClipboard(curl), true);
  assert.equal(state.copied, curl);
});

test('recusa ou erro no fallback não informa sucesso e sempre limpa o campo', async t => {
  installGlobal(t, 'navigator', {});
  for (const outcome of [false, new Error('copy blocked')]) {
    const { state, field } = legacyBrowser(t, outcome);
    assert.equal(await copyTextToClipboard('synthetic-token'), false);
    assert.equal(field.value, '');
    assert.deepEqual(state.children, []);
    assert.equal(state.restored, true);
  }
});

test('sem nenhuma API disponível retorna falha para habilitar a cópia manual', async t => {
  installGlobal(t, 'navigator', {});
  installGlobal(t, 'document', {});
  assert.equal(await copyTextToClipboard('synthetic-token'), false);
});
