// Runs seed-challenges.js and tidy-submissions.js in dry-run (read-only) mode,
// combines their previews, writes backups/<date>/step2-preview.json, and prints
// the two tables requested: (1) round-1..9 summary, (2) submission changes.
// This script never writes to Firestore itself and never passes --apply through.

const fs = require('fs');
const path = require('path');
const seedChallenges = require('./seed-challenges');
const tidySubmissions = require('./tidy-submissions');

async function main() {
    const challengeRows = await seedChallenges.buildPreview();
    const tidyPreview = await tidySubmissions.buildPreview();

    const dateStr = new Date().toISOString().slice(0, 10);
    const outDir = path.join(__dirname, '..', 'backups', dateStr);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'step2-preview.json');
    fs.writeFileSync(outPath, JSON.stringify({ challenges: challengeRows, submissions: tidyPreview }, null, 2));

    console.log('=== TABLE 1: round-1..round-9 ===\n');
    console.log('| Round | Title | Dates | Winner | Entries | Requirement labels | Brief len | First sentence |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of challengeRows) {
        const dates = `${r.opensAt.slice(0,10)} → ${r.closesAt.slice(0,10)}${r.datesApproximate ? ' (approx)' : ''}`;
        console.log(`| R${r.round} | ${r.title} | ${dates} | ${r.winnerName || '(none yet)'} | ${r.entryCount} | ${r.requirementLabels.join('; ')} | ${r.briefLength} | ${r.briefFirstSentence} |`);
    }

    console.log('\n=== TABLE 2: submission changes ===\n');
    console.log(`round:1 additions: ${tidyPreview.roundAdds.length} docs`);
    console.log(`hiddenReason:"test" additions: ${tidyPreview.testHides.length} docs`);
    console.log(`hiddenReason:"duplicate" additions: ${tidyPreview.duplicateHides.length} docs`);
    console.log('entryCount per round (live, matches seed-challenges.js figures):', tidyPreview.entryCountByRound);

    console.log(`\nFull combined preview written to ${outPath}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
