/* App-shell controller: the bottom bar swaps between the Calendar, Stats and
   Search views in-page (no full reload), keeps /stats and /search as real URLs
   via the History API, and lazy-loads the Stats data the first time it's opened. */
(function () {
    const bar = document.getElementById("tmux");
    if (!bar) return;
    const tabs = Array.from(bar.querySelectorAll(".tmux-win[data-view]"));
    let statsLoaded = false;
    let statsLoading = null;

    /** Load (or reload) Stats. Anything that changes moods, markers or
     *  entries sets window.statsStale, so the next open shows fresh numbers. */
    let statsYear = null;   // null = last 12 months
    function loadStats({ year } = {}) {
        const changingRange = year !== undefined && year !== statsYear;
        if (changingRange) statsYear = year;
        if (statsLoaded && !window.statsStale && !changingRange) return Promise.resolve();
        if (statsLoading) return statsLoading;
        const view = document.getElementById("statsView");
        const status = document.getElementById("statsStatus");
        const firstLoad = !statsLoaded;
        if (firstLoad) { view.classList.add("st-loading"); status.textContent = "Loading your stats…"; status.hidden = false; }
        window.statsStale = false;
        statsLoading = (async () => {
            try {
                const res = await fetch(appUrl("/stats/data" + (statsYear ? `?year=${statsYear}` : "")));
                if (!res.ok) throw new Error(`stats ${res.status}`);
                window.renderStats(await res.json());
                statsLoaded = true;
                status.hidden = true;
            } catch (e) {
                window.statsStale = true;   // try again on the next open
                console.error("Failed to load stats:", e);
                if (!statsLoaded) {
                    status.innerHTML = 'Couldn\'t load your stats. <button type="button" class="link-btn" id="statsRetry">Try again</button>';
                    status.hidden = false;
                    document.getElementById("statsRetry").onclick = () => loadStats();
                }
            } finally {
                view.classList.remove("st-loading");
                statsLoading = null;
            }
        })();
        return statsLoading;
    }

    const PATHS = { calendar: "/", stats: "/stats", search: "/search" };

    let current = null;
    function setView(view, { push = true } = {}) {
        if (view === current) return;
        current = view;
        // The day panel floats over the page, so it closes on leaving. The
        // context pane (year / diary) stays as it was for coming back.
        document.getElementById("sidebar")?.classList.remove("active");
        document.body.classList.toggle("view-calendar", view === "calendar");
        document.body.classList.toggle("view-stats", view === "stats");
        document.body.classList.toggle("view-search", view === "search");
        // month / stats / search light up here; the year and diary toggles are
        // lit by updateTmux.
        tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
        window.updateTmux?.();
        if (view === "stats") loadStats();
        if (push) {
            // A panel's history entry, if one was open, becomes the view's.
            if (layerDepth) { history.replaceState({ view }, "", appUrl(PATHS[view] || "/")); layerDepth = 0; }
            else history.pushState({ view }, "", appUrl(PATHS[view] || "/"));
        }
    }

    // ---------- back closes what's open ----------
    // On a phone (and in the browser) back closes the open panel or sheet, top
    // one first, before it changes view. History keeps one entry per open
    // layer above the view's own, put back in line after every tap or key.
    const byId = (id) => document.getElementById(id);
    const layers = [   // topmost first: [is it open?, close it]
        [() => !byId("confirmModal").hidden, () => byId("confirmCancel").click()],
        [() => !byId("keysModal").hidden, () => { byId("keysModal").hidden = true; }],
        [() => byId("viewer").classList.contains("open"), () => closeViewer()],
        [() => byId("actionSheet").classList.contains("open"), () => closeActionSheet()],
        [() => byId("sidebar").classList.contains("active"), () => closeDayPanel()],
        [() => byId("termWindow").classList.contains("pane-open"), () => closePane()],
    ];
    let layerDepth = 0, ignoredPops = 0;
    function syncLayers() {
        const open = layers.filter(([isOpen]) => isOpen()).length;
        while (layerDepth < open) history.pushState({ view: current, layer: ++layerDepth }, "");
        if (layerDepth > open) { ignoredPops++; history.go(open - layerDepth); layerDepth = open; }
    }
    ["click", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, () => setTimeout(syncLayers, 0), true));

    tabs.forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
    window.loadStats = loadStats;

    // A heatmap cell opens that day on the calendar.
    window.openDayFromStats = async (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        setView("calendar");
        viewState.year = y;
        viewState.month = m;
        await updateCalendarView();
        showSidebar(d);
    };

    // Browser back/forward closes or reopens the Stats view (once no panel is open).
    window.addEventListener("popstate", (e) => {
        if (ignoredPops) { ignoredPops--; return; }
        if (layerDepth) {   // back from an open panel: close it, stay on the view
            layerDepth--;
            layers.find(([isOpen]) => isOpen())?.[1]();
            setTimeout(syncLayers, 0);
            return;
        }
        const path = location.pathname.replace(/\/+$/, "");
        let view = "calendar";
        if (e.state && e.state.view) view = e.state.view;
        else if (path.endsWith("/stats")) view = "stats";
        else if (path.endsWith("/search")) view = "search";
        setView(view, { push: false });
    });

    // Initial view comes from the server (active_view); the URL already matches.
    setView(window.INITIAL_VIEW || "calendar", { push: false });

    // Warm the Stats view in the background so opening it is instant.
    if (window.SIGNED_IN) (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => loadStats());
})();
