// Sets a round's winner on its challenges doc, deriving winnerName from the given
// submission (teamName for a group entry, name for an individual one). Dry-run by
// default; pass --apply to write. Only ever updates winnerName, winningSubmissionId,
// winnerImage and winnerLabel - nothing else on the doc, and never touches the
// submissions collection.
//
// Usage: node scripts/set-winner.js <round> <submissionId> [winnerImageUrl] [winnerLabel] [--apply]
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const BASE_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    const args = process.argv.slice(2).filter(a => a !== '--apply');
    const apply = process.argv.includes('--apply');
    const [roundArg, submissionId, winnerImageArg, winnerLabelArg] = args;

    if (!roundArg || !submissionId) {
        console.error('Usage: node scripts/set-winner.js <round> <submissionId> [winnerImageUrl] [winnerLabel] [--apply]');
        process.exit(1);
    }
    const round = Number(roundArg);
    if (!Number.isInteger(round)) {
        console.error(`"${roundArg}" is not a valid round number.`);
        process.exit(1);
    }

    getAdminApp();
    const db = admin.firestore();

    const subRef = db.doc(`${BASE_PATH}/submissions/${submissionId}`);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
        console.error(`Submission not found: ${submissionId}`);
        process.exit(1);
    }
    const submission = subSnap.data();
    const effRound = submission.round === undefined || submission.round === null ? 1 : submission.round;
    if (effRound !== round) {
        console.error(`Submission ${submissionId} is tagged round ${effRound}, not round ${round}. Refusing - check the id.`);
        process.exit(1);
    }

    const challengeRef = db.doc(`${BASE_PATH}/challenges/round-${round}`);
    const challengeSnap = await challengeRef.get();
    if (!challengeSnap.exists) {
        console.error(`Challenge doc not found: challenges/round-${round}`);
        process.exit(1);
    }
    const challenge = challengeSnap.data();

    const winnerName = submission.type === 'group' ? submission.teamName : submission.name;
    if (!winnerName) {
        console.error(`Submission ${submissionId} has no usable name/teamName field.`);
        process.exit(1);
    }

    const winnerImage = winnerImageArg || submission.docLink || challenge.winnerImage || null;
    const winnerLabel = winnerLabelArg || `Round ${round} ${challenge.title} Winner`;

    const update = {
        winnerName,
        winningSubmissionId: submissionId,
        winnerImage,
        winnerLabel
    };

    console.log(`challenges/round-${round} - current winner fields:`, {
        winnerName: challenge.winnerName || null,
        winningSubmissionId: challenge.winningSubmissionId || null,
        winnerImage: challenge.winnerImage || null,
        winnerLabel: challenge.winnerLabel || null
    });
    console.log(`challenges/round-${round} - new winner fields:`, update);

    if (!apply) {
        console.log('\nDRY RUN ONLY - no write made. Pass --apply to write.');
        return;
    }

    await challengeRef.update(update);
    console.log(`\nApplied to challenges/round-${round}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
