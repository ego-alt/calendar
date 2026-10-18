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

    const HINT = '<div class="search-hint">Search every entry by meaning or words, e.g. “dinner with Sam last month”.</div>';
    let debounce;
    let lastRequest = 0;
    let limit = 20;   // grows with "Show more"

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

    // Filters fold behind a button on phones; the badge counts the active ones.
    const filtersBtn = document.getElementById('filtersBtn');
    const filtersBox = document.getElementById('searchFilters');
    const filtersCount = document.getElementById('filtersCount');
    function updateFilterCount() {
        const n = filters.filter((el) => el.value.trim()).length;
        filtersCount.textContent = n;
        filtersCount.hidden = n === 0;
    }
    filtersBtn.addEventListener('click', () => {
        const open = filtersBox.classList.toggle('open');
        filtersBtn.setAttribute('aria-expanded', String(open));
    });

    /** Escape, then wrap the searched words (3+ letters) in <mark>. */
    function highlight(text) {
        const words = input.value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
        let html = esc(text);
        if (!words.length) return html;
        const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
        return html.replace(pattern, '<mark>$1</mark>');
    }

    function renderInterpreted(parsed) {
        const labels = (parsed && parsed.labels) || [];
        if (!labels.length) {
            interpretedEl.style.display = 'none';
            interpretedEl.textContent = '';
            return;
        }
        interpretedEl.textContent = `Showing ${labels.join(' · ')}`;
        interpretedEl.style.display = '';
    }

    async function runSearch({ keepLimit = false } = {}) {
        if (!keepLimit) limit = 20;
        updateFilterCount();
        const params = buildQuery();
        if ([...params.keys()].length === 0) {
            renderInterpreted(null);
            resultsEl.innerHTML = HINT;
            return;
        }

        const stamp = ++lastRequest;
        if (!keepLimit) resultsEl.innerHTML = '<div class="loading-indicator">Searching…</div>';
        params.set('limit', limit);
        try {
            const response = await fetch(appUrl(`/search/data?${params.toString()}`));
            const data = await response.json();
            if (stamp !== lastRequest) return; // a newer query superseded this one
            if (data.status === 'success') {
                renderInterpreted(data.parsed);
                renderResults(data.results, data.more);
            } else {
                renderInterpreted(null);
                resultsEl.innerHTML = '<div class="error-message">Couldn\'t search right now. Try again.</div>';
            }
        } catch (error) {
            if (stamp !== lastRequest) return;
            console.error('Search error:', error);
            renderInterpreted(null);
            resultsEl.innerHTML = '<div class="error-message">Couldn\'t search right now. Check your connection and try again.</div>';
        }
    }

    function renderResults(results, more) {
        if (!results.length) {
            const q = input.value.trim();
            resultsEl.innerHTML = `<div class="no-events">${q ? `Nothing matches “${esc(q)}”.` : 'Nothing matches.'} Try fewer words or clear the filters.</div>`;
            return;
        }
        resultsEl.innerHTML = results.map((r) => {
            const [datePart] = (r.kind === 'note' ? r.date : r.start_time || '').split(' ');
            const [y, m, d] = datePart.split('-').map(Number);
            const display = formatDate(new Date(y, m - 1, d));
            const detail = (kind, text, extra = '') =>
                text ? detailLine(kind, highlight(text), `diary-event-detail ${extra}`) : '';
            const mood = r.mood
                ? `<span class="diary-mood" style="--mood: ${esc(r.mood.color)}"><span class="mood-dot" aria-hidden="true"></span>${esc(r.mood.name)}</span>` : '';
            if (r.kind === 'note') {
                return `
                <div class="diary-event search-result" data-year="${y}" data-month="${m}" data-day="${d}">
                    <div class="search-result-date">${display} ${mood}</div>
                    ${detailLine('notes', highlight(r.note), 'diary-event-detail diary-event-notes')}
                </div>`;
            }
            return `
                <div class="diary-event search-result" data-year="${y}" data-month="${m}" data-day="${d}">
                    <div class="search-result-date">${display} ${mood}</div>
                    <div class="diary-event-name">${highlight(r.name)}</div>
                    ${detail('who', r.with_who)}
                    ${detail('where', r.where)}
                    ${detail('notes', r.notes, 'diary-event-notes')}
                </div>`;
        }).join('') + `<div class="search-footer">${results.length} ${results.length === 1 ? 'result' : 'results'}${more
            ? ` · <button type="button" class="link-btn" id="searchMore">Show more</button>` : ''}</div>`;
    }

    async function openResult(card) {
        const year = Number(card.dataset.year);
        const month = Number(card.dataset.month);
        const day = Number(card.dataset.day);
        viewState.year = year;
        viewState.month = month;
        // Leave Search for the calendar at that month, open the day.
        document.querySelector('.tmux-win[data-view="calendar"]')?.click();
        await updateCalendarView();
        showSidebar(day);
    }

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(runSearch, 250);
    });
    filters.forEach((el) => el.addEventListener('change', runSearch));

    resultsEl.addEventListener('click', (event) => {
        if (event.target.id === 'searchMore') {
            limit = Math.min(100, limit + 20);
            runSearch({ keepLimit: true });
            return;
        }
        const card = event.target.closest('.search-result');
        if (card) openResult(card);
    });
})();
