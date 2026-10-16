/* The day panel: one day's entries and attachments, plus the one entry form
 * (new entry, edit entry, add/edit a moment).
 *
 * Drafts are never thrown away by closing the panel, tapping outside it or
 * pressing Escape: every keystroke is kept per day and form in localStorage,
 * and the form comes back with its text when that day is opened again. Only
 * Cancel (after asking, if anything changed) or a successful save clears one.
 *
 * Loaded after index.js and shares its globals: viewState, currentOpenDay,
 * appUrl, escapeHtml, parseLocalDateTime, isAllDayEvent, isoFromDate,
 * updateCalendarView, dismissSidebar. */

// ---------- feedback: toasts and an in-app confirm ----------

/** toast("Saved") or toast("Deleted “X”", { action: "Undo", onAction }). */
function toast(message, { action, onAction, error = false } = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' toast-error' : '');
    el.setAttribute('role', error ? 'alert' : 'status');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    if (action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'toast-action';
        b.textContent = action;
        b.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); onAction(); });
        el.appendChild(b);
    }
    document.getElementById('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(dismiss, action ? 8000 : error ? 6000 : 3000);
}

/** In-app confirm. Resolves true (OK), false (the cancel button) or null
 *  (dismissed: Escape or a tap outside), so callers can tell them apart. */
function askConfirm(text, { detail = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmText').textContent = text;
        document.getElementById('confirmDetail').textContent = detail;
        const okBtn = document.getElementById('confirmOk');
        okBtn.textContent = ok;
        document.getElementById('confirmCancel').textContent = cancel;
        okBtn.classList.toggle('btn-danger', danger);
        modal.hidden = false;
        okBtn.focus();
        const done = (value) => {
            modal.hidden = true;
            okBtn.onclick = document.getElementById('confirmCancel').onclick = modal.onclick = null;
            document.removeEventListener('keydown', onKey, true);
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); }
        };
        okBtn.onclick = () => done(true);
        document.getElementById('confirmCancel').onclick = () => done(false);
        modal.onclick = (e) => { if (e.target === modal) done(null); };
        document.addEventListener('keydown', onKey, true);
    });
}

/** fetch → JSON, throwing an Error whose message can be shown to the user. */
async function api(path, { method = 'GET', json, form } = {}) {
    let response;
    try {
        response = await fetch(appUrl(path), {
            method,
            headers: json ? { 'Content-Type': 'application/json' } : {},
            body: json ? JSON.stringify(json) : form,
        });
    } catch (_) {
        throw new Error("Couldn't reach the calendar. Check your connection.");
    }
    let data = {};
    try { data = await response.json(); } catch (_) { /* not JSON */ }
    if (!response.ok || data.status === 'error') {
        throw new Error(data.message || `Something went wrong (${response.status}). Try again.`);
    }
    return data;
}

// ---------- offline ----------

// The app and the days you've already looked at open offline (sw.js). Saving
// needs the connection: a failed save keeps the form and its draft.
if ('serviceWorker' in navigator && window.SIGNED_IN) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(appUrl('/sw.js'), { scope: appUrl('/') })
            .catch((err) => console.warn('Service worker registration failed:', err));
    });
}
window.addEventListener('offline', () => toast("You're offline. You can read; saving waits until you're back.", { error: true }));
window.addEventListener('online', () => toast('Back online'));

// ---------- dates ----------

/** "Tue 6 Oct 2026" — the one long date format (see AUDIT 3.1). */
function formatDayLong(date) {
    return formatDate(date);
}
/** "Tue 6 Oct" */
function formatDayShort(date) {
    return formatDate(date, { year: false });
}
/** "09:00–10:00", "All day", or for a multi-day entry the span seen from `onIso`. */
function entryTimeLabel(entry, onIso) {
    const start = parseLocalDateTime(entry.start_time);
    const end = entry.end_time ? parseLocalDateTime(entry.end_time) : null;
    const time = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (end && isoFromDate(start) !== isoFromDate(end)) {
        const allDay = isAllDayEvent(entry);
        const from = formatDayShort(start) + (allDay ? '' : `, ${time(start)}`);
        const to = formatDayShort(end) + (allDay ? '' : `, ${time(end)}`);
        return `${from} – ${to}`;
    }
    if (isAllDayEvent(entry)) return 'All day';
    return end ? `${time(start)}–${time(end)}` : time(start);
}

/** The log gutter beside an entry: start over end ("09:00" / "10:00"),
 *  "all day", or for a multi-day entry the span ("3–5 Oct"). */
