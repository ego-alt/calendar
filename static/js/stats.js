// Renders the Stats view from a get_stats_data() payload. Called by the shell
// the first time the Stats tab is opened (data fetched from /stats/data).
function renderStats(data) {
    const $ = (id) => document.getElementById(id);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmt = (iso) => formatDate(new Date(iso + "T00:00:00"), { weekday: false });

    $("range").textContent = fmt(data.range_start) + " – " + fmt(data.range_end);
    // Nothing logged in this period: say what will appear, not a page of zeros.
    const empty = !data.tiles.logged;
    document.getElementById("statsView").classList.toggle("st-nothing", empty);
    const status = $("statsStatus");
    if (empty) {
        status.textContent = data.year
            ? `No moods logged in ${data.year}.`
            : "Your stats fill in once you've logged a few days. Start with today on the Calendar.";
        status.hidden = false;
    } else if (!status.querySelector("#statsRetry")) {
        status.hidden = true;
    }

    // Shared hover tooltip: one floating element, follows the cursor.
    let tip = document.querySelector(".st-tip");
    if (!tip) {
        tip = document.createElement("div");
        tip.className = "st-tip";
        document.body.appendChild(tip);
    }
    tip.hidden = true;
    function moveTip(e) {
        const pad = 14, r = tip.getBoundingClientRect();
        let x = e.clientX + pad, y = e.clientY + pad;
        if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
        if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
        tip.style.left = x + "px";
        tip.style.top = y + "px";
    }
    // Hover shows a floating tip; a tap (touch has no hover) writes the same
    // details into the caption line under the chart.
    function attachTip(el, htmlFn, detailEl) {
        el.addEventListener("mouseenter", (e) => { tip.innerHTML = htmlFn(); tip.hidden = false; moveTip(e); });
        el.addEventListener("mousemove", moveTip);
        el.addEventListener("mouseleave", () => { tip.hidden = true; });
        if (detailEl) el.addEventListener("click", () => { detailEl.innerHTML = htmlFn(); });
    }
    // One mood breakdown row: swatch · name · "count · share%".
    const tipRow = (s) =>
        `<div class="row"><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)}<span class="v">${s.count} (${s.share}%)</span></div>`;

    // tiles
    const t = data.tiles, tm = t.top_mood;
    const avg = data.mood_with && data.mood_with.overall;
    const tiles = [
        { n: t.logged, l: `days logged of ${t.total}` },
        t.current_streak == null
            ? { n: avg != null ? `${avg.toFixed(1)}` : "—", l: "average mood (of 5)" }
            : {
                n: t.current_streak,
                l: "day streak" + (!t.today_logged && t.current_streak > 0 ? " · log today to keep it going" : ""),
            },
        { n: t.longest_streak, l: "day longest streak" },
        tm
            ? { n: esc(tm.name), l: `<span class="swatch" style="background:${esc(tm.color)}"></span>most common mood` }
            : { n: "—", l: "most common mood" },
    ];
    $("tiles").innerHTML = tiles.map((x) => `<div class="st-tile"><div class="n">${x.n}</div><div class="l">${x.l}</div></div>`).join("");

    // heatmap
    const grid = $("hmGrid");
    grid.innerHTML = "";
    data.days.forEach((d) => {
        const c = document.createElement("div");
        c.className = "st-cell";
        if (d.c) c.style.background = d.c;
        c.title = formatDate(new Date(d.d + "T00:00:00")) + (d.n ? " · " + d.n : " · no mood logged");
        c.dataset.date = d.d;
        grid.appendChild(c);
    });
    grid.onclick = (e) => {
        const cell = e.target.closest(".st-cell[data-date]");
        if (cell && window.openDayFromStats) window.openDayFromStats(cell.dataset.date);
    };
    // Start at the most recent weeks (the grid scrolls sideways on phones).
    requestAnimationFrame(() => {
        const sc = document.querySelector(".st-hm-scroll");
        if (sc) sc.scrollLeft = sc.scrollWidth;
    });
    const months = $("hmMonths");
    months.innerHTML = "";
    const weeks = Math.ceil(data.days.length / 7);
    months.style.gridTemplateColumns = `repeat(${weeks}, 13px)`;
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
        const day = data.days[w * 7];
        const s = document.createElement("span");
        if (day) {
            const mo = new Date(day.d + "T00:00:00").getMonth();
            if (mo !== lastMonth) { s.textContent = MONTHS[mo]; lastMonth = mo; }
        }
        months.appendChild(s);
    }

    // legend
    $("legend").innerHTML = data.distribution
        .map((m) => `<span class="item"><span class="sw" style="background:${esc(m.color)}"></span>${esc(m.name)}</span>`)
        .join("") + `<span class="item"><span class="sw" style="background:var(--color-bg-inset)"></span>No log</span>`;

    // stacked columns; tipFor(i) -> tooltip HTML for column i (optional)
    function stack(el, columns, tipFor) {
        el.innerHTML = "";
        columns.forEach((segs, i) => {
            const col = document.createElement("div");
            col.className = "col";
            (segs || []).forEach((s) => {
                const d = document.createElement("div");
                d.className = "seg";
                d.style.height = s.share + "%";
                d.style.background = s.color;
                col.appendChild(d);
            });
            if (tipFor) attachTip(col, () => tipFor(i), $("mixDetail"));
            el.appendChild(col);
        });
    }
    function mixTip(label, segs) {
        if (!segs || !segs.length) return `<div class="h">${esc(label)}</div><div class="row">No logs</div>`;
        const total = segs.reduce((a, s) => a + s.count, 0);
        return `<div class="h">${esc(label)} — ${total} days logged</div>${segs.map(tipRow).join("")}`;
    }
    const mixViews = {
        month:   { columns: data.month_mix.map((m) => m.segments), labels: data.month_mix.map((m) => m.label), cols: 12 },
        weekday: { columns: data.weekday, labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], cols: 7 },
    };
    function renderMix(view) {
        const { columns, labels, cols } = mixViews[view];
        const stackEl = $("mixStack"), labelsEl = $("mixLabels");
        // minmax(0, 1fr), not 1fr: the default `auto` minimum keeps a column
        // from shrinking below its label's min-width, so 12 month columns push
        // the card wider than the viewport (horizontal scroll). 0 lets them
        // share the fixed card width so the card stays uniform across views.
        stackEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        labelsEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        stack(stackEl, columns, (i) => mixTip(labels[i], columns[i]));
        labelsEl.innerHTML = labels.map((l) => `<span>${esc(l)}</span>`).join("");
    }
    // Wire one toggle group: active-class swap is scoped to this container's
    // buttons (so the trend and mix toggles don't clear each other's state).
    function wireToggle(container, onSelect) {
        const btns = container.querySelectorAll(".st-tab");
        // onclick (not addEventListener) so re-rendering doesn't stack handlers.
        btns.forEach((btn) => { btn.onclick = () => {
            btns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            onSelect(btn.dataset);
        }; });
    }
    $("mixDetail").textContent = "";
    $("evDetail").textContent = "";
    renderMix("month");
    wireToggle($("mixToggle"), (ds) => renderMix(ds.view));

    // days with events per month
    const evMax = Math.max(1, ...data.events_per_month.map((e) => e.count));
    $("ev").innerHTML = data.events_per_month
        .map((e) => `<div class="col" style="height:${e.count / evMax * 100}%"></div>`).join("");
    $("ev").querySelectorAll(".col").forEach((bar, i) => {
        const e = data.events_per_month[i];
        attachTip(bar, () => `<div class="h">${esc(e.label)}</div><div class="row">${e.count} days with entries</div>`, $("evDetail"));
    });
    $("evLabels").innerHTML = data.events_per_month.map((e) => `<span>${esc(e.label[0])}</span>`).join("");

    // mood trend
    (function () {
        const el = $("trend");
        const allTrend = data.trend || [];   // raw daily score; null where unlogged
        const labels = data.score_labels || [];
        let win = 7;

        // Trailing rolling average over logged days in the window; win<=1 is the
        // raw "Actual" series. Gaps (unlogged days) are skipped in the mean.
        function rolling(series, w) {
            if (w <= 1) return series;
            const need = Math.ceil(w / 4);
            return series.map((_, i) => {
                let sum = 0, cnt = 0;
                for (let k = Math.max(0, i - w + 1); k <= i; k++) {
                    if (series[k].v != null) { sum += series[k].v; cnt++; }
                }
                return { d: series[i].d, v: cnt >= need ? +(sum / cnt).toFixed(2) : null, m: series[i].m };
            });
        }

        function renderTrend(trend) {
            if (trend.filter(d => d.v != null).length < 7) {
                el.innerHTML = `<div class="st-empty">Not enough data yet.</div>`;
                return;
            }
            // Drawn at the card's real width so labels stay readable on phones.
            const W = Math.max(280, Math.round(el.clientWidth || 900)), H = W < 500 ? 150 : 170;
            const pad = { top: 10, right: 10, bottom: 22, left: 38 };
            const w = W - pad.left - pad.right;
            const h = H - pad.top - pad.bottom;
            const n = trend.length;
            const xAt = i => pad.left + (i / Math.max(n - 1, 1)) * w;
            const yAt = v => pad.top + h - ((v - 1) / 4) * h;

            // Runs of consecutive logged days; gaps break the line.
            const segs = [];
            let seg = [];
            trend.forEach((d, i) => {
                if (d.v == null) { if (seg.length) segs.push(seg); seg = []; }
                else seg.push([xAt(i), yAt(d.v)]);
            });
            if (seg.length) segs.push(seg);
            const pathD = segs.filter(s => s.length > 1).map(pts =>
                pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
            ).join(" ");
            // Lone logged days (gap on both sides) would be invisible as a line.
            const dots = segs.filter(s => s.length === 1).map(s =>
                `<circle cx="${s[0][0].toFixed(1)}" cy="${s[0][1].toFixed(1)}" r="1.8" class="st-tdot"/>`
            ).join("");

            // Marker days: a small red dot on the line (unlabelled, as on the calendar),
            // or at the baseline when the day has no value in this view.
            const marks = trend.map((d, i) => {
                if (!d.m) return "";
                const y = d.v != null ? yAt(d.v) : pad.top + h;
                return `<circle cx="${xAt(i).toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" class="st-tmark"></circle>`;
            }).join("");

            const grids = labels.map(s => {
                const y = yAt(s.score).toFixed(1);
                return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + w}" y2="${y}" class="st-tgrid"/>
                        <text x="${pad.left - 5}" y="${(+y + 4).toFixed(1)}" class="st-tlabel">${esc(s.name)}</text>`;
            }).join("");

            let lastMo = -1, nth = 0;
            const xTicks = trend.map((d, i) => {
                const mo = new Date(d.d + "T00:00:00").getMonth();
                if (mo === lastMo) return "";
                lastMo = mo;
                if (W < 500 && nth++ % 2) return "";   // every other month on narrow screens
                return `<text x="${xAt(i).toFixed(1)}" y="${H - 4}" class="st-tlabel">${MONTHS[mo]}</text>`;
            }).join("");

            el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
                ${grids}<path d="${pathD}" class="st-tline"/>${dots}${marks}${xTicks}
            </svg>`;
        }

        function draw() { renderTrend(rolling(allTrend, win)); }
        draw();
        wireToggle($("trendWin"), (ds) => { win = Number(ds.win); draw(); });
    })();


    // Mood with… — people and places against the overall average.
    (function () {
        const mw = data.mood_with || { people: [], places: [] };
        const el = $("moodWith");
        const hint = $("moodWithHint");
        if (mw.overall == null || (!mw.people.length && !mw.places.length)) {
            hint.textContent = `Shows up once a person or place appears on ${mw.min_days || 3} days with a mood logged.`;
            el.innerHTML = "";
            return;
        }
        hint.textContent = `Average mood on days with each person or place, against your overall ${mw.overall.toFixed(1)} of 5. `
            + `Only those seen on ${mw.min_days}+ days.`;
        const maxDelta = Math.max(0.5, ...[...mw.people, ...mw.places].map((r) => Math.abs(r.delta)));
        const row = (r) => {
            const pct = Math.min(50, (Math.abs(r.delta) / maxDelta) * 50);
            const side = r.delta >= 0 ? "up" : "down";
            const sign = r.delta > 0 ? "+" : r.delta < 0 ? "−" : "±";
            return `<div class="st-with-row" title="${esc(r.name)}: ${r.avg.toFixed(1)} on ${r.days} days">
                <span class="st-with-name">${esc(r.name)}</span>
                <span class="st-with-bar"><span class="st-with-fill ${side}" style="width:${pct}%"></span></span>
                <span class="st-with-val">${sign}${Math.abs(r.delta).toFixed(1)} <span class="st-with-days">· ${r.days} days</span></span>
            </div>`;
        };
        const col = (title, rows) => rows.length
            ? `<div class="st-with-col"><h3>${title}</h3>${rows.slice(0, 8).map(row).join("")}</div>` : "";
        el.innerHTML = col("People", mw.people) + col("Places", mw.places);
    })();

    // Range picker: last 12 months or any year with logs.
    (function () {
        const sel = $("statsRange");
        const current = data.year ? String(data.year) : "";
        sel.innerHTML = '<option value="">Last 12 months</option>'
            + (data.years || []).map((y) => `<option value="${y}">${y}</option>`).join("");
        sel.value = current;
        document.querySelector("#statsView h1").textContent = data.year ? `${data.year} in moods` : "Your year in moods";
        sel.onchange = () => window.loadStats && window.loadStats({ year: sel.value || null });
    })();

    window.lastStatsData = data;
}

window.renderStats = renderStats;

// Redraw the trend when the width changes (it's drawn at the card's width).
let statsResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(statsResizeTimer);
    statsResizeTimer = setTimeout(() => {
        if (window.lastStatsData && document.body.classList.contains("view-stats")) renderStats(window.lastStatsData);
    }, 200);
});
