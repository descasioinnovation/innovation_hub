// Sets or removes the `admin: true` custom claim on a Firebase Auth user, identified
// by email. Dry-run by default; pass --apply to write. Requires the user to already
// have signed in at least once (with Google) so a Firebase Auth record exists for
// their email - a rejected "not an admin" sign-in from the Hub's Admin button is
// enough to create that record.
//
// Usage: node scripts/set-admin.js <email> [--remove] [--apply]
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    const email = process.argv[2];
    const remove = process.argv.includes('--remove');
    const apply = process.argv.includes('--apply');

    if (!email || email.startsWith('--')) {
        console.error('Usage: node scripts/set-admin.js <email> [--remove] [--apply]');
        process.exit(1);
    }

    getAdminApp();

    let user;
    try {
        user = await admin.auth().getUserByEmail(email);
    } catch (e) {
        console.error(`No Firebase Auth user found for ${email}.`);
        console.error('They need to sign in with Google at least once first (via the Hub\'s Admin button - a "not an admin" rejection still creates the account record), then re-run this script.');
        process.exit(1);
    }

    const currentClaims = user.customClaims || {};
    console.log(`${email} (uid ${user.uid}) - current custom claims:`, currentClaims);

    const newClaims = { ...currentClaims };
    if (remove) {
        delete newClaims.admin;
    } else {
        newClaims.admin = true;
    }
    console.log(`${email} - new custom claims:`, newClaims);

    if (!apply) {
        console.log('\nDRY RUN ONLY - no change made. Pass --apply to write.');
        return;
    }

    await admin.auth().setCustomUserClaims(user.uid, newClaims);
    console.log(`\nApplied. ${email} must sign out and back in (so a fresh ID token carries the new claim) to see the effect.`);
}

main().catch(err => { console.error(err); process.exit(1); });
