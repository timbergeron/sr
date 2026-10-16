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
The artwork checks also cover phone and desktop uploads, crop gestures and
keyboard movement, cancel/re-edit, transparent logos, persistence, and actual
SVG/PNG/PDF canvas rendering. Tests route the local files through a browser origin
without needing a localhost server.

Settings, court menus and new setups use **Smart Arrange** and **Court Position**.
Only roles in the active system participate in court label collision checks, while
all roster details remain stored and shared. Share links require numeric version 1;
boundary ties caused by coordinate rounding are separated inward. Player drags are
scoped to the document and system where they began.

The web app includes the player-photo, team-watermark and display changes through
native revision `2cd83c4` (2026-10-16). In **Your team**, use **Add photo** beside a
position, then drag or pinch to frame it and choose **Use Photo**. A zoom slider,
arrow-key crop movement, and **Reset crop** are available. **Adjust crop** reopens
the retained source; canceling preserves the saved photo. Photos follow the
displayed roster position through all six rotations, with labels and role and
receiver borders above them.

Photo captions use white lettering with a black outline, leaving the image visible
between letters. In **Court view**, turn **Labels on photos** off for photo-only
circles without names, numbers, role codes or position badges. Missing or unreadable
photos keep their labels. This preference is saved with setups and shared links,
and applies to all six courts and image/PDF exports.

**Reset positions** (or **Reset R1** on phones) sits beside each court's view menu.
It restores Court Position for that rotation, keeps receivers and player details,
and can be undone. The button is disabled when the saved formation already matches
Court Position. Resetting all six rotations from **Edit** asks for confirmation.

Under **Court watermark**, add a team logo and set its opacity from 0% to 40%
(16% by default). Transparent logos stay transparent. Artwork is resized and
re-encoded before saving, stays with the setup through reloads, duplication and
full-library backups, and appears in image and PDF exports. New setups and
incoming share previews start without artwork. Share-link bytes are unchanged.
Browser storage limits still apply; failed saves keep the in-memory setup and
show the existing retry and backup controls.

The canonical host serves this directory with nginx. Deploy the tracked HTML,
JavaScript, CSS and `assets/`, `privacy/`, and `support/` files, publishing
`index.html` last. Its content hashes bypass nginx's 30-day asset cache. Native CI
also checks formation and share-link parity against a pinned revision of this repo.
