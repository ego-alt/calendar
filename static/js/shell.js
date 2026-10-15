/* App-shell controller: the persistent top bar swaps between the Calendar and
   Stats views in-page (no full reload), keeps /stats as a real URL via the
   History API, and lazy-loads the Stats data the first time it's opened. */
(function () {
    const bar = document.querySelector(".shell-bar");
    if (!bar) return;
    const tabs = Array.from(bar.querySelectorAll(".shell-tab"));
    let statsLoaded = false;
    let statsLoading = null;

    /** Load (or reload) Stats. Anything that changes moods, markers or
     *  entries sets window.statsStale, so the next open shows fresh numbers. */
    function loadStats() {
        if (statsLoaded && !window.statsStale) return Promise.resolve();
        if (statsLoading) return statsLoading;
        const view = document.getElementById("statsView");
        const status = document.getElementById("statsStatus");
        const firstLoad = !statsLoaded;
        if (firstLoad) { view.classList.add("st-loading"); status.textContent = "Loading your stats…"; status.hidden = false; }
        window.statsStale = false;
        statsLoading = (async () => {
            try {
                const res = await fetch(appUrl("/stats/data"));
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

    function setView(view, { push = true } = {}) {
        // Switching the top-level view closes any open calendar sub-view
        // (year / diary / day) so we don't land on another view with one still open.
        ["yearView", "diaryView", "sidebar"].forEach((id) => {
            document.getElementById(id)?.classList.remove("active");
        });
        window.updateBottomBar?.();
        document.body.classList.toggle("view-calendar", view === "calendar");
        document.body.classList.toggle("view-stats", view === "stats");
        document.body.classList.toggle("view-search", view === "search");
        tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
        if (view === "stats") loadStats();
        if (push) {
            history.pushState({ view }, "", appUrl(PATHS[view] || "/"));
        }
    }

    tabs.forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));

    // Browser back/forward closes or reopens the Stats view.
    window.addEventListener("popstate", (e) => {
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
    (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => loadStats());
})();
