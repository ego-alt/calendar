/* Diary search — its own top-level view (#searchView). Hybrid search runs
 * server-side (search_index.py) with query routing (query_router.py); this fetches
 * GET /search/data, renders ranked results, and on click switches to the Calendar
 * view at that entry's day and opens the day sidebar.
 *
 * Loaded after index.js, so it shares its globals: viewState, updateCalendarView,
 * showSidebar, appUrl. */
(function () {
    const input = document.getElementById('searchInput');
    if (!input) return;

    const fromEl = document.getElementById('searchFrom');
    const toEl = document.getElementById('searchTo');
    const moodEl = document.getElementById('searchMood');
    const whoEl = document.getElementById('searchWho');
    const whereEl = document.getElementById('searchWhere');
    const resultsEl = document.getElementById('searchResults');
    const interpretedEl = document.getElementById('searchInterpreted');
    const filters = [fromEl, toEl, moodEl, whoEl, whereEl];

    const HINT = '<div class="search-hint">Search across every diary entry by meaning, words, or filters.</div>';
    let debounce;
    let lastRequest = 0;

    function esc(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function buildQuery() {
        const params = new URLSearchParams();
        const q = input.value.trim();
        if (q) params.set('q', q);
        if (fromEl.value) params.set('from', fromEl.value);
        if (toEl.value) params.set('to', toEl.value);
        if (moodEl.value) params.set('mood', moodEl.value);
        if (whoEl.value.trim()) params.set('who', whoEl.value.trim());
        if (whereEl.value.trim()) params.set('where', whereEl.value.trim());
        return params;
    }

    function renderInterpreted(parsed) {
        const labels = (parsed && parsed.labels) || [];
        if (!labels.length) {
            interpretedEl.style.display = 'none';
            interpretedEl.textContent = '';
            return;
        }
        interpretedEl.textContent = `Interpreted: ${labels.join(' · ')}`;
        interpretedEl.style.display = '';
    }

    async function runSearch() {
        const params = buildQuery();
        if ([...params.keys()].length === 0) {
            renderInterpreted(null);
            resultsEl.innerHTML = HINT;
            return;
        }

        const stamp = ++lastRequest;
        resultsEl.innerHTML = '<div class="loading-indicator">Searching…</div>';
        try {
            const response = await fetch(appUrl(`/search/data?${params.toString()}`));
            const data = await response.json();
            if (stamp !== lastRequest) return; // a newer query superseded this one
            if (data.status === 'success') {
                renderInterpreted(data.parsed);
                renderResults(data.results);
            } else {
                renderInterpreted(null);
                resultsEl.innerHTML = '<div class="error-message">Search failed</div>';
            }
        } catch (error) {
            if (stamp !== lastRequest) return;
            console.error('Search error:', error);
            renderInterpreted(null);
            resultsEl.innerHTML = '<div class="error-message">Search error</div>';
        }
    }

    function renderResults(results) {
        if (!results.length) {
            resultsEl.innerHTML = '<div class="no-events">No matching entries</div>';
            return;
        }
        resultsEl.innerHTML = results.map((r) => {
            const [datePart] = (r.start_time || '').split(' ');
            const [y, m, d] = datePart.split('-').map(Number);
            const display = new Date(y, m - 1, d).toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            });
            const detail = (icon, text) =>
                text ? `<div class="diary-event-detail"><i class="fas ${icon}"></i> ${esc(text)}</div>` : '';
            return `
                <div class="diary-event search-result" data-year="${y}" data-month="${m}" data-day="${d}">
                    <div class="search-result-date">${display}</div>
                    <div class="diary-event-name">${esc(r.name)}</div>
                    ${detail('fa-user', r.with_who)}
                    ${detail('fa-map-marker-alt', r.where)}
                    ${r.notes ? `<div class="diary-event-detail diary-event-notes"><i class="fas fa-sticky-note"></i> ${esc(r.notes)}</div>` : ''}
                </div>`;
        }).join('');
    }

    async function openResult(card) {
        const year = Number(card.dataset.year);
        const month = Number(card.dataset.month);
        const day = Number(card.dataset.day);
        viewState.mode = 'month';
        viewState.year = year;
        viewState.month = month;
        // Leave Stats for the calendar, render the target month, open the day.
        document.querySelector('.shell-tab[data-view="calendar"]')?.click();
        await updateCalendarView();
        showSidebar(day);
    }

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(runSearch, 250);
    });
    filters.forEach((el) => el.addEventListener('change', runSearch));

    resultsEl.addEventListener('click', (event) => {
        const card = event.target.closest('.search-result');
        if (card) openResult(card);
    });
})();
