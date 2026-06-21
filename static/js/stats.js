(function () {
    const data = JSON.parse(document.getElementById("stats-data").textContent);
    const $ = (id) => document.getElementById(id);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    $("range").textContent = fmt(data.range_start) + " – " + fmt(data.range_end);

    // Shared hover tooltip: one floating element, follows the cursor.
    const tip = document.createElement("div");
    tip.className = "st-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
    function moveTip(e) {
        const pad = 14, r = tip.getBoundingClientRect();
        let x = e.clientX + pad, y = e.clientY + pad;
        if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
        if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
        tip.style.left = x + "px";
        tip.style.top = y + "px";
    }
    function attachTip(el, htmlFn) {
        el.addEventListener("mouseenter", (e) => { tip.innerHTML = htmlFn(); tip.hidden = false; moveTip(e); });
        el.addEventListener("mousemove", moveTip);
        el.addEventListener("mouseleave", () => { tip.hidden = true; });
    }
    // One mood breakdown row: swatch · name · "count · share%".
    const tipRow = (s) =>
        `<div class="row"><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)}<span class="v">${s.count} (${s.share}%)</span></div>`;

    // tiles
    const t = data.tiles, tm = t.top_mood;
    const tiles = [
        { n: t.logged, l: `days logged of ${t.total}` },
        { n: t.current_streak, l: "day current streak" },
        { n: t.longest_streak, l: "day longest streak" },
        tm
            ? { n: esc(tm.name), l: `<span class="swatch" style="background:${esc(tm.color)}"></span>most common mood` }
            : { n: "—", l: "most common mood" },
    ];
    $("tiles").innerHTML = tiles.map((x) => `<div class="st-tile"><div class="n">${x.n}</div><div class="l">${x.l}</div></div>`).join("");

    // heatmap
    const grid = $("hmGrid");
    data.days.forEach((d) => {
        const c = document.createElement("div");
        c.className = "st-cell";
        if (d.c) c.style.background = d.c;
        c.title = new Date(d.d + "T00:00:00").toDateString() + (d.n ? " · " + d.n : " · —");
        grid.appendChild(c);
    });
    const months = $("hmMonths");
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
            if (tipFor) attachTip(col, () => tipFor(i));
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
        btns.forEach((btn) => btn.addEventListener("click", () => {
            btns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            onSelect(btn.dataset);
        }));
    }
    renderMix("month");
    wireToggle($("mixToggle"), (ds) => renderMix(ds.view));

    // days with events per month
    const evMax = Math.max(1, ...data.events_per_month.map((e) => e.count));
    $("ev").innerHTML = data.events_per_month
        .map((e) => `<div class="col" style="height:${e.count / evMax * 100}%"></div>`).join("");
    $("ev").querySelectorAll(".col").forEach((bar, i) => {
        const e = data.events_per_month[i];
        attachTip(bar, () => `<div class="h">${esc(e.label)}</div><div class="row">${e.count} days with events</div>`);
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
                return { d: series[i].d, v: cnt >= need ? +(sum / cnt).toFixed(2) : null };
            });
        }

        function renderTrend(trend) {
            if (trend.filter(d => d.v != null).length < 7) {
                el.innerHTML = `<div class="st-empty">Not enough data yet.</div>`;
                return;
            }
            const W = 900, H = 160;
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

            const grids = labels.map(s => {
                const y = yAt(s.score).toFixed(1);
                return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + w}" y2="${y}" class="st-tgrid"/>
                        <text x="${pad.left - 5}" y="${(+y + 4).toFixed(1)}" class="st-tlabel">${esc(s.name)}</text>`;
            }).join("");

            let lastMo = -1;
            const xTicks = trend.map((d, i) => {
                const mo = new Date(d.d + "T00:00:00").getMonth();
                if (mo === lastMo) return "";
                lastMo = mo;
                return `<text x="${xAt(i).toFixed(1)}" y="${H - 4}" class="st-tlabel">${MONTHS[mo]}</text>`;
            }).join("");

            el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
                ${grids}<path d="${pathD}" class="st-tline"/>${dots}${xTicks}
            </svg>`;
        }

        function draw() { renderTrend(rolling(allTrend, win)); }
        draw();
        wireToggle($("trendWin"), (ds) => { win = Number(ds.win); draw(); });
    })();

    // ranked lists
    function rank(el, rows) {
        if (!rows.length) { el.innerHTML = `<div class="st-empty">Nothing recorded yet.</div>`; return; }
        const max = rows[0].count;
        el.innerHTML = rows.map((r) =>
            `<div class="row"><div><div>${esc(r.name)}</div><div class="meter"><div style="width:${r.count / max * 100}%"></div></div></div><div class="count">${r.count}</div></div>`).join("");
    }
    rank($("people"), data.people);
    rank($("places"), data.places);
})();
