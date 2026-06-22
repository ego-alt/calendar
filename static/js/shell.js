/* App-shell controller: the persistent top bar swaps between the Calendar and
   Stats views in-page (no full reload), keeps /stats as a real URL via the
   History API, and lazy-loads the Stats data the first time it's opened. */
(function () {
    const bar = document.querySelector(".shell-bar");
    if (!bar) return;
    const tabs = Array.from(bar.querySelectorAll(".shell-tab"));
    let statsLoaded = false;

    async function loadStats() {
        if (statsLoaded) return;
        statsLoaded = true;
        try {
            const res = await fetch(appUrl("/stats/data"));
            if (!res.ok) throw new Error(`stats ${res.status}`);
            window.renderStats(await res.json());
        } catch (e) {
            statsLoaded = false; // allow a retry on the next open
            console.error("Failed to load stats:", e);
        }
    }

    function setView(view, { push = true } = {}) {
        const stats = view === "stats";
        // Switching the top-level view closes any open calendar sub-view
        // (year / diary / day) so we don't land on Stats with one still open.
        ["yearView", "diaryView", "sidebar"].forEach((id) => {
            document.getElementById(id)?.classList.remove("active");
        });
        window.updateBottomBar?.();
        document.body.classList.toggle("view-stats", stats);
        document.body.classList.toggle("view-calendar", !stats);
        tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
        if (stats) loadStats();
        if (push) {
            history.pushState({ view }, "", appUrl(stats ? "/stats" : "/"));
        }
    }

    tabs.forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));

    // Browser back/forward closes or reopens the Stats view.
    window.addEventListener("popstate", (e) => {
        const path = location.pathname.replace(/\/+$/, "");
        const view = (e.state && e.state.view) || (path.endsWith("/stats") ? "stats" : "calendar");
        setView(view, { push: false });
    });

    // Initial view comes from the server (active_view); the URL already matches.
    setView(window.INITIAL_VIEW || "calendar", { push: false });
})();
