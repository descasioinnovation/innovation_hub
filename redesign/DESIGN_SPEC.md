# AI Innovation Hub redesign: design spec

This is the approved redesign. Recreate it faithfully.

The `mockups/` folder holds the approved mockup pages in a mockup format:
- `<x-dc>`, `<helmet>`, `<sc-for>`, `<sc-if>`, `{{bindings}}` and the `DCLogic` class are mockup syntax only. Do not copy them.
- Read them for the exact layout, inline styles, colours, spacing, copy and interactions.
- Rebuild them in the Hub's existing stack (Tailwind CDN, lucide icons, Firebase compat SDK, a single `index.html` with tabs).

| Mockup file | Hub tab |
|---|---|
| Main.dc.html | Dashboard |
| Challenges.dc.html | Challenges (archive) |
| Submissions.dc.html | Submissions (form + archive feed) |
| Ideas.dc.html | Idea Hub |
| Winners.dc.html | Winners (Hall of Fame) |
| Leaderboard.dc.html | Leaderboard |

Values in `[square brackets]` in the mockups are placeholders. Replace them with real data from Firestore or from the existing hardcoded data. Never ship a bracket.

## Rules
- **Nothing is removed from Idea Hub, Winners or Leaderboard.** Every existing field, card, column and piece of copy stays. These pages only get a new look and the additions shown in the mockups.
- The Submissions tab no longer shows the "Shortlisted for voting" or "Cast official vote" sections.
- **Every link works.** Nav tabs, logo → Dashboard, "Full table" → Leaderboard, "Hall of Fame" → Winners, "Share an idea" → Idea Hub, "Read the brief" → Challenges (open round selected), "Submit your entry" → Submissions form, "View entries" → Submissions feed filtered to that round, "See the winner" → Winners.
- Keep the Admin button and all existing admin functions.
- Keep the support email footer.
- Responsive at 390px (phone), 768px (tablet) and 1440px (desktop). No horizontal page scroll; only the leaderboard table scrolls sideways inside its card.
- Keyboard focus is visible (3px #00AEEF outline).
- Animations respect `prefers-reduced-motion`.

## Design tokens
| Token | Value | Use |
|---|---|---|
| bg | #050E1C | page background |
| surface | #0B1A2E | cards |
| surface-2 | #10223A | inner tiles, active nav |
| surface-active | #12345C | selected item |
| border | #1C3150 | card borders |
| border-strong | #2A4466 | inputs, outline buttons |
| border-muted | #4A6488 | dashed / hover |
| text | #EAF1F8 / #FFFFFF | headings |
| text-2 | #C9D8E8 | body on dark |
| text-muted | #9FB3C8 | secondary |
| text-faint | #8197AE | footnotes |
| navy (brand) | #003366 | hero, gradients |
| coral (brand) | #E6533C | accents, Mesca ring |
| coral button | #C8432D | primary buttons (AA contrast with white) |
| blue (brand) | #00AEEF | focus, selected border |
| link | #7FD6F7 | links on dark |
| gold | #F2B544 (text #F6CD7F) | seasonal accent, winner, eyebrow labels |
| green | #3FA66B (text #8FE0B0) | "open / active" status |
| medals | gold #F2B544, silver #C9D3DF, bronze #E08A5A | ranks 1 to 3 |

Hero gradient: `radial-gradient(circle at 85% 20%, #0F4A85 0%, #003366 45%, #061A33 100%)`.

Fonts (Google Fonts):
- **Poppins** 500, 600 and 700 for headings and numbers.
- **Inter** 400 to 700 for body text.
- Drop the old heavy italic uppercase headings. Use sentence case.
- Small eyebrow labels are uppercase, 12px, letter-spacing 1.2–1.4px.

Radii: hero 28px, cards 20–24px, tiles 14–16px, pills and buttons fully rounded (height 44–52px).

Department colours (submission covers), as gradient start → end:

| Department | Start | End |
|---|---|---|
| Technology Services | #003366 | #00AEEF |
| Software Engineering | #2B2350 | #6F5BD6 |
| Marketing | #5A1F17 | #E6533C |
| Sales | #4A3510 | #D99A22 |
| Finance | #123D2A | #3FA66B |
| Strategy | #0B3B3F | #22A6A0 |
| Product | #3D1640 | #B54FB8 |
| Customer Success | #0B3B4F | #3CC1D9 |
| Team | #1B2A44 | #F2B544 |
| Unknown | #1C3150 | #4A6488 |

Leaderboard round colours (keep the per-round colouring):

| R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 |
|---|---|---|---|---|---|---|---|---|
| #C9D3DF | #5AA9F0 | #8E8CF2 | #C084F5 | #4FB4F0 | #3ECF8E | #F2B544 | #F2667A | #8197AE |

Zero values are shown at 55% opacity.

## Assets
- Header logo: `assets/descasio-white.svg` (official white logo, viewBox 0 0 809.41 200) shown at 130×32. `assets/descasio-color.svg` is for light backgrounds.
- Mesca: the existing `HUB_AVATAR` ImageKit URL (same image as `assets/mesca.png`). Show it in a 300px circle with a 6px #E6533C ring, holly and gold sparkle SVG accents, and a "Mesca · Hub mascot" pill.
- Winner images: keep the existing ImageKit winner image URLs inside the Winners frames. The initials tiles in the mockup only stand in for them.

## Shared layout
- **Announcement bar** (Dashboard only): a navy gradient strip with a gold sparkle and a line about the open round, plus a "Read the brief" link.
- **Header:** logo, a divider, "AI Innovation Hub", the 6 nav tabs (the active tab gets bg #10223A and white text), and the Admin button.
- **Footer:** support email link, then "© 2026 Descasio AI Innovation Hub · Empowering Your Digital Future". Fix the old "© 2025" text.

## Pages (see the mockups for exact markup)
1. **Dashboard:**
   - Hero for the current round: status badges, title, summary, two CTAs, a countdown (days, hours, mins) to `closesAt`, the closing date, the entry count, and Mesca with gentle falling snow.
   - 4 KPI tiles: challenges this year, innovators on the leaderboard, last round's entries, and the leader with their points.
   - "Our 2026 challenge journey": a grid of every round plus the December finale. The open round has a green border; the finale has a dashed border.
   - Top-5 leaderboard → "Full table".
   - Latest winner card → "Hall of Fame".
   - Alison reminder (gold border).
   - Idea Hub teaser.
   - All numbers are computed from data. None are hardcoded.
2. **Challenges:**
   - Month list, **newest first** (November → March). The open round shows a green dot with a glow.
   - Clicking a month shows a detail panel: status (Open or Closed), round and month, title, Winner / Entries / Window tiles, the brief, "What entrants submitted" (from that round's requirements), and the CTAs.
   - Closed rounds show "Submissions closed. This round is read-only." Only the open round links to the form.
3. **Submissions:**
   - **Form card:**
     - Constant fields every round: Entry type (Individual / Group segmented control; Group reveals "Team name" and relabels the name field "Team lead full name"), Full name, Work email (@descasio.io), Department.
     - Then a "Round N requirements" divider and the fields generated from `challenges/{round}.requirements`.
     - A Submit button, then a success state.
     - Next to it, a brief card: status, title, what to submit, a "Before you submit" checklist, closing time, and a link to the full brief.
   - **Archive feed:**
     - Round filter chips (open round, then R8 → R1, then All). A header line shows the round title and winner.
     - Cards with auto-generated covers: a browser-frame illustration tinted by department, showing the round, the entry title and the entrant's initials.
     - Each card has round and department chips, a Winner chip where relevant, the title, "By name", and a "Details and impact" button (must show every link, including `submissionDocLink`).
     - Open-round entries stay hidden until `closesAt` (show the "under wraps" empty state).
     - Names display tidied (casing), but stored data is unchanged.
4. **Idea Hub:**
   - The same pitch form fields (full name, work email, department, idea title, description, "Share concept").
   - "How ideas travel" side panel with a count.
   - The concept wall: cards expand in place to show the full text.
5. **Winners:**
   - "Hall of Fame" with the same subtitle.
   - A latest-winner spotlight.
   - A highlights row (rounds decided, two-time winners, different winners, up next).
   - The month grid March → December, with the same labels as now plus a "Challenge:" line and a "View challenge" link. The open month reads "Round N · In progress"; future months read "Upcoming".
6. **Leaderboard:**
   - Same title and subtitle.
   - A top-3 podium (2nd, 1st, 3rd).
   - A "Find a name" filter.
   - The table keeps Rank, Participant detail (name and email), R1 to R8, adds R9 (and future rounds automatically), and a Total column that is always visible.
   - Dense ranking; ties share a rank.
   - The Alison note, plus a link to Winners.

## Data model (new `challenges` collection)
Path: `artifacts/descasio-innovation-hub-perpetual/public/data/challenges/{round-N}`
```
round: 9, month: "November", year: 2026, slug: "nov-2026"
title, summary, brief (long text), criteria: [string]
opensAt, closesAt: Timestamp (WAT = UTC+1)
status: derived in code from opensAt / closesAt, plus judging and closed (stored override allowed)
winnerName, winnerImage, winnerLabel, winningSubmissionId (optional)
requirements: [{ id, label, type: "url" | "text" | "textarea" | "multiselect", required, options?, placeholder? }]
checklist: [string]   // "Before you submit"
entryCount (optional cache)
```
Submissions keep their existing field names. The new requirement answers are stored under the same keys as each requirement's `id`. Test and duplicate entries get `hidden: true`; they are never deleted.

## Round 9 (November) values
- Title: "Season's Greetings E-card".
- Opens Monday 9 Nov 2026, 08:00 WAT. Closes Wednesday 25 Nov 2026, 23:59 WAT.
- Requirements:
  - Gemini Canvas share link (url, required).
  - Tools used (multiselect: Gemini Canvas, Claude, ChatGPT, Canva, Figma, Other; required).
- Checklist:
  - Mesca appears on the card.
  - Works on phone and tablet.
  - Official logo, brand and season colours.
  - Share link opens without a sign-in.
- Brief summary: "Design Descasio's official season's greetings e-card for clients and partners. Mesca must appear, the card must work on phone and tablet, use brand and season colours with the official logo, and be finished in Gemini Canvas."
- Before `opensAt`, the hero and form show "Opens Monday 9 Nov, 8:00 AM" instead of the countdown, and the form is disabled.
