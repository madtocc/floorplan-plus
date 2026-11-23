// UML lens: the same codebase as class, entity-relationship and sequence diagrams. Data comes from graph.uml
// (scripts/lib/uml.mjs): classes with what each is handed, the calls their methods make, and the data model.
//   Classes   a part, a file, or one class and its neighbours: inheritance, interfaces, injected dependencies
//   Data      Prisma models and Drizzle tables with their keys and relations
//   Sequence  an endpoint or a method traced through the classes it calls down to the database, or a flow
// Every diagram copies out as Mermaid or PlantUML and downloads as SVG. Talks to the viewer only through
// window.Floorplan.
(() => {
  const SC = window.Floorplan;
  if (!SC) return;
  const G = SC.graph;
  const U = G.uml || {};
  const C = U.classes || [], E = U.entities || [], R = U.rels || [];
  const flows = (G.flows || []).filter((f) => (f.steps || []).length >= 2);
  if (!C.length && !E.length && !flows.length) return;
  const { h, hk } = SC; // hk for ids and paths the page reads back: they must stay exact

  // ---------- model lookups ----------
  const nodeById = new Map(G.nodes.map((n) => [n.id, n]));
  const fileNode = new Map(G.files.map((f) => [f.p, f.n]));
  const ownersOf = (file) => { const out = []; for (let id = fileNode.get(file), guard = 0; id && guard < 20; guard++) { out.push(id); id = nodeById.get(id)?.parent; } return out; };
  const classesIn = (nodeId) => C.map((c, i) => i).filter((i) => ownersOf(C[i].f).includes(nodeId));
  const byFile = new Map();
  C.forEach((c, i) => { if (!byFile.has(c.f)) byFile.set(c.f, []); byFile.get(c.f).push(i); });
  const entByFile = new Map();
  E.forEach((e, i) => { if (!entByFile.has(e.f)) entByFile.set(e.f, []); entByFile.get(e.f).push(i); });
  const nums = (list) => (list || []).filter((x) => typeof x === 'number');
  // who points at a class: subclasses, implementers, and the classes handed it
  const usedBy = new Map(), implementers = new Map();
  const back = (to, from) => { if (!usedBy.has(to)) usedBy.set(to, new Set()); usedBy.get(to).add(from); };
  C.forEach((c, i) => {
    for (const t of nums(c.x)) back(t, i);
    for (const t of nums(c.im)) { back(t, i); if (!implementers.has(t)) implementers.set(t, []); implementers.get(t).push(i); }
    for (const d of c.d || []) back(d[1], i);
  });
  const bound = new Map((U.binds || []).map(([a, b]) => [a, b]));
  /** The class that stands in for an interface: the one the container binds, or its only implementer. */
  const implOf = (ci) => { if (C[ci].k !== 'i') return ci; if (bound.has(ci)) return bound.get(ci); const im = implementers.get(ci) || []; return im.length === 1 ? im[0] : ci; };
  const findMethod = (ci, name, seen = new Set()) => {
    if (ci == null || seen.has(ci)) return null;
    seen.add(ci);
    const m = C[ci].m.find((x) => x[1] === name);
    if (m) return { ci, m };
    for (const up of nums(C[ci].x)) { const r = findMethod(up, name, seen); if (r) return r; }
    return null;
  };
  /** The class method that answers an endpoint: the handler the scan named, in a class of the endpoint's file. */
  const routeTarget = (ri) => {
    const r = G.routes[ri];
    if (!r) return null;
    for (const ci of byFile.get(r.f) || []) {
      const m = C[ci].m.find((x) => (r.h && x[1] === r.h) || (!r.h && x[5] >= r.l && x[5] - r.l < 40));
      if (m) return { ci, name: m[1] };
    }
    return null;
  };
  const traceable = G.routes.map((r, i) => i).filter((i) => routeTarget(i));

  // ---------- look ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const ctx = document.createElement('canvas').getContext('2d');
  const tw = (s, px = 12, font = MONO, weight = 400) => { ctx.font = `${weight} ${px}px ${font}`; return ctx.measureText(s).width; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const ST_COLOR = { controller: '--n-ui', service: '--n-service', repository: '--n-data', adapter: '--n-external', handler: '--n-worker', middleware: '--n-test', factory: '--n-script', model: '--n-library', error: '--n-infra', port: '--n-symbol', module: '--n-config', store: '--n-data', component: '--n-ui' };
  const colorOf = (c) => css(c.k === 'i' ? '--n-symbol' : ST_COLOR[c.st] || '--n-feature');
  const theme = () => ({ bg: css('--bg'), text: css('--text'), text2: css('--text-2'), text3: css('--text-3'), ink: css('--ink'), data: css('--n-data'), ext: css('--n-external'), ui: css('--n-ui') });

  const style = document.createElement('style');
  style.textContent = `
#uml { position: fixed; inset: 0; z-index: 40; background: var(--bg); display: none; flex-direction: column; }
#uml.open { display: flex; }
#uml .uh { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--hair-2); flex-wrap: wrap; }
#uml .uh h2 { margin: 0 6px 0 2px; font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
#uml .tabs { display: inline-flex; background: rgba(var(--ink), .06); border-radius: 999px; padding: 3px; }
#uml .tabs button { border: 0; background: none; color: var(--text-2); height: 30px; padding: 0 14px; border-radius: 999px; cursor: pointer; font-size: 13px; }
#uml .tabs button.on { background: var(--on); color: var(--on-text); }
#uml .tabs button:disabled { opacity: .35; cursor: default; }
#uml .sp { flex: 1; }
#uml .uh .btn { height: 32px; padding: 0 12px; }
#uml .ub { flex: 1; min-height: 0; display: flex; }
#uml .side { width: 300px; flex: none; border-right: 1px solid var(--hair-2); display: flex; flex-direction: column; min-height: 0; }
#uml .side .q { margin: 10px; height: 34px; border: 0; border-radius: 12px; padding: 0 12px; background: rgba(var(--ink), .06); color: var(--text); outline: none; font: inherit; }
#uml .side .q:focus { box-shadow: 0 0 0 1px rgba(var(--ink), .18); }
#uml .side select { margin: 0 10px 8px; height: 32px; border: 0; border-radius: 10px; padding: 0 8px; background: rgba(var(--ink), .06); color: var(--text); font: inherit; max-width: calc(100% - 20px); }
#uml .opts { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 8px; }
#uml .opts label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); background: rgba(var(--ink), .05); border-radius: 999px; padding: 4px 10px; cursor: pointer; user-select: none; }
#uml .opts label.on { background: rgba(var(--ink), .14); color: var(--text); }
#uml .opts input { display: none; }
#uml .ul { flex: 1; overflow: auto; padding: 0 8px 10px; overscroll-behavior: contain; }
#uml .ul .g { padding: 10px 8px 4px; font-size: 12px; color: var(--text-3); }
#uml .ul button { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 6px 8px; border-radius: 10px; cursor: pointer; font: inherit; }
#uml .ul button:hover, #uml .ul button.on { background: rgba(var(--ink), .07); }
#uml .ul button b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono); font-size: 12px; }
#uml .ul button span { color: var(--text-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: auto; flex: none; max-width: 45%; }
#uml .ul .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
#uml .ul .none { padding: 14px 8px; color: var(--text-3); font-size: 12.5px; }
#uml .stage { flex: 1; min-width: 0; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
#uml .stage.drag { cursor: grabbing; }
#uml .stage svg { position: absolute; left: 0; top: 0; transform-origin: 0 0; user-select: none; }
#uml .stage [data-c], #uml .stage [data-e], #uml .stage [data-m], #uml .stage [data-p] { cursor: pointer; }
#uml .stage [data-m]:hover { text-decoration: underline; }
#uml .note { position: absolute; left: 14px; bottom: 12px; right: 14px; color: var(--text-3); font-size: 12px; pointer-events: none; }
#uml .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-3); padding: 24px; text-align: center; line-height: 1.6; }
#uml .zoom { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 4px; }
#uml .zoom button { width: 34px; height: 34px; border-radius: 12px; border: 0; background: rgba(var(--ink), .08); color: var(--text); cursor: pointer; font-size: 16px; }
#uml-menu { position: fixed; width: 300px; transform-origin: top right; }
#uml-menu button { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 9px 12px; border-radius: 12px; cursor: pointer; font: inherit; }
#uml-menu button:hover { background: rgba(var(--ink), .07); }
#uml-menu button:disabled { opacity: .4; cursor: default; background: none; }
#uml-menu button b { font-weight: 500; display: block; }
#uml-menu button span { font-size: 12px; color: var(--text-3); display: block; margin-top: 1px; }
@media (max-width: 760px) { #uml .side { display: none; } #uml.list-open .side { display: flex; position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: min(320px, 88vw); background: var(--bg); } #uml .uh h2 { display: none; } }
@media (min-width: 761px) { #uml [data-u="list"] { display: none; } }
`;
  document.head.appendChild(style);

  // ---------- state ----------
  const S = {
    tab: C.length ? 'class' : E.length ? 'data' : 'seq',
    q: '',
    cls: { scope: { type: 'all' }, members: true, errors: false, around: false },
    data: { focus: null, groups: null, cols: false },
    seq: { src: null, helpers: false, depth: 6 },
  };
  let current = null; // what's on the stage: { svg, w, h, mermaid, plantuml, name }
  let view = { x: 0, y: 0, k: 1 };

  // ---------- class diagram ----------
  const MAX_BOXES = 140;
  function classSet() {
    const sc = S.cls.scope;
    let ids, keep = new Set();
    const out1 = (i) => [...nums(C[i].x), ...nums(C[i].im), ...(C[i].d || []).map((d) => d[1])];
    if (sc.type === 'focus') { ids = new Set([sc.id, ...out1(sc.id), ...(usedBy.get(sc.id) || [])]); keep.add(sc.id); }
    else if (sc.type === 'file') { const own = byFile.get(sc.id) || []; ids = new Set(own); own.forEach((i) => keep.add(i)); for (const i of own) { for (const t of out1(i)) ids.add(t); for (const t of implementers.get(i) || []) ids.add(t); } }
    else if (sc.type === 'node') { ids = new Set(classesIn(sc.id)); if (S.cls.around) for (const i of [...ids]) for (const t of out1(i)) ids.add(t); }
    else ids = new Set(C.map((c, i) => i));
    let list = [...ids].filter((i) => keep.has(i) || S.cls.errors || C[i].st !== 'error');
    const total = list.length;
    if (list.length > MAX_BOXES) {
      // too many to read: the most connected stay
      const deg = (i) => (usedBy.get(i)?.size || 0) + (C[i].d?.length || 0) + nums(C[i].x).length + nums(C[i].im).length;
      list = list.sort((a, b) => (keep.has(b) - keep.has(a)) || deg(b) - deg(a)).slice(0, MAX_BOXES);
    }
    return { list, total, keep };
  }
  const memberRows = (c) => {
    const attrs = c.a.map((a) => `${a[0]} ${a[1]}${a[2] ? ': ' + a[2] : ''}`);
    const ops = c.m.map((m) => `${m[0]} ${m[1]}(${m[2]})${m[3] ? ': ' + m[3] : ''}`);
    return { attrs, ops };
  };
  const ROW = 17, PAD = 12, MAXW = 470;
  function classBox(i, full, T) {
    const c = C[i];
    const label = c.k === 'i' ? 'interface' : c.st || (c.k === 'a' ? 'abstract' : '');
    const head = label ? 44 : 32;
    let rows = [], w = Math.max(tw(c.n, 13, MONO, 600), label ? tw(`«${label}»`, 10.5) : 0) + PAD * 2;
    let hgt = head;
    if (full) {
      const { attrs, ops } = memberRows(c);
      const A = attrs.slice(0, 12), M = c.m.slice(0, 18);
      if (attrs.length > A.length) A.push(`… ${attrs.length - A.length} more`);
      rows = [...A.map((t) => ({ t: cut(t, 62) })), { sep: true }, ...M.map((m, k) => ({ t: cut(ops[k], 62), m: m[1], st: m[4].includes('s'), ab: m[4].includes('a') })), ...(ops.length > M.length ? [{ t: `… ${ops.length - M.length} more` }] : [])];
      for (const r of rows) if (r.t) w = Math.max(w, tw(r.t) + PAD * 2);
      hgt = head + 6 + rows.reduce((s, r) => s + (r.sep ? 9 : ROW), 0) + 6;
      if (!attrs.length && !ops.length) hgt = head;
    }
    w = Math.min(MAXW, Math.max(140, Math.ceil(w)));
    return { i, c, w, h: Math.ceil(hgt), head, rows, label, color: colorOf(c), T };
  }
  function drawClassBox(b, x, y, on) {
    const { c, w, T } = b;
    const italic = c.k !== 'c' ? ' font-style="italic"' : '';
    let s = `<g data-c="${b.i}" transform="translate(${x},${y})"><title>${esc(c.f)}:${c.l}</title>`;
    s += `<rect width="${w}" height="${b.h}" rx="9" fill="rgba(${T.ink},${on ? '.09' : '.045'})" stroke="${b.color}" stroke-width="${on ? 2 : 1.2}"/>`;
    if (b.label) s += `<text x="${w / 2}" y="17" text-anchor="middle" font-family='${MONO}' font-size="10.5" fill="${b.color}">«${esc(b.label)}»</text>`;
    s += `<text x="${w / 2}" y="${b.label ? 34 : 21}" text-anchor="middle" font-family='${MONO}' font-size="13" font-weight="600" fill="${T.text}"${italic}>${esc(cut(c.n, 52))}</text>`;
    if (b.rows.length && b.h > b.head) {
      let ry = b.head;
      s += `<line x1="0" y1="${ry}" x2="${w}" y2="${ry}" stroke="${b.color}" stroke-opacity=".5"/>`;
      ry += 6;
      for (const r of b.rows) {
        if (r.sep) { s += `<line x1="0" y1="${ry + 4}" x2="${w}" y2="${ry + 4}" stroke="${b.color}" stroke-opacity=".35"/>`; ry += 9; continue; }
        s += `<text x="${PAD}" y="${ry + 12}" font-family='${MONO}' font-size="12" fill="${r.m ? T.text : T.text2}"${r.m ? ` data-m="${b.i}|${esc(r.m)}"` : ''}${r.st ? ' text-decoration="underline"' : ''}${r.ab ? ' font-style="italic"' : ''}>${esc(r.t)}</text>`;
        ry += ROW;
      }
    }
    return s + '</g>';
  }
  const pathOf = (e) => (e.sections || []).map((sec) => `M${sec.startPoint.x},${sec.startPoint.y}` + (sec.bendPoints || []).map((p) => `L${p.x},${p.y}`).join('') + `L${sec.endPoint.x},${sec.endPoint.y}`).join('');
  const defs = (T) => `<defs>
<marker id="u-tri" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M1,1 L13,7 L1,13 Z" fill="${T.bg}" stroke="${T.text2}" stroke-width="1.2"/></marker>
<marker id="u-arr" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M2,1.5 L11,6 L2,10.5" fill="none" stroke="${T.text2}" stroke-width="1.3"/></marker>
<marker id="u-fill" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M1,1 L11,6 L1,11 Z" fill="${T.text2}"/></marker>
<marker id="u-many0" viewBox="0 0 24 16" refX="23" refY="8" markerWidth="22" markerHeight="15" orient="auto-start-reverse"><path d="M10,8 L23,2 M10,8 L23,14 M10,8 L23,8" fill="none" stroke="${T.text2}" stroke-width="1.3"/><circle cx="6" cy="8" r="4" fill="${T.bg}" stroke="${T.text2}" stroke-width="1.3"/></marker>
<marker id="u-one" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="15" markerHeight="15" orient="auto-start-reverse"><path d="M7,2 L7,14 M11,2 L11,14" fill="none" stroke="${T.text2}" stroke-width="1.3"/></marker>
<marker id="u-one0" viewBox="0 0 24 16" refX="23" refY="8" markerWidth="22" markerHeight="15" orient="auto-start-reverse"><path d="M19,2 L19,14" fill="none" stroke="${T.text2}" stroke-width="1.3"/><circle cx="10" cy="8" r="4" fill="${T.bg}" stroke="${T.text2}" stroke-width="1.3"/></marker>
</defs>`;
  const wrapSvg = (T, w, hgt, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(hgt)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(hgt)}">${defs(T)}<rect width="100%" height="100%" fill="${T.bg}"/>${body}</svg>`;
  const layered = (children, edges, dir = 'RIGHT') => new ELK().layout({
    id: 'root', children, edges,
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': dir, 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90', 'elk.spacing.nodeNode': '28', 'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '10',
      'elk.layered.spacing.edgeNodeBetweenLayers': '22', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.separateConnectedComponents': 'true', 'elk.spacing.componentComponent': '60', 'elk.padding': '[top=30,left=30,bottom=30,right=30]',
      'elk.aspectRatio': String(Math.max(1, (stage.clientWidth || 1200) / Math.max(300, stage.clientHeight || 700))),
    },
  });

  // names safe for Mermaid and PlantUML, unique within one diagram
  const namer = () => { const used = new Map(); return (key, name) => { if (used.has(key)) return used.get(key); let base = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'X', n = base, k = 2; const taken = new Set(used.values()); while (taken.has(n)) n = `${base}_${k++}`; used.set(key, n); return n; }; };
  const mmType = (t) => t.replace(/[<>]/g, '~').replace(/[{}"`]/g, '').replace(/\s+/g, ' ').trim();

  async function classDiagram() {
    const { list, total, keep } = classSet();
    if (!list.length) return { empty: 'No classes here. Pick another part, or search for a class on the left.' };
    const T = theme();
    const full = S.cls.members && list.length <= 60;
    const boxes = new Map(list.map((i) => [i, classBox(i, full, T)]));
    const edges = [], seen = new Set();
    const add = (a, b, kind) => { const k = `${a}|${b}|${kind}`; if (a === b || seen.has(k) || !boxes.has(a) || !boxes.has(b)) return; seen.add(k); edges.push({ id: 'e' + edges.length, sources: ['c' + a], targets: ['c' + b], kind, a, b }); };
    for (const i of list) {
      const c = C[i];
      for (const p of nums(c.x)) add(p, i, 'ext');
      for (const p of nums(c.im)) add(p, i, 'impl');
      for (const d of c.d || []) add(i, d[1], 'dep');
    }
    const res = await layered([...boxes.values()].map((b) => ({ id: 'c' + b.i, width: b.w, height: b.h })), edges.map(({ id, sources, targets }) => ({ id, sources, targets })));
    const byId = new Map(edges.map((e) => [e.id, e]));
    let body = '';
    for (const e of res.edges || []) {
      const k = byId.get(e.id).kind;
      body += `<path d="${pathOf(e)}" fill="none" stroke="${T.text2}" stroke-width="1.2" stroke-opacity=".8"${k === 'impl' ? ' stroke-dasharray="6 4"' : ''} ${k === 'dep' ? 'marker-end="url(#u-arr)"' : 'marker-start="url(#u-tri)"'}/>`;
    }
    for (const n of res.children || []) { const b = boxes.get(+n.id.slice(1)); body += drawClassBox(b, n.x, n.y, keep.has(b.i) && S.cls.scope.type === 'focus'); }
    // text exports
    const nm = namer(), id = (i) => nm(i, C[i].n);
    const vis = { '+': '+', '-': '-', '#': '#' };
    let mm = 'classDiagram\n', pu = '@startuml\nhide empty members\n';
    for (const i of list) {
      const c = C[i], name = id(i);
      const stereo = c.k === 'i' ? 'interface' : c.k === 'a' ? 'abstract' : c.st;
      mm += `  class ${name} {\n${stereo ? `    <<${stereo}>>\n` : ''}`;
      pu += `${c.k === 'i' ? 'interface' : c.k === 'a' ? 'abstract class' : 'class'} ${name}${c.st && c.k === 'c' ? ` <<${c.st}>>` : ''} {\n`;
      if (full) {
        for (const a of c.a.slice(0, 30)) { mm += `    ${vis[a[0]]}${a[1].replace(/\?$/, '')}${a[2] ? ' ' + mmType(a[2]) : ''}\n`; pu += `  ${vis[a[0]]}${a[1]}${a[2] ? ' : ' + a[2].replace(/\n/g, ' ') : ''}\n`; }
        for (const m of c.m.slice(0, 40)) { mm += `    ${vis[m[0]]}${m[1]}(${mmType(m[2])})${m[3] ? ' ' + mmType(m[3]) : ''}${m[4].includes('s') ? '$' : m[4].includes('a') ? '*' : ''}\n`; pu += `  ${m[4].includes('s') ? '{static} ' : m[4].includes('a') ? '{abstract} ' : ''}${vis[m[0]]}${m[1]}(${m[2]})${m[3] ? ' : ' + m[3] : ''}\n`; }
      }
      mm += '  }\n'; pu += '}\n';
    }
    for (const e of edges) {
      const a = id(e.a), b = id(e.b);
      if (e.kind === 'ext') { mm += `  ${a} <|-- ${b}\n`; pu += `${a} <|-- ${b}\n`; }
      else if (e.kind === 'impl') { mm += `  ${a} <|.. ${b}\n`; pu += `${a} <|.. ${b}\n`; }
      else { mm += `  ${a} --> ${b}\n`; pu += `${a} --> ${b}\n`; }
    }
    pu += '@enduml\n';
    const notes = [];
    if (total > list.length) notes.push(`Showing the ${list.length} most connected of ${total} classes. Pick a part or a class on the left to narrow it.`);
    else if (S.cls.members && !full) notes.push('Members are hidden above 60 classes. Narrow the scope to see them.');
    return { svg: wrapSvg(T, res.width, res.height, body), w: res.width, h: res.height, mermaid: mm, plantuml: pu, name: 'class-diagram', note: notes.join(' ') };
  }

  // ---------- data model ----------
  const erNeighbours = (i) => { const out = new Set([i]); for (const r of R) { if (r[0] === i) out.add(r[1]); if (r[1] === i) out.add(r[0]); } return out; };
  const groups = [...new Set(E.map((e) => e.g || ''))].filter(Boolean).sort();
  function entitySet() {
    if (S.data.focus != null) return [...erNeighbours(S.data.focus)];
    const g = S.data.groups;
    return E.map((e, i) => i).filter((i) => !g || g.has(E[i].g || ''));
  }
  const colMark = (f) => (f.includes('p') ? 'PK' : f.includes('f') ? 'FK' : f.includes('u') ? 'UQ' : '');
  async function dataDiagram() {
    let list = entitySet();
    if (!list.length) return { empty: 'No tables in this selection.' };
    const total = list.length;
    if (list.length > MAX_BOXES) { const deg = new Map(); for (const r of R) { deg.set(r[0], (deg.get(r[0]) || 0) + 1); deg.set(r[1], (deg.get(r[1]) || 0) + 1); } list = list.sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0)).slice(0, MAX_BOXES); }
    const T = theme();
    const all = S.data.cols || list.length <= 12;
    const inSet = new Set(list);
    const boxes = new Map(list.map((i) => {
      const e = E[i];
      const cols = all ? e.c : e.c.filter((c) => /[pfu]/.test(c[2]));
      const shown = cols.slice(0, 40);
      const rows = shown.map((c) => ({ mark: colMark(c[2]), name: c[0], type: c[1] + (c[2].includes('n') ? '?' : '') }));
      const more = e.c.length - shown.length;
      const nameW = Math.max(0, ...rows.map((r) => tw(r.name)));
      const typeW = Math.max(0, ...rows.map((r) => tw(cut(r.type, 26))));
      const sub = e.t && e.t !== e.n ? e.t : '';
      const w = Math.min(MAXW, Math.max(150, tw(e.n, 13, MONO, 600) + PAD * 2, (sub ? tw(sub, 10.5) + PAD * 2 : 0), 30 + nameW + 14 + typeW + PAD * 2));
      const head = sub ? 44 : 32;
      return [i, { i, e, rows, more, w: Math.ceil(w), h: head + (rows.length || more ? 8 + rows.length * ROW + (more ? ROW : 0) + 6 : 0), head, sub, nameW }];
    }));
    const edges = R.map((r, k) => ({ r, k })).filter(({ r }) => inSet.has(r[0]) && inSet.has(r[1]) && r[0] !== r[1]).map(({ r, k }) => ({ id: 'r' + k, sources: ['e' + r[1]], targets: ['e' + r[0]], r }));
    const res = await layered([...boxes.values()].map((b) => ({ id: 'e' + b.i, width: b.w, height: b.h })), edges.map(({ id, sources, targets }) => ({ id, sources, targets })));
    const byId = new Map(edges.map((e) => [e.id, e]));
    const color = T.data;
    let body = '';
    for (const e of res.edges || []) {
      const r = byId.get(e.id).r; // drawn from the referenced table (one) to the table holding the key (many)
      const one = r[4] ? 'u-one0' : 'u-one', many = r[2] === '11' ? (r[4] ? 'u-one0' : 'u-one') : 'u-many0';
      body += `<path d="${pathOf(e)}" fill="none" stroke="${T.text2}" stroke-width="1.2" stroke-opacity=".8" marker-start="url(#${r[2] === 'nn' ? 'u-many0' : one})" marker-end="url(#${many})"><title>${esc(E[r[0]].n)}.${esc(r[3])} → ${esc(E[r[1]].n)}</title></path>`;
    }
    for (const n of res.children || []) {
      const b = boxes.get(+n.id.slice(1)), on = S.data.focus === b.i;
      body += `<g data-e="${b.i}" transform="translate(${n.x},${n.y})"><title>${esc(b.e.f)}:${b.e.l}</title><rect width="${b.w}" height="${b.h}" rx="9" fill="rgba(${T.ink},${on ? '.09' : '.045'})" stroke="${color}" stroke-width="${on ? 2 : 1.2}"/>`;
      body += `<text x="${b.w / 2}" y="21" text-anchor="middle" font-family='${MONO}' font-size="13" font-weight="600" fill="${T.text}">${esc(cut(b.e.n, 50))}</text>`;
      if (b.sub) body += `<text x="${b.w / 2}" y="36" text-anchor="middle" font-family='${MONO}' font-size="10.5" fill="${T.text3}">${esc(cut(b.sub, 56))}</text>`;
      if (b.rows.length || b.more) {
        body += `<line x1="0" y1="${b.head}" x2="${b.w}" y2="${b.head}" stroke="${color}" stroke-opacity=".5"/>`;
        let ry = b.head + 8;
        for (const r of b.rows) {
          body += `<text x="${PAD}" y="${ry + 12}" font-family='${MONO}' font-size="10" fill="${color}">${r.mark}</text><text x="${PAD + 26}" y="${ry + 12}" font-family='${MONO}' font-size="12" fill="${T.text}">${esc(r.name)}</text><text x="${PAD + 26 + b.nameW + 14}" y="${ry + 12}" font-family='${MONO}' font-size="12" fill="${T.text3}">${esc(cut(r.type, 26))}</text>`;
          ry += ROW;
        }
        if (b.more) body += `<text x="${PAD + 26}" y="${ry + 12}" font-family='${MONO}' font-size="12" fill="${T.text3}">… ${b.more} more</text>`;
      }
      body += '</g>';
    }
    const nm = namer(), id = (i) => nm(i, E[i].n);
    let mm = 'erDiagram\n', pu = '@startuml\nhide circle\nskinparam linetype ortho\n';
    for (const i of list) {
      const e = E[i], cols = all ? e.c : e.c.filter((c) => /[pfu]/.test(c[2]));
      mm += `  ${id(i)} {\n`; pu += `entity ${id(i)} {\n`;
      for (const c of cols.slice(0, 60)) {
        const keys = [c[2].includes('p') && 'PK', c[2].includes('f') && 'FK', c[2].includes('u') && !c[2].includes('p') && 'UK'].filter(Boolean);
        mm += `    ${c[1].replace(/[^\w[\]()-]/g, '_') || 'unknown'} ${c[0].replace(/[^\w-]/g, '_')}${keys.length ? ' ' + keys.join(', ') : ''}\n`;
        pu += `  ${c[2].includes('n') ? '' : '*'}${c[0]} : ${c[1]}${keys.length ? ` <<${keys.join(',')}>>` : ''}\n`;
      }
      mm += '  }\n'; pu += '}\n';
    }
    for (const { r } of edges) {
      const a = id(r[0]), b = id(r[1]);
      const link = r[2] === 'nn' ? '}o--o{' : r[2] === '11' ? (r[4] ? '|o--o|' : '|o--||') : r[4] ? '}o--o|' : '}o--||';
      mm += `  ${a} ${link} ${b} : "${String(r[3] || 'has').replace(/"/g, '')}"\n`;
      pu += `${a} ${link} ${b}${r[3] ? ` : ${r[3]}` : ''}\n`;
    }
    pu += '@enduml\n';
    const notes = [];
    if (total > list.length) notes.push(`Showing the ${list.length} most connected of ${total} tables.`);
    if (!all) notes.push('Showing keys only. Turn on All columns, or click a table to see it with its neighbours.');
    return { svg: wrapSvg(T, res.width, res.height, body), w: res.width, h: res.height, mermaid: mm, plantuml: pu, name: 'data-model', note: notes.join(' ') };
  }

  // ---------- sequence ----------
  const MAX_MSGS = 80;
  /** Does this method, through the helpers it calls on itself, reach another class or the database? */
  const leadsOut = (ci, name, seen = new Set()) => {
    const hit = findMethod(ci, name);
    if (!hit || seen.has(name)) return false;
    seen.add(name);
    return (hit.m[6] || []).some((call) => call[0] !== -1 || leadsOut(ci, call[1], seen));
  };
  function trace(ci, name) {
    const msgs = [], expanded = new Set();
    let truncated = false;
    const visit = (at, method, depth, stack) => {
      const hit = findMethod(at, method);
      const key = `${at}.${method}`;
      if (!hit || stack.has(key)) return;
      if (expanded.has(key) || depth > S.seq.depth) return;
      expanded.add(key);
      stack.add(key);
      for (const call of hit.m[6] || []) {
        if (msgs.length >= MAX_MSGS) { truncated = true; break; }
        if (call[0] === -1) {
          if (!findMethod(at, call[1]) || (!S.seq.helpers && !leadsOut(at, call[1]))) continue;
          if (S.seq.helpers) msgs.push({ a: 'c' + at, b: 'c' + at, label: call[1] + '()', depth });
          visit(at, call[1], depth + (S.seq.helpers ? 1 : 0), stack);
        } else if (call[0] === -2) msgs.push({ a: 'c' + at, b: 'db', label: `${call[2]} ${E[call[1]]?.n || ''}`, depth, data: true });
        else if (call[0] === -3) msgs.push({ a: 'c' + at, b: 'x' + call[1], label: call[2] + '()', depth });
        else {
          const t = implOf(call[0]);
          msgs.push({ a: 'c' + at, b: 'c' + t, label: call[1] + '()', depth, tip: t !== call[0] ? `through ${C[call[0]].n}` : '' });
          visit(t, call[1], depth + 1, stack);
        }
      }
      stack.delete(key);
    };
    visit(ci, name, 1, new Set());
    return { msgs, truncated };
  }
  function seqModel() {
    const src = S.seq.src;
    if (!src) return null;
    const parts = new Map(); // key -> { label, kind, color, ci }
    const T = theme();
    const part = (key) => {
      if (parts.has(key)) return;
      if (key === 'client') parts.set(key, { label: 'Client', kind: 'actor', color: T.ui });
      else if (key === 'db') parts.set(key, { label: 'Database', kind: 'db', color: T.data });
      else if (key[0] === 'c') { const c = C[+key.slice(1)]; parts.set(key, { label: c.n, kind: 'class', color: colorOf(c), ci: +key.slice(1), sub: c.k === 'i' ? 'interface' : c.st || '' }); }
      else if (key[0] === 'x') parts.set(key, { label: key.slice(1), kind: 'ext', color: T.ext, sub: 'outside' });
      else {
        // a card of the map (a flow's step): its own colour, read out of the page so an exported SVG keeps it
        const inf = SC.exists(key) ? SC.info(key) : null;
        const v = inf ? /^var\((--[\w-]+)\)$/.exec(SC.colorOf(inf) || '') : null;
        parts.set(key, { label: inf?.name || key, kind: 'item', color: (v && css(v[1])) || T.text3, ref: key });
      }
    };
    let msgs = [], title = '', note = '';
    if (src.type === 'flow') {
      const fl = flows.find((f) => f.id === src.id);
      if (!fl) return null;
      title = fl.title;
      const steps = fl.steps.map((s) => ({ ref: s.ref || s.id || s.node, note: s.note || '' })).filter((s) => s.ref);
      steps.forEach((s) => part(s.ref));
      for (let k = 1; k < steps.length; k++) msgs.push({ a: steps[k - 1].ref, b: steps[k].ref, label: steps[k].note || '', depth: 1 });
      if (steps[0]?.note) note = steps[0].note;
    } else {
      const root = 'c' + src.ci;
      const r = src.route != null ? G.routes[src.route] : null;
      title = r ? `${r.m} ${r.p}` : `${C[src.ci].n}.${src.name}()`;
      if (r) { part('client'); msgs.push({ a: 'client', b: root, label: `${r.m} ${r.p}`, depth: 0 }); }
      part(root);
      const t = trace(src.ci, src.name);
      if (!r) msgs.push({ a: root, b: root, label: src.name + '()', depth: 0 });
      msgs.push(...t.msgs);
      if (r) msgs.push({ a: root, b: 'client', label: 'response', depth: 0, back: true });
      for (const m of msgs) { part(m.a); part(m.b); }
      if (t.truncated) note = `Stopped after ${MAX_MSGS} calls.`;
      else if (!t.msgs.length) note = 'This method calls nothing the map can follow: no injected class, no database call.';
    }
    return { parts, msgs, title, note, T };
  }
  function seqDiagram() {
    const model = seqModel();
    if (!model) return { empty: 'Pick an endpoint, a flow or a method on the left to trace it.' };
    const { parts, msgs, T } = model;
    const keys = [...parts.keys()];
    const col = new Map(keys.map((k, i) => [k, i]));
    const labelOf = (m, n) => `${n}. ${cut(m.label, 58)}`;
    const boxW = keys.map((k) => Math.max(110, tw(cut(parts.get(k).label, 34), 12.5, MONO, 600) + 28));
    // room between neighbouring lifelines: the widest label that has to fit there
    const gap = keys.map(() => 60);
    msgs.forEach((m, n) => {
      const a = col.get(m.a), b = col.get(m.b), w = tw(labelOf(m, n + 1), 11.5) + 36;
      if (a === b) gap[a] = Math.max(gap[a], w + 30 - boxW[a] / 2);
      else { const lo = Math.min(a, b), span = Math.abs(a - b); for (let k = lo; k < lo + span; k++) gap[k] = Math.max(gap[k], w / span - (boxW[k] + boxW[k + 1]) / 2 / span); }
    });
    const cx = [];
    let x = 30;
    keys.forEach((k, i) => { cx.push(x + boxW[i] / 2); x += boxW[i] + Math.max(40, gap[i]); });
    const width = x - Math.max(40, gap[keys.length - 1]) + Math.max(30, gap[keys.length - 1] + 20);
    const top = 30, headH = 46, rowH = 38;
    let y = top + headH + 26;
    let body = '';
    const rows = msgs.map((m, n) => {
      const a = cx[col.get(m.a)], b = cx[col.get(m.b)], label = esc(labelOf(m, n + 1));
      const tip = m.tip ? `<title>${esc(m.tip)}</title>` : '';
      let s;
      if (m.a === m.b) {
        s = `<path d="M${a},${y} h34 v16 h-28" fill="none" stroke="${T.text2}" stroke-width="1.2" marker-end="url(#u-fill)"/><text x="${a + 42}" y="${y + 11}" font-family='${MONO}' font-size="11.5" fill="${T.text}">${label}${tip}</text>`;
        y += rowH + 8;
      } else {
        const dir = b > a ? 1 : -1;
        s = `<line x1="${a}" y1="${y}" x2="${b - dir * 2}" y2="${y}" stroke="${T.text2}" stroke-width="1.2"${m.back ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#${m.back ? 'u-arr' : 'u-fill'})"/><text x="${Math.min(a, b) + 10}" y="${y - 7}" font-family='${MONO}' font-size="11.5" fill="${m.data ? T.data : T.text}">${label}${tip}</text>`;
        y += rowH;
      }
      return s;
    });
    const height = y + 30;
    keys.forEach((k, i) => {
      const p = parts.get(k), w = boxW[i], bx = cx[i] - w / 2;
      body += `<line x1="${cx[i]}" y1="${top + headH}" x2="${cx[i]}" y2="${height - 24}" stroke="${T.text3}" stroke-width="1" stroke-dasharray="4 5" stroke-opacity=".7"/>`;
      body += `<g data-p="${esc(k)}"><rect x="${bx}" y="${top}" width="${w}" height="${headH}" rx="${p.kind === 'db' ? 18 : 9}" fill="rgba(${T.ink},.05)" stroke="${p.color}" stroke-width="1.3"/>`;
      if (p.sub) body += `<text x="${cx[i]}" y="${top + 17}" text-anchor="middle" font-family='${MONO}' font-size="10" fill="${p.color}">«${esc(p.sub)}»</text>`;
      body += `<text x="${cx[i]}" y="${top + (p.sub ? 34 : 28)}" text-anchor="middle" font-family='${MONO}' font-size="12.5" font-weight="600" fill="${T.text}">${esc(cut(p.label, 34))}</text></g>`;
    });
    body += rows.join('');
    // text exports
    const nm = namer(), id = (k) => nm(k, parts.get(k).label);
    let mm = 'sequenceDiagram\n', pu = '@startuml\n';
    for (const k of keys) {
      const p = parts.get(k), alias = id(k), label = p.label.replace(/"/g, '');
      mm += p.kind === 'actor' ? `  actor ${alias} as ${label}\n` : `  participant ${alias} as ${label}\n`;
      pu += `${p.kind === 'actor' ? 'actor' : p.kind === 'db' ? 'database' : 'participant'} "${label}" as ${alias}\n`;
    }
    for (const m of msgs) {
      const text = (m.label || ' ').replace(/[\n;#]/g, ' ');
      mm += `  ${id(m.a)}${m.back ? '-->>' : '->>'}${id(m.b)}: ${text}\n`;
      pu += `${id(m.a)} ${m.back ? '-->' : '->'} ${id(m.b)}: ${text}\n`;
    }
    pu += '@enduml\n';
    return { svg: wrapSvg(T, width, height, body), w: width, h: height, mermaid: mm, plantuml: pu, name: 'sequence', note: model.note, title: model.title };
  }

  // ---------- overlay ----------
  const el = document.createElement('div');
  el.id = 'uml';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'UML diagrams');
  el.innerHTML = `<div class="uh"><button class="btn soft" data-u="list">List</button><h2>UML</h2>
<div class="tabs" role="tablist"><button data-tab="class" role="tab">Classes</button><button data-tab="data" role="tab">Data model</button><button data-tab="seq" role="tab">Sequence</button></div>
<span class="sp"></span>
<button class="btn soft" data-u="mermaid" title="Copy this diagram as Mermaid text, for a README, a pull request or Notion">Copy Mermaid</button>
<button class="btn soft" data-u="plantuml" title="Copy this diagram as PlantUML text">Copy PlantUML</button>
<button class="btn soft" data-u="svg" title="Download this diagram as an SVG image">SVG</button>
<button class="btn" data-u="close" aria-label="Close UML diagrams">Close</button></div>
<div class="ub"><div class="side"></div><div class="stage"><div class="empty"></div><div class="note"></div><div class="zoom"><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Fit to screen">⤢</button><button data-z="in" aria-label="Zoom in">+</button></div></div></div>`;
  document.body.appendChild(el);
  const stage = el.querySelector('.stage'), side = el.querySelector('.side'), noteEl = el.querySelector('.note'), emptyEl = el.querySelector('.empty');
  let svgEl = null;
  const applyView = () => { if (svgEl) svgEl.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; };
  const fit = () => {
    if (!current?.w) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const k = Math.min(1.15, (W - 24) / current.w, (H - 40) / current.h);
    // a sequence diagram is read from its top-left corner: when all of it would be too small to read, start there
    const readable = current.name === 'sequence' && k < 0.62 ? 0.62 : null;
    view = { k: readable || Math.max(0.05, k), x: 0, y: 0 };
    view.x = readable ? 12 : (W - current.w * view.k) / 2;
    view.y = readable ? 8 : Math.max(8, (H - current.h * view.k) / 2);
    applyView();
  };
  const zoomAt = (f, px, py) => {
    const k = Math.min(3, Math.max(0.05, view.k * f));
    view.x = px - (px - view.x) * (k / view.k);
    view.y = py - (py - view.y) * (k / view.k);
    view.k = k;
    applyView();
  };
  stage.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', (ev) => { if (ev.target.closest('.zoom')) return; drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false, target: ev.target }; stage.setPointerCapture(ev.pointerId); });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; stage.classList.add('drag');
    view.x = drag.vx + dx; view.y = drag.vy + dy; applyView();
  });
  const endDrag = (ev) => {
    if (!drag) return;
    const d = drag; drag = null; stage.classList.remove('drag');
    if (!d.moved && ev.type === 'pointerup') clicked(d.target);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  el.querySelector('.zoom').addEventListener('click', (ev) => {
    const z = ev.target.closest('[data-z]')?.dataset.z;
    if (z === 'fit') fit(); else if (z) zoomAt(z === 'in' ? 1.25 : 0.8, stage.clientWidth / 2, stage.clientHeight / 2);
  });

  function clicked(target) {
    const m = target.closest?.('[data-m]');
    if (m) { const [ci, name] = m.dataset.m.split('|'); S.seq.src = { type: 'method', ci: +ci, name }; S.tab = 'seq'; S.q = ''; return draw(); }
    const c = target.closest?.('[data-c]');
    if (c) { S.cls.scope = { type: 'focus', id: +c.dataset.c }; return draw(); }
    const e = target.closest?.('[data-e]');
    if (e) { S.data.focus = S.data.focus === +e.dataset.e ? null : +e.dataset.e; return draw(); }
    const p = target.closest?.('[data-p]');
    if (p) {
      const key = p.dataset.p;
      if (key[0] === 'c' && /^c\d+$/.test(key)) { S.cls.scope = { type: 'focus', id: +key.slice(1) }; S.tab = 'class'; S.q = ''; return draw(); }
      if (key === 'db' && E.length) { S.tab = 'data'; S.q = ''; return draw(); }
      if (SC.exists(key)) { close(); SC.reveal(key); }
    }
  }

  let drawing = 0;
  async function draw() {
    const run = ++drawing;
    el.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); });
    renderSide();
    let res;
    try { res = S.tab === 'class' ? await classDiagram() : S.tab === 'data' ? await dataDiagram() : seqDiagram(); }
    catch (e) { console.error('floorplan uml', e); res = { empty: 'This diagram could not be drawn. Try a smaller selection.' }; }
    if (run !== drawing) return; // a newer draw started while this one was laying out
    svgEl?.remove(); svgEl = null;
    current = res.empty ? null : res;
    emptyEl.textContent = res.empty || '';
    emptyEl.style.display = res.empty ? 'flex' : 'none';
    noteEl.textContent = res.note || '';
    for (const b of el.querySelectorAll('[data-u="mermaid"],[data-u="plantuml"],[data-u="svg"]')) b.disabled = !current;
    if (!current) return;
    const holder = document.createElement('div');
    holder.innerHTML = res.svg;
    svgEl = holder.firstElementChild;
    stage.insertBefore(svgEl, stage.firstChild);
    fit();
  }

  // ---------- side list ----------
  const opt = (key, label, on) => `<label class="${on ? 'on' : ''}"><input type="checkbox" data-opt="${key}" ${on ? 'checked' : ''}>${h(label)}</label>`;
  const words = () => S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => { const w = words(); const t = text.toLowerCase(); return w.every((x) => t.includes(x)); };
  const nodesWithClasses = () => G.nodes.map((n) => [n, classesIn(n.id).length]).filter(([, c]) => c);
  function renderSide() {
    const keepFocus = document.activeElement?.classList?.contains('q');
    let html = `<input class="q" placeholder="${S.tab === 'class' ? 'Find a class…' : S.tab === 'data' ? 'Find a table…' : 'Find an endpoint, a flow or Class.method…'}" spellcheck="false" autocomplete="off" aria-label="Filter the list">`;
    if (S.tab === 'class') {
      const sc = S.cls.scope;
      const depth = (n) => { let d = 0; for (let p = nodeById.get(n.parent); p && d < 6; p = nodeById.get(p.parent)) d++; return d; };
      html += `<select data-scope aria-label="Which part to draw"><option value="all"${sc.type === 'all' ? ' selected' : ''}>Everything (${C.length})</option>${nodesWithClasses().map(([n, c]) => `<option value="${hk(n.id)}"${sc.type === 'node' && sc.id === n.id ? ' selected' : ''}>${'  '.repeat(depth(n))}${h(n.label)} (${c})</option>`).join('')}${sc.type === 'focus' ? `<option selected>Around ${h(C[sc.id].n)}</option>` : sc.type === 'file' ? `<option selected>${h(sc.id.split('/').pop())}</option>` : ''}</select>`;
      html += `<div class="opts">${opt('members', 'Members', S.cls.members)}${opt('errors', 'Errors', S.cls.errors)}${sc.type === 'node' ? opt('around', 'What they use', S.cls.around) : ''}</div><div class="ul">`;
      const pool = (sc.type === 'node' && !S.q ? classesIn(sc.id) : C.map((c, i) => i)).filter((i) => hit(C[i].n) && (S.cls.errors || S.q || C[i].st !== 'error'));
      pool.sort((a, b) => C[a].n.localeCompare(C[b].n));
      html += pool.slice(0, 400).map((i) => `<button data-class="${i}" class="${sc.type === 'focus' && sc.id === i ? 'on' : ''}" title="${h(C[i].f)}"><i class="dot" style="background:${colorOf(C[i])}"></i><b>${h(C[i].n)}</b><span>${h(C[i].k === 'i' ? 'interface' : C[i].st || '')}</span></button>`).join('') || '<div class="none">No class matches.</div>';
      if (pool.length > 400) html += `<div class="none">${pool.length - 400} more: type to narrow.</div>`;
      html += '</div>';
    } else if (S.tab === 'data') {
      if (groups.length > 1) html += `<div class="opts">${groups.map((g) => opt('g:' + g, g, !S.data.groups || S.data.groups.has(g))).join('')}</div>`;
      html += `<div class="opts">${opt('cols', 'All columns', S.data.cols)}${S.data.focus != null ? '<label class="on" data-all>Show all tables</label>' : ''}</div><div class="ul">`;
      const pool = E.map((e, i) => i).filter((i) => hit(`${E[i].n} ${E[i].t || ''}`)).sort((a, b) => E[a].n.localeCompare(E[b].n));
      html += pool.slice(0, 400).map((i) => `<button data-ent="${i}" class="${S.data.focus === i ? 'on' : ''}" title="${h(E[i].f)}"><i class="dot" style="background:var(--n-data)"></i><b>${h(E[i].n)}</b><span>${h(E[i].g || E[i].t || '')}</span></button>`).join('') || '<div class="none">No table matches.</div>';
      html += '</div>';
    } else {
      html += `<div class="opts">${opt('helpers', 'Calls on itself', S.seq.helpers)}<label class="on" data-depth title="How many classes deep to follow the calls">Depth ${S.seq.depth}</label></div><div class="ul">`;
      const src = S.seq.src;
      const fl = flows.filter((f) => hit(f.title));
      if (fl.length) html += `<div class="g">Flows</div>` + fl.map((f) => `<button data-flow="${hk(f.id)}" class="${src?.type === 'flow' && src.id === f.id ? 'on' : ''}"><b style="font-family:inherit;font-size:13px">${h(f.title)}</b></button>`).join('');
      const rs = traceable.filter((i) => hit(`${G.routes[i].m} ${G.routes[i].p} ${G.routes[i].name || ''}`));
      if (rs.length) html += `<div class="g">Endpoints <span style="color:var(--text-4)">${rs.length}</span></div>` + rs.slice(0, 300).map((i) => `<button data-route="${i}" class="${src?.route === i ? 'on' : ''}" title="${h(G.routes[i].name || '')}"><b>${h(G.routes[i].m)} ${h(G.routes[i].p)}</b></button>`).join('');
      if (S.q) {
        // Class.method, for anything that isn't an endpoint
        const ms = [];
        for (let i = 0; i < C.length && ms.length < 60; i++) for (const m of C[i].m) if ((m[6] || []).length && hit(`${C[i].n}.${m[1]}`)) { ms.push([i, m[1]]); if (ms.length >= 60) break; }
        if (ms.length) html += `<div class="g">Methods</div>` + ms.map(([i, n]) => `<button data-method="${i}|${hk(n)}"><b>${h(C[i].n)}.${h(n)}</b></button>`).join('');
      }
      if (!fl.length && !rs.length && !S.q) html += '<div class="none">No endpoint here is answered by a class method the map could follow. Search for Class.method, or open a class and click one of its methods.</div>';
      html += '</div>';
    }
    side.innerHTML = html;
    const q = side.querySelector('.q');
    q.value = S.q;
    if (keepFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    q.oninput = () => { S.q = q.value; renderSide(); };
  }
  side.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('[data-scope]')) { S.cls.scope = t.value === 'all' ? { type: 'all' } : { type: 'node', id: t.value }; S.q = ''; return draw(); }
    const key = t.dataset.opt;
    if (!key) return;
    if (key.startsWith('g:')) { const g = key.slice(2), set = S.data.groups ? new Set(S.data.groups) : new Set(groups); if (t.checked) set.add(g); else set.delete(g); S.data.groups = set.size === groups.length ? null : set; S.data.focus = null; }
    else if (key === 'cols') S.data.cols = t.checked;
    else if (key === 'helpers') S.seq.helpers = t.checked;
    else S.cls[key] = t.checked;
    draw();
  });
  side.addEventListener('click', (ev) => {
    const b = ev.target.closest('button, [data-all], [data-depth]');
    if (!b) return;
    el.classList.remove('list-open');
    if (b.dataset.class != null) S.cls.scope = { type: 'focus', id: +b.dataset.class };
    else if (b.dataset.ent != null) S.data.focus = +b.dataset.ent;
    else if (b.dataset.all != null) S.data.focus = null;
    else if (b.dataset.depth != null) S.seq.depth = S.seq.depth >= 8 ? 2 : S.seq.depth + 2;
    else if (b.dataset.flow != null) S.seq.src = { type: 'flow', id: b.dataset.flow };
    else if (b.dataset.route != null) { const t = routeTarget(+b.dataset.route); if (t) S.seq.src = { type: 'method', ci: t.ci, name: t.name, route: +b.dataset.route }; }
    else if (b.dataset.method != null) { const [ci, name] = b.dataset.method.split('|'); S.seq.src = { type: 'method', ci: +ci, name }; }
    else return;
    draw();
  });

  // ---------- header ----------
  const stamp = () => (G.meta.rootName || 'map').replace(/[^\w.-]+/g, '-');
  el.querySelector('.uh').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { S.tab = b.dataset.tab; S.q = ''; return draw(); }
    const u = b.dataset.u;
    if (u === 'close') return close();
    if (u === 'list') return el.classList.toggle('list-open');
    if (!current) return;
    if (u === 'mermaid' || u === 'plantuml') { if (await SC.copy(current[u])) SC.toast(u === 'mermaid' ? 'Copied as Mermaid' : 'Copied as PlantUML'); return; }
    if (u === 'svg') {
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([current.svg], { type: 'image/svg+xml' }));
        a.download = `${stamp()}-${current.name}.svg`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch { SC.toast('This browser blocked the download. Copy the Mermaid text instead.'); }
    }
  });
  const tabOk = { class: C.length > 0, data: E.length > 0, seq: flows.length > 0 || C.length > 0 };
  el.querySelectorAll('[data-tab]').forEach((b) => { b.disabled = !tabOk[b.dataset.tab]; });

  const isOpen = () => el.classList.contains('open');
  function open(what = {}) {
    closeMenu();
    SC.closeMenus?.();
    if (what.tab && tabOk[what.tab]) S.tab = what.tab;
    if (what.scope) S.cls.scope = what.scope;
    if (what.entity != null) S.data.focus = what.entity;
    if (what.src) S.seq.src = what.src;
    S.q = '';
    el.classList.add('open');
    draw();
  }
  function close() { el.classList.remove('open', 'list-open'); }
  window.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    ev.stopPropagation(); // the map's own shortcuts stay out of the open diagram
  }, true);
  window.addEventListener('resize', () => { if (isOpen()) fit(); });
  // a theme switch redraws with the new colours
  new MutationObserver(() => { if (isOpen()) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- entry points on the map ----------
  const menu = document.createElement('div');
  menu.id = 'uml-menu';
  menu.className = 'menu glass';
  document.body.appendChild(menu);
  let btn = null;
  function closeMenu() { menu.classList.remove('open'); }
  /** The part or file the map is showing or has selected, as a class-diagram scope. */
  function scopeHere() {
    for (const id of [SC.state.selected, SC.state.container]) {
      if (typeof id !== 'string') continue;
      if (id.startsWith('f:') && byFile.has(id.slice(2))) return { scope: { type: 'file', id: id.slice(2) }, label: SC.info(id).name };
      if (id.startsWith('n:') && classesIn(id.slice(2)).length) return { scope: { type: 'node', id: id.slice(2) }, label: SC.info(id).name };
    }
    return { scope: { type: 'all' }, label: '' };
  }
  function openMenu() {
    SC.closeMenus?.();
    const here = scopeHere();
    const sel = SC.state.selected;
    const route = typeof sel === 'string' && sel.startsWith('r:') && routeTarget(+sel.slice(2)) ? +sel.slice(2) : null;
    menu.innerHTML = `<button data-o="class" ${C.length ? '' : 'disabled'}><b>Class diagram${here.label ? ` of ${h(here.label)}` : ''}</b><span>${C.length ? `${U.counts?.classes ?? C.length} classes, what each extends, implements and is handed` : 'No classes found in this code'}</span></button>
<button data-o="data" ${E.length ? '' : 'disabled'}><b>Data model</b><span>${E.length ? `${E.length} tables with their keys and relations` : 'No Prisma or Drizzle schema found'}</span></button>
<button data-o="seq" ${tabOk.seq ? '' : 'disabled'}><b>Sequence diagram${route != null ? ' of this endpoint' : ''}</b><span>An endpoint, a flow or a method, call by call down to the database</span></button>`;
    const r = btn.getBoundingClientRect(), w = Math.min(300, innerWidth - 16);
    menu.style.top = r.bottom + 8 + 'px';
    menu.style.width = w + 'px';
    menu.style.right = Math.min(Math.max(8, innerWidth - r.right), innerWidth - 8 - w) + 'px';
    menu.classList.add('open');
    menu.querySelectorAll('[data-o]').forEach((b) => b.onclick = (ev) => {
      ev.stopPropagation();
      if (b.dataset.o === 'class') open({ tab: 'class', scope: here.scope });
      else if (b.dataset.o === 'data') open({ tab: 'data' });
      else { const t = route != null ? routeTarget(route) : null; open({ tab: 'seq', ...(t ? { src: { type: 'method', ci: t.ci, name: t.name, route } } : {}) }); }
    });
  }
  btn = SC.addHeaderButton({ id: 'uml-btn', label: 'UML', svg: '<rect x="3" y="3" width="8" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="14" width="8" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10v4a3 3 0 0 0 3 3h3" fill="none" stroke="currentColor" stroke-width="1.6"/>', title: 'Class, data and sequence diagrams of this code', onClick: () => (menu.classList.contains('open') ? closeMenu() : openMenu()) });
  window.addEventListener('pointerdown', (ev) => { if (menu.classList.contains('open') && !menu.contains(ev.target) && !btn.contains(ev.target)) closeMenu(); }, true);

  const linkRow = (attr, title, sub) => `<a class="row" ${attr}><span class="dot" style="background:var(--n-symbol)"></span><span class="rt"><div class="rn">${h(title)}</div>${sub ? `<div class="rd">${h(sub)}</div>` : ''}</span></a>`;
  SC.addPanelSection('item', (id) => {
    if (typeof id !== 'string') return null;
    const rows = [];
    if (id.startsWith('f:') || id.startsWith('m:')) {
      const p = id.slice(2), cs = byFile.get(p) || [], es = entByFile.get(p) || [];
      if (cs.length) rows.push(linkRow(`data-uml="file" data-v="${hk(p)}"`, 'Class diagram', cs.slice(0, 4).map((i) => C[i].n).join(', ') + (cs.length > 4 ? ` and ${cs.length - 4} more` : '')));
      if (es.length) rows.push(linkRow(`data-uml="ent" data-v="${es[0]}"`, 'Data model', `${E[es[0]].n} and the tables it relates to`));
    } else if (id.startsWith('n:')) {
      const n = classesIn(id.slice(2)).length;
      if (n) rows.push(linkRow(`data-uml="node" data-v="${hk(id.slice(2))}"`, 'Class diagram', `${n} class${n === 1 ? '' : 'es'} in this part`));
    } else if (id.startsWith('r:')) {
      const t = routeTarget(+id.slice(2));
      if (t) rows.push(linkRow(`data-uml="route" data-v="${+id.slice(2)}"`, 'Sequence diagram', `${C[t.ci].n}.${t.name}() and everything it calls`));
    }
    if (!rows.length) return null;
    return {
      html: `<div class="sec"><h3>UML</h3><div class="list">${rows.join('')}</div></div>`,
      bind: (root) => root?.querySelectorAll('[data-uml]').forEach((a) => a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const v = a.dataset.v;
        if (a.dataset.uml === 'file') open({ tab: 'class', scope: { type: 'file', id: v } });
        else if (a.dataset.uml === 'node') open({ tab: 'class', scope: { type: 'node', id: v } });
        else if (a.dataset.uml === 'ent') open({ tab: 'data', entity: +v });
        else { const t = routeTarget(+v); if (t) open({ tab: 'seq', src: { type: 'method', ci: t.ci, name: t.name, route: +v } }); }
      })),
    };
  });

  window.FloorplanUml = { open, close, classes: C, entities: E };
})();
