// Additive patch: adds a `placeholder` string to every requirement (rounds 1-4, 9)
// that doesn't already have one, matching scripts/challenges-seed-data.js. Never
// touches a requirement that already has a placeholder, or any other field.
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
        if (!Array.isArray(live.requirements)) {
            console.log(`${docId}: no requirements array, skipping`);
            continue;
        }

        let changed = false;
        const newRequirements = live.requirements.map(liveReq => {
            if (liveReq.placeholder) return liveReq; // never overwrite an existing placeholder
            const seedReq = (ch.requirements || []).find(r => r.id === liveReq.id);
            if (!seedReq || !seedReq.placeholder) return liveReq;
            changed = true;
            return { ...liveReq, placeholder: seedReq.placeholder };
        });

        if (!changed) {
            console.log(`${docId}: nothing to add`);
            continue;
        }

        console.log(`${docId}: will add placeholders ->`, JSON.stringify(newRequirements, null, 2));
        if (apply) {
            await ref.update({ requirements: newRequirements });
            console.log(`${docId}: applied`);
        }
    }

    if (!apply) console.log('\nDRY RUN ONLY - no writes made. Pass --apply to write.');
}

main().catch(err => { console.error(err); process.exit(1); });
