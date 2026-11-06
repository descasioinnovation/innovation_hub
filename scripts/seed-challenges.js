// Creates artifacts/descasio-innovation-hub-perpetual/public/data/challenges/round-1..round-9
// from scripts/challenges-seed-data.js. DRY-RUN BY DEFAULT — pass --apply to write.
//
// Never overwrites an existing challenges/{round-N} doc: if one already exists this
// script skips it with a warning, so re-running after a manual edit can't clobber it.
//
//   node seed-challenges.js            -> dry run, prints + returns preview
//   node seed-challenges.js --apply    -> actually creates the 9 docs (skipping any that exist)

const admin = require('firebase-admin');
const { CHALLENGES } = require('./challenges-seed-data');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const CHALLENGES_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: PROJECT_ID
    });
}

function briefLength(brief) {
    return brief.reduce((n, block) => n + (block.type === 'p' ? block.text.length : block.items.join(' ').length), 0);
}

function briefFirstSentence(brief) {
    const firstP = brief.find(b => b.type === 'p');
    if (!firstP) return '(no brief text)';
    const m = firstP.text.match(/^[^.!?]*[.!?]/);
    return m ? m[0] : firstP.text.slice(0, 120);
}

async function buildPreview() {
    getAdminApp();
    const db = admin.firestore();
    const col = db.collection(CHALLENGES_PATH);

    const rows = [];
    for (const ch of CHALLENGES) {
        const docId = `round-${ch.round}`;
        const existing = await col.doc(docId).get();
        rows.push({
            docId,
            round: ch.round,
            month: ch.month,
            title: ch.title,
            opensAt: ch.opensAt,
            closesAt: ch.closesAt,
            datesApproximate: ch.datesApproximate,
            datesNote: ch.datesNote,
            winnerName: ch.winnerName,
            winningSubmissionId: ch.winningSubmissionId,
            entryCount: ch.entryCount,
            requirementLabels: ch.requirements.map(r => r.label),
            briefUnavailable: !!ch.briefUnavailable,
            briefLength: briefLength(ch.brief),
            briefFirstSentence: briefFirstSentence(ch.brief),
            alreadyExistsInFirestore: existing.exists,
            data: ch
        });
    }
    return rows;
}

async function apply(rows) {
    const db = admin.firestore();
    const col = db.collection(CHALLENGES_PATH);
    let written = 0, skipped = 0;
    for (const row of rows) {
        if (row.alreadyExistsInFirestore) {
            console.log(`  SKIP ${row.docId} — already exists, not overwriting`);
            skipped++;
            continue;
        }
        const { data } = row;
        const { _source, ...docData } = data; // keep _source out of the stored doc; it's documentation for this script, not app data
        await col.doc(row.docId).set(docData);
        console.log(`  WROTE ${row.docId}`);
        written++;
    }
    return { written, skipped };
}

async function main() {
    const applyFlag = process.argv.includes('--apply');
    const rows = await buildPreview();

    console.log('round  month      title                                    opens->closes                              approx  winner                 entries  reqs');
    for (const r of rows) {
        console.log(
            `R${r.round}     ${r.month.padEnd(10)} ${r.title.slice(0, 38).padEnd(40)} ${r.opensAt.slice(0,10)}->${r.closesAt.slice(0,10)}  ${String(r.datesApproximate).padEnd(6)}  ${(r.winnerName || '(none yet)').padEnd(22)} ${String(r.entryCount).padEnd(7)}  ${r.requirementLabels.join(' | ')}`
        );
    }

    const existing = rows.filter(r => r.alreadyExistsInFirestore);
    if (existing.length) {
        console.log(`\n${existing.length} doc(s) already exist in Firestore and would be SKIPPED, not overwritten: ${existing.map(r => r.docId).join(', ')}`);
    }

    if (applyFlag) {
        console.log('\n--apply passed: writing now...');
        const { written, skipped } = await apply(rows);
        console.log(`Done. ${written} created, ${skipped} skipped (already existed).`);
    } else {
        console.log('\nDRY RUN ONLY — no writes made. Pass --apply to create these docs.');
    }
}

module.exports = { buildPreview, apply };

if (require.main === module) {
    main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