function gutterTime(entry, onIso) {
    const start = parseLocalDateTime(entry.start_time);
    const end = entry.end_time ? parseLocalDateTime(entry.end_time) : null;
    const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (end && isoFromDate(start) !== isoFromDate(end)) {
        // Where this day sits in the span: "day 2 / of 3" (the dates go above the title).
        const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const [y, m, d] = onIso.split('-').map(Number);
        const n = Math.round((new Date(y, m - 1, d) - dayStart(start)) / 864e5) + 1;
        const total = Math.round((dayStart(end) - dayStart(start)) / 864e5) + 1;
        return `<span>day ${n}</span><span class="gutter-end">of ${total}</span>`;
    }
    if (isAllDayEvent(entry)) return '<span class="gutter-span">all day</span>';
    return `<span>${hm(start)}</span>${end ? `<span class="gutter-end">${hm(end)}</span>` : ''}`;
}

/** For a multi-day entry, its dates on one line ("Sat 3 – Mon 5 Oct"); else ''. */
function spanLine(entry) {
    const start = parseLocalDateTime(entry.start_time);
    const end = entry.end_time ? parseLocalDateTime(entry.end_time) : null;
    if (!end || isoFromDate(start) === isoFromDate(end)) return '';
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const from = `${WEEKDAY_ABBR[start.getDay()]} ${start.getDate()}${sameMonth ? '' : ' ' + MONTH_ABBR[start.getMonth()]}`;
    const to = formatDate(end, { year: false });
    return `<div class="entry-span">${escapeHtml(from)} – ${escapeHtml(to)}</div>`;
}

// ---------- drafts ----------

const DRAFTS_KEY = 'calendar-drafts';
function readDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {}; } catch (_) { return {}; }
}
function writeDrafts(drafts) {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch (_) { /* private mode: memory only */ }
}
function saveDraft(key, values) {
    const drafts = readDrafts();
    drafts[key] = { values, at: Date.now() };
    writeDrafts(drafts);
}
function clearDraft(key) {
    const drafts = readDrafts();
    delete drafts[key];
    writeDrafts(drafts);
}
/** The most recent draft for a day, if any: [key, draft]. */
function latestDraftFor(iso) {
    return Object.entries(readDrafts())
        .filter(([key]) => key.startsWith(iso + '|'))
        .sort((a, b) => b[1].at - a[1].at)[0] || null;
}

// ---------- mood and marker (shared by the day panel and the grid picker) ----------

const MOODS = window.MOODS || [];
const moodByKey = (key) => MOODS.find((m) => m.key === key) || null;

/** Repaint one day on the visible calendar after a mood/marker change. */
function paintDay(year, month, day, { mood, marker } = {}) {
    // Year view: repaint that one cell in place (no reload, no scroll jump).
    const yearCell = document.querySelector(`#yearView .year-day[data-month="${month}"][data-day="${day}"]`);
    if (yearCell && viewState.year === year) {
        if (mood !== undefined) yearCell.style.backgroundColor = mood ? moodByKey(mood).color : '';
        if (marker !== undefined) {
            const dot = yearCell.querySelector('.year-marker');
            if (marker && !dot) yearCell.insertAdjacentHTML('beforeend', '<span class="year-marker" aria-hidden="true"></span>');
            if (!marker && dot) dot.remove();
        }
    }
    if (isPaneOpen('diary')) loadMonthEvents();
    if (year !== viewState.year || month !== viewState.month) return;
    const cell = document.querySelector(`.day.current-month[data-day="${day}"]`);
    if (!cell) return;
    if (mood !== undefined) cell.style.backgroundColor = mood ? moodByKey(mood).color : '';
    if (marker !== undefined) {
        let dot = cell.querySelector('.marker-indicator');
        if (marker && !dot) {
            dot = document.createElement('div');
            dot.className = 'marker-indicator';
            cell.appendChild(dot);
        } else if (!marker && dot) {
            dot.remove();
        }
    }
}

/** Set (or clear, with null) a day's mood: instant on screen, rolled back with
 *  a message if the save fails, and undoable from the toast. */
async function setDayMood(year, month, day, key, { undoable = true } = {}) {
    const open = dayState && currentOpenDay === day && viewState.year === year && viewState.month === month;
    const before = open ? dayState.mood : undefined;
    if (open) { dayState.mood = key; renderMoodRow(); }
    paintDay(year, month, day, { mood: key });
    let result;
    try {
        result = await api('/mood/update', { method: 'POST', json: { year, month, day, mood: key } });
    } catch (error) {
        if (open) { dayState.mood = before; renderMoodRow(); }
        paintDay(year, month, day, { mood: before ?? null });
        toast(`Couldn't save the mood. ${error.message}`, { error: true });
        return;
    }
    window.statsStale = true;
    document.getElementById('firstRun')?.remove();
    const previous = result.previous ?? null;
    if (!undoable || previous === key) return;
    const label = key ? `Mood: ${moodByKey(key).name}` : 'Mood cleared';
    toast(label, { action: 'Undo', onAction: () => setDayMood(year, month, day, previous, { undoable: false }) });
}

