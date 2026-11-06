# Go-live steps

Written the night before. Branch `hub-redesign` is clean and fully pushed as of
commit `8c7154c0b268ca7fad3272d609e5f7e258dbbf40`. No secrets in this file.

## 1. Merge the PR

Open (or reuse) the PR from `hub-redesign` into `main`. Merge it with a **merge
commit** (not squash, not rebase) and **keep the branch** afterward.

```bash
gh pr create --title "Redesign: go live" --base main --head hub-redesign --body "Go-live merge for the redesigned Hub."
# merge on GitHub with "Create a merge commit", do not delete the branch
```

## 2. Tag the release

After the merge lands on `main`:

```bash
git checkout main
git pull origin main
git tag redesign-live-nov-2026
git push origin redesign-live-nov-2026
```

## 3. Check the live site

Wait for GitHub Pages to publish, then hard-refresh **https://ai.innovation-hub.com.ng**:

- Every tab loads (Dashboard, Challenges, Submissions, Idea Hub, Winners, Leaderboard).
- Phone width (DevTools or a real phone): nav grid at ≤640px, hero fits at 320px.
- The Round 9 "Opens Monday 9 Nov, 8:00 AM" state shows correctly (upcoming, form
  disabled, feed under wraps).
- The countdown is correct and ticking.

## 4. Publish the Firestore rules

Paste the contents of `firestore.rules` (repo root) into Firebase Console →
Firestore Database → Rules → Publish.

The rollback copy of the rules **currently live** (the blanket
`allow read, write: if request.auth != null` rule, in case you need to revert) is
saved locally at:

```
backups/2026-11-06/firestore.rules
```

## 5. Run the rules test

Tell me when the new rules are published; I'll run:

```bash
node scripts/test-rules.js
```

This signs in as a real anonymous user (not the Admin SDK) and confirms: anonymous
update/delete on submissions and challenges is denied, creating a submission for a
closed round is denied, creating a challenges doc is denied, and listing `otps` is
denied. (A valid create on the now-open round can't be tested until Round 9 is
actually open - re-run after Monday 9 Nov, 08:00 WAT to confirm that path too.)

## 6. Admin test

Sign in with Google from the Admin button (either admin account) and test one admin
action - shortlist or delete a submission - to confirm the new rules don't block
legitimate admin writes.

---

## Rollback (if something goes wrong)

```bash
git checkout main
git reset --hard pre-redesign-oct-2026
git push origin main --force
```

Then re-paste the saved old rules from `backups/2026-11-06/firestore.rules` into
Firebase Console → Firestore Database → Rules → Publish.
