# Search regression in a browser

Start the frontend with `npm run dev`. Open `/test/browser/search-race.html` in an
isolated Playwright CLI session, then run:

```sh
playwright-cli run-code --filename frontend/test/browser/search-race.js
```

Run the CLI command from the repository root, using the same session that opened
the fixture. The fixture uses real React and React Query, with manually resolved
HTTP responses. It deliberately ignores transport cancellation to also test the
hook's stale-response guard. No backend or credentials are needed.