async function toggleDayMarker(year, month, day) {
    let result;
    try {
        result = await api('/mood/marker/toggle', { method: 'POST', json: { year, month, day } });
    } catch (error) {
        toast(`Couldn't change the marker. ${error.message}`, { error: true });
        return;
    }
    window.statsStale = true;
    if (dayState && currentOpenDay === day) { dayState.hasMarker = result.has_marker; renderMoodRow(); }
    paintDay(year, month, day, { marker: result.has_marker });   // quietly: no toast
}

function renderMoodRow() {
    const slot = document.getElementById('dayMoodSlot');
    if (!slot || !dayState) return;
    const chips = MOODS.map((m) => `
        <button type="button" class="mood-chip${dayState.mood === m.key ? ' active' : ''}" data-act="mood"
                data-mood="${m.key}" aria-pressed="${dayState.mood === m.key}" style="--mood: ${m.color}">
            <span class="mood-dot" aria-hidden="true"></span>${escapeHtml(m.name)}
        </button>`).join('');
    slot.innerHTML = `
        <div class="day-mood" role="group" aria-label="How did the day feel?">${chips}</div>
        ${dayState.mood ? '<div class="day-flags"><button type="button" class="link-btn" data-act="clear-mood">Clear mood</button></div>' : ''}`;
    // The marker sits quietly in the header, beside the paperclip.
    const marker = document.querySelector('#sidebarContent [data-act="marker"]');
    if (marker) {
        marker.classList.toggle('active', !!dayState.hasMarker);
        marker.setAttribute('aria-pressed', String(!!dayState.hasMarker));
    }
}

// ---------- panel state ----------

let dayState = null;     // { day, iso, events, attachments }
let entryForm = null;    // { key, mode, eventId, subId, initial }
let draftTimer = null;   // pending draft save (debounced keystrokes)

function dayIso(day) {
    return isoFromDate(new Date(viewState.year, viewState.month - 1, day));
}
function findEntry(eventId, subId) {
    const event = (dayState?.events || []).find((e) => e.id === eventId);
    if (!event || subId == null) return event;
    return (event.subevents || []).find((s) => s.id === subId);
}

/** The day panel's header, shared by every state (loading, error, the day):
 *  ‹ date › to step a day, the marker and attach tools, and ×. The Year /
 *  Diary drawer on the right has the same header (index.html .drawer-head). */
function dayHeader(date, { tools = false } = {}) {
    return `
        <header class="drawer-head">
            <div class="drawer-title">
                <button type="button" class="drawer-step" data-act="prev-day" aria-label="Previous day" title="Previous day ([)">‹</button>
                <span class="day-title">${escapeHtml(formatDayLong(date))}</span>
                <button type="button" class="drawer-step" data-act="next-day" aria-label="Next day" title="Next day (])">›</button>
            </div>
            <div class="drawer-tools">${tools ? `
                <button type="button" class="marker-toggle" data-act="marker" aria-pressed="false" aria-label="Marker" title="Marker">
                    <span class="marker-dot" aria-hidden="true"></span>
                </button>
                <label class="attachment-upload-btn" title="Attach photos or PDFs (up to 10 MB each)">
                    <input type="file" multiple hidden accept="image/*,.heic,.heif,application/pdf" onchange="handleAttachmentUpload(event)">
                    <i class="fas fa-paperclip" aria-hidden="true"></i><span class="sr-only">Attach</span>
                </label>` : ''}
            </div>
            <button type="button" class="btn btn-ghost drawer-close" data-act="close" aria-label="Close"><i class="fas fa-times"></i></button>
        </header>`;
}

/** Close the day panel (any half-written entry is kept as a draft). */
function closeDayPanel() {
    closeEntryForm();
    dismissSidebar();
}

/** Step the open day by ±1, across month ends (the month follows). */
async function stepDay(delta) {
    if (currentOpenDay == null) return;
    const d = new Date(viewState.year, viewState.month - 1, currentOpenDay + delta);
    closeEntryForm();   // keeps a draft
    if (d.getFullYear() !== viewState.year || d.getMonth() + 1 !== viewState.month) {
        viewState.year = d.getFullYear();
        viewState.month = d.getMonth() + 1;
        updateCalendarView();
    }
    showSidebar(d.getDate());
}

