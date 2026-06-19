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

    // distribution
    const maxCount = Math.max(1, ...data.distribution.map((d) => d.count));
    $("dist").innerHTML = data.distribution.length
        ? data.distribution.map((d) =>
            `<div class="row"><span>${esc(d.name)}</span><span class="bar"><span class="fill" style="width:${d.count / maxCount * 100}%;background:${esc(d.color)}"></span></span><span class="val">${d.count} · ${d.pct}%</span></div>`).join("")
        : `<div class="st-empty">No moods logged yet.</div>`;

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
    stack($("weekday"), data.weekday);
    stack($("monthMix"), data.month_mix.map((m) => m.segments));
    $("monthMixLabels").innerHTML = data.month_mix.map((m) => `<span>${esc(m.label)}</span>`).join("");

    // events per month
    const evMax = Math.max(1, ...data.events_per_month.map((e) => e.count));
    $("ev").innerHTML = data.events_per_month
        .map((e) => `<div class="col" style="height:${e.count / evMax * 100}%" title="${e.count} events"></div>`).join("");
    $("evLabels").innerHTML = data.events_per_month.map((e) => `<span>${esc(e.label[0])}</span>`).join("");

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
