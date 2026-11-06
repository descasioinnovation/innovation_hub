// New shell: announcement bar, header (logo, nav, admin button), footer.
// Built to redesign/DESIGN_SPEC.md and redesign/mockups/*.dc.html. Does NOT touch
// tab content - renderTabContent() etc. in js/app.js are unchanged.
const Shell = (() => {
    const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 809.41 200" class="w-[130px] h-8 block" role="img" aria-label="Descasio"><path fill="#ffffff" d="M83.97,15.5l31.19,26.68v140.57h-31.19v-13.95c-2.67,4.92-6.98,9.03-12.72,12.11-5.54,3.08-11.9,4.51-18.67,4.51-14.36,0-25.65-4.92-34.06-14.57-8.41-9.64-12.52-22.16-12.52-37.55s4.31-27.5,12.93-37.35c8.62-9.85,19.9-14.77,34.06-14.77,6.98,0,13.13,1.44,18.67,4.51,5.54,3.08,9.64,7.18,12.31,12.31v-8.41h-.21l.21-74.08ZM61.6,159.34c7.59,0,13.34-2.46,17.44-7.39,4.1-4.92,6.16-11.08,6.16-18.67s-2.05-13.54-6.16-18.47c-4.1-4.92-9.85-7.39-17.44-7.39-7.18,0-12.93,2.46-17.24,7.18-4.31,4.72-6.36,11.08-6.36,18.67s2.05,13.95,6.36,18.88c4.31,4.72,10.06,7.18,17.24,7.18Z"/><path fill="#ffffff" d="M228.23,128.15c0,4.1-.21,8.62-.82,13.75h-73.05c.21,6.36,2.46,11.49,6.57,14.98,4.1,3.49,9.64,5.34,16.62,5.34,9.64,0,15.8-3.08,18.47-9.23h30.78c-1.44,9.64-6.77,17.65-16.01,23.8-9.03,5.95-20.11,9.03-33.24,9.03-16.83,0-30.17-4.72-39.81-13.95-9.64-9.23-14.57-22.16-14.57-38.58s4.92-28.93,14.57-38.17c9.64-9.44,22.57-14.16,38.78-14.16s27.7,4.31,37.35,13.13c9.64,8.82,14.36,20.11,14.36,34.06ZM154.35,122.41h42.89c-.21-6.57-2.05-11.7-5.54-15.19-3.49-3.49-8.62-5.34-15.39-5.34s-12.11,1.85-16.01,5.75c-3.9,3.69-5.75,8.62-5.95,14.77Z"/><path fill="#ffffff" d="M276.04,185.82c-14.16,0-25.65-3.08-34.06-9.23-8.41-6.16-12.72-13.95-12.72-23.6h31.19c0,3.49,1.44,6.16,4.51,8.41,3.08,2.26,6.98,3.28,11.7,3.28,3.49,0,6.16-.82,8.21-2.46,2.26-1.64,3.28-3.9,3.28-6.77,0-4.51-2.46-7.39-7.18-8.41l-24.21-6.16c-8-2.05-14.16-5.54-18.47-10.47-4.31-4.92-6.36-10.88-6.36-18.06,0-9.23,3.9-16.83,11.49-22.57,7.59-5.95,17.85-8.82,30.78-8.82,14.16,0,25.04,2.67,32.63,8.21,7.59,5.54,11.49,12.93,11.49,22.57h-30.99c0-3.49-1.23-6.16-3.69-8-2.26-1.85-5.54-2.87-9.85-2.87-3.49,0-6.16.82-8.21,2.26-2.05,1.44-3.08,3.49-3.08,5.95,0,4.31,2.87,7.39,8.41,8.82l23.39,6.36c7.8,2.05,13.95,5.54,18.26,10.26,4.51,4.72,6.77,10.47,6.77,17.24,0,10.26-3.9,18.47-11.7,24.83-7.8,6.16-18.26,9.23-31.6,9.23Z"/><path fill="#ffffff" d="M374.13,185.82c-16.21,0-28.93-4.72-38.58-14.36-9.64-9.64-14.36-22.37-14.36-38.17s4.72-28.32,14.36-37.96c9.64-9.64,22.37-14.36,38.58-14.36,14.57,0,26.47,3.69,35.71,10.88,9.23,7.18,14.36,17.03,15.6,29.55h-31.4c-2.26-9.23-8.82-13.95-19.7-13.95-6.77,0-12.11,2.26-16.01,6.77-3.9,4.51-5.75,10.88-5.75,19.08s1.85,14.57,5.75,19.08c3.9,4.51,9.23,6.77,16.01,6.77,10.88,0,17.44-4.31,19.7-13.13h31.4c-1.23,12.11-6.36,21.96-15.6,29.14-9.03,7.18-20.93,10.67-35.71,10.67Z"/><path fill="#ffffff" d="M475.09,185.41c-14.36,0-25.65-4.92-34.06-14.57-8.41-9.64-12.52-22.16-12.52-37.55s4.31-27.5,12.93-37.35c8.62-9.85,19.9-14.77,34.06-14.77,6.98,0,13.13,1.44,18.67,4.51,5.54,3.08,9.64,7.18,12.31,12.31v-14.16h31.19v98.91h-31.19v-13.95c-2.67,4.92-6.98,9.03-12.72,12.11-5.75,3.08-11.9,4.51-18.67,4.51ZM484.12,159.34c7.59,0,13.34-2.46,17.44-7.39,4.1-4.92,6.16-11.08,6.16-18.67s-2.05-13.54-6.16-18.47c-4.1-4.92-9.85-7.39-17.44-7.39-7.18,0-12.93,2.46-17.24,7.18-4.31,4.72-6.36,11.08-6.36,18.67s2.05,13.95,6.36,18.88c4.31,4.72,10.06,7.18,17.24,7.18Z"/><path fill="#ef472a" fill-rule="evenodd" d="M750.88,156.92c-20.87-1.13-34.75-9.92-32.95-35.83,2.75-16.7,10.65-26.05,21.42-31.31,4.61-2.21,9.5-3,13.78-3.18,26.05-1.13,39.13,16.33,44.29,48.49,1.54-16.25-2.97-30.95-15.32-43.18-19.41-19.98-55.65-19.19-73.35,1.65-24.06,31.79-2.53,70.78,42.13,63.36h0Z"/><path fill="#ef472a" fill-rule="evenodd" d="M739.81,103.23c20.87,1.13,34.75,9.92,32.95,35.83-2.75,16.7-10.65,26.05-21.42,31.31-4.61,2.21-9.5,3-13.78,3.18-26.05,1.13-39.13-16.33-44.29-48.49-1.54,16.25,2.97,30.95,15.32,43.18,19.41,19.98,55.65,19.19,73.35-1.65,24.06-31.79,2.53-70.78-42.13-63.36h0Z"/><path fill="#ffffff" d="M593.08,185.82c-14.16,0-25.65-3.08-34.06-9.23-8.41-6.16-12.72-13.95-12.72-23.6h31.19c0,3.49,1.44,6.16,4.51,8.41,3.08,2.26,6.98,3.28,11.7,3.28,3.49,0,6.16-.82,8.21-2.46,2.26-1.64,3.28-3.9,3.28-6.77,0-4.51-2.46-7.39-7.18-8.41l-24.21-6.16c-8-2.05-14.16-5.54-18.47-10.47-4.31-4.92-6.36-10.88-6.36-18.06,0-9.23,3.9-16.83,11.49-22.57,7.59-5.95,17.85-8.82,30.78-8.82,14.16,0,25.04,2.67,32.63,8.21,7.59,5.54,11.49,12.93,11.49,22.57h-30.99c0-3.49-1.23-6.16-3.69-8-2.26-1.85-5.54-2.87-9.85-2.87-3.49,0-6.16.82-8.21,2.26-2.05,1.44-3.08,3.49-3.08,5.95,0,4.31,2.87,7.39,8.41,8.82l23.39,6.36c7.8,2.05,13.95,5.54,18.26,10.26,4.51,4.72,6.77,10.47,6.77,17.24,0,10.26-3.9,18.47-11.7,24.83-7.8,6.16-18.26,9.23-31.6,9.23Z"/><path fill="#ffffff" d="M645.62,182.74v-98.91h31.4v98.91h-31.4Z"/><path fill="#ffffff" d="M659.37,76.44c5.54,0,10.26-1.85,13.95-5.54,3.69-3.69,5.54-8.21,5.54-13.54s-1.85-9.85-5.54-13.54c-3.69-3.9-8.41-5.75-13.95-5.75s-10.26,1.85-13.95,5.54c-3.49,3.69-5.34,8.21-5.34,13.75s1.85,9.85,5.34,13.54c3.69,3.69,8.41,5.54,13.95,5.54Z"/></svg>`;

    const NAV_ITEMS = [
        { tab: 'dashboard', label: 'Dashboard' },
        { tab: 'challenge', label: 'Challenges' },
        { tab: 'gallery', label: 'Submissions' },
        { tab: 'ideahub', label: 'Idea Hub' },
        { tab: 'winners', label: 'Winners' },
        { tab: 'leaderboard', label: 'Leaderboard' }
    ];

    function renderAnnouncementBar(state) {
        if (state.activeTab !== 'dashboard') return '';
        if (typeof Challenges === 'undefined' || !Challenges.isReady()) return '';
        const round = Challenges.currentRound();
        if (!round) return '';

        const status = Challenges.statusOf(round);
        let text;
        if (status === 'upcoming') {
            const { weekday, day, month, time } = formatWATDateTime(round.opensAt);
            text = `Round ${round.round} opens ${weekday} ${day} ${month}, ${time}: ${round.title}`;
        } else if (status === 'open') {
            text = `Round ${round.round} is open: ${round.title}`;
        } else if (status === 'judging') {
            text = `Round ${round.round} is closed — judging in progress`;
        } else if (round.winnerName) {
            text = `Congratulations to ${round.winnerName}, Round ${round.round} winner`;
        } else {
            text = `Round ${round.round}: ${round.title}`;
        }

        const item = (hidden) => `
            <span class="ticker-item"${hidden ? ' aria-hidden="true"' : ''}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" class="shrink-0"><path d="M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9 Z" fill="var(--gold)"></path></svg>
                <span class="font-inter font-medium text-[13px] text-[#D6E4F2] shell-sentence-case">${text}</span>
                <a href="${Router.buildHash('challenge')}"${hidden ? ' tabindex="-1"' : ''} class="link-gold font-inter font-semibold text-[13px] shell-sentence-case">Read the brief</a>
            </span>`;

        return `
        <div class="ticker-wrap bg-gradient-to-r from-navy via-[#0B2A4D] to-navy border-b border-border overflow-hidden">
            <div class="ticker-track">
                ${item(false)}
                ${item(true)}
            </div>
        </div>`;
    }

    function renderHeader(state) {
        const navLinks = NAV_ITEMS.map(item => {
            const active = state.activeTab === item.tab;
            return `<a href="${Router.buildHash(item.tab)}" class="shell-nav-link${active ? ' shell-nav-link--active' : ''} px-3.5 py-2.5 rounded-[10px] font-inter font-medium text-sm shell-sentence-case whitespace-nowrap"${active ? ' aria-current="page"' : ''}>${item.label}</a>`;
        }).join('');

        const adminTabLink = state.isAdmin ? (() => {
            const active = state.activeTab === 'admin';
            return `<a href="${Router.buildHash('admin')}" class="shell-nav-link${active ? ' shell-nav-link--active' : ''} px-3.5 py-2.5 rounded-[10px] font-inter font-medium text-sm shell-sentence-case whitespace-nowrap"${active ? ' aria-current="page"' : ''}>Admin</a>`;
        })() : '';

        return `
        <header class="border-b border-border bg-bg/[0.92] sticky top-0 z-40">
            <div class="max-w-[1240px] mx-auto px-6 py-4 flex flex-wrap md:flex-nowrap items-center gap-3 md:gap-5">
                <a href="${Router.buildHash('dashboard')}" class="flex items-center gap-3.5 no-underline order-1">
                    ${LOGO_SVG}
                    <span aria-hidden="true" class="w-px h-[26px] bg-border-strong"></span>
                    <span class="font-poppins font-semibold text-sm text-text shell-sentence-case tracking-[0.2px]">AI Innovation Hub</span>
                </a>
                <nav class="shell-nav flex gap-1.5" aria-label="Main">${navLinks}${adminTabLink}</nav>
                <button type="button" onclick="toggleAdminLogin()" class="shell-admin-btn h-10 px-4 rounded-[10px] border border-border-strong bg-transparent text-text font-inter font-semibold text-[13px] shell-sentence-case cursor-pointer whitespace-nowrap">
                    ${state.isAdmin ? '<i data-lucide="shield-check" class="w-4 h-4 inline-block align-middle" style="color:var(--green-text)"></i>' : 'Admin'}
                </button>
            </div>
        </header>`;
    }

    function renderFooter() {
        const year = new Date().getFullYear();
        return `
        <footer class="border-t border-border py-7 px-6 text-center flex flex-col gap-1.5">
            <span class="font-inter font-medium text-sm text-text-2 shell-sentence-case">Support and feedback: <a href="mailto:ai-innovation-hub@descasio.io" class="link-text">ai-innovation-hub@descasio.io</a></span>
            <span class="font-inter text-xs text-text-faint shell-sentence-case">© ${year} Descasio AI Innovation Hub · Empowering Your Digital Future</span>
        </footer>`;
    }

    return { renderAnnouncementBar, renderHeader, renderFooter };
})();