async function showSidebar(day) {
    const sidebar = document.getElementById('sidebar');
    const content = document.getElementById('sidebarContent');
    if (window.innerWidth <= 480) sidebar.style.height = '';
    requestAnimationFrame(() => sidebar.classList.add('active'));
    currentOpenDay = day;
    entryForm = null;

    const iso = dayIso(day);
    // Show the right day straight away, never the previous day's content.
    content.innerHTML = `
        ${dayHeader(new Date(viewState.year, viewState.month - 1, day))}
        <div class="loading-indicator">Loading…</div>`;
    try {
        const query = `year=${viewState.year}&month=${viewState.month}&day=${day}`;
        const [events, attachments] = await Promise.all([
            api(`/events?${query}`),
            api(`/attachments?${query}`),
        ]);
        if (currentOpenDay !== day) return;   // another day was opened meanwhile
        dayState = {
            day, iso, events: events.events, attachments: attachments.attachments,
            mood: events.mood, hasMarker: events.has_marker,
        };
        renderDay();
        const draft = latestDraftFor(iso);
        if (draft) restoreDraft(draft[0], draft[1].values);
    } catch (error) {
        content.innerHTML = `
            ${dayHeader(new Date(viewState.year, viewState.month - 1, day))}
            <div class="error-message">${escapeHtml(error.message)}<br>
                <button class="btn btn-secondary retry-btn" type="button" data-act="retry">Try again</button></div>`;
    }
}

/** Re-fetch the open day and the visible calendar after a change. */
async function refreshAfterChange() {
    window.statsStale = true;
    document.getElementById('firstRun')?.remove();
    if (isPaneOpen('year')) loadYearView(viewState.year, { keepScroll: true });
    if (currentOpenDay != null) await showSidebar(currentOpenDay);
    await updateCalendarView();
}

function renderDetail(icon, text, extraClass = '') {
    return text ? `<div class="event-detail-item ${extraClass}"><i class="fas ${icon}" aria-hidden="true"></i> ${escapeHtml(text)}</div>` : '';
}

function renderEntryCard(event) {
    const linked = dayState.attachments.filter((a) => a.event_id === event.id);
    const subs = (event.subevents || []).map((s) => `
        <div class="subevent-card" data-event-id="${event.id}" data-subevent-id="${s.id}">
            <div class="subevent-actions">
                <button type="button" class="icon-btn" data-act="edit-sub" title="Edit moment" aria-label="Edit moment"><i class="fas fa-edit"></i></button>
                <button type="button" class="icon-btn" data-act="delete-sub" title="Delete moment" aria-label="Delete moment"><i class="fas fa-trash"></i></button>
            </div>
            <button type="button" class="more-btn" data-act="more-sub" aria-label="More actions for this moment"><i class="fas fa-ellipsis-h"></i></button>
            <div class="subevent-time log-gutter" title="${escapeHtml(entryTimeLabel(s, dayState.iso))}">${gutterTime(s, dayState.iso)}</div>
            <div class="subevent-name">${escapeHtml(s.name)}</div>
            <div class="subevent-details">
                ${renderDetail('fa-user', s.with_who)}
                ${renderDetail('fa-map-marker-alt', s.where)}
                ${renderDetail('fa-sticky-note', s.notes, 'entry-notes')}
            </div>
        </div>`).join('');
    return `
        <div class="event-card" data-event-id="${event.id}">
            <div class="event-actions">
                <button type="button" class="icon-btn" data-act="edit" title="Edit entry" aria-label="Edit entry"><i class="fas fa-edit"></i></button>
                <button type="button" class="icon-btn" data-act="add-sub" title="Add a moment" aria-label="Add a moment"><i class="fas fa-plus-circle"></i></button>
                <button type="button" class="icon-btn" data-act="delete" title="Delete entry" aria-label="Delete entry"><i class="fas fa-trash"></i></button>
            </div>
            <button type="button" class="more-btn" data-act="more" aria-label="More actions for this entry"><i class="fas fa-ellipsis-h"></i></button>
            <div class="event-time log-gutter" title="${escapeHtml(entryTimeLabel(event, dayState.iso))}">${gutterTime(event, dayState.iso)}</div>
            ${spanLine(event)}
            <div class="event-name">${escapeHtml(event.name)}</div>
            <div class="event-details">
                ${renderDetail('fa-user', event.with_who)}
                ${renderDetail('fa-map-marker-alt', event.where)}
                ${renderDetail('fa-sticky-note', event.notes, 'entry-notes')}
            </div>
            ${subs ? `<div class="subevents-container"><div class="subevents-list">${subs}</div></div>` : ''}
            ${linked.length ? `<div class="entry-attachments">${linked.map((a) => attachmentTile(a, { small: true })).join('')}</div>` : ''}
        </div>`;
}

/** One attachment tile: a real thumbnail for photos, an icon card for PDFs. */
function attachmentTile(a, { small = false } = {}) {
    const name = escapeHtml(a.filename);
    const caption = a.caption ? escapeHtml(a.caption) : '';
    const preview = a.is_image
        ? `<img src="${appUrl(`/attachments/${a.id}/thumb`)}" alt="${caption || name}" loading="lazy">`
        : `<span class="attachment-icon"><i class="fas fa-file-pdf" aria-hidden="true"></i><span>${name}</span></span>`;
    return `
        <div class="attachment-tile${small ? ' small' : ''}" data-attachment-id="${a.id}">
            <button type="button" class="attachment-open" data-act="view-attachment" title="${caption || name}" aria-label="Open ${caption || name}">${preview}</button>
            ${small ? '' : `<button type="button" class="attachment-delete" data-act="delete-attachment" title="Delete" aria-label="Delete ${name}"><i class="fas fa-times"></i></button>`}
            ${caption && !small ? `<div class="attachment-caption">${caption}</div>` : ''}
        </div>`;
}

