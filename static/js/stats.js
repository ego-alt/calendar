(function () {
    const data = JSON.parse(document.getElementById("stats-data").textContent);
    const $ = (id) => document.getElementById(id);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    $("range").textContent = fmt(data.range_start) + " – " + fmt(data.range_end);

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

    // stacked columns
    function stack(el, columns) {
        el.innerHTML = "";
        columns.forEach((segs) => {
            const col = document.createElement("div");
            col.className = "col";
            (segs || []).forEach((s) => {
                const d = document.createElement("div");
                d.className = "seg";
                d.style.height = s.share + "%";
                d.style.background = s.color;
                col.appendChild(d);
            });
            el.appendChild(col);
        });
    }
    const mixViews = {
        month:   { columns: data.month_mix.map((m) => m.segments), labels: data.month_mix.map((m) => m.label), cols: 12 },
        weekday: { columns: data.weekday, labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], cols: 7 },
    };
    function renderMix(view) {
        const { columns, labels, cols } = mixViews[view];
        const stackEl = $("mixStack"), labelsEl = $("mixLabels");
        stackEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        labelsEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        stack(stackEl, columns);
        labelsEl.innerHTML = labels.map((l) => `<span>${esc(l)}</span>`).join("");
    }
    renderMix("month");
    document.querySelectorAll(".st-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".st-tab").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            renderMix(btn.dataset.view);
        });
    });

    // events per month
    const evMax = Math.max(1, ...data.events_per_month.map((e) => e.count));
    $("ev").innerHTML = data.events_per_month
        .map((e) => `<div class="col" style="height:${e.count / evMax * 100}%" title="${e.count} events"></div>`).join("");
    $("evLabels").innerHTML = data.events_per_month.map((e) => `<span>${esc(e.label[0])}</span>`).join("");

    // mood trend
    (function () {
        const el = $("trend");
        const allTrend = data.trend || [];
        const labels = data.score_labels || [];

        function renderTrend(trend) {
            const valid = trend.filter(d => d.v !== null);
            if (valid.length < 7) {
                el.innerHTML = `<div class="st-empty">Not enough data for this range yet.</div>`;
                return;
            }
            const W = 900, H = 160;
            const pad = { top: 10, right: 10, bottom: 22, left: 38 };
            const w = W - pad.left - pad.right;
            const h = H - pad.top - pad.bottom;
            const n = trend.length;
            const xAt = i => pad.left + (i / Math.max(n - 1, 1)) * w;
            const yAt = v => pad.top + h - ((v - 1) / 4) * h;

            const segs = [];
            let seg = [];
            trend.forEach((d, i) => {
                if (d.v == null) { if (seg.length > 1) segs.push(seg); seg = []; }
                else seg.push([xAt(i), yAt(d.v)]);
            });
            if (seg.length > 1) segs.push(seg);
            const pathD = segs.map(pts =>
                pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
            ).join(" ");

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
                ${grids}<path d="${pathD}" class="st-tline"/>${xTicks}
            </svg>`;
        }

        renderTrend(allTrend);

        document.querySelectorAll("[data-days]").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll("[data-days]").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                renderTrend(allTrend.slice(-Number(btn.dataset.days)));
            });
        });
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
