# Serve Receive

The public web companion to the native app, hosted at https://timbergeron.com/sr/.
Open `index.html` through a static HTTP server; no build step is required.

After editing scripts or styles, refresh the asset URLs and run the model regression checks:

```sh
node scripts/version-assets.cjs
node tests/parity.cjs
```

Browser rendering checks include Chromium and WebKit at narrow phone widths in
light and dark mode. They check painted player and position text, glyph centering
for names and numbers, overlapping circles, exported courts, the setup title and
the Team sheet. Touch checks cover Safari event targeting, drag cancellation of
scrolling, one-step undo, and native Chromium swipes on players and empty court
space. Run them with `npm ci`, `npx playwright install --with-deps webkit`,
and `npm run test:browser` (set `SR_BROWSER=chromium` to check Chromium).

Settings, court menus and new setups use **Smart Arrange** and **Court Position**.
Only roles in the active system participate in court label collision checks, while
all roster details remain stored and shared. Share links require numeric version 1;
boundary ties caused by coordinate rounding are separated inward. Player drags are
scoped to the document and system where they began.

The canonical host serves this directory with nginx. Deploy the tracked HTML,
JavaScript, CSS and `assets/`, `privacy/`, and `support/` files, publishing
`index.html` last. Its content hashes bypass nginx's 30-day asset cache. Native CI
also checks formation and share-link parity against a pinned revision of this repo.