function renderAttachments() {
    // Attachments linked to an entry show in its card; the rest belong to the day.
    const own = dayState.attachments.filter((a) => !a.event_id || !findEntry(a.event_id));
    if (!own.length) return '';
    return `
        <section class="attachments-section">
            <div class="section-label">Receipts &amp; tickets</div>
            <div class="attachments-grid">${own.map((a) => attachmentTile(a)).join('')}</div>
        </section>`;
}

function renderDay() {
    const content = document.getElementById('sidebarContent');
    const date = new Date(viewState.year, viewState.month - 1, dayState.day);
    const cards = dayState.events.map(renderEntryCard).join('');
    content.innerHTML = `
        ${dayHeader(date, { tools: true })}
        <div id="dayMoodSlot"></div>
        <button class="add-event-btn btn btn-primary" type="button" data-act="new">New entry</button>
        <div id="entryFormSlot"></div>
        <div class="event-list">${cards || '<div class="no-events">No entries yet.</div>'}</div>
        ${renderAttachments()}`;
    renderMoodRow();
}

// ---------- the entry form ----------

const FORM_TITLES = { 'new': 'New entry', 'edit': 'Edit entry', 'sub-new': 'Add a moment', 'sub-edit': 'Edit moment' };

function formKey(mode, eventId, subId) {
    return `${dayState.iso}|${mode}|${eventId ?? ''}|${subId ?? ''}`;
}

/** Form values from an entry ("YYYY-MM-DD HH:MM" strings) or blank for a new one. */
function valuesFromEntry(entry) {
    if (!entry) {
        return { name: '', start_date: dayState.iso, start_time: '', end_date: dayState.iso, end_time: '', with_who: '', where: '', notes: '' };
    }
    const [sd, st] = entry.start_time.split(' ');
    const [ed, et] = (entry.end_time || entry.start_time).split(' ');
    const allDay = isAllDayEvent(entry);
    return {
        name: entry.name || '',
        start_date: sd, start_time: allDay ? '' : st,
        end_date: ed, end_time: allDay || !entry.end_time ? '' : et,
        with_who: entry.with_who || '', where: entry.where || '', notes: entry.notes || '',
    };
}

function readForm(form) {
    const values = {};
    ['name', 'start_date', 'start_time', 'end_date', 'end_time', 'with_who', 'where', 'notes']
        .forEach((f) => { values[f] = form.elements[f].value; });
    return values;
}
function isDirty(values, initial) {
    return Object.keys(values).some((k) => (values[k] || '').trim() !== (initial[k] || '').trim());
}

