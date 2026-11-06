// Creates a new challenges/round-N doc from a JSON file shaped like
// data/challenge-template.json. Dry-run by default (validates + prints the doc);
// pass --apply to actually write it. Additive only - refuses to overwrite a round
// that already exists. name/email/dept/entry-type are always collected by the
// submission form itself and must never be listed under `requirements`.
//
// Usage: node scripts/new-challenge.js path/to/file.json [--apply]
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const CHALLENGES_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges';
const BUILTIN_FIELD_IDS = ['name', 'email', 'dept', 'department', 'type', 'teamName', 'member1Name', 'member1Email', 'member1Dept', 'member2Name', 'member2Email', 'member2Dept'];
const VALID_REQ_TYPES = ['url', 'text', 'textarea', 'multiselect'];

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

function validate(data) {
    const errors = [];
    const required = ['round', 'month', 'year', 'slug', 'title', 'summary', 'opensAt', 'closesAt'];
    for (const f of required) {
        if (data[f] === undefined || data[f] === null || data[f] === '') errors.push(`missing required field: ${f}`);
    }
    if (typeof data.round !== 'number') errors.push('round must be a number');
    if (data.opensAt && isNaN(new Date(data.opensAt).getTime())) errors.push('opensAt is not a valid date');
    if (data.closesAt && isNaN(new Date(data.closesAt).getTime())) errors.push('closesAt is not a valid date');
    if (data.opensAt && data.closesAt && new Date(data.opensAt) >= new Date(data.closesAt)) errors.push('opensAt must be before closesAt');
    if (!Array.isArray(data.requirements) || !data.requirements.length) errors.push('requirements must be a non-empty array');
    (data.requirements || []).forEach((req, i) => {
        if (!req.id) errors.push(`requirements[${i}] missing id`);
        if (BUILTIN_FIELD_IDS.includes(req.id)) errors.push(`requirements[${i}] id "${req.id}" is a built-in field (name/email/department/entry type) and must not be listed as a requirement`);
        if (!req.label) errors.push(`requirements[${i}] missing label`);
        if (!VALID_REQ_TYPES.includes(req.type)) errors.push(`requirements[${i}] type must be one of ${VALID_REQ_TYPES.join(', ')}`);
        if (req.type === 'multiselect' && (!Array.isArray(req.options) || !req.options.length)) errors.push(`requirements[${i}] (multiselect) needs a non-empty options array`);
    });
    return errors;
}

async function main() {
    const file = process.argv[2];
    if (!file || file === '--apply') {
        console.error('Usage: node scripts/new-challenge.js path/to/file.json [--apply]');
        process.exit(1);
    }
    const apply = process.argv.includes('--apply');
    const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    delete data._comment;

    // Firestore rules can't parse an ISO-8601 string into a Timestamp, so the open-round
    // submission rule compares against plain epoch-millisecond numbers - derived here
    // automatically, never hand-typed in the source JSON.
    if (data.opensAt) data.opensAtMs = new Date(data.opensAt).getTime();
    if (data.closesAt) data.closesAtMs = new Date(data.closesAt).getTime();

    const errors = validate(data);
    if (errors.length) {
        console.error('Validation failed:');
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
    }

    console.log('Validated OK. Doc to write:', JSON.stringify(data, null, 2));

    getAdminApp();
    const db = admin.firestore();
    const docId = data.slug || `round-${data.round}`;
    const ref = db.collection(CHALLENGES_PATH).doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
        console.error(`\nRefusing to overwrite: ${CHALLENGES_PATH}/${docId} already exists. This script only creates new rounds.`);
        process.exit(1);
    }

    if (!apply) {
        console.log(`\nDRY RUN ONLY - no write made. Would create ${CHALLENGES_PATH}/${docId}. Pass --apply to write.`);
        return;
    }

    await ref.set(data);
    console.log(`\nCreated ${CHALLENGES_PATH}/${docId}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
