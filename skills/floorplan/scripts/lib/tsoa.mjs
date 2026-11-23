// tsoa: endpoints declared with decorators on controller classes, served through a routes file tsoa generates.
//
//   @Route('orders') class OrdersController extends Controller { @Get('{id}') getOrder(...) {} }
//
// The controller is where the endpoint lives, so that's where it sits on the map: at its method, with the
// decorators Health reads (@Security, @NoSecurity, @Middlewares). The generated routes file, when it's in git,
// knows the full address (tsoa's basePath is added there), so its routes hand their address to the controller's
// and leave the map: one endpoint, in the file a person would open.

const VERB = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(?:["'`]([^"'`$]*)["'`]\s*)?\)/g;
const ROUTE = /@Route\s*\(\s*(?:["'`]([^"'`$]*)["'`]\s*)?\)/g;
const clean = (s) => s.replace(/^\/+|\/+$/g, '');
/** tsoa writes path parameters as {id}; the rest of the map writes :id. */
const params = (p) => p.replace(/\{([A-Za-z_]\w*)\}/g, ':$1');

export const isTsoaController = (code) => /["']tsoa["']|@tsoa\/runtime/.test(code) && /@Route\s*\(/.test(code);

/**
 * The method a route decorator sits on: what follows once the other decorators are stepped over, brackets and
 * all, since their arguments often run over several lines (@Middlewares(\n validateSchema(schema)\n)).
 */
function handlerAfter(code, from) {
  let i = from;
  for (let guard = 0; guard < 40; guard++) {
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code[i] !== '@') break;
    i++;
    while (i < code.length && /[\w$.]/.test(code[i])) i++;
    while (code[i] === ' ' || code[i] === '\t') i++;
    if (code[i] === '<') { // type arguments: @Response<ApiResponse<null>>(401)
      let d = 0, j = i;
      const end = Math.min(code.length, i + 2000);
      for (; j < end; j++) { if (code[j] === '<') d++; else if (code[j] === '>' && code[j - 1] !== '=' && !--d) break; }
      if (j >= end) return null;
      i = j + 1;
    }
    if (code[i] === '(') {
      let d = 0, j = i;
      const end = Math.min(code.length, i + 8000);
      for (; j < end; j++) { if (code[j] === '(') d++; else if (code[j] === ')' && !--d) break; }
      if (j >= end) return null;
      i = j + 1;
    }
  }
  return /^(?:(?:public|private|protected|static|async|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^(]{0,200}>)?\s*\(/.exec(code.slice(i, i + 400))?.[1] || null;
}

/** Endpoints of the tsoa controllers in one file (comments already stripped). */
export function tsoaRoutes(code, at) {
  const ctrls = [...code.matchAll(ROUTE)].map((m) => ({ index: m.index, prefix: m[1] || '' }));
  if (!ctrls.length) return [];
  const out = [];
  for (const m of code.matchAll(VERB)) {
    let ctrl = null;
    for (const c of ctrls) if (c.index < m.index) ctrl = c;
    if (!ctrl) continue;
    const p = params('/' + [clean(ctrl.prefix), clean(m[2] || '')].filter(Boolean).join('/'));
    const handler = handlerAfter(code, m.index + m[0].length);
    out.push({ method: m[1].toUpperCase(), path: p, var: null, line: at(m.index), framework: 'tsoa', ...(handler ? { handler } : {}) });
  }
  return out;
}

const GENERATED = /auto-generated with tsoa/;
const HANDLED_BY = /\b([A-Za-z_$][\w$]*)\s*\.\s*prototype\s*\.\s*([A-Za-z_$][\w$]*)/;

/**
 * Fold the routes of tsoa's generated files into their controllers' endpoints. `routes` is changed in place;
 * returns how many were folded. A generated route whose controller wasn't found stays where it is.
 */
export function mergeTsoaGenerated(files, routes, read) {
  const withRoutes = new Set(routes.map((r) => r.file));
  // resolved routes no longer say which framework declared them: the files' own lists do
  const tsoaAt = new Set();
  for (const f of files) for (const r of f.routes || []) if (r.framework === 'tsoa') tsoaAt.add(`${f.path}|${r.line}`);
  if (!tsoaAt.size) return 0;
  let merged = 0;
  for (const f of files) {
    if (!withRoutes.has(f.path) || !/\.[cm]?[jt]s$/.test(f.path)) continue;
    const src = read(f.path);
    if (!src || !GENERATED.test(src.slice(0, 4000))) continue;
    const lines = src.split('\n');
    // which file each controller class was imported from
    const fileOf = new Map();
    for (const imp of f.imports || []) for (const [local] of Object.entries(imp.locals || {})) if (imp.files?.[0]) fileOf.set(local, imp.files[0]);
    const gone = new Set();
    const used = new Set();
    for (const r of routes) {
      if (r.file !== f.path) continue;
      const m = HANDLED_BY.exec(lines.slice(r.line - 1, r.line + 11).join('\n'));
      const ctrlFile = m && fileOf.get(m[1]);
      if (!ctrlFile) continue;
      const target = routes.find((t) => t.file === ctrlFile && tsoaAt.has(`${t.file}|${t.line}`) && t.handler === m[2] && t.method === r.method);
      if (!target) continue;
      if (!used.has(target) && !target.generated) {
        target.path = r.path;
        target.generated = f.path;
        if (r.mountMw?.length) target.mountMw = r.mountMw;
      } else if (target.path !== r.path && !routes.some((t) => t.file === ctrlFile && t.line === target.line && t.method === r.method && t.path === r.path)) {
        // the same controller served under a second address (another generated file, another version)
        routes.push({ ...target, path: r.path, generated: f.path });
      }
      used.add(target);
      gone.add(r);
      merged++;
    }
    if (gone.size) for (let i = routes.length - 1; i >= 0; i--) if (gone.has(routes[i])) routes.splice(i, 1);
  }
  return merged;
}
