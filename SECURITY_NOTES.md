# Security notes

Internal notes on known limitations and the interim/full fixes for them. No secrets
are stored here - API keys referenced below are Firebase **web** API keys, which are
public by design (every visitor's browser already has them) and are not credentials.

## OTP login (interim hardening, Step 7C)

The visitor login gate (`requestOtp`/`verifyOtp` in `js/app.js`) is entirely
client-side: a 6-digit code is generated in the browser, emailed via EmailJS, and
checked against what the browser itself generated. There is no server in this flow,
so this is fundamentally a convenience gate, not a real authentication boundary - it
restricts casual access to `@descasio.io` addresses, nothing more.

**What changed:** the plain 6-digit code used to sit in `state.generatedOtp` for the
life of the login flow. It's now never stored - only `hashString(salt + otp)` is kept
(`state.otpHash` + `state.otpSalt`), and `verifyOtp()` compares hashes. A `state.otpUsed`
flag stops the same hash being matched twice. This only protects against someone
reading the plain code out of in-memory JS state (e.g. via devtools on a shared
machine, or a future logging mistake) - it does not add real server-side verification.

**The full fix**, planned for after launch: replace this entire flow with Firebase
Authentication's email-link sign-in (`sendSignInLinkToEmail` / `isSignInWithEmailLink`).
That moves verification to Firebase's servers, removes EmailJS and the client-generated
code entirely, and gives each visitor a real Firebase Auth identity instead of a
`localStorage` flag layered on top of an anonymous session.

## Admin access (Step 7B)

Replaced a client-side password (SHA-256 hash of a fixed string, checked in the
browser) with Google Sign-In (Firebase Auth `GoogleAuthProvider`) gated by a custom
`admin: true` claim, set server-side via `scripts/set-admin.js` (Admin SDK, ADC). The
claim is the actual access boundary - Firestore rules check
`request.auth.token.admin == true`, not anything the client asserts about itself.

## Firestore rules (Step 7D)

`firestore.rules` in the repo root is a **draft** - not deployed automatically. The
rules currently live in production are the blanket
`allow read, write: if request.auth != null` rule, backed up at
`backups/2026-11-06/firestore.rules` (gitignored, kept locally as the rollback copy).
That blanket rule means any signed-in user (including every anonymous visitor, since
the app signs everyone in anonymously) can read, write, or delete *any* document in the
database - including other people's submissions, the leaderboard, and challenge data.
The draft rules scope every collection down to what the app actually needs (see the
comments in `firestore.rules` itself for the per-collection reasoning), in particular:
submissions can only be created for a round that's genuinely open right now, and a
client can never set its own `hidden`/`winningSubmissionId`/`shortlisted: true` fields.

After publishing, run `node scripts/test-rules.js` to confirm the new rules actually
behave as intended from a real anonymous session (not the Admin SDK, which bypasses
rules entirely).
