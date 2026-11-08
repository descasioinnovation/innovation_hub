# Hub operations — monthly runbook

Short reference for running the Hub month to month. No secrets here — every script
below uses your own `gcloud auth application-default login` session (Admin SDK),
never a stored key. All commands run from the repo root.

## 1. Create next month's challenge

1. Copy `data/challenge-template.json` to a new file (e.g. `data/round-10.json`),
   fill in every field, delete the `_comment` key.
2. Dry run, then apply:
   ```bash
   node scripts/new-challenge.js data/round-10.json
   node scripts/new-challenge.js data/round-10.json --apply
   ```
   This only creates a brand-new round — it refuses to overwrite one that already
   exists.
3. **This only writes to live Firestore.** The offline fallback the app falls back
   to if Firestore is unreachable (`data/challenges-fallback.json`) is generated
   from `scripts/challenges-seed-data.js`, a separate hand-maintained file — it does
   NOT update automatically. To keep it in sync: add the same round object to the
   `CHALLENGES` array in `scripts/challenges-seed-data.js` by hand, then run:
   ```bash
   node scripts/regenerate-fallback.js
   ```
   Commit both the `challenges-seed-data.js` edit and the regenerated
   `data/challenges-fallback.json`.

## 2. Add a rich page + resources (optional)

- Only needed for a round getting the full rich-page treatment (sections, design
  pack, interactive checklist, scoring). Round 9 (`scripts/round9-page-content.js`)
  is the real worked example; the `page` shape is documented field-by-field in
  `data/challenge-template.json` under `_page_comment`.
- For a brand-new round, add `page` to the JSON file before running
  `new-challenge.js`. To add it to a round that already exists, write a small
  one-off patch script following `scripts/patch-round9-page.js`'s pattern (dry-run
  default, `--apply` flag, refuses to overwrite an existing `page`).
- Plain resource links (the small pill buttons shown under a simple round's brief,
  not the rich page) are the `resources` array on the challenge doc:
  `[{ "label": "...", "url": "..." }]` — add the same way, at creation or via a
  small patch script afterward.
- Remember step 1.3 above: anything you add to the live doc should also go into
  `scripts/challenges-seed-data.js` + `regenerate-fallback.js` if it should survive
  a Firestore outage.

## 3. Hide / unhide a submission

- **Hide:**
  ```bash
  node scripts/hide-round9-test-entries.js <submissionId> [<id> ...]
  node scripts/hide-round9-test-entries.js <submissionId> [<id> ...] --apply
  ```
  Despite the filename, this works on any submission id in any round — it only
  ever sets `hidden: true, hiddenReason: "test"`. For a different reason (e.g.
  `"duplicate"`), see `scripts/tidy-submissions.js` for the pattern, or edit the
  Firestore doc directly.
- **Unhide:** there's no dedicated script. In Firebase Console → Firestore
  Database → `artifacts/descasio-innovation-hub-perpetual/public/data/submissions/<id>`,
  delete the `hidden` and `hiddenReason` fields (or set `hidden` to `false`).
- The Admin tab itself only has shortlist (star) and delete buttons — hiding isn't
  exposed there, use the script/console path above.

## 4. Set the round's winner

```bash
node scripts/set-winner.js <round> <submissionId> [winnerImageUrl] [winnerLabel] [--name "Display Name"]
node scripts/set-winner.js <round> <submissionId> [winnerImageUrl] [winnerLabel] [--name "Display Name"] --apply
```

- `winnerImage` defaults to the winning submission's own `docLink` — only pass
  `winnerImageUrl` if you want to override it with a separately hosted image.
- It cross-checks that the submission's own `round` field matches the `<round>`
  you passed and refuses otherwise.
- Only ever touches `winnerName`, `winningSubmissionId`, `winnerImage`,
  `winnerLabel` on the challenge doc.

## 5. Update the leaderboard

- Source of truth: the `FINAL_STANDINGS` array in `js/data.js`. Each entry is
  `{ name, email, r1..rN, cumulativeScore, rank }`.
- To add a new round's scores: add `rN: <score>` to every person's entry (`0` for
  anyone who didn't enter that round), then hand-recompute `cumulativeScore` (sum
  of all `rN` fields) and `rank` (1 = highest `cumulativeScore`). Commit the
  `js/data.js` change.
- A brand-new entrant: add a new object with `0` for every earlier round.
- There's also a live Firestore `leaderboard` collection that merges on top of
  `FINAL_STANDINGS` by matching on `name` (see `js/app.js`'s leaderboard
  `onSnapshot` handler) — writing a doc there lets you push a correction without a
  deploy, but `FINAL_STANDINGS` in `js/data.js` is what ships with the code and
  should stay the actual record.

## 6. Add / remove an admin

The person must have signed in with Google via the Hub's Admin button at least
once first (even a "not an admin" rejection creates their Firebase Auth record).

```bash
node scripts/set-admin.js <email>              # dry run
node scripts/set-admin.js <email> --apply      # grant
node scripts/set-admin.js <email> --remove --apply   # revoke
```

They need to sign out and back in afterward — the claim only takes effect on a
fresh ID token.

## 7. Take a backup

```bash
node scripts/export.js
```

Read-only — it never writes to Firestore. Dumps every subcollection under
`artifacts/descasio-innovation-hub-perpetual/public/data` to
`backups/<YYYY-MM-DD>/<collection>.json`. `backups/` is gitignored and stays local.

## 8. Rollback

- **Code:** see `GO_LIVE.md` for the exact pre-redesign tag/commit; the pattern is
  ```bash
  git checkout main
  git reset --hard pre-redesign-oct-2026
  git push origin main --force
  ```
- **Firestore rules:** re-paste the saved old rules (`backups/2026-11-06/firestore.rules`)
  into Firebase Console → Firestore Database → Rules → Publish.
- **Data:** `scripts/export.js` backups are JSON snapshots for reference/recovery,
  not an automated restore — recovering from one means manually re-writing the
  affected docs (or scripting a one-off restore from the dump).