function openEntryForm(mode, { eventId = null, subId = null, draftValues = null } = {}) {
    const slot = document.getElementById('entryFormSlot');
    if (!slot) return;
    const entry = mode === 'edit' ? findEntry(eventId)
        : mode === 'sub-edit' ? findEntry(eventId, subId) : null;
    const initial = valuesFromEntry(entry);
    const parent = mode.startsWith('sub') ? findEntry(eventId) : null;
    const key = formKey(mode, eventId, subId);
    const draft = draftValues || readDrafts()[key]?.values;
    const values = draft || initial;
    entryForm = { key, mode, eventId, subId, initial };

    slot.innerHTML = `
        <form class="entry-form" id="entryForm" novalidate>
            <div class="form-header">${FORM_TITLES[mode]}</div>
            ${parent ? `<div class="form-context">Part of “${escapeHtml(parent.name)}”</div>` : ''}
            ${draft ? `<div class="form-note">Draft restored.</div>` : ''}
            <input class="input" name="name" placeholder="What happened?" aria-label="What happened?" autocomplete="off">
            <div class="field-row">
                <span class="field-label">From</span>
                <input class="input date-input" type="date" name="start_date" aria-label="From date">
                <input class="input time-input" type="time" name="start_time" aria-label="From time (optional)">
            </div>
            <div class="field-row">
                <span class="field-label">To</span>
                <input class="input date-input" type="date" name="end_date" aria-label="To date">
                <input class="input time-input" type="time" name="end_time" aria-label="To time (optional)">
            </div>
            <div class="field-hint">Times are optional.</div>
            <input class="input" name="with_who" placeholder="Who was there?" aria-label="Who was there?" autocomplete="off">
            <input class="input" name="where" placeholder="Where?" aria-label="Where?" autocomplete="off">
            <textarea class="input" name="notes" placeholder="Notes" aria-label="Notes"></textarea>
            <div class="form-error" role="alert" hidden></div>
            <div class="form-buttons">
                <button type="button" class="btn btn-secondary cancel-btn" data-act="cancel-form">Cancel</button>
                <span class="form-buttons-title" aria-hidden="true">${FORM_TITLES[mode]}</span>
                <button type="submit" class="btn btn-primary save-btn">Save</button>
            </div>
        </form>`;
    const form = document.getElementById('entryForm');
    Object.entries(values).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v || ''; });

    // Keep the end date in step with the start date until it's changed by hand.
    let endTouched = values.end_date !== values.start_date;
    form.elements.end_date.addEventListener('input', () => { endTouched = true; });
    form.elements.start_date.addEventListener('input', () => {
        if (!endTouched) form.elements.end_date.value = form.elements.start_date.value;
    });

    form.addEventListener('input', () => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            if (!entryForm || entryForm.key !== key) return;   // saved or closed meanwhile
            const now = readForm(form);
            if (isDirty(now, initial)) saveDraft(key, now); else clearDraft(key);
        }, 250);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); submitEntryForm(); });

    document.getElementById('sidebar').classList.add('form-open');
    document.body.classList.add('entry-form-open');
    form.elements.name.focus({ preventScroll: true });
    slot.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function restoreDraft(key, values) {
    const [, mode, eventId, subId] = key.split('|');
    const eid = eventId ? Number(eventId) : null;
    const sid = subId ? Number(subId) : null;
    // A draft for an entry that's gone (deleted elsewhere) can't be restored in place.
    if ((mode === 'edit' || mode.startsWith('sub')) && !findEntry(eid)) { clearDraft(key); return; }
    if (mode === 'sub-edit' && !findEntry(eid, sid)) { clearDraft(key); return; }
    openEntryForm(mode, { eventId: eid, subId: sid, draftValues: values });
}

/** Close the form. The draft stays unless `discard` is set. */
function closeEntryForm({ discard = false } = {}) {
    clearTimeout(draftTimer);
    // Closing without discarding: make sure the very latest keystrokes are kept.
    const form = document.getElementById('entryForm');
    if (entryForm && !discard && form && isDirty(readForm(form), entryForm.initial)) {
        saveDraft(entryForm.key, readForm(form));
    }
    if (entryForm && discard) clearDraft(entryForm.key);
    entryForm = null;
    const slot = document.getElementById('entryFormSlot');
    if (slot) slot.innerHTML = '';
    document.getElementById('sidebar').classList.remove('form-open');
    document.body.classList.remove('entry-form-open');
}

async function cancelEntryForm() {
    const form = document.getElementById('entryForm');
    if (form && entryForm && isDirty(readForm(form), entryForm.initial)) {
        const choice = await askConfirm('Discard this entry?', {
            detail: 'Or keep it as a draft: it comes back when you open this day again.',
            ok: 'Discard', cancel: 'Keep as draft', danger: true,
        });
        if (choice === null) return;                    // dismissed: keep editing
        if (choice === false) { closeEntryForm(); toast('Draft kept'); return; }
    }
    closeEntryForm({ discard: true });
}

async function submitEntryForm() {
    const form = document.getElementById('entryForm');
    if (!form || !entryForm) return;
    const values = readForm(form);
    const errorEl = form.querySelector('.form-error');
    const showError = (msg) => {
        errorEl.textContent = msg;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // not hidden under a keyboard
    };
    if (!values.name.trim()) { showError('Give this entry a name.'); form.elements.name.focus(); return; }
    if (!values.start_date) { showError('Pick a date.'); return; }

    clearTimeout(draftTimer);
    const { mode, eventId, subId, key } = entryForm;
    const payload = {
        name: values.name.trim(),
        start_date: values.start_date,
        start_time: values.start_time || null,
        end_date: values.end_date || values.start_date,
        end_time: values.end_time || null,
        with_who: values.with_who.trim() || null,
        where: values.where.trim() || null,
        notes: values.notes.trim() || null,
    };
    const request = {
        'new': ['/events/', 'POST'],
        'edit': [`/events/${eventId}`, 'PUT'],
        'sub-new': [`/events/${eventId}/subevents`, 'POST'],
        'sub-edit': [`/events/subevents/${subId}`, 'PUT'],
    }[mode];
    const saveBtn = form.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
        await api(request[0], { method: request[1], json: payload });
    } catch (error) {
        // Keep the form and its text; say what went wrong.
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        saveDraft(key, values);
        showError(error.message);
        return;
    }
    clearDraft(key);
    closeEntryForm({ discard: true });
    toast('Saved');
    await refreshAfterChange();
}

// ---------- deleting ----------

