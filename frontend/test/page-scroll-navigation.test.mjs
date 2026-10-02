import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadPageScroll() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/layout/pageScroll.ts');
  } finally {
    await server.close();
  }
}

function setGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  return () => previous
    ? Object.defineProperty(globalThis, name, previous)
    : delete globalThis[name];
}

test('page navigation scrolls the visible scroller and respects reduced motion', async () => {
  const { pageScrollElement, scrollPageTo, PAGE_SCROLL_COMMAND_EVENT } = await loadPageScroll();
  const documentCalls = [];
  const pageCalls = [];
  const events = [];
  const documentScroller = {
    clientHeight: 600, scrollHeight: 1600, scrollTop: 380,
    scrollTo: options => documentCalls.push(options)
  };
  const pageScroller = {
    clientHeight: 400, scrollHeight: 2200, scrollTop: 0,
    scrollTo: options => pageCalls.push(options)
  };
  let reducedMotion = false;
  const restoreDocument = setGlobal('document', {
    scrollingElement: documentScroller,
    documentElement: documentScroller,
    body: {},
    querySelector: selector => selector.includes('.fv-app-shell__content .page-scroll') ? pageScroller : null
  });
  const restoreWindow = setGlobal('window', {
    matchMedia: () => ({ matches: reducedMotion }),
    dispatchEvent: event => events.push(event.type)
  });

  try {
    assert.equal(pageScrollElement(), documentScroller);
    scrollPageTo('start');
    assert.deepEqual(documentCalls, [{ top: 0, behavior: 'smooth' }]);

    documentScroller.scrollTop = 0;
    pageScroller.scrollTop = 420;
    reducedMotion = true;
    assert.equal(pageScrollElement(), pageScroller);
    scrollPageTo('end');
    assert.deepEqual(pageCalls, [{ top: 2200, behavior: 'auto' }]);
    assert.deepEqual(events, [PAGE_SCROLL_COMMAND_EVENT, PAGE_SCROLL_COMMAND_EVENT]);
  } finally {
    restoreWindow();
    restoreDocument();
  }
});
