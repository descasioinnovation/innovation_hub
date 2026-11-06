// Additive patch: adds opensAtMs/closesAtMs (epoch-millisecond numbers, derived from
// the existing opensAt/closesAt ISO strings) to every challenges/round-N doc that
// doesn't already have them. Needed because Firestore security rules can't parse an
// ISO-8601 string into a Timestamp - the open-round submission rule in firestore.rules
// compares request.time.toMillis() against these numbers instead. Never touches
// opensAt/closesAt or any other field. Dry-run by default; pass --apply to write.
const admin = require('firebase-admin');
const { CHALLENGES } = require('./challenges-seed-data');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const CHALLENGES_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    getAdminApp();
    const db = admin.firestore();
    const apply = process.argv.includes('--apply');

    for (const ch of CHALLENGES) {
        const docId = ch.slug || `round-${ch.round}`;
        const ref = db.collection(CHALLENGES_PATH).doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
            console.log(`${docId}: doc not found, skipping`);
            continue;
        }
        const live = snap.data();
        const update = {};
        if (live.opensAtMs === undefined && ch.opensAtMs !== undefined) update.opensAtMs = ch.opensAtMs;
        if (live.closesAtMs === undefined && ch.closesAtMs !== undefined) update.closesAtMs = ch.closesAtMs;

        if (!Object.keys(update).length) {
            console.log(`${docId}: nothing to add`);
            continue;
        }

        console.log(`${docId}: will add ->`, update);
        if (apply) {
            await ref.update(update);
            console.log(`${docId}: applied`);
        }
    }

    if (!apply) console.log('\nDRY RUN ONLY - no writes made. Pass --apply to write.');
}

main().catch(err => { console.error(err); process.exit(1); });