async function deleteEntry(eventId, subId = null) {
    const entry = findEntry(eventId, subId);
    if (!entry) return;
    try {
        await api(subId ? `/events/subevents/${subId}` : `/events/${eventId}`, { method: 'DELETE' });
    } catch (error) {
        toast(error.message, { error: true });
        return;
    }
    const restorePath = subId ? `/events/subevents/${subId}/restore` : `/events/${eventId}/restore`;
    toast(`Deleted “${entry.name}”`, {
        action: 'Undo',
        onAction: async () => {
            try {
                await api(restorePath, { method: 'POST' });
            } catch (error) {
                toast(error.message, { error: true });
                return;
            }
            toast('Restored');
            await refreshAfterChange();
        },
    });
    window.statsStale = true;
    await refreshAfterChange();
}

// ---------- attachments ----------

async function handleAttachmentUpload(event) {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!files.length || currentOpenDay == null) return;
    let added = 0;
    const progress = document.createElement('div');
    progress.className = 'upload-progress';
    document.querySelector('#sidebarContent .drawer-head')?.after(progress);
    for (const [index, file] of files.entries()) {
        progress.textContent = files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : `Uploading ${file.name}…`;
        const form = new FormData();
        form.append('file', file);
        form.append('year', viewState.year);
        form.append('month', viewState.month);
        form.append('day', currentOpenDay);
        try {
            await api('/attachments', { method: 'POST', form });
            added += 1;
        } catch (error) {
            toast(`${file.name}: ${error.message}`, { error: true });
        }
    }
    progress.remove();
    if (added) toast(added === 1 ? 'Attached' : `Attached ${added} files`);
    await showSidebar(currentOpenDay);
}

async function deleteAttachment(attachmentId) {
    const attachment = dayState.attachments.find((a) => a.id === attachmentId);
    try {
        await api(`/attachments/${attachmentId}`, { method: 'DELETE' });
    } catch (error) {
        toast(error.message, { error: true });
        return;
    }
    const day = currentOpenDay;
    toast(`Deleted “${attachment ? attachment.filename : 'attachment'}”`, {
        action: 'Undo',
        onAction: async () => {
            try {
                await api(`/attachments/${attachmentId}/restore`, { method: 'POST' });
            } catch (error) {
                toast(error.message, { error: true });
                return;
            }
            toast('Restored');
            if (currentOpenDay === day) await showSidebar(day);
        },
    });
    await showSidebar(currentOpenDay);
}

// ---------- the attachment viewer ----------

let viewer = null;   // { list, index, editable }

/** Show attachments one at a time: photo (or PDF card), caption, the entry
 *  it belongs to, Open original and Delete. Arrow keys and swipes move. */
