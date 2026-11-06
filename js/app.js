        // --- Safe persistedAuth evaluation to avoid execution halt ReferenceErrors ---
        const persistedAuth = (() => {
            try {
                const data = localStorage.getItem('descasio_hub_auth');
                return data ? JSON.parse(data) : null;
            } catch (e) {
                return null;
            }
        })();

        // DEV-ONLY: skips the OTP login gate for Playwright screenshots. Active only when
        // BOTH location.hostname is localhost/127.0.0.1 AND ?preview=1 is in the URL - both
        // conditions fail together on the live site (ai.innovation-hub.com.ng has a real
        // hostname, so this is structurally impossible in production, not just unlikely).
        // Remove this block (and the isAuthenticated line below reverts to `!!persistedAuth`)
        // once the redesign no longer needs local screenshot runs.
        const isLocalPreviewBypass = (() => {
            try {
                const host = location.hostname;
                const isLocalHost = host === 'localhost' || host === '127.0.0.1';
                const hasPreviewFlag = new URLSearchParams(location.search).get('preview') === '1';
                return isLocalHost && hasPreviewFlag;
            } catch (e) {
                return false;
            }
        })();

        let state = {
            user: null,
            isAuthenticated: !!persistedAuth || isLocalPreviewBypass,
            gatewayView: 'email',
            authEmail: persistedAuth ? persistedAuth.email : '',
            generatedOtp: null,
            otpExpiry: null,
            activeTab: 'dashboard',
            routeSub: null,
            submissionType: 'individual',
            submissions: [],
            ideas: [],
            leaderboard: [...FINAL_STANDINGS],
            selectedInnovation: null,
            selectedIdea: null,
            isAdmin: false,
            showAdminLogin: false,
            challengeClosed: false,
            timeLeft: {
                days: 0,
                hours: 0,
                mins: 0,
                label: "HUNT ENDS"
            },
            formData: {},
            formToolsSelected: [], // multiselect requirement answers (array of chip labels)
            submitting: false,
            submissionSent: false,
            ideaData: {},
            loading: false
        };

        async function hashString(str) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function requestOtp() {
            const email = document.getElementById('gatewayEmail').value.trim().toLowerCase();
            if (!email.endsWith('@descasio.io')) {
                showGatewayError("Access restricted to @descasio.io email addresses.");
                return;
            }
            state.loading = true;
            updateUI();
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiry = Date.now() + (60 * 60 * 1000);
            try {
                await emailjs.send("service_v9ysmxt", "template_20x7ujf", {
                    to_email: email,
                    otp_code: otp
                });
                state.authEmail = email;
                state.generatedOtp = otp;
                state.otpExpiry = expiry;
                state.gatewayView = 'otp';
                state.loading = false;
                updateUI();
            } catch (err) {
                console.error(err);
                showGatewayError("Failed to send code. Please check your connection.");
                state.loading = false;
                updateUI();
            }
        }

        async function verifyOtp() {
            const entered = document.getElementById('gatewayOtp').value.trim();
            if (Date.now() > state.otpExpiry) {
                showGatewayError("Code has expired. Please request a new one.");
                return;
            }
            if (entered === state.generatedOtp) {
                state.isAuthenticated = true;
                try {
                    localStorage.setItem('descasio_hub_auth', JSON.stringify({
                        email: state.authEmail,
                        expiry: Date.now() + (30 * 24 * 60 * 60 * 1000)
                    }));
                } catch (e) {}
                updateUI();
                if (state.user) {
                    try {
                        await db.collection('artifacts').doc(STABLE_APP_ID)
                            .collection('users').doc(state.user.uid)
                            .collection('profile').doc('session').set({
                                email: state.authEmail,
                                authenticated: true,
                                timestamp: new Date().getTime()
                            });
                    } catch (e) {
                        console.error("Firestore persistence failed", e);
                    }
                }
            } else {
                showGatewayError("Invalid access code.");
            }
        }

        function showGatewayError(msg) {
            const errEl = document.getElementById('gatewayError');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        function formatWATDateTime(isoDate) {
            const d = new Date(isoDate);
            return {
                weekday: d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' }),
                day: d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' }),
                month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Africa/Lagos' }),
                time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' })
            };
        }

        function diffToParts(diffMs) {
            return {
                days: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
                hours: Math.floor((diffMs / (1000 * 60 * 60)) % 24),
                mins: Math.floor((diffMs / 1000 / 60) % 60)
            };
        }

        // Short form for disabled CTA buttons, e.g. "Opens Monday 8:00 AM" (no date number).
        function formatOpenShort(isoDate) {
            const { weekday, time } = formatWATDateTime(isoDate);
            return `Opens ${weekday} ${time}`;
        }

        // Countdown is driven by the challenges collection (js/challenges.js) instead of a
        // hand-edited target date.
        //   upcoming -> counts down to opensAt, label "Opens <Weekday> <D> <Mon>, <time>"
        //   open     -> counts down to closesAt, label "Closes <Wkd> <D> <Mon>, <time> WAT"
        //   judging/closed -> no countdown; state.timeLeft.showCountdown is false and the
        //     hero (js/app.js renderDashboard) shows status text instead.
        // Updates every minute per spec; renderDashboard() re-reads state.timeLeft directly
        // on each updateUI() render rather than being poked via getElementById.
        function updateCountdown() {
            const now = new Date();
            const round = (typeof Challenges !== 'undefined') ? Challenges.currentRound(now) : null;

            if (!round) {
                // No challenges data yet (listener hasn't fired, fallback hasn't loaded) -
                // leave existing state.timeLeft/challengeClosed as-is rather than guessing.
                return;
            }

            const status = Challenges.statusOf(round, now);
            const prevClosed = state.challengeClosed;

            if (status === 'judging' || status === 'closed') {
                state.challengeClosed = true;
                state.timeLeft = {
                    days: 0, hours: 0, mins: 0, showCountdown: false,
                    label: status === 'judging' ? 'Judging in progress' : 'Submissions closed'
                };
            } else if (status === 'upcoming') {
                state.challengeClosed = true;
                const target = new Date(round.opensAt);
                const diff = Math.max(0, target - now);
                const { weekday, day, month, time } = formatWATDateTime(round.opensAt);
                state.timeLeft = {
                    ...diffToParts(diff),
                    showCountdown: true,
                    label: `Opens ${weekday} ${day} ${month}, ${time}`
                };
            } else {
                // open
                state.challengeClosed = false;
                const target = new Date(round.closesAt);
                const diff = Math.max(0, target - now);
                const { weekday, day, month, time } = formatWATDateTime(round.closesAt);
                state.timeLeft = {
                    ...diffToParts(diff),
                    showCountdown: true,
                    label: `Closes ${weekday.slice(0, 3)} ${day} ${month}, ${time} WAT`
                };
            }

            if (state.challengeClosed !== prevClosed) {
                updateUI();
            } else if (document.getElementById('countdown-timer')) {
                // Cheap re-render of just the Dashboard hero's countdown digits/label each
                // tick, without a full updateUI() pass (which would be wasted work and could
                // interrupt focus elsewhere on the page).
                const labelEl = document.getElementById('countdown-label');
                const timerEl = document.getElementById('countdown-timer');
                if (labelEl) labelEl.innerText = state.timeLeft.label;
                if (timerEl) timerEl.innerText = state.timeLeft.showCountdown
                    ? `${state.timeLeft.days}d : ${state.timeLeft.hours}h : ${state.timeLeft.mins}m`
                    : '';
            }
        }

        function updateUI() {
            if (document.activeElement &&
                (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                return;
            }

            const app = document.getElementById('app');
            if (!state.user) return;
            if (!state.isAuthenticated) {
                app.innerHTML = renderLoginGateway();
                lucide.createIcons();
                return;
            }
            app.innerHTML = `
                ${Shell.renderAnnouncementBar(state)}
                ${Shell.renderHeader(state)}
                <main class="max-w-7xl mx-auto p-6 md:p-8 min-h-[70vh]">
                    ${renderTabContent()}
                </main>
                ${state.selectedInnovation ? renderModal() : ''}
                ${state.selectedIdea ? renderIdeaModal() : ''}
                ${state.showAdminLogin ? renderAdminLogin() : ''}
                ${Shell.renderFooter()}
            `;
            lucide.createIcons();
            updateCountdown();
        }

        function renderLoginGateway() {
            return `
                <div class="min-h-screen bg-[#020617] flex items-center justify-center p-6 relative overflow-hidden">
                    <div class="absolute -top-20 -left-20 w-96 h-96 bg-blue-900/20 blur-[120px] rounded-full"></div>
                    <div class="absolute -bottom-20 -right-20 w-96 h-96 bg-indigo-900/20 blur-[120px] rounded-full"></div>
                    <div class="w-full max-w-md bg-[#0f172a] rounded-[2.5rem] border border-slate-800 p-12 shadow-2xl relative z-10 text-center">
                        <div class="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-10 shadow-lg shadow-blue-500/20">
                            <i data-lucide="zap" class="text-white w-10 h-10"></i>
                        </div>
                        <h2 class="text-white text-4xl font-black italic tracking-tighter uppercase mb-2">DESCASIO</h2>
                        <p class="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mb-12">Innovation Hub Gateway</p>
                        ${state.gatewayView === 'email' ? `
                            <p class="text-slate-400 text-sm italic mb-10 px-4 leading-relaxed">Enter your @descasio.io email to receive an access code.</p>
                            <input id="gatewayEmail" type="email" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-5 text-center text-white outline-none focus:ring-2 ring-blue-600 font-bold mb-6" placeholder="name@descasio.io" value="${state.authEmail}">
                            <div id="gatewayError" class="hidden text-red-500 text-[10px] font-bold uppercase mb-6"></div>
                            <button onclick="requestOtp()" class="w-full bg-white text-black font-black py-5 rounded-2xl uppercase tracking-widest text-[11px] hover:bg-blue-50 transition shadow-xl active:scale-[0.98] flex items-center justify-center gap-3">
                                ${state.loading ? '<div class="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>' : 'REQUEST ACCESS CODE'}
                            </button>
                        ` : `
                            <p class="text-slate-400 text-sm italic mb-10 px-4 leading-relaxed">Enter the 6-digit code sent to <br><b class="text-blue-400">${state.authEmail}</b></p>
                            <input id="gatewayOtp" type="text" maxlength="6" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-5 text-center text-white outline-none focus:ring-2 ring-blue-600 font-mono tracking-[0.5em] text-2xl font-bold mb-6" placeholder="000000">
                            <div id="gatewayError" class="hidden text-red-500 text-[10px] font-bold uppercase mb-6"></div>
                            <button onclick="verifyOtp()" class="w-full bg-blue-600 text-white font-black py-5 rounded-2xl uppercase tracking-widest text-[11px] hover:bg-blue-500 transition shadow-xl active:scale-[0.98] mb-4">VERIFY & ENTER</button>
                            <button onclick="state.gatewayView = 'email'; updateUI();" class="text-slate-500 text-[10px] font-black uppercase tracking-widest hover:text-white transition">Back to Email</button>
                        `}
                    </div>
                </div>
            `;
        }


        function formatShortDateWAT(isoDate) {
            const d = new Date(isoDate);
            const day = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' });
            const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Africa/Lagos' });
            return `${day} ${month}`;
        }

        function formatWindow(ch) {
            if (!ch.opensAt || !ch.closesAt) return '—';
            const w = `${formatShortDateWAT(ch.opensAt)} – ${formatShortDateWAT(ch.closesAt)}`;
            return ch.datesApproximate ? `${w} (approx.)` : w;
        }

        function generateSnowflakes(count) {
            let flakes = '';
            for (let i = 0; i < count; i++) {
                const s = 2 + (i % 3);
                const left = (i * 41) % 100;
                const dur = 7 + (i % 6);
                const delay = ((i * 0.7) % 8).toFixed(1);
                flakes += `<span class="flake" style="left:${left}%;width:${s}px;height:${s}px;animation-duration:${dur}s;animation-delay:-${delay}s"></span>`;
            }
            return flakes;
        }

        // Renders a challenge's `brief` block array (paragraphs + lists) as HTML.
        function renderBriefHtml(ch) {
            const summaryNote = ch.briefIsSummary
                ? `<p class="font-inter text-xs italic text-text-faint shell-sentence-case mb-2">${ch.briefIsSummaryLabel || 'Summary — original brief not archived'}</p>`
                : '';
            const blocks = (ch.brief || []).map(block => {
                if (block.type === 'list') {
                    return `<ul class="list-disc list-inside space-y-1 font-inter text-[15px] leading-[1.65] text-text-2">${block.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
                }
                return `<p class="font-inter text-[15px] leading-[1.65] text-text-2">${block.text}</p>`;
            }).join('<div class="h-2"></div>');
            return `${summaryNote}<div class="space-y-3">${blocks || '<p class="font-inter text-[15px] text-text-faint italic">No brief text available.</p>'}</div>`;
        }

        function renderDashboard() {
            const round = Challenges.currentRound();
            if (!round) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            const status = Challenges.statusOf(round);
            const allRounds = Challenges.allRounds(); // newest first
            const highestRound = allRounds.length ? allRounds[0].round : round.round;
            const isFinalOfYear = round.round === highestRound;

            // --- Hero status badges ---
            let statusBadge;
            if (status === 'open') {
                statusBadge = `<span class="inline-flex items-center gap-2 h-[30px] px-3 rounded-full bg-[rgba(63,166,107,0.16)] border border-[rgba(63,166,107,0.45)] text-green-text font-inter font-semibold text-xs tracking-[0.4px] shell-sentence-case"><span class="w-2 h-2 rounded-full bg-green"></span>Round ${round.round} · Open now</span>`;
            } else if (status === 'upcoming') {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · ${formatShortDateWAT(round.opensAt) ? `Opens ${formatWATDateTime(round.opensAt).weekday}` : 'Opens soon'}</span>`;
            } else if (status === 'judging') {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Judging</span>`;
            } else {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Closed</span>`;
            }
            const finaleBadge = isFinalOfYear
                ? `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Final challenge of ${round.year}</span>`
                : '';

            // --- CTAs ---
            const briefHref = Router.buildHash('challenge', round.slug || `round-${round.round}`);
            const submitDisabled = status !== 'open';
            const submitLabel = status === 'upcoming' ? formatOpenShort(round.opensAt)
                : status === 'judging' ? 'Judging in progress'
                : status === 'closed' ? 'Submissions closed'
                : 'Submit your entry';
            const submitCta = submitDisabled
                ? `<span class="inline-flex items-center h-12 px-6 rounded-full border border-border-strong text-text-faint font-inter font-semibold text-[15px] shell-sentence-case cursor-not-allowed opacity-70">${submitLabel}</span>`
                : `<a href="#submit" class="inline-flex items-center h-12 px-6 rounded-full border-[1.5px] border-[#7FA9D6] text-text-strong font-inter font-semibold text-[15px] shell-sentence-case no-underline">Submit your entry</a>`;

            // --- Countdown / status text ---
            const countdownBlock = state.timeLeft && state.timeLeft.showCountdown ? `
                <div class="flex gap-2">
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.days}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">days</div></div>
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.hours}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">hrs</div></div>
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.mins}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">mins</div></div>
                </div>
                <div class="flex flex-col justify-center gap-0.5 pl-1.5">
                    <span id="countdown-label" class="font-inter font-semibold text-[13px] text-text-strong shell-sentence-case">${state.timeLeft.label}</span>
                    <span id="countdown-timer" class="hidden"></span>
                    ${status !== 'upcoming' ? `<span class="font-inter text-[13px] text-text-muted shell-sentence-case">${liveEntryCount(round)} entries so far</span>` : ''}
                </div>` : `
                <div class="flex flex-col gap-0.5">
                    <span id="countdown-label" class="font-poppins font-semibold text-lg text-text-strong shell-sentence-case">${state.timeLeft ? state.timeLeft.label : ''}</span>
                    <span id="countdown-timer" class="hidden"></span>
                    ${status !== 'upcoming' ? `<span class="font-inter text-[13px] text-text-muted shell-sentence-case">${liveEntryCount(round)} entries so far</span>` : ''}
                </div>`;

            // --- Optional resource links ---
            const resourcesHtml = (round.resources && round.resources.length) ? `
                <div class="flex flex-wrap gap-3">
                    ${round.resources.map(r => `<a href="${r.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[rgba(0,174,239,0.12)] border border-border-strong text-link font-inter font-semibold text-[13px] shell-sentence-case no-underline"><i data-lucide="link" class="w-3.5 h-3.5"></i>${r.label}</a>`).join('')}
                </div>` : '';

            // --- KPI tiles ---
            const challengesThisYear = allRounds.filter(r => r.year === round.year && r.round <= round.round).length;
            const innovatorCount = state.leaderboard.length;
            const lastCompleted = allRounds.find(r => Challenges.statusOf(r) === 'closed');
            const leader = state.leaderboard[0];

            const kpiTiles = [
                { label: 'Challenges this year', value: String(challengesThisYear), meta: `March to ${round.month}` },
                { label: 'Innovators on the leaderboard', value: String(innovatorCount), meta: 'across all departments' },
                lastCompleted
                    ? { label: `Entries in Round ${lastCompleted.round}`, value: String(lastCompleted.entryCount || 0), meta: lastCompleted.title }
                    : { label: 'Entries in the last round', value: '0', meta: 'No completed rounds yet' },
                leader
                    ? { label: 'Leaderboard leader', value: `${leader.cumulativeScore.toFixed(1)} <span class="font-inter font-medium text-[15px] text-text-muted">pts</span>`, meta: leader.name }
                    : { label: 'Leaderboard leader', value: '—', meta: '' }
            ];
            const kpiHtml = kpiTiles.map(t => `
                <div class="p-[22px] rounded-[20px] bg-surface border border-border flex flex-col gap-1.5">
                    <span class="font-inter font-medium text-[13px] text-text-muted shell-sentence-case">${t.label}</span>
                    <span class="font-poppins font-bold text-[34px] text-text-strong">${t.value}</span>
                    <span class="font-inter text-[13px] text-text-muted shell-sentence-case">${t.meta}</span>
                </div>`).join('');

            // --- "Our <year> challenge journey" tiles ---
            const journeyRounds = allRounds.slice().sort((a, b) => a.round - b.round).filter(r => r.round <= round.round);
            const journeyTiles = journeyRounds.map(r => {
                const st = Challenges.statusOf(r);
                let meta, metaColorClass, tileClasses;
                if (st === 'open') {
                    meta = 'Open now'; metaColorClass = 'text-green-text';
                    tileClasses = 'bg-surface-active border-[1.5px] border-green';
                } else if (st === 'upcoming') {
                    meta = `Opens ${formatShortDateWAT(r.opensAt)}`; metaColorClass = 'text-gold-text';
                    tileClasses = 'bg-[#0E1F36] border border-border-muted';
                } else if (st === 'judging') {
                    meta = 'Judging'; metaColorClass = 'text-text-muted';
                    tileClasses = 'bg-surface-2 border border-border';
                } else {
                    meta = r.winnerName ? `Winner: ${r.winnerName}` : 'Closed'; metaColorClass = 'text-text-muted';
                    tileClasses = 'bg-surface-2 border border-border';
                }
                return `
                <a href="${Router.buildHash('challenge', r.slug || `round-${r.round}`)}" class="flex flex-col gap-1.5 p-3.5 rounded-2xl no-underline min-h-[112px] box-border ${tileClasses}">
                    <span class="font-inter font-semibold text-[11px] tracking-[1.2px] uppercase text-text-muted shell-sentence-case" style="text-transform:uppercase">${r.month} · Round ${r.round}</span>
                    <span class="font-poppins font-semibold text-[15px] leading-[1.3] text-text-strong">${r.title}</span>
                    <span class="font-inter font-medium text-xs ${metaColorClass} shell-sentence-case">${meta}</span>
                </a>`;
            }).join('');
            const financeTile = `
                <a href="${Router.buildHash('challenge')}" class="flex flex-col gap-1.5 p-3.5 rounded-2xl no-underline min-h-[112px] box-border bg-[#0E1F36] border border-dashed border-border-muted">
                    <span class="font-inter font-semibold text-[11px] tracking-[1.2px] uppercase text-text-muted shell-sentence-case" style="text-transform:uppercase">Dec · Finale</span>
                    <span class="font-poppins font-semibold text-[15px] leading-[1.3] text-text-strong">Year-end awards</span>
                    <span class="font-inter font-medium text-xs text-gold-text shell-sentence-case">Coming soon</span>
                </a>`;

            // --- Leaderboard top 5 ---
            const medalColors = ['var(--medal-gold)', 'var(--medal-silver)', 'var(--medal-bronze)'];
            const top5 = state.leaderboard.slice(0, 5);
            const leaderboardHtml = top5.map((l, i) => `
                <li class="flex items-center gap-3.5 px-3.5 py-3 rounded-[14px] bg-surface-2">
                    <span class="w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px]" style="${i < 3 ? `background:${medalColors[i]};color:#050E1C` : 'background:var(--border);color:var(--text-2)'}">${l.rank}</span>
                    <span class="flex-1 min-w-0 font-inter font-semibold text-[15px] text-text-strong truncate">${l.name}</span>
                    <span class="font-poppins font-bold text-base text-text-strong">${l.cumulativeScore.toFixed(1)}</span>
                </li>`).join('');

            // --- Latest winner card ---
            const latestWinnerRound = allRounds.find(r => r.winnerName);

            return `
                <div class="space-y-7 animate-in fade-in">
                    <section class="relative overflow-hidden rounded-[28px] border border-border p-12 flex flex-wrap gap-10 items-center" style="background: radial-gradient(circle at 85% 20%, #0F4A85 0%, #003366 45%, #061A33 100%)">
                        <div aria-hidden="true" class="absolute inset-0 pointer-events-none overflow-hidden">${generateSnowflakes(24)}</div>
                        <div class="flex-[999_1_520px] min-w-0 flex flex-col gap-5 relative">
                            <div class="flex gap-2.5 flex-wrap">${statusBadge}${finaleBadge}</div>
                            <h1 class="m-0 font-poppins font-bold text-[clamp(32px,5vw,52px)] leading-[1.05] tracking-[-1.2px] text-text-strong shell-sentence-case">${round.month} AI Challenge: ${round.title}</h1>
                            <p class="m-0 max-w-[560px] font-inter text-lg leading-[1.6] text-text-2">${round.summary || ''}</p>
                            <div class="flex gap-3 flex-wrap items-center">
                                <a href="${briefHref}" class="inline-flex items-center h-12 px-6 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-[15px] shell-sentence-case no-underline">Read the brief</a>
                                ${submitCta}
                            </div>
                            ${resourcesHtml}
                            <div class="flex gap-2.5 items-stretch flex-wrap">${countdownBlock}</div>
                        </div>
                        <div class="flex-[1_1_300px] flex justify-center relative">
                            <div class="relative w-[260px] h-[260px] sm:w-[300px] sm:h-[300px]">
                                <div class="absolute inset-0 rounded-full border-[6px] border-coral" style="box-shadow:0 0 40px rgba(230,83,60,0.35)"></div>
                                <img src="${HUB_AVATAR}" alt="Mesca, the AI Innovation Hub mascot" class="absolute inset-3 rounded-full object-cover" style="object-position:50% 22%">
                                <svg aria-hidden="true" viewBox="0 0 300 300" class="absolute pointer-events-none" style="left:-14px;top:-14px;width:calc(100% + 28px);height:calc(100% + 28px)">
                                    <path d="M22 92 C10 82, 6 104, 18 112 C28 120, 34 100, 22 92 Z" fill="#2E7D32"></path>
                                    <path d="M12 104 C2 102, 4 120, 16 122 C26 124, 24 106, 12 104 Z" fill="#1B5E20"></path>
                                    <circle cx="23" cy="107" r="5" fill="#E6533C"></circle>
                                    <circle cx="30" cy="112" r="4" fill="#C62828"></circle>
                                    <path d="M278 92 C290 82, 294 104, 282 112 C272 120, 266 100, 278 92 Z" fill="#2E7D32"></path>
                                    <path d="M288 104 C298 102, 296 120, 284 122 C274 124, 276 106, 288 104 Z" fill="#1B5E20"></path>
                                    <circle cx="277" cy="107" r="5" fill="#E6533C"></circle>
                                    <circle cx="270" cy="112" r="4" fill="#C62828"></circle>
                                    <path d="M150 6 L152 13 L159 15 L152 17 L150 24 L148 17 L141 15 L148 13 Z" fill="#F2B544"></path>
                                </svg>
                                <div class="absolute left-1/2 -bottom-3.5 -translate-x-1/2 whitespace-nowrap px-4 py-2 rounded-[18px] bg-bg border border-border-strong font-poppins font-semibold text-[13px] text-text-strong">Mesca · Hub mascot</div>
                            </div>
                        </div>
                    </section>

                    <section aria-label="Hub at a glance" class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${kpiHtml}</section>

                    <div class="flex flex-wrap gap-6 items-stretch">
                        <section class="flex-[999_1_560px] min-w-0 p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-5">
                            <div class="flex justify-between items-baseline gap-3 flex-wrap">
                                <h2 class="m-0 font-poppins font-semibold text-[22px] text-text-strong shell-sentence-case">Our ${round.year} challenge journey</h2>
                                <a href="${Router.buildHash('challenge')}" class="font-inter font-semibold text-sm shell-sentence-case">Browse all challenges</a>
                            </div>
                            <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${journeyTiles}${financeTile}</div>
                        </section>

                        <section class="flex-[1_1_320px] p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-4">
                            <div class="flex justify-between items-baseline gap-3">
                                <h2 class="m-0 font-poppins font-semibold text-[22px] text-text-strong shell-sentence-case">Leaderboard</h2>
                                <a href="${Router.buildHash('leaderboard')}" class="font-inter font-semibold text-sm shell-sentence-case">Full table</a>
                            </div>
                            <ol class="list-none m-0 p-0 flex flex-col gap-2.5">${leaderboardHtml}</ol>
                            <span class="font-inter text-[13px] leading-[1.5] text-text-muted">Positions count for the year-end rewards only when all assigned Alison courses are complete.</span>
                        </section>
                    </div>

                    <div class="grid gap-6" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
                        <section class="p-7 rounded-[24px] bg-surface border border-border flex gap-4.5 items-center">
                            <div aria-hidden="true" class="w-16 h-16 shrink-0 rounded-full flex items-center justify-center" style="background:rgba(242,181,68,0.14);border:1px solid rgba(242,181,68,0.45)">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F2B544" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"></circle><path d="M8.2 13.3 7 22l5-3 5 3-1.2-8.7"></path></svg>
                            </div>
                            <div class="flex flex-col gap-1 min-w-0">
                                <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">${latestWinnerRound ? `Round ${latestWinnerRound.round} winner` : 'Winners'}</span>
                                ${latestWinnerRound ? `
                                    <span class="font-poppins font-semibold text-[22px] text-text-strong">${latestWinnerRound.winnerName}</span>
                                    <span class="font-inter text-sm text-text-muted">${latestWinnerRound.title} · ${latestWinnerRound.month} ${latestWinnerRound.year}</span>
                                ` : `<span class="font-inter text-sm text-text-muted">No winners yet</span>`}
                                <a href="${Router.buildHash('winners')}" class="font-inter font-semibold text-sm mt-1 shell-sentence-case">Hall of Fame</a>
                            </div>
                        </section>
                        <section class="p-7 rounded-[24px] bg-surface flex flex-col gap-2.5" style="border:1px solid rgba(242,181,68,0.45)">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Alison LMS</span>
                            <span class="font-poppins font-semibold text-[19px] leading-[1.35] text-text-strong shell-sentence-case">Finish your assigned Alison courses</span>
                            <span class="font-inter text-sm leading-[1.5] text-text-muted">Incomplete courses mean your ${round.year} leaderboard position will not count.</span>
                            <a href="https://alison.com" target="_blank" rel="noopener noreferrer" class="font-inter font-semibold text-sm shell-sentence-case">Go to Alison</a>
                        </section>
                        <section class="p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-2.5">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-link shell-sentence-case" style="text-transform:uppercase">Idea Hub</span>
                            <span class="font-poppins font-semibold text-[19px] leading-[1.35] text-text-strong shell-sentence-case">Got an idea that could save time or add value?</span>
                            <span class="font-inter text-sm leading-[1.5] text-text-muted">Share it, vote on others, and help pick the next challenge.</span>
                            <a href="${Router.buildHash('ideahub')}" class="font-inter font-semibold text-sm shell-sentence-case">Share an idea</a>
                        </section>
                    </div>
                </div>
            `;
        }

        function liveEntryCount(round) {
            return state.submissions.filter(s => {
                if (s.hiddenReason === 'test') return false;
                const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                return effRound === round.round;
            }).length;
        }

        function renderChallenge() {
            const allRounds = Challenges.allRounds(); // newest first already
            if (!allRounds.length) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            const current = Challenges.currentRound();
            const selectedSlug = state.routeSub || (current ? (current.slug || `round-${current.round}`) : allRounds[0].slug);
            const selected = allRounds.find(r => (r.slug || `round-${r.round}`) === selectedSlug) || current || allRounds[0];

            const monthListHtml = allRounds.map(r => {
                const slug = r.slug || `round-${r.round}`;
                const on = slug === (selected.slug || `round-${selected.round}`);
                const st = Challenges.statusOf(r);
                const isLive = st === 'open' || st === 'upcoming';
                const dotStyle = isLive
                    ? 'background:var(--green);box-shadow:0 0 0 4px rgba(63,166,107,0.22)'
                    : 'background:var(--border-muted)';
                const rowClasses = on ? 'bg-surface-active border-[1.5px] border-brand-blue' : 'bg-surface border border-border';
                return `
                <button type="button" onclick="navigate('challenge', '${slug}')" aria-pressed="${on}" class="flex items-center gap-3.5 w-full box-border px-4 py-3.5 rounded-2xl text-left cursor-pointer ${rowClasses}">
                    <span class="w-2.5 h-2.5 shrink-0 rounded-full" style="${dotStyle}"></span>
                    <span class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span class="font-poppins font-semibold text-[15px] text-text-strong shell-sentence-case">${r.month} challenge</span>
                        <span class="font-inter text-[13px] text-text-muted">Round ${r.round} · ${r.title}</span>
                    </span>
                </button>`;
            }).join('');

            const status = Challenges.statusOf(selected);
            const isOpen = status === 'open';
            const isUpcoming = status === 'upcoming';

            let statusLabel, statusClasses;
            if (isOpen) {
                statusLabel = 'Open for submissions';
                statusClasses = 'bg-[rgba(63,166,107,0.18)] text-green-text border border-[rgba(63,166,107,0.5)]';
            } else if (isUpcoming) {
                statusLabel = `Opens ${formatWATDateTime(selected.opensAt).weekday}`;
                statusClasses = 'bg-[rgba(242,181,68,0.14)] text-gold-text border border-[rgba(242,181,68,0.4)]';
            } else if (status === 'judging') {
                statusLabel = 'Judging';
                statusClasses = 'bg-[rgba(159,179,200,0.12)] text-text-2 border border-border-strong';
            } else {
                statusLabel = 'Closed';
                statusClasses = 'bg-[rgba(159,179,200,0.12)] text-text-2 border border-border-strong';
            }

            const bannerBg = (isOpen || isUpcoming)
                ? 'background:radial-gradient(circle at 90% 10%, #0F4A85 0%, #003366 55%, #0B1A2E 100%)'
                : 'background:linear-gradient(135deg, #10223A 0%, #0B1A2E 100%)';

            let cta, ctaHref, note, noteColorClass;
            if (isOpen) {
                cta = 'Submit your entry'; ctaHref = '#submit';
                note = `Closes ${formatWATDateTime(selected.closesAt).time} WAT, ${formatShortDateWAT(selected.closesAt)}`;
                noteColorClass = 'text-green-text';
            } else if (isUpcoming) {
                cta = formatOpenShort(selected.opensAt); ctaHref = null;
                note = `Opens ${formatWATDateTime(selected.opensAt).weekday} ${formatShortDateWAT(selected.opensAt)}, ${formatWATDateTime(selected.opensAt).time}`;
                noteColorClass = 'text-gold-text';
            } else {
                cta = 'See the winner'; ctaHref = Router.buildHash('winners');
                note = 'Submissions closed. This round is read-only.';
                noteColorClass = 'text-text-muted';
            }
            const ctaHtml = ctaHref
                ? `<a href="${ctaHref}" class="inline-flex items-center h-11 px-5 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-sm shell-sentence-case no-underline">${cta}</a>`
                : `<span class="inline-flex items-center h-11 px-5 rounded-full border border-border-strong text-text-faint font-inter font-semibold text-sm shell-sentence-case cursor-not-allowed opacity-70">${cta}</span>`;
            const viewEntriesHtml = isUpcoming ? '' : `<a href="${Router.buildHash('gallery', selected.slug || `round-${selected.round}`)}" class="inline-flex items-center h-11 px-5 rounded-full border-[1.5px] border-border-muted text-text-strong font-inter font-semibold text-sm shell-sentence-case no-underline">View entries</a>`;

            const entriesDisplay = isUpcoming ? `Opens ${formatShortDateWAT(selected.opensAt)}` : String(selected.entryCount != null ? selected.entryCount : liveEntryCount(selected));
            const archiveNameHtml = selected.archiveName
                ? `<div class="font-inter text-xs text-text-faint italic">Previously: ${selected.archiveName}</div>` : '';

            const fieldsChips = (selected.requirements || []).map(r =>
                `<span class="px-3 py-1.5 rounded-xl bg-surface-2 border border-border font-inter font-medium text-[13px] text-text-2">${r.label}</span>`
            ).join('');
            const criteriaChips = (selected.criteria && selected.criteria.length) ? `
                <div class="flex flex-col gap-2">
                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">Scoring criteria</h3>
                    <div class="flex gap-2 flex-wrap">
                        ${selected.criteria.map(c => `<span class="px-3 py-1.5 rounded-xl bg-surface-2 border border-border font-inter font-medium text-[13px] text-text-2">${c}</span>`).join('')}
                    </div>
                </div>` : '';

            return `
                <div class="space-y-7 animate-in fade-in">
                    <div class="flex flex-col gap-2">
                        <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Challenge archive · ${selected.year || new Date().getFullYear()}</span>
                        <h1 class="m-0 font-poppins font-bold text-4xl leading-[1.1] tracking-[-0.8px] text-text-strong shell-sentence-case">Every challenge, newest first</h1>
                        <p class="m-0 max-w-[640px] font-inter text-base leading-[1.6] text-text-muted">Pick a month to see the brief, the winner and the entries. Past rounds are read-only; only the open round accepts submissions.</p>
                    </div>

                    <div class="flex flex-wrap gap-6 items-start">
                        <nav aria-label="Challenge months" class="flex-[1_1_280px] flex flex-col gap-2">${monthListHtml}</nav>

                        <section aria-live="polite" class="flex-[999_1_560px] min-w-0 rounded-[24px] bg-surface border border-border overflow-hidden">
                            <div class="p-8 flex flex-col gap-3.5" style="${bannerBg}">
                                <div class="flex gap-2.5 flex-wrap">
                                    <span class="inline-flex items-center h-7 px-3 rounded-full font-inter font-semibold text-xs shell-sentence-case ${statusClasses}">${statusLabel}</span>
                                    <span class="inline-flex items-center h-7 px-3 rounded-full bg-[rgba(5,14,28,0.5)] text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${selected.round} · ${selected.month} ${selected.year}</span>
                                </div>
                                <h2 class="m-0 font-poppins font-bold text-[32px] leading-[1.15] text-text-strong shell-sentence-case">${selected.title}</h2>
                                ${archiveNameHtml}
                            </div>
                            <div class="px-8 pb-8 pt-7 flex flex-col gap-6">
                                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Winner</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${selected.winnerName || 'To be announced'}</div></div>
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Entries</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${entriesDisplay}</div></div>
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Window</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${formatWindow(selected)}</div></div>
                                </div>
                                <div class="flex flex-col gap-2">
                                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">The brief</h3>
                                    ${renderBriefHtml(selected)}
                                </div>
                                <div class="flex flex-col gap-2">
                                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">What entrants submitted</h3>
                                    <div class="flex gap-2 flex-wrap">${fieldsChips}</div>
                                </div>
                                ${criteriaChips}
                                <div class="flex gap-3 flex-wrap items-center pt-4" style="border-top:1px solid var(--border)">
                                    ${ctaHtml}
                                    ${viewEntriesHtml}
                                    <span class="font-inter font-medium text-[13px] shell-sentence-case ${noteColorClass}">${note}</span>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            `;
        }

        // Unchanged submission form (same handleFormSubmit/setSubmissionType/state.formData
        // wiring as the pre-redesign Challenge tab) - only the round number is now dynamic.
        function renderSubmissionForm(round) {
            return `
                <div class="bg-slate-900 border-2 border-blue-500/20 rounded-[3rem] p-12 shadow-2xl">
                    <h3 class="text-3xl font-black text-white mb-10 italic uppercase tracking-tighter flex items-center gap-3"><i data-lucide="plus-circle" class="text-blue-500"></i> Share Round ${round} Submission</h3>
                    <div class="flex gap-4 mb-10 bg-slate-950 p-2 rounded-2xl border border-slate-800 max-w-md">
                        <button onclick="setSubmissionType('individual')" class="flex-1 py-3 rounded-xl font-black text-[10px] uppercase transition-all ${state.submissionType === 'individual' ? 'bg-blue-600 text-white' : 'text-slate-500'}">Individual</button>
                        <button onclick="setSubmissionType('group')" class="flex-1 py-3 rounded-xl font-black text-[10px] uppercase transition-all ${state.submissionType === 'group' ? 'bg-blue-600 text-white' : 'text-slate-500'}">Group (Team of 2)</button>
                    </div>
                    <form onsubmit="handleFormSubmit(event)" class="space-y-8">
                        ${state.submissionType === 'individual' ? `
                            <div class="grid md:grid-cols-2 gap-6 animate-in fade-in">
                                <div class="space-y-2"><label class="text-[10px] font-black text-slate-500 uppercase ml-1">Full Name</label><input required oninput="handleFormInput('formData', 'name', this.value)" value="${state.formData.name || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold"></div>
                                <div class="space-y-2"><label class="text-[10px] font-black text-slate-500 uppercase ml-1">Email (@descasio.io)</label><input required oninput="handleFormInput('formData', 'email', this.value)" value="${state.formData.email || ''}" type="email" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold"></div>
                                <div class="space-y-2 col-span-full"><label class="text-[10px] font-black text-slate-500 uppercase ml-1">Department</label><select onchange="handleFormInput('formData', 'dept', this.value)" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold"><option value="">Select Dept</option>${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
                            </div>
                        ` : `
                            <div class="space-y-8 animate-in slide-in-from-top-2">
                                <div class="space-y-2"><label class="text-[10px] font-black text-slate-500 uppercase ml-1">Team Name</label><input required oninput="handleFormInput('formData', 'teamName', this.value)" value="${state.formData.teamName || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-black uppercase italic" placeholder="THE GUARDIANS"></div>
                                <div class="grid md:grid-cols-2 gap-6 p-8 bg-slate-950 rounded-3xl border border-slate-800">
                                    <div class="col-span-full border-b border-slate-800 pb-3 mb-3"><span class="text-[10px] font-black text-blue-500 uppercase">Team Member 01</span></div>
                                    <div class="space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Name</label>
                                        <input required oninput="handleFormInput('formData', 'member1Name', this.value)" value="${state.formData.member1Name || ''}" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-1 ring-blue-600">
                                    </div>
                                    <div class="space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Email</label>
                                        <input required oninput="handleFormInput('formData', 'member1Email', this.value)" value="${state.formData.member1Email || ''}" type="email" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-1 ring-blue-600">
                                    </div>
                                    <div class="col-span-full space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Department</label>
                                        <select onchange="handleFormInput('formData', 'member1Dept', this.value)" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none">
                                            <option value="">Select Dept</option>
                                            ${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.member1Dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                                        </select>
                                    </div>
                                </div>
                                <div class="grid md:grid-cols-2 gap-6 p-8 bg-slate-950 rounded-3xl border border-slate-800">
                                    <div class="col-span-full border-b border-slate-800 pb-3 mb-3"><span class="text-[10px] font-black text-blue-500 uppercase">Team Member 02</span></div>
                                    <div class="space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Name</label>
                                        <input required oninput="handleFormInput('formData', 'member2Name', this.value)" value="${state.formData.member2Name || ''}" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-1 ring-blue-600">
                                    </div>
                                    <div class="space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Email</label>
                                        <input required oninput="handleFormInput('formData', 'member2Email', this.value)" value="${state.formData.member2Email || ''}" type="email" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-1 ring-blue-600">
                                    </div>
                                    <div class="col-span-full space-y-2">
                                        <label class="text-[10px] font-black text-slate-500 uppercase">Department</label>
                                        <select onchange="handleFormInput('formData', 'member2Dept', this.value)" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-white outline-none">
                                            <option value="">Select Dept</option>
                                            ${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.member2Dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        `}
                        <div class="pt-10 border-t border-slate-800 space-y-8">
                            <div class="space-y-2">
                                <label class="text-[10px] font-black text-slate-500 uppercase ml-1">1. Submission Document Link</label>
                                <input required oninput="handleFormInput('formData', 'submissionDocLink', this.value)" value="${state.formData.submissionDocLink || ''}" type="url" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 text-sm font-medium" placeholder="https://gemini.google.com/share/...">
                                <p class="text-[10px] text-slate-500 italic mt-1 ml-1">Paste your Gemini Canvas share link. Open it in a private window first to check it loads without signing in.</p>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] font-black text-slate-500 uppercase ml-1">Tools Used</label>
                                <input required oninput="handleFormInput('formData', 'toolsUsed', this.value)" value="${state.formData.toolsUsed || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 text-sm font-medium" placeholder="e.g. ChatGPT, Gemini, Claude, Custom Prompt Guardrails">
                            </div>
                        </div>
                        <div id="formStatus" class="hidden text-red-400 text-[10px] font-bold uppercase tracking-wider"></div>
                        <button type="submit" ${state.challengeClosed ? 'disabled' : ''} class="w-full ${state.challengeClosed ? 'bg-slate-700 cursor-not-allowed opacity-60' : 'bg-blue-600 hover:bg-blue-500'} text-white font-black py-6 rounded-2xl transition shadow-2xl uppercase tracking-[0.2em] active:scale-[0.98]">${state.challengeClosed ? 'Submissions Closed' : `Submit Round ${round} Entry`}</button>
                    </form>
                </div>
            `;
        }

        function renderTabContent() {
            if (state.activeTab === 'dashboard') {
                return renderDashboard();
            }

            if (state.activeTab === 'ideahub') {
                return `
                    <div class="max-w-5xl mx-auto space-y-12">
                        <div class="text-center"><h2 class="text-4xl font-black text-white italic uppercase tracking-tighter">Idea Crowdsourcing</h2><p class="text-slate-500 font-bold uppercase tracking-widest text-xs mt-2">What solutions should we build next?</p></div>
                        <div class="bg-slate-900 border border-blue-500/10 rounded-[2.5rem] p-10 max-w-2xl mx-auto shadow-2xl custom-card">
                            <h3 class="text-2xl font-black text-white mb-8 italic uppercase tracking-tighter flex items-center gap-3"><i data-lucide="lightbulb" class="text-yellow-400"></i> Pitch a Concept</h3>
                            <form onsubmit="handleIdeaSubmit(event)" class="space-y-6">
                                <div class="grid md:grid-cols-2 gap-6">
                                    <input required oninput="handleFormInput('ideaData', 'name', this.value)" value="${state.ideaData.name || ''}" class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold text-sm" placeholder="Full Name">
                                    <input required oninput="handleFormInput('ideaData', 'email', this.value)" value="${state.ideaData.email || ''}" type="email" class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold text-sm" placeholder="Work Email (@descasio.io)">
                                    <select onchange="handleFormInput('ideaData', 'dept', this.value)" class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold text-sm">
                                        <option value="">Select Dept</option>
                                        ${DEPARTMENTS.map(d => `<option value="${d}" ${state.ideaData.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                                    </select>
                                    <input required oninput="handleFormInput('ideaData', 'title', this.value)" value="${state.ideaData.title || ''}" class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 font-bold text-sm" placeholder="Idea Title">
                                </div>
                                <textarea required oninput="handleFormInput('ideaData', 'description', this.value)" rows="4" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none focus:ring-2 ring-blue-600 text-sm" placeholder="Description...">${state.ideaData.description || ''}</textarea>
                                <div id="ideaStatus"></div>
                                <button type="submit" class="w-full bg-blue-700 hover:bg-blue-600 text-white font-black p-5 rounded-2xl uppercase tracking-widest text-xs">Share Concept</button>
                            </form>
                        </div>
                        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            ${state.ideas.map(idea => `
                                <div onclick="showIdeaDetails('${idea.id}')" class="bg-slate-900 p-8 rounded-[2rem] border border-slate-800 hover:border-blue-500/40 transition-all group overflow-hidden cursor-pointer shadow-lg hover:shadow-blue-900/10 flex flex-col h-full">
                                    <div class="flex items-center gap-2 text-blue-500 mb-6"><i data-lucide="lightbulb" class="w-4 h-4"></i> <span class="text-[10px] font-black uppercase tracking-widest">Concept</span></div>
                                    <h4 class="text-white font-black text-xl mb-4 uppercase leading-tight italic tracking-tighter break-words group-hover:text-blue-400 transition-colors">${idea.title}</h4>
                                    <p class="text-slate-400 text-sm italic line-clamp-4 break-words leading-relaxed mb-8">"${idea.description}"</p>
                                    <div class="mt-auto space-y-4">
                                        <div class="pt-4 border-t border-slate-800/50 flex items-center justify-between">
                                            <div class="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[150px]">BY ${idea.name || 'Anonymous'}</div>
                                            <div class="text-blue-500 group-hover:translate-x-1 transition-transform"><i data-lucide="arrow-right" class="w-4 h-4"></i></div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            if (state.activeTab === 'challenge') {
                return renderChallenge();
            }

            if (state.activeTab === 'gallery') {
                return renderGallery();
            }
            if (state.activeTab === 'winners') {
                return `
                    <div class="max-w-6xl mx-auto space-y-12 animate-in zoom-in-95 duration-500">
                        <div class="text-center">
                            <h2 class="text-5xl font-black text-white italic tracking-tighter uppercase leading-none">Hall of Fame</h2>
                            <p class="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px] mt-4 italic underline underline-offset-8 decoration-blue-500/50">Celebrating the AI Transformation Journey</p>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            ${MONTHLY_RECORDS.map(item => `
                                <div class="bg-slate-900 rounded-[2.5rem] p-10 border-2 ${item.status === 'active' ? 'border-blue-500 shadow-blue-900/40 shadow-2xl' : 'border-slate-800'} relative overflow-hidden">
                                    <div class="flex justify-between items-start mb-8"><span class="text-slate-500 font-black text-xs uppercase tracking-[0.2em]">${item.month}</span>${item.status === 'completed' ? '<i data-lucide="medal" class="text-yellow-500 w-8 h-8"></i>' : item.status === 'active' ? '<div class="w-3 h-3 rounded-full bg-blue-500 animate-ping"></div>' : ''}</div>
                                    <div class="flex flex-col items-center text-center">
                                        ${item.winner ? `
                                            <div class="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-white font-black text-2xl mb-6 shadow-xl overflow-hidden border-2 border-white/10">
                                                ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover">` : item.winner.charAt(0)}
                                            </div>
                                            <h4 class="text-white font-black uppercase italic tracking-tighter text-2xl mb-1">${item.winner}</h4>
                                            <p class="text-blue-400 text-[10px] font-black uppercase tracking-widest text-center">${item.solution}</p>
                                        ` : `
                                            <div class="py-16 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-[2.5rem] w-full">
                                                <p class="text-slate-700 font-black text-[10px] uppercase tracking-widest italic">${item.status === 'active' ? 'CHALLENGE IN PROGRESS' : 'UPCOMING'}</p>
                                            </div>
                                        `}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            if (state.activeTab === 'leaderboard') {
                return `
                    <div class="space-y-10 animate-in fade-in">
                        <div class="text-center mb-12">
                            <h2 class="text-5xl font-black text-white italic uppercase tracking-tighter leading-none mb-4">Innovation Leaderboard</h2>
                            <p class="text-blue-500 font-black uppercase tracking-[0.3em] text-[10px]">Real-time Performance Standings (Verified)</p>
                        </div>
                        <div class="overflow-hidden rounded-[2.5rem] border border-slate-800 bg-slate-900 shadow-2xl">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left">
                                <thead class="bg-slate-950 text-slate-500 uppercase font-black border-b border-slate-800 text-[10px] tracking-widest">
                                    <tr>
                                        <th class="p-8 text-center w-24">Rank</th>
                                        <th class="p-8">Participant Detail</th>
                                        <th class="p-8 text-center">Round 1</th>
                                        <th class="p-8 text-center">Round 2</th>
                                        <th class="p-8 text-center">Round 3</th>
                                        <th class="p-8 text-center">Round 4</th>
                                        <th class="p-8 text-center">Round 5</th>
                                        <th class="p-8 text-center">Round 6</th>
                                        <th class="p-8 text-center">Round 7</th>
                                        <th class="p-8 text-center">Round 8</th>
                                        <th class="p-8 text-right">Cumulative</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-800">
                                    ${state.leaderboard.map((entry, index) => `
                                        <tr class="hover:bg-white/5 transition group">
                                            <td class="p-8 text-center">
                                                <div class="w-10 h-10 rounded-full mx-auto flex items-center justify-center font-black text-xs ${entry.rank < 4 ? 'rank-badge-' + entry.rank : 'bg-slate-800 text-slate-400'}">
                                                    ${entry.rank}
                                                </div>
                                            </td>
                                            <td class="p-8">
                                                <div class="flex flex-col">
                                                    <span class="text-white font-black uppercase text-sm tracking-tight group-hover:text-blue-400 transition-colors">${entry.name}</span>
                                                    <span class="text-slate-500 text-[10px] font-medium tracking-tight mt-1 opacity-60">${entry.email || 'descasio.io'}</span>
                                                </div>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-slate-400 font-bold">${entry.r1 !== undefined ? entry.r1 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-blue-400 font-bold">${entry.r2 !== undefined ? entry.r2 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-indigo-400 font-bold">${entry.r3 !== undefined ? entry.r3 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-purple-400 font-bold">${entry.r4 !== undefined ? entry.r4 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-blue-400 font-black">${entry.r5 !== undefined ? entry.r5 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-emerald-400 font-black">${entry.r6 !== undefined ? entry.r6 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-amber-400 font-black">${entry.r7 !== undefined ? entry.r7 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-center">
                                                <span class="text-rose-400 font-black">${entry.r8 !== undefined ? entry.r8 : '-'}</span>
                                            </td>
                                            <td class="p-8 text-right">
                                                <div class="flex flex-col items-end">
                                                    <span class="text-3xl font-black text-white italic tracking-tighter leading-none">${entry.cumulativeScore.toFixed(1)}</span>
                                                    <span class="text-blue-500 text-[8px] font-black uppercase tracking-[0.2em] mt-2">TOTAL POINTS</span>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            </div>
                        </div>
                    </div>
                `;
            }
            if (state.activeTab === 'admin') {
                return `
                    <div class="space-y-6">
                        <div class="flex justify-between items-end border-b border-slate-800 pb-10"><div><h2 class="text-4xl font-black text-white italic uppercase tracking-tighter leading-none">Admin Control</h2></div><button onclick="logoutAdmin()" class="bg-red-600/10 text-red-500 text-[10px] font-black uppercase px-6 py-3 rounded-xl border border-red-500/20 hover:bg-red-600 hover:text-white transition-all">Sign Out</button></div>
                        <div class="overflow-hidden rounded-[2.5rem] border border-slate-800 bg-slate-900 shadow-2xl">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-950 text-slate-500 uppercase font-black border-b border-slate-800"><tr><th class="p-6">Origin / Team</th><th class="p-6">Submission Detail</th><th class="p-6">Round</th><th class="p-6">Preview</th><th class="p-6 text-center">Shortlist</th><th class="p-6 text-center">Delete</th></tr></thead>
                                <tbody class="divide-y divide-slate-800">
                                    ${state.submissions.map(sub => `
                                        <tr class="hover:bg-white/5 transition">
                                            <td class="p-6"><b class="text-white uppercase tracking-tight">${sub.type === 'group' ? sub.teamName : sub.name}</b><br><span class="opacity-50 italic text-[10px] uppercase tracking-widest font-black text-blue-400">${sub.type === 'group' ? 'Group' : (sub.dept || 'Indiv')}</span></td>
                                            <td class="p-6 font-black uppercase text-blue-100 italic">${sub.round === 7 ? 'Descasio Security Trainer' : (sub.round === 6 ? 'Rogue AI Recovery Plan' : (sub.round === 5 ? 'The Optimizer 2 App' : (sub.round === 4 ? 'The Optimizer App' : (sub.round === 3 ? (sub.canvasLink ? 'Shared Link' : 'Website') : (sub.innovationName || 'Entry')))))}</td>
                                            <td class="p-6 font-black text-blue-500">R${sub.round || 1}</td>
                                            <td class="p-6">${sub.docLink ? `<img src="${sub.docLink}" class="w-10 h-10 rounded-lg object-cover">` : sub.round >= 4 ? (sub.solutionLink ? `<a href="${sub.solutionLink}" target="_blank" class="text-blue-500 underline text-[10px]">View Link</a>` : '-') : (sub.canvasLink ? `<a href="${sub.canvasLink}" target="_blank" class="text-blue-500 underline text-[10px]">View Link</a>` : '-')}</td>
                                            <td class="p-6 text-center"><button onclick="toggleShortlist('${sub.id}', ${sub.shortlisted})" class="p-4 rounded-2xl ${sub.shortlisted ? 'bg-yellow-500 text-black' : 'bg-slate-800 text-slate-500'} hover:scale-110 transition-all"><i data-lucide="star" class="w-6 h-6 ${sub.shortlisted ? 'fill-black' : ''}"></i></button></td>
                                            <td class="p-6 text-center"><button onclick="deleteSubmission('${sub.id}')" class="p-4 rounded-2xl bg-slate-800 text-red-500 hover:bg-red-600 hover:text-white hover:scale-110 transition-all"><i data-lucide="trash-2" class="w-6 h-6"></i></button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
        }

        function tidyName(raw) {
            if (!raw) return '';
            return raw
                .replace(/\b([a-z])/g, (m) => m.toUpperCase())
                .replace(/\b([A-Z])([A-Z]{3,})\b/g, (m, a, b) => a + b.toLowerCase());
        }

        function initialsOf(name) {
            return (name || '')
                .replace(/\[.*?\]/g, '')
                .replace(/[^A-Za-z\s-]/g, '')
                .trim()
                .split(/[\s-]+/)
                .filter(Boolean)
                .map(w => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
        }

        function deptColorsFor(item) {
            const key = item.type === 'group' ? 'Team' : (DEPT_COLORS[item.dept] ? item.dept : 'Unknown');
            return DEPT_COLORS[key];
        }

        function getSubmissionDisplayName(item) {
            const raw = item.type === 'group' ? item.teamName : item.name;
            return tidyName(raw || 'Anonymous');
        }

        // Fallback order: existing title field -> "<Challenge title> entry".
        // ("Avatar name" for Round 1 is the same innovationName field, not a separate one.)
        function getSubmissionTitle(item, roundTitle) {
            return item.innovationName || `${roundTitle || 'Challenge'} entry`;
        }

        // Every link field present on the item: the viewing round's own url-type
        // requirements first (real labels), then a legacy fallback for any of the four
        // historical link field names not already covered. Fixes the old bug where
        // submissionDocLink never rendered for Round 8 (no isR8 branch existed).
        function collectLinkFields(item) {
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const seen = new Set();
            const out = [];
            if (round && round.requirements) {
                for (const req of round.requirements) {
                    if (req.type === 'url' && item[req.id]) {
                        out.push({ label: req.label, url: item[req.id] });
                        seen.add(req.id);
                    }
                }
            }
            const legacy = [
                { id: 'docLink', label: 'Image / Doc Link' },
                { id: 'submissionDocLink', label: 'Submission Document Link' },
                { id: 'canvasLink', label: 'Canvas / Shared Link' },
                { id: 'solutionLink', label: 'Solution Link' }
            ];
            for (const f of legacy) {
                if (!seen.has(f.id) && item[f.id]) out.push({ label: f.label, url: item[f.id] });
            }
            return out;
        }

        // Every non-link text/textarea/multiselect answer, labelled from the round's own
        // requirements first, then legacy free-text fields from earlier rounds that
        // predate the requirements model.
        function collectTextFields(item) {
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const out = [];
            const covered = new Set();
            if (round && round.requirements) {
                for (const req of round.requirements) {
                    if (req.type === 'url') continue;
                    covered.add(req.id);
                    const val = item[req.id];
                    if (req.type === 'multiselect') {
                        if (val && val.length) out.push({ label: req.label, value: Array.isArray(val) ? val.join(', ') : val });
                    } else if (val) {
                        out.push({ label: req.label, value: val });
                    }
                }
            }
            const legacyText = [
                { id: 'achievements', label: 'Description' },
                { id: 'bugsIdentified', label: 'Bugs Identified' },
                { id: 'productRecommendations', label: 'Product Recommendations' },
                { id: 'problemDefinition', label: 'Problem Definition' },
                { id: 'operationalimpact', label: 'Operational Impact' },
                { id: 'rootCauseAnalysis', label: 'Root Cause Analysis' },
                { id: 'recoveryEmail', label: 'Client Recovery Email' },
                { id: 'guardrailRules', label: 'Guardrail System Rules' },
                { id: 'toolsUsed', label: 'Tools Used' }
            ];
            for (const f of legacyText) {
                if (!covered.has(f.id) && item[f.id]) {
                    const val = Array.isArray(item[f.id]) ? item[f.id].join(', ') : item[f.id];
                    out.push({ label: f.label, value: val });
                }
            }
            return out;
        }

        function renderDuplicateNotice(round) {
            const email = (state.formData.email || '').toLowerCase().trim();
            if (!email) return '';
            const hasExisting = state.submissions.some(s => {
                if (s.hiddenReason) return false;
                const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                return effRound === round.round && (s.email || '').toLowerCase().trim() === email;
            });
            if (!hasExisting) return '';
            return `<div class="p-4 rounded-2xl font-inter text-sm shell-sentence-case" style="background:rgba(242,181,68,0.12);border:1px solid rgba(242,181,68,0.4);color:var(--gold-text)">You've already submitted for Round ${round.round}. Submitting again adds a new version; the organisers will keep your latest one.</div>`;
        }

        function renderRequirementField(req, disabled) {
            const value = state.formData[req.id] || '';
            if (req.type === 'multiselect') {
                const options = req.options || [];
                const chips = options.map(opt => {
                    const on = state.formToolsSelected.includes(opt);
                    const safeOpt = opt.replace(/'/g, "\\'");
                    return `<button type="button" ${disabled ? 'disabled' : ''} onclick="toggleToolChip('${safeOpt}')" class="h-[38px] px-3.5 rounded-full font-inter font-semibold text-[13px] cursor-pointer border ${on ? 'border-[#00AEEF]' : 'border-border-strong bg-transparent text-text-2'}" style="${on ? 'background:rgba(0,174,239,0.16);color:var(--link)' : ''}">${on ? '✓ ' : ''}${opt}</button>`;
                }).join('');
                return `
                <div class="space-y-2">
                    <span class="lbl">${req.label} <span class="font-normal text-text-muted">(pick all that apply)</span></span>
                    <div class="flex gap-2 flex-wrap">${chips}</div>
                </div>`;
            }
            if (req.type === 'textarea') {
                return `
                <div class="space-y-2">
                    <label class="lbl">${req.label}</label>
                    <textarea ${disabled ? 'disabled' : ''} ${req.required ? 'required' : ''} rows="4" oninput="handleFormInput('formData','${req.id}',this.value)" class="fld" style="height:auto;padding-top:12px;padding-bottom:12px" placeholder="${req.placeholder || ''}">${value}</textarea>
                </div>`;
            }
            const inputType = req.type === 'url' ? 'url' : 'text';
            return `
            <div class="space-y-2">
                <label class="lbl">${req.label}</label>
                <input ${disabled ? 'disabled' : ''} ${req.required ? 'required' : ''} type="${inputType}" oninput="handleFormInput('formData','${req.id}',this.value)" value="${value}" class="fld" placeholder="${req.placeholder || ''}">
            </div>`;
        }

        function toggleToolChip(label) {
            const idx = state.formToolsSelected.indexOf(label);
            if (idx > -1) state.formToolsSelected.splice(idx, 1);
            else state.formToolsSelected.push(label);
            updateUI();
        }

        function resetSubmissionForm() {
            state.submissionSent = false;
            state.formData = {};
            state.formToolsSelected = [];
            updateUI();
        }

        function renderSubmissionFormSection(round) {
            const status = Challenges.statusOf(round);
            const reqLabels = (round.requirements || []).map(r => r.label.charAt(0).toLowerCase() + r.label.slice(1));
            const needText = reqLabels.length
                ? `This month you only need ${reqLabels.length === 1 ? 'one thing' : reqLabels.length + ' things'}: ${reqLabels.join(' and ')}.`
                : '';
            const checklistHtml = (round.checklist || []).map(c => `<span class="font-inter text-sm leading-[1.5] text-text-2">✓ ${c}</span>`).join('');
            const closeTarget = round.closesAt || round.opensAt;
            const { time, day, month, weekday } = closeTarget ? formatWATDateTime(closeTarget) : {};

            let statusBadge;
            if (status === 'open') {
                statusBadge = `<span class="self-start inline-flex items-center gap-2 h-7 px-3 rounded-full bg-[rgba(63,166,107,0.18)] border border-[rgba(63,166,107,0.5)] text-green-text font-inter font-semibold text-xs shell-sentence-case"><span class="w-2 h-2 rounded-full bg-green"></span>Round ${round.round} · Open</span>`;
            } else if (status === 'upcoming') {
                statusBadge = `<span class="self-start inline-flex items-center h-7 px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Opens ${weekday || 'soon'}</span>`;
            } else {
                statusBadge = `<span class="self-start inline-flex items-center h-7 px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · ${status === 'judging' ? 'Judging' : 'Closed'}</span>`;
            }

            const infoCard = `
            <div class="flex-[1_1_320px] p-8 rounded-[24px] border border-border flex flex-col gap-4" style="background:radial-gradient(circle at 90% 10%, #0F4A85 0%, #003366 55%, #0B1A2E 100%)">
                ${statusBadge}
                <h1 class="m-0 font-poppins font-bold text-[32px] leading-[1.15] text-text-strong shell-sentence-case">Submit your ${round.title}</h1>
                ${needText ? `<p class="m-0 font-inter text-[15px] leading-[1.6] text-text-2">${needText}</p>` : ''}
                ${checklistHtml ? `
                <div class="flex flex-col gap-2.5 p-4 rounded-2xl" style="background:rgba(5,14,28,0.45)">
                    <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Before you submit</span>
                    ${checklistHtml}
                </div>` : ''}
                <div class="mt-auto flex gap-4 flex-wrap items-center">
                    ${time ? `<span class="font-inter font-semibold text-sm text-text-strong shell-sentence-case">Closes ${time} WAT, ${day} ${month}</span>` : ''}
                    <a href="${Router.buildHash('challenge', round.slug || `round-${round.round}`)}" class="font-inter font-semibold text-sm shell-sentence-case">Read the full brief</a>
                </div>
            </div>`;

            let formCard;
            if (state.submissionSent) {
                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border flex items-center justify-center" style="min-height:420px">
                    <div class="flex flex-col items-center gap-3 text-center">
                        <div class="w-16 h-16 rounded-full flex items-center justify-center" style="background:rgba(63,166,107,0.18);border:1px solid rgba(63,166,107,0.5)">
                            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8FE0B0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>
                        </div>
                        <span class="font-poppins font-semibold text-2xl text-text-strong">Entry received</span>
                        <span class="font-inter text-[15px] leading-[1.6] text-text-muted" style="max-width:380px">Thanks for taking part. Round ${round.round} entries go live in the feed after the deadline.</span>
                        <button type="button" onclick="resetSubmissionForm()" class="mt-2 rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer" style="height:42px;padding:0 20px">Back to the form</button>
                    </div>
                </div>`;
            } else if (status === 'judging' || status === 'closed') {
                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border flex items-center justify-center text-center" style="min-height:420px">
                    <span class="font-poppins font-semibold text-xl text-text-strong">Round ${round.round} is closed — see the entries below.</span>
                </div>`;
            } else {
                const disabled = status === 'upcoming';
                const memberFieldsHtml = state.submissionType === 'group' ? `
                    <div class="grid gap-4 p-5 rounded-2xl bg-bg border border-border" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
                        <div class="font-inter font-semibold text-xs text-link uppercase shell-sentence-case" style="grid-column:1/-1;text-transform:uppercase">Additional team member (optional)</div>
                        <div class="space-y-2"><label class="lbl">Name</label><input ${disabled ? 'disabled' : ''} oninput="handleFormInput('formData','member1Name',this.value)" value="${state.formData.member1Name || ''}" class="fld"></div>
                        <div class="space-y-2"><label class="lbl">Email</label><input ${disabled ? 'disabled' : ''} type="email" oninput="handleFormInput('formData','member1Email',this.value)" value="${state.formData.member1Email || ''}" class="fld"></div>
                        <div class="space-y-2"><label class="lbl">Department</label><select ${disabled ? 'disabled' : ''} onchange="handleFormInput('formData','member1Dept',this.value)" class="fld"><option value="">Select department</option>${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.member1Dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
                    </div>
                    <div class="grid gap-4 p-5 rounded-2xl bg-bg border border-border" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
                        <div class="font-inter font-semibold text-xs text-link uppercase shell-sentence-case" style="grid-column:1/-1;text-transform:uppercase">Another team member (optional)</div>
                        <div class="space-y-2"><label class="lbl">Name</label><input ${disabled ? 'disabled' : ''} oninput="handleFormInput('formData','member2Name',this.value)" value="${state.formData.member2Name || ''}" class="fld"></div>
                        <div class="space-y-2"><label class="lbl">Email</label><input ${disabled ? 'disabled' : ''} type="email" oninput="handleFormInput('formData','member2Email',this.value)" value="${state.formData.member2Email || ''}" class="fld"></div>
                        <div class="space-y-2"><label class="lbl">Department</label><select ${disabled ? 'disabled' : ''} onchange="handleFormInput('formData','member2Dept',this.value)" class="fld"><option value="">Select department</option>${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.member2Dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
                    </div>` : '';

                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border">
                    <form id="submission-form" onsubmit="handleFormSubmit(event)" class="space-y-5">
                        ${renderDuplicateNotice(round)}
                        <div class="space-y-2">
                            <span class="lbl">Entry type</span>
                            <div role="group" aria-label="Entry type" class="inline-flex self-start p-1 rounded-[14px] bg-bg border border-border-strong">
                                <button type="button" ${disabled ? 'disabled' : ''} aria-pressed="${state.submissionType === 'individual'}" onclick="setSubmissionType('individual')" class="h-10 px-5 rounded-[10px] border-0 font-inter font-semibold text-sm cursor-pointer ${state.submissionType === 'individual' ? 'bg-text text-bg' : 'bg-transparent text-text-2'}">Individual</button>
                                <button type="button" ${disabled ? 'disabled' : ''} aria-pressed="${state.submissionType === 'group'}" onclick="setSubmissionType('group')" class="h-10 px-5 rounded-[10px] border-0 font-inter font-semibold text-sm cursor-pointer ${state.submissionType === 'group' ? 'bg-text text-bg' : 'bg-transparent text-text-2'}">Group</button>
                            </div>
                        </div>
                        ${state.submissionType === 'group' ? `
                        <div class="space-y-2">
                            <label class="lbl">Team name</label>
                            <input ${disabled ? 'disabled' : ''} required oninput="handleFormInput('formData','teamName',this.value)" value="${state.formData.teamName || ''}" class="fld" placeholder="e.g. Team DataFlow TS">
                        </div>` : ''}
                        <div class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
                            <div class="space-y-2">
                                <label class="lbl">${state.submissionType === 'group' ? 'Team lead full name' : 'Full name'}</label>
                                <input ${disabled ? 'disabled' : ''} required oninput="handleFormInput('formData','name',this.value)" value="${state.formData.name || ''}" class="fld" placeholder="Your full name">
                            </div>
                            <div class="space-y-2">
                                <label class="lbl">Work email</label>
                                <input ${disabled ? 'disabled' : ''} required type="email" oninput="handleFormInput('formData','email',this.value)" value="${state.formData.email || ''}" class="fld" placeholder="name@descasio.io">
                            </div>
                            <div class="space-y-2">
                                <label class="lbl">Department</label>
                                <select ${disabled ? 'disabled' : ''} required onchange="handleFormInput('formData','dept',this.value)" class="fld">
                                    <option value="">Select department</option>
                                    ${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        ${memberFieldsHtml}
                        <div class="flex items-center gap-3 pt-1">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-link shell-sentence-case whitespace-nowrap" style="text-transform:uppercase">Round ${round.round} requirements</span>
                            <span class="flex-1 h-px bg-border"></span>
                        </div>
                        ${(round.requirements || []).map(req => renderRequirementField(req, disabled)).join('')}
                        <div id="formStatus" class="hidden rounded-xl px-4 py-3 text-red-300 text-xs font-semibold" style="background:rgba(230,83,60,0.12);border:1px solid rgba(230,83,60,0.4)"></div>
                        <button type="submit" ${disabled || state.submitting ? 'disabled' : ''} class="w-full rounded-full border-0 font-inter font-semibold text-[15px] cursor-pointer mt-1 ${disabled ? 'bg-border-strong text-text-faint cursor-not-allowed' : 'bg-coral-btn text-text-strong'}" style="height:52px">
                            ${disabled ? formatOpenShort(round.opensAt) : (state.submitting ? 'Submitting…' : 'Submit entry')}
                        </button>
                    </form>
                </div>`;
            }

            return `<section id="submit-section" class="flex flex-wrap gap-6 items-stretch">${infoCard}${formCard}</section>`;
        }

        function renderArchiveFeed(current) {
            const allRounds = Challenges.allRounds(); // newest first
            const currentKey = current.slug || `round-${current.round}`;
            const filter = state.routeSub;
            const selectedKey = filter || currentKey;

            const others = allRounds.filter(r => r.round !== current.round).sort((a, b) => b.round - a.round);
            const chipDefs = [current, ...others].map(r => ({ key: r.slug || `round-${r.round}`, label: `Round ${r.round} · ${(r.month || '').slice(0, 3)}` }));
            chipDefs.push({ key: 'all', label: 'All rounds' });

            const chipsHtml = chipDefs.map(c => {
                const on = c.key === selectedKey;
                return `<button type="button" onclick="navigate('gallery','${c.key}')" aria-pressed="${on}" class="h-9 px-3.5 rounded-full font-inter font-semibold text-[13px] cursor-pointer ${on ? 'bg-text text-bg border border-text' : 'bg-transparent text-text-2 border border-border-strong'}">${c.label}</button>`;
            }).join('');

            let roundsToShow, headerTitle, headerMeta, isCurrentUpcomingView = false;
            if (selectedKey === 'all') {
                roundsToShow = allRounds.slice().sort((a, b) => b.round - a.round);
                headerTitle = `All rounds · March to ${current.month} ${current.year}`;
                headerMeta = 'Newest round first';
            } else {
                const r = allRounds.find(x => (x.slug || `round-${x.round}`) === selectedKey) || current;
                roundsToShow = [r];
                const st = Challenges.statusOf(r);
                if (r.round === current.round && (st === 'open' || st === 'upcoming')) isCurrentUpcomingView = true;
                headerTitle = `Round ${r.round} · ${r.title}`;
                headerMeta = r.winnerName
                    ? `Completed · ${r.month} ${r.year} · winner: ${r.winnerName}`
                    : (st === 'open' ? 'Open now · entries are revealed after the deadline'
                        : (st === 'upcoming' ? `Opens ${formatShortDateWAT(r.opensAt)}`
                            : `${st === 'judging' ? 'Judging' : 'Completed'} · ${r.month} ${r.year}`));
            }

            const cards = [];
            for (const r of roundsToShow) {
                const st = Challenges.statusOf(r);
                const hideBecauseOpenCurrent = (r.round === current.round) && (st === 'open' || st === 'upcoming') && !state.isAdmin;
                if (hideBecauseOpenCurrent) continue;
                const roundSubs = state.submissions.filter(s => {
                    const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                    if (effRound !== r.round) return false;
                    if (s.hidden === true && !state.isAdmin) return false;
                    return true;
                });
                for (const s of roundSubs) cards.push({ item: s, round: r });
            }

            const totalKnown = selectedKey === 'all' ? null : (roundsToShow[0] && roundsToShow[0].entryCount);
            const countText = selectedKey === 'all'
                ? `${cards.length} entries`
                : (totalKnown != null ? `${cards.length} entries${cards.length < totalKnown ? ' shown of ' + totalKnown : ''}` : `${cards.length} entries`);

            const underWraps = isCurrentUpcomingView && selectedKey !== 'all';

            let bodyHtml;
            if (underWraps) {
                bodyHtml = `
                <div class="p-14 rounded-[24px] border border-dashed border-border-strong bg-surface text-center flex flex-col gap-2 items-center">
                    <span class="font-poppins font-semibold text-xl text-text-strong">Round ${current.round} entries are under wraps</span>
                    <span class="font-inter text-sm leading-[1.6] text-text-muted" style="max-width:460px">Entries for the open round appear here after the deadline, so nobody copies a design before judging.</span>
                </div>`;
            } else if (cards.length) {
                bodyHtml = `
                <div class="grid gap-5" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
                    ${cards.map(c => renderSubmissionCard(c.item, c.round)).join('')}
                </div>`;
            } else {
                bodyHtml = `
                <div class="p-14 rounded-[24px] border border-dashed border-border-strong bg-surface text-center flex flex-col gap-2 items-center">
                    <span class="font-poppins font-semibold text-xl text-text-strong">No entries yet</span>
                </div>`;
            }

            return `
            <section class="space-y-5">
                <div class="flex justify-between items-end gap-4 flex-wrap">
                    <div class="flex flex-col gap-1.5">
                        <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Submissions archive</span>
                        <h2 class="m-0 font-poppins font-bold text-[30px] leading-[1.15] text-text-strong shell-sentence-case">What the team built</h2>
                    </div>
                    <span class="font-inter font-medium text-[13px] text-text-muted">${countText}</span>
                </div>
                <div class="flex gap-2 flex-wrap" role="group" aria-label="Filter by round">${chipsHtml}</div>
                <div class="px-4.5 py-3.5 rounded-2xl bg-surface border border-border flex gap-3 flex-wrap items-baseline">
                    <span class="font-poppins font-semibold text-[15px] text-text-strong">${headerTitle}</span>
                    <span class="font-inter text-[13px] text-text-muted">${headerMeta}</span>
                </div>
                ${bodyHtml}
                <div class="px-5 py-4 rounded-2xl bg-surface border border-border font-inter text-[13px] leading-[1.6] text-text-muted">
                    <strong class="text-text">How the cover works:</strong> each card draws its own cover from the entry title, round and entrant initials, tinted by department, so no card is ever blank.
                </div>
            </section>`;
        }

        function renderGallery() {
            const round = Challenges.currentRound();
            if (!round) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            return `
            <div class="space-y-8 animate-in fade-in">
                ${renderSubmissionFormSection(round)}
                ${renderArchiveFeed(round)}
            </div>`;
        }

        function renderSubmissionCard(item, round) {
            const [c1, c2] = deptColorsFor(item);
            const name = getSubmissionDisplayName(item);
            const initials = initialsOf(name);
            const title = getSubmissionTitle(item, round ? round.title : 'Challenge');
            const roundLabel = `Round ${item.round === undefined || item.round === null ? 1 : item.round}`;
            const deptLabel = item.type === 'group' ? 'Team' : (item.dept || 'Unknown');
            const isWinner = !!(round && round.winningSubmissionId && round.winningSubmissionId === item.id);
            const hiddenChip = item.hidden
                ? `<span class="px-2.5 py-1 rounded-[10px] font-inter font-semibold text-[10px]" style="background:rgba(230,83,60,0.18);color:#F2A08A">Hidden · ${item.hiddenReason || 'hidden'}</span>`
                : '';
            return `
            <article class="rounded-[20px] bg-surface border border-border overflow-hidden flex flex-col transition-transform hover:-translate-y-1">
                <div class="relative" style="height:168px;overflow:hidden;background:linear-gradient(135deg, ${c1} 0%, ${c2} 100%)">
                    <div class="absolute rounded-t-[10px] overflow-hidden flex flex-col" style="left:18px;right:18px;top:18px;bottom:0;background:#F5F7FA;box-shadow:0 10px 30px rgba(0,0,0,0.35)">
                        <div class="flex items-center gap-1" style="height:18px;flex-shrink:0;background:#E3E9F0;padding:0 8px">
                            <span class="rounded-full" style="width:6px;height:6px;background:#E6533C"></span>
                            <span class="rounded-full" style="width:6px;height:6px;background:#F2B544"></span>
                            <span class="rounded-full" style="width:6px;height:6px;background:#3FA66B"></span>
                        </div>
                        <div class="flex flex-col justify-end gap-0.5 box-border" style="height:72px;flex-shrink:0;padding:10px 12px;background:linear-gradient(135deg, ${c1}, ${c2})">
                            <span class="font-inter font-bold text-[10px] tracking-[1px] uppercase text-white" style="opacity:0.85;text-transform:uppercase">${roundLabel}</span>
                            <span class="font-poppins font-bold text-[15px] leading-[1.2] text-white truncate">${title}</span>
                        </div>
                        <div class="flex gap-1.5" style="padding:8px 10px">
                            <span class="rounded" style="flex:2;height:6px;background:#CDD7E2"></span>
                            <span class="rounded" style="flex:1;height:6px;background:#CDD7E2"></span>
                        </div>
                    </div>
                    <span class="absolute rounded-full flex items-center justify-center font-poppins font-bold text-sm text-white" style="right:14px;bottom:12px;width:40px;height:40px;background:#050E1C;border:2px solid ${c2}">${initials}</span>
                </div>
                <div class="flex flex-col gap-2.5 flex-1" style="padding:18px">
                    <div class="flex gap-1.5 flex-wrap">
                        <span class="px-2.5 py-1 rounded-[10px] bg-surface-2 font-inter font-semibold text-[11px] text-link">${roundLabel}</span>
                        <span class="px-2.5 py-1 rounded-[10px] bg-surface-2 font-inter font-semibold text-[11px]" style="color:${c2}">${deptLabel}</span>
                        ${isWinner ? `<span class="px-2.5 py-1 rounded-[10px] font-inter font-semibold text-[11px] text-gold-text" style="background:rgba(242,181,68,0.16)">Winner</span>` : ''}
                        ${hiddenChip}
                    </div>
                    <h3 class="m-0 font-poppins font-semibold text-[17px] leading-[1.3] text-text-strong truncate">${title}</h3>
                    <p class="m-0 font-inter text-[13px] leading-[1.5] text-text-muted truncate">By ${name}</p>
                    <div class="mt-auto flex gap-2" style="padding-top:6px">
                        <button type="button" onclick="showDetails('${item.id}')" class="flex-1 inline-flex justify-center items-center rounded-full bg-surface-active text-text-strong font-inter font-semibold text-[13px] cursor-pointer border-0" style="height:38px">Details and impact</button>
                    </div>
                </div>
            </article>`;
        }

        function renderModal() {
            const item = state.selectedInnovation;
            if (!item) return '';
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const title = getSubmissionTitle(item, round ? round.title : 'Submission');
            const links = collectLinkFields(item);
            const texts = collectTextFields(item);
            return `
                <div class="fixed inset-0 z-[110] bg-slate-950/98 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div class="bg-slate-900 max-w-2xl w-full p-12 rounded-[4rem] border-2 border-blue-500/30 shadow-[0_0_100px_rgba(37,99,235,0.2)] relative max-h-[90vh] overflow-y-auto custom-card">
                        <button onclick="closeModal()" class="absolute top-10 right-10 text-slate-500 hover:text-white transition-all hover:rotate-90"><i data-lucide="x" class="w-10 h-10"></i></button>
                        <span class="bg-blue-600/20 text-blue-400 border border-blue-400/30 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] italic">ROUND ${item.round === undefined || item.round === null ? 1 : item.round} ENTRY DETAIL</span>
                        <h3 class="text-4xl font-black text-white italic tracking-tighter uppercase leading-tight mt-8 mb-6 break-words">${title}</h3>
                        ${item.docLink ? `<img src="${item.docLink}" class="w-full aspect-square object-cover rounded-[2rem] border-2 border-blue-500/20 mb-10 shadow-2xl">` : ''}
                        <div class="space-y-4 mb-10">
                            ${item.type === 'group' ? `
                                <div class="flex items-center gap-3 text-slate-200 text-xs font-black uppercase tracking-widest truncate"><i data-lucide="shield" class="text-blue-500 w-4 h-4"></i> ${item.teamName || ''}</div>
                                <div class="p-6 bg-black/40 rounded-3xl border border-white/5 space-y-3">
                                    ${item.member1Name ? `<div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest truncate"><i data-lucide="user" class="w-3 h-3"></i> ${item.member1Name} • ${item.member1Dept || ''}</div>` : ''}
                                    ${item.member2Name ? `<div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest truncate"><i data-lucide="user" class="w-3 h-3"></i> ${item.member2Name} • ${item.member2Dept || ''}</div>` : ''}
                                </div>
                            ` : `
                                <div class="flex items-center gap-3 text-slate-300 text-sm font-black uppercase tracking-widest truncate"><i data-lucide="user" class="text-blue-500 w-4 h-4"></i> ${item.name || 'Anonymous'} • ${item.email || ''}</div>
                                <div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest px-1"><i data-lucide="briefcase" class="w-3 h-3"></i> ${item.dept || 'CORE'}</div>
                            `}
                        </div>
                        ${links.length ? `
                        <div class="space-y-4 mb-6">
                            <h4 class="text-[11px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-3"><i data-lucide="link" class="w-4 h-4"></i> Links</h4>
                            <div class="flex flex-wrap gap-3">
                                ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-100 font-black text-[11px] uppercase tracking-widest no-underline"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>${l.label}</a>`).join('')}
                            </div>
                        </div>` : ''}
                        ${texts.map(t => `
                        <div class="bg-black/60 rounded-[2.5rem] p-10 border border-white/5 mb-6 shadow-inner">
                            <h4 class="text-[11px] font-black text-amber-400 uppercase tracking-[0.3em] flex items-center gap-3 mb-4"><i data-lucide="file-text" class="w-4 h-4"></i> ${t.label}</h4>
                            <p class="text-slate-200 text-base leading-relaxed italic break-words whitespace-pre-wrap">${t.value}</p>
                        </div>`).join('')}
                        ${(!links.length && !texts.length) ? `<p class="text-slate-500 italic text-sm">No additional details recorded.</p>` : ''}
                    </div>
                </div>
            `;
        }

        function renderIdeaModal() {
            const idea = state.selectedIdea;
            if (!idea) return '';
            return `
                <div class="fixed inset-0 z-[110] bg-slate-950/98 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div class="bg-slate-900 max-w-3xl w-full p-12 rounded-[4rem] border-2 border-yellow-500/30 shadow-[0_0_100px_rgba(234,179,8,0.1)] relative max-h-[90vh] overflow-y-auto custom-card">
                        <button onclick="closeIdeaModal()" class="absolute top-10 right-10 text-slate-500 hover:text-white transition-all hover:rotate-90"><i data-lucide="x" class="w-10 h-10"></i></button>
                        <div class="flex items-center gap-3 text-yellow-500 mb-8"><i data-lucide="lightbulb" class="w-6 h-6"></i> <span class="text-xs font-black uppercase tracking-[0.3em] italic">Concept Detail</span></div>
                        <h3 class="text-5xl font-black text-white italic tracking-tighter uppercase leading-none mb-10 break-words">${idea.title}</h3>
                        <div class="bg-black/60 rounded-[3rem] p-12 border border-white/5 shadow-inner">
                            <h4 class="text-[11px] font-black text-blue-400 uppercase tracking-[0.4em] mb-10 flex items-center gap-3"><i data-lucide="align-left" class="w-4 h-4"></i> Detailed Description</h4>
                            <p class="text-slate-100 text-xl leading-[1.8] italic font-medium break-words whitespace-pre-wrap">"${idea.description}"</p>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderAdminLogin() {
            return `
                <div class="fixed inset-0 z-[100] bg-slate-950/98 backdrop-blur-2xl flex items-center justify-center p-6 animate-in zoom-in duration-300">
                    <div class="bg-slate-900 max-md w-full p-12 rounded-[3rem] border-2 border-slate-800 shadow-2xl text-center custom-card">
                        <div class="w-24 h-24 bg-blue-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-10 border border-blue-500/20 shadow-inner"><i data-lucide="lock" class="text-blue-500 w-12 h-12"></i></div>
                        <h3 class="text-3xl font-black text-white uppercase italic tracking-tighter mb-10">Admin Access Restricted</h3>
                        <input type="password" id="adminCode" class="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl p-5 text-center text-white outline-none focus:border-blue-600 transition-all font-mono tracking-[1em] mb-6" placeholder="••••">
                        <div id="adminCodeError" class="hidden text-red-500 text-[10px] font-bold uppercase mb-6"></div>
                        <div class="flex gap-4">
                            <button onclick="toggleAdminLogin()" class="flex-1 p-5 rounded-2xl border border-slate-800 text-slate-500 font-black text-[11px] uppercase tracking-[0.2em] hover:bg-slate-800 transition">ABORT</button>
                            <button onclick="authorizeAdmin()" class="flex-1 p-5 rounded-2xl bg-blue-600 text-white font-black text-[11px] uppercase tracking-[0.2em] hover:bg-blue-500 shadow-2xl transition">VERIFY</button>
                        </div>
                    </div>
                </div>
            `;
        }

        function navigate(tab, sub) {
            Router.go(tab, sub || null);
        }

        function toggleAdminLogin() {
            state.showAdminLogin = !state.showAdminLogin;
            updateUI();
        }
        function showAdminError(msg) {
            const errEl = document.getElementById('adminCodeError');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        async function authorizeAdmin() {
            const code = document.getElementById('adminCode').value;
            const hashed = await hashString(code);
            if (hashed === ADMIN_HASH) {
                state.isAdmin = true;
                state.showAdminLogin = false;
                state.activeTab = 'admin';
                updateUI();
            } else {
                showAdminError("Incorrect code.");
            }
        }

        function logoutAdmin() {
            state.isAdmin = false;
            state.activeTab = 'dashboard';
            updateUI();
        }

        function closeModal() {
            state.selectedInnovation = null;
            updateUI();
        }

        function closeIdeaModal() {
            state.selectedIdea = null;
            updateUI();
        }

        function showDetails(id) {
            state.selectedInnovation = state.submissions.find(s => String(s.id) === String(id));
            updateUI();
        }

        function showIdeaDetails(id) {
            state.selectedIdea = state.ideas.find(i => String(i.id) === String(id));
            updateUI();
        }

        function handleFormInput(stateKey, field, value) {
            state[stateKey][field] = value;
        }

        function setSubmissionType(type) {
            state.submissionType = type;
            updateUI();
        }

        async function toggleShortlist(id, current) {
            try {
                const docRef = db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').doc(id);
                await docRef.update({
                    shortlisted: !current
                });
            } catch (e) {
                console.error(e);
            }
        }

        async function deleteSubmission(id) {
            const confirmed = confirm('Permanently delete this submission? This removes it everywhere on the Hub and cannot be undone.');
            if (!confirmed) return;
            try {
                const docRef = db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').doc(id);
                await docRef.delete();
            } catch (e) {
                console.error(e);
                alert('Failed to delete submission. Check console for details.');
            }
        }

        function showFormError(msg) {
            const errEl = document.getElementById('formStatus');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        async function handleFormSubmit(e) {
            e.preventDefault();
            const round = Challenges.currentRound();
            if (!round || Challenges.statusOf(round) !== 'open') {
                showFormError('Submissions are closed for this round.');
                return;
            }
            const data = state.formData;

            if (!data.email || !data.email.toLowerCase().trim().endsWith('@descasio.io')) {
                showFormError('Work email must be a @descasio.io address.');
                return;
            }
            if (!data.name) {
                showFormError(state.submissionType === 'group' ? 'Team lead full name is required.' : 'Full name is required.');
                return;
            }
            if (!data.dept) {
                showFormError('Department is required.');
                return;
            }
            if (state.submissionType === 'group' && !data.teamName) {
                showFormError('Team name is required.');
                return;
            }

            for (const req of (round.requirements || [])) {
                if (!req.required) continue;
                if (req.type === 'multiselect') {
                    if (!state.formToolsSelected.length) {
                        showFormError(`${req.label} is required.`);
                        return;
                    }
                } else {
                    const val = data[req.id];
                    if (!val) {
                        showFormError(`${req.label} is required.`);
                        return;
                    }
                    if (req.type === 'url' && !val.startsWith('https://')) {
                        showFormError(`${req.label} must start with https://`);
                        return;
                    }
                }
            }

            const errEl = document.getElementById('formStatus');
            if (errEl) errEl.classList.add('hidden');

            const payload = {
                ...data,
                type: state.submissionType,
                round: round.round,
                shortlisted: false,
                timestamp: new Date().toISOString()
            };
            for (const req of (round.requirements || [])) {
                if (req.type === 'multiselect') payload[req.id] = [...state.formToolsSelected];
            }

            state.submitting = true;
            updateUI();
            try {
                await db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').add(payload);
                state.formData = {};
                state.formToolsSelected = [];
                state.submitting = false;
                state.submissionSent = true;
                updateUI();
            } catch (err) {
                console.error(err);
                state.submitting = false;
                showFormError('Something went wrong - please try again.');
                updateUI();
            }
        }

        async function handleIdeaSubmit(e) {
            e.preventDefault();
            const data = state.ideaData;
            try {
                await db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('ideas').add({
                    ...data,
                    timestamp: new Date().toISOString()
                });
                state.ideaData = {};
                updateUI();
            } catch (err) {
                console.error(err);
            }
        }

        Router.onRouteChange((route) => {
            if (route.tab !== 'gallery' && state.activeTab === 'gallery') {
                state.submissionSent = false; // don't leave a stale "Entry received" screen behind
            }
            state.activeTab = route.tab;
            state.routeSub = route.sub;
            updateUI();
        });

        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                await auth.signInAnonymously();
            } else {
                state.user = user;
                setInterval(() => {
                    updateCountdown();
                }, 60000); // spec: "Update every minute"

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions')
                    .onSnapshot((snapshot) => {
                        state.submissions = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        state.submissions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        updateUI();
                    });

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('ideas')
                    .onSnapshot((snapshot) => {
                        state.ideas = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        state.ideas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        updateUI();
                    });

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('leaderboard')
                    .onSnapshot((snapshot) => {
                        const firestoreData = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        const combined = [...FINAL_STANDINGS];
                        firestoreData.forEach(item => {
                            const existingIdx = combined.findIndex(e => e.name === item.name);
                            if (existingIdx > -1) combined[existingIdx] = item;
                            else combined.push(item);
                        });
                        state.leaderboard = combined.sort((a, b) => (b.cumulativeScore || 0) - (a.cumulativeScore || 0));
                        updateUI();
                    });

                Challenges.init(db, STABLE_APP_ID);
                Challenges.onUpdate(() => {
                    updateCountdown();
                    updateUI();
                });

                Router.onRoute(); // sync state.activeTab/routeSub from the current URL hash
                updateUI();
            }
        });
