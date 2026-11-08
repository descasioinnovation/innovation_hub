// One-off, dry-run-by-default patch to round-8's challenge doc: adds the "How to
// Participate" list (present in rounds 4/6/7's brief but missing from round-8's,
// an oversight from the original seed) and a `resources` link for the Landing Page
// Starter Kit that's currently a hardcoded link in the old (soon to be replaced)
// Challenge tab markup. Preserves everything else in the document untouched.
//
//   node patch-round8.js            -> dry run, shows the new brief/resources
//   node patch-round8.js --apply    -> writes it

const admin = require('firebase-admin');
const PROJECT_ID = 'ai-innovation-hub-submissions';
const DOC_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges/round-8';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

const HOW_TO_PARTICIPATE = {
    type: 'list',
    items: [
        'Build in Gemini Canvas: Log in to gemini.google.com with your descasio.io account, attach the official Descasio logo and brand colors, and prompt Gemini in Canvas to build the DIP landing page covering every required section.',
        'Test Before You Submit: Open your Canvas share link in a private/incognito window to confirm it loads without signing in.',
        'Submit Your Link: Paste your Gemini Canvas share link into the submission form. Deadline: 11:59 PM (WAT), 28 October 2026.'
    ]
};

const RESOURCES = [
    { label: 'Landing Page Starter Kit', url: 'https://drive.google.com/drive/folders/1Xg80YH3vbROjBYxxtpGsTwyx9zV2BjH6?usp=sharing' }
];

async function main() {
    getAdminApp();
    const db = admin.firestore();
    const ref = db.doc(DOC_PATH);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('round-8 challenge doc not found');
    const data = snap.data();

    const newBrief = [...data.brief, HOW_TO_PARTICIPATE];

    console.log('Current brief has', data.brief.length, 'blocks; new brief will have', newBrief.length, 'blocks.');
    console.log('Adding block:', JSON.stringify(HOW_TO_PARTICIPATE, null, 2));
    console.log('Adding resources field:', JSON.stringify(RESOURCES, null, 2));

    if (process.argv.includes('--apply')) {
        await ref.update({ brief: newBrief, resources: RESOURCES });
        console.log('Applied.');
    } else {
        console.log('\nDRY RUN ONLY — no write made. Pass --apply to write.');
    }
}

main().catch(err => { console.error(err); process.exit(1); });