function openViewer(list, index, { editable = true } = {}) {
    viewer = { list, index, editable };
    const el = document.getElementById('viewer');
    el.hidden = false;
    renderViewer();
    requestAnimationFrame(() => el.classList.add('open'));
}
function closeViewer() {
    const el = document.getElementById('viewer');
    el.classList.remove('open');
    setTimeout(() => { el.hidden = true; }, 150);
    viewer = null;
}
function renderViewer() {
    const a = viewer.list[viewer.index];
    const url = appUrl(`/attachments/${a.id}`);
    const el = document.getElementById('viewer');
    const many = viewer.list.length > 1;
    const entries = (dayState?.events || []);
    el.querySelector('.viewer-stage').innerHTML = a.is_image
        ? `<img src="${url}" alt="${escapeHtml(a.caption || a.filename)}">`
        : `<div class="viewer-doc"><i class="fas fa-file-pdf" aria-hidden="true"></i><div>${escapeHtml(a.filename)}</div>
              <a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open PDF</a></div>`;
    el.querySelector('.viewer-count').textContent = many ? `${viewer.index + 1} of ${viewer.list.length}` : '';
    el.querySelectorAll('.viewer-nav').forEach((b) => { b.hidden = !many; });
    el.querySelector('.viewer-open').href = url;
    const meta = el.querySelector('.viewer-meta');
    meta.innerHTML = viewer.editable ? `
        <input class="input viewer-caption" placeholder="Add a caption" value="${escapeHtml(a.caption || '')}" aria-label="Caption" maxlength="500">
        ${entries.length ? `<select class="input viewer-entry" aria-label="Belongs to">
            <option value="">Belongs to the whole day</option>
            ${entries.map((e) => `<option value="${e.id}" ${a.event_id === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
        </select>` : ''}` : (a.caption ? `<div class="viewer-caption-text">${escapeHtml(a.caption)}</div>` : '');
    el.querySelector('.viewer-delete').hidden = !viewer.editable;
}
async function saveViewerField(field, value) {
    const a = viewer?.list[viewer.index];
    if (!a) return;
    try {
        const res = await api(`/attachments/${a.id}`, { method: 'PATCH', json: { [field]: value } });
        Object.assign(a, res.attachment);
        toast('Saved');
        if (dayState) { dayState.attachments = dayState.attachments.map((x) => (x.id === a.id ? a : x)); renderDay(); }
    } catch (error) {
        toast(error.message, { error: true });
    }
}
function moveViewer(step) {
    if (!viewer || viewer.list.length < 2) return;
    viewer.index = (viewer.index + step + viewer.list.length) % viewer.list.length;
    renderViewer();
}
(function wireViewer() {
    const el = document.getElementById('viewer');
    el.addEventListener('click', (e) => {
        e.stopPropagation();   // never a tap outside the day panel
        if (e.target === el || e.target.closest('.viewer-close')) closeViewer();
        else if (e.target.closest('[data-step]')) moveViewer(Number(e.target.closest('[data-step]').dataset.step));
        else if (e.target.closest('.viewer-delete')) {
            const a = viewer.list[viewer.index];
            closeViewer();
            deleteAttachment(a.id);
        }
    });
    el.addEventListener('change', (e) => {
        if (e.target.classList.contains('viewer-caption')) saveViewerField('caption', e.target.value);
        if (e.target.classList.contains('viewer-entry')) saveViewerField('event_id', e.target.value ? Number(e.target.value) : null);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('viewer-caption')) e.target.blur();
    });
    document.addEventListener('keydown', (e) => {
        if (!viewer) return;
        if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); }
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.key === 'ArrowLeft') moveViewer(-1);
        if (e.key === 'ArrowRight') moveViewer(1);
    }, true);
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50) moveViewer(dx < 0 ? 1 : -1);
    }, { passive: true });
})();

// ---------- action sheet (touch: the ⋯ on an entry) ----------

function openActionSheet(title, items) {
    const sheet = document.getElementById('actionSheet');
    sheet.querySelector('.action-sheet-title').textContent = title;
    const list = sheet.querySelector('.action-sheet-items');
    list.innerHTML = '';
    items.forEach(({ label, danger, run }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'action-sheet-item' + (danger ? ' danger' : '');
        b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); closeActionSheet(); run(); });
        list.appendChild(b);
    });
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeActionSheet() {
    const sheet = document.getElementById('actionSheet');
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, 180);
}
document.getElementById('actionSheet').addEventListener('click', (e) => {
    e.stopPropagation();   // never counts as a tap outside the day panel
    if (e.target.id === 'actionSheet' || e.target.closest('.action-sheet-cancel')) closeActionSheet();
});

// ---------- one click handler for the whole panel ----------

document.getElementById('sidebarContent').addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const card = target.closest('[data-event-id]');
    const eventId = card ? Number(card.dataset.eventId) : null;
    const subId = card && card.dataset.subeventId ? Number(card.dataset.subeventId) : null;
    switch (act) {
        case 'new': openEntryForm('new'); break;
        case 'edit': openEntryForm('edit', { eventId }); break;
        case 'add-sub': openEntryForm('sub-new', { eventId }); break;
        case 'edit-sub': openEntryForm('sub-edit', { eventId, subId }); break;
        case 'delete': deleteEntry(eventId); break;
        case 'delete-sub': deleteEntry(eventId, subId); break;
        case 'cancel-form': cancelEntryForm(); break;
        case 'delete-attachment':
            e.preventDefault();
            deleteAttachment(Number(target.closest('.attachment-tile').dataset.attachmentId));
            break;
        case 'view-attachment': {
            const id = Number(target.closest('.attachment-tile').dataset.attachmentId);
            const list = dayState.attachments;
            openViewer(list, Math.max(0, list.findIndex((a) => a.id === id)));
            break;
        }
        case 'retry': showSidebar(currentOpenDay); break;
        case 'close': closeDayPanel(); break;
        case 'prev-day': stepDay(-1); break;
        case 'next-day': stepDay(1); break;
        case 'more': {
            const entry = findEntry(eventId);
            openActionSheet(entry.name, [
                { label: 'Edit entry', run: () => openEntryForm('edit', { eventId }) },
                { label: 'Add a moment', run: () => openEntryForm('sub-new', { eventId }) },
                { label: 'Delete entry', danger: true, run: () => deleteEntry(eventId) },
            ]);
            break;
        }
        case 'more-sub': {
            const entry = findEntry(eventId, subId);
            openActionSheet(entry.name, [
                { label: 'Edit moment', run: () => openEntryForm('sub-edit', { eventId, subId }) },
                { label: 'Delete moment', danger: true, run: () => deleteEntry(eventId, subId) },
            ]);
            break;
        }
        case 'mood': setDayMood(viewState.year, viewState.month, currentOpenDay, target.dataset.mood); break;
        case 'clear-mood': setDayMood(viewState.year, viewState.month, currentOpenDay, null); break;
        case 'marker': toggleDayMarker(viewState.year, viewState.month, currentOpenDay); break;
    }
});
