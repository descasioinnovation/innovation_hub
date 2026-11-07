// Round 9's `page` object - word-for-word from redesign/mockups/Challenges.dc.html's
// November view. Shared by scripts/patch-round9-page.js (writes it to the live
// challenges/round-9 doc) and scripts/challenges-seed-data.js (keeps the local seed +
// data/challenges-fallback.json in sync). See data/challenge-template.json for the
// documented shape.
const SAMPLE_URL = 'https://gemini.google.com/share/be6fe571a19b?social_preview=false&skid=3f46d5a1-9558-42de-8a58-559461784f2d';
const DESIGN_PACK_URL = 'https://drive.google.com/drive/folders/1zf2u-sIS-Z31nDoptpO05ikYGLcMHufM?usp=sharing';
const MESCA_IMAGE_URL = 'https://ik.imagekit.io/orxg6xgry/Innovation%20Hub/Mesca_png.jpeg';

const page = {
    intro: "Design Descasio's official season's greetings e-card: an interactive card, built in Gemini Canvas, that thanks our clients and partners for being part of our 2026. The winning card goes out to clients and partners from 1 December to mid-January.",

    why: {
        lead: "This is our last challenge of 2026, and it ends the year on something real: your design could become the card every Descasio client and partner receives this season.",
        points: [
            { title: 'Seen by everyone who works with us.', text: 'The winning card is sent to clients and partners and shared on our channels from 1 December to mid-January.', accent: '#00AEEF' },
            { title: 'A thank-you, not a sales pitch.', text: "The card's job is to show appreciation for being part of our 2026.", accent: '#E6533C' },
            { title: 'A showcase of what we do.', text: "An interactive card built with AI is itself a small proof of Descasio's AI-first year.", accent: '#F2B544' }
        ]
    },

    brief: {
        statement: 'Create an interactive season’s greetings e-card from Descasio to its clients and partners, finished in Gemini Canvas.',
        mustHaves: [
            { lead: 'Mesca.', text: 'Our Hub mascot must appear on the card, in a festive way (Santa Mesca, Mesca with a gift, Mesca in the snow: your call).' },
            { lead: 'The Descasio logo,', text: 'used correctly (official file, not redrawn or AI-generated).' },
            { lead: 'Descasio brand colours,', text: 'with tasteful seasonal colours alongside them.' },
            { lead: "A season's greeting", text: '(for example "Season’s Greetings" or "Happy Holidays").' },
            { lead: 'A message of appreciation', text: 'thanking clients and partners for being part of our 2026.' },
            { lead: 'At least one interactive element:', text: 'something the reader clicks, taps, opens, types or plays with.' },
            { lead: 'Works on phone, tablet and desktop,', text: 'and opens without signing in.' }
        ]
    },

    yourCall: [
        { label: 'Layout', text: 'A traditional fold-out card (cover, inside, back), a single page, a scroll story, a flip card, an animated reveal: any format that feels like a card.' },
        { label: 'Images', text: 'Beyond Mesca, you may use other Descasio images, such as team photos from our official social media pages.' },
        { label: 'Words', text: 'Write your own message. Keep it warm, clear and professional enough for clients.' },
        { label: 'Extras', text: 'Music or sound (off by default), animation, personalisation, a GIF version: anything that makes it memorable.' }
    ],

    sampleUrl: SAMPLE_URL,

    designPack: {
        url: DESIGN_PACK_URL,
        assets: [
            { kind: 'mesca', label: 'Mesca', compulsory: true, imageUrl: MESCA_IMAGE_URL, linkUrl: MESCA_IMAGE_URL, linkLabel: 'Mesca image', text: 'Official Mesca image:' },
            { kind: 'logo-light', label: 'Logo, light backgrounds', text: 'Full-colour "descasio" wordmark: navy letters, coral swirl "o" (SVG and PNG)' },
            { kind: 'logo-dark', label: 'Logo, dark backgrounds', text: 'White "descasio" wordmark with coral swirl "o" (SVG and PNG)' },
            {
                kind: 'brand-swatches', label: 'Brand colours', swatches: [
                    { name: 'Navy', hex: '#003366' },
                    { name: 'Coral', hex: '#E6533C' },
                    { name: 'Light grey', hex: '#F5F7FA' },
                    { name: 'Blue accent', hex: '#00AEEF' }
                ]
            },
            {
                kind: 'seasonal-swatches', label: 'Seasonal colours', text: 'Optional accents, for example holly green, warm gold or snow white. Keep Descasio navy and coral as the main colours.', swatches: [
                    { name: 'Holly green', hex: '#2E7D32' },
                    { name: 'Warm gold', hex: '#F2B544' },
                    { name: 'Snow white', hex: '#FFFFFF' }
                ]
            },
            { kind: 'fonts', label: 'Fonts', text: 'Poppins for headings, Inter for body text (both free on Google Fonts)' },
            { kind: 'tagline', label: 'Tagline', text: 'Empowering Your Digital Future' },
            { kind: 'text', label: 'Other images', text: 'Descasio photos from our official social media pages, such as team photos' }
        ]
    },

    makeItYours: {
        intro: 'Everything beyond the must-haves is up to you. Ideas to spark you:',
        ideas: [
            { title: 'An opening moment', text: 'A card that unfolds, an envelope that opens, a gift box that unwraps.' },
            { title: 'Personalisation', text: 'A "To" field that puts the client’s name into the greeting.' },
            { title: 'Mesca in action', text: 'Mesca waving, delivering a gift, or revealing the message.' },
            { title: 'A 2026 look-back', text: 'A few highlights of our AI-first year, told warmly.' },
            { title: 'A small surprise', text: 'A tap-to-reveal wish, falling snow, confetti, a New Year countdown.' },
            { title: 'Local touch', text: 'A nod to celebrating the season in Lagos and across our markets.' },
            { title: 'A shareable version', text: 'A GIF or image of your card that works inside an email.' }
        ],
        note: 'Keep it light and quick: a client should enjoy the whole card in under a minute.'
    },

    rules: [
        { lead: 'Finished in Gemini Canvas,', text: 'through your descasio.io account. Drafting in other tools is fine.' },
        { lead: 'Mesca must appear', text: 'on the card.' },
        { lead: 'Official logo files only:', text: 'no AI-drawn or altered logos.' },
        { lead: 'Approved images only:', text: 'the design pack, Descasio’s official social media, or images you create. No client logos, real client data or copyrighted characters.' },
        { lead: "People's faces:", text: "use a colleague's photo only with their permission, and only from Descasio's official pages." },
        { lead: 'Inclusive greeting:', text: 'our clients celebrate in different ways, so keep the main greeting season-wide ("Season’s Greetings", "Happy Holidays").' },
        { lead: 'No data collection:', text: 'any form or name field is for display only and must not send or store anything.' },
        { lead: 'Sound off by default:', text: 'if your card plays music, the reader turns it on.' },
        { lead: 'Submit before the deadline.', text: 'You can submit more than once; every entry you send is scored.' }
    ],

    howToSubmit: {
        steps: [
            { text: 'Go to the AI Innovation Hub and open the Round 9 submission form.', linkLabel: 'Go to the submission form →', linkHref: '#submit' },
            { text: 'In the Round 9 submission form, paste your Gemini share link.', showPrefixCheck: true },
            { text: 'List every tool you used, for example "Gemini Canvas, Canva for image edits".' },
            { text: 'Submit before the deadline.' }
        ],
        validPrefixes: ['https://gemini.google.com/share/', 'https://share.gemini.google/'],
        invalidPrefix: 'gemini.google.com/app/…',
        invalidNote: 'A link that starts with gemini.google.com/app/ is your private chat and cannot be opened by the judges.'
    },

    checklist: [
        'The link opens in a private/incognito window without signing in',
        'Mesca and the official Descasio logo appear on the card',
        'The card works on a phone as well as a computer',
        'Every button and interaction works',
        'The message has no spelling mistakes'
    ],

    afterDeadlineNote: 'Only the sharing setting of a link may be fixed after the deadline, not the card itself.',

    scoring: {
        total: 20,
        intro: 'Five judges score every valid entry on five criteria, 4 points each.',
        validity: 'the link opens without signing in, it is a season’s greetings card from Descasio, and it was submitted on time.',
        criteria: [
            { name: 'Brand and festive identity', points: 4, full: 'Descasio colours and the official logo used correctly; seasonal colours that complement the brand; Mesca featured with festive charm.' },
            { name: 'Message of appreciation', points: 4, full: 'A warm, specific thank-you for being part of our 2026; clear, client-appropriate and error-free.' },
            { name: 'Design and UI/UX', points: 4, full: 'Polished and easy to read, and works smoothly on phone, tablet and desktop, with no overlapping or cut-off content.' },
            { name: 'Interactivity and innovation', points: 4, full: 'Interactions that work and delight, plus at least one original idea that makes the card memorable.' },
            { name: 'Essentials', points: 4, full: 'All seven must-haves from the brief are present.' }
        ]
    }
};

module.exports = { page, SAMPLE_URL, DESIGN_PACK_URL, MESCA_IMAGE_URL };
