'use strict';

/**
 * Line chart as SVG for PDF reports (pdfmake draws SVG natively), used when the optional
 * chart.js / chartjs-node-canvas plugins are not installed (canvas needs native binaries).
 * values: { [tagId]: [{ x: Date, y: number|null }] }
 */

const W = 1000;
const H = 560;
const PAD = { left: 70, right: 20, top: 16, bottom: 90 };

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceStep(range, ticks) {
    const raw = range / Math.max(1, ticks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function two(n) { return (n < 10 ? '0' : '') + n; }

function timeLabel(t, span) {
    const d = new Date(t);
    const date = `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
    const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
    if (span <= 36 * 3600e3) return time;
    if (span <= 10 * 24 * 3600e3) return `${date} ${time}`;
    return date;
}

function fmt(v, step) {
    const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
    return Number(v).toFixed(dec);
}

/**
 * @param {{ chart: { lines: { id: string, label?: string, name?: string, color?: string }[] }, size?: number }} chartItem
 * @param {Object} values
 * @param {{ begin: Date, end: Date }} range
 * @returns {string} svg
 */
function createSvgChart(chartItem, values, range) {
    const lines = (chartItem.chart && chartItem.chart.lines) || [];
    const fontSize = Math.max(10, Math.min(20, (chartItem.size || 12) * 1.4));
    const t0 = range.begin.getTime();
    const t1 = Math.max(range.end.getTime(), t0 + 1);
    const series = lines.map((line, i) => ({
        label: line.label || line.name || line.id,
        color: line.color || ['#1D3C67', '#E30019', '#3BB24A', '#FE9413', '#7030A0', '#00A3E0'][i % 6],
        points: ((values && values[line.id]) || [])
            .map(p => ({ t: new Date(p.x).getTime(), y: p.y === null || p.y === undefined || p.y === '' ? null : Number(p.y) }))
            .filter(p => p.t >= t0 && p.t <= t1)
            .sort((a, b) => a.t - b.t)
    }));
    const ys = series.flatMap(s => s.points.map(p => p.y).filter(y => y !== null && Number.isFinite(y)));
    let yMin = ys.length ? Math.min(...ys) : 0;
    let yMax = ys.length ? Math.max(...ys) : 1;
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const step = niceStep(yMax - yMin, 6);
    yMin = Math.floor(yMin / step) * step;
    yMax = Math.ceil(yMax / step) * step;

    const pw = W - PAD.left - PAD.right;
    const ph = H - PAD.top - PAD.bottom;
    const X = t => PAD.left + (t - t0) / (t1 - t0) * pw;
    const Y = v => PAD.top + ph - (v - yMin) / (yMax - yMin) * ph;

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
    // horizontal grid and y labels
    for (let v = yMin; v <= yMax + step / 2; v += step) {
        const y = Y(v).toFixed(1);
        out.push(`<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#d9d9d9" stroke-width="1"/>`);
        out.push(`<text x="${PAD.left - 8}" y="${(Number(y) + fontSize * 0.35).toFixed(1)}" font-size="${fontSize}" text-anchor="end" fill="#333333">${esc(fmt(v, step))}</text>`);
    }
    // vertical grid and time labels
    const span = t1 - t0;
    const xticks = 6;
    // tick step rounded to the minute (a day 00:00 - 23:59:59 gives 00:00, 04:00, …)
    const tstep = Math.max(60000, Math.round(span / xticks / 60000) * 60000);
    for (let i = 0; i <= xticks; i++) {
        const t = Math.min(t0 + tstep * i, t1);
        const x = X(t).toFixed(1);
        out.push(`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + ph}" stroke="#eeeeee" stroke-width="1"/>`);
        const anchor = i === 0 ? 'start' : i === xticks ? 'end' : 'middle';
        out.push(`<text x="${x}" y="${PAD.top + ph + fontSize + 6}" font-size="${fontSize}" text-anchor="${anchor}" fill="#333333">${esc(timeLabel(t, span))}</text>`);
    }
    out.push(`<rect x="${PAD.left}" y="${PAD.top}" width="${pw}" height="${ph}" fill="none" stroke="#999999" stroke-width="1"/>`);
    // lines (gaps where values are missing)
    series.forEach(s => {
        let d = '';
        let pen = false;
        s.points.forEach(p => {
            if (p.y === null || !Number.isFinite(p.y)) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.y).toFixed(1)} `;
            pen = true;
        });
        if (d) out.push(`<path d="${d.trim()}" fill="none" stroke="${esc(s.color)}" stroke-width="2"/>`);
    });
    if (!ys.length) {
        out.push(`<text x="${PAD.left + pw / 2}" y="${PAD.top + ph / 2}" font-size="${fontSize}" text-anchor="middle" fill="#888888">no data in this period</text>`);
    }
    // legend
    let lx = PAD.left;
    const ly = H - fontSize - 8;
    series.forEach(s => {
        out.push(`<rect x="${lx}" y="${ly - fontSize * 0.75}" width="${fontSize * 1.6}" height="${fontSize * 0.5}" fill="${esc(s.color)}"/>`);
        out.push(`<text x="${lx + fontSize * 2}" y="${ly}" font-size="${fontSize}" fill="#222222">${esc(s.label)}</text>`);
        lx += fontSize * 2.6 + String(s.label).length * fontSize * 0.6;
    });
    out.push('</svg>');
    return out.join('\n');
}

module.exports = { createSvgChart };
