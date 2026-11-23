// UML model for the map (graph.uml), read from the source at build time:
//   classes   TypeScript/JavaScript classes and the interfaces they implement or are handed, with members,
//             inheritance, and what each constructor is given (dependency injection: inversify, NestJS, plain)
//   calls     per method, the calls it makes on what it was handed (this.service.method()), on itself, and on
//             the database, in order: enough to draw a sequence diagram from any endpoint or method
//   entities  the data model: Prisma models and Drizzle tables, with keys and the relations between them
// The viewer (assets/ui/35-uml.js) draws class, entity-relationship and sequence diagrams from it.
//
// Pattern matching, not a compiler. Text inside strings and comments never reaches the model: members are read
// from code with both blanked out, so a default value or a comment can't leak into the map.

import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 600_000;
const MAX_CLASSES = 6000, MAX_MEMBERS = 80, MAX_CALLS = 60, MAX_ENTITIES = 2000, MAX_COLUMNS = 150, MAX_BODY = 400_000;
const JS_LANG = new Set(['typescript', 'javascript']);
const SKIP_FILE = /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?|coverage)\/|\.(test|spec|e2e|stories|gen|generated)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const ID = String.raw`[A-Za-z_$][\w$]*`;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// ---------- reading code ----------

/**
 * The source with comments and the insides of strings turned to spaces, same length and same line breaks, so
 * positions still point into the original. Code inside a template's ${…} stays. A regular expression holding a
 * quote can blank the rest of its line, never more: a string stops at the end of its line.
 */
export function blank(src) {
  const n = src.length;
  const out = src.split('');
  const wipe = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const templates = []; // brace depth at which each open ${ sits
  let i = 0, depth = 0;
  const template = () => {
    const s = i;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { wipe(s, i); i++; return; }
      if (c === '$' && src[i + 1] === '{') { wipe(s, i + 2); i += 2; templates.push(depth); return; }
      i++;
    }
    wipe(s, n);
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; wipe(s, i); }
    else if (c === '/' && d === '*') { const s = i; const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; wipe(s, i); }
    else if (c === '"' || c === "'") {
      const s = ++i;
      while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      wipe(s, i); i++;
    }
    else if (c === '`') { i++; template(); }
    else if (c === '{') { depth++; i++; }
    else if (c === '}') {
      if (templates.length && templates[templates.length - 1] === depth) { templates.pop(); out[i] = ' '; i++; template(); }
      else { depth--; i++; }
    }
    else i++;
  }
  return out.join('');
}

/** Index of the bracket closing the one at `open`, or -1 when it isn't closed within `limit` characters. */
function closing(code, open, limit = MAX_BODY) {
  const a = code[open], b = { '{': '}', '(': ')', '[': ']' }[a];
  const end = Math.min(code.length, open + limit);
  for (let i = open, d = 0; i < end; i++) {
    if (code[i] === a) d++;
    else if (code[i] === b && !--d) return i;
  }
  return -1;
}

/** Split on commas that sit outside every bracket (angle brackets too, `=>` aside). */
function splitTop(s) {
  const out = [];
  let d = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') d++;
    else if (c === ')' || c === ']' || c === '}' || (c === '>' && s[i - 1] !== '=')) d = Math.max(0, d - 1);
    else if (c === ',' && !d) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
}

const lineAt = (src) => {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
};

/** The decorators stacked right before `pos`, outermost first: [{ name, args }] (args as written, or null). */
function decoratorsBefore(code, pos) {
  const found = [];
  let i = pos;
  for (let guard = 0; guard < 30; guard++) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    if (j < 0) break;
    let argsStart = -1, argsEnd = -1;
    if (code[j] === ')') {
      let d = 0, k = j;
      for (; k >= 0 && j - k < 6000; k--) { if (code[k] === ')') d++; else if (code[k] === '(' && !--d) break; }
      if (k < 0 || d) break;
      argsEnd = j; argsStart = k; j = k - 1;
    }
    const e = j;
    while (j >= 0 && /[\w$.]/.test(code[j])) j--;
    if (j < 0 || code[j] !== '@' || e === j) break;
    found.unshift({ name: code.slice(j + 1, e + 1), args: argsStart >= 0 ? code.slice(argsStart + 1, argsEnd) : null });
    i = j;
  }
  return found;
}

const BUILTIN = new Set('Promise Array Map Set WeakMap WeakSet Record Partial Required Readonly Pick Omit Exclude Extract NonNullable ReturnType Parameters Awaited Date Error RegExp Buffer Function Object String Number Boolean Symbol BigInt Uint8Array ArrayBuffer Iterable AsyncIterable Generator AsyncGenerator Observable'.split(' '));
/** The names a type mentions that could be the project's own: `Map<string, OrderRepo> | null` gives OrderRepo. */
const typeNames = (t) => [...new Set((t || '').match(/(?<![\w$.])[A-Z][\w$]*/g) || [])].filter((n) => !BUILTIN.has(n));

function parseHeader(header) {
  let s = header;
  const lt = s.search(/\S/);
  if (lt >= 0 && s[lt] === '<') { // the type parameters of the declaration itself
    let d = 0, i = lt;
    for (; i < s.length; i++) { if (s[i] === '<') d++; else if (s[i] === '>' && s[i - 1] !== '=' && !--d) break; }
    s = s.slice(i + 1);
  }
  const ext = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(s)?.[1] || '';
  const imp = /\bimplements\s+([\s\S]*)$/.exec(s)?.[1] || '';
  const names = (t) => splitTop(t).map((x) => new RegExp(`^((?:${ID}\\.)*${ID})`).exec(x)?.[1]?.split('.').pop()).filter(Boolean);
  return { ext: names(ext), imp: names(imp) };
}

const MODS = /^(?:(?:public|private|protected|static|readonly|abstract|override|async|declare|accessor)\b\s*)*/;
const vis = (mods, name) => (/\bprivate\b/.test(mods) || name.startsWith('#') ? '-' : /\bprotected\b/.test(mods) ? '#' : '+');
const flagsOf = (mods) => (/\bstatic\b/.test(mods) ? 's' : '') + (/\babstract\b/.test(mods) ? 'a' : '') + (/\basync\b/.test(mods) ? 'y' : '') + (/\breadonly\b/.test(mods) ? 'r' : '');

/** Parameters as written, shortened for a diagram: `id: string, body: CreateOrderDto`. */
function paramText(raw) {
  return cut(splitTop(raw).map((p) => {
    const m = new RegExp(`^(?:@${ID}(?:\\.${ID})*(?:\\([^()]*(?:\\([^()]*\\)[^()]*)*\\))?\\s*)*(?:(?:public|private|protected|readonly|override)\\s+)*(\\.\\.\\.)?\\s*(${ID}|\\{[^}]*\\}|\\[[^\\]]*\\])\\s*(\\?)?\\s*(?::\\s*([\\s\\S]*?))?(?:=[\\s\\S]*)?$`).exec(p);
    if (!m) return cut(squash(p), 28);
    const name = /^[{[]/.test(m[2]) ? '{…}' : m[2];
    return `${m[1] || ''}${name}${m[3] || ''}${m[4] ? ': ' + cut(squash(m[4]), 32) : ''}`;
  }).join(', '), 110);
}

/** What a constructor is handed: [{ name, type, field, inject }]. */
function ctorParams(raw) {
  return splitTop(raw).map((p) => {
    const decos = [];
    let rest = p;
    for (let guard = 0; guard < 8; guard++) {
      const m = new RegExp(`^@(${ID}(?:\\.${ID})*)\\s*`).exec(rest);
      if (!m) break;
      rest = rest.slice(m[0].length);
      let args = null;
      if (rest[0] === '(') { const e = closing(rest, 0, 2000); if (e < 0) break; args = rest.slice(1, e); rest = rest.slice(e + 1).trimStart(); }
      decos.push({ name: m[1], args });
    }
    const mods = MODS.exec(rest)[0];
    rest = rest.slice(mods.length);
    const m = new RegExp(`^(${ID})\\s*(\\?)?\\s*(?::\\s*([\\s\\S]*?))?(?:=[\\s\\S]*)?$`).exec(rest);
    if (!m) return null;
    const inject = decos.find((d) => /^(inject|Inject|multiInject)$/.test(d.name.split('.').pop()));
    return { name: m[1], type: squash(m[3] || ''), field: /\b(public|private|protected|readonly)\b/.test(mods), mods, inject: !!inject, token: inject?.args ? squash(inject.args) : '' };
  }).filter(Boolean);
}

const CALL = new RegExp(String.raw`\bthis\s*\.\s*(#?${ID})\s*(?:[?!]\s*)?(?:\.\s*(${ID})\s*)?(?:<[^()<>;]{0,120}>\s*)?\(`, 'g');
const DATA_OP = new RegExp(String.raw`\.\s*(${ID})\s*\.\s*(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*(?:<[^()<>;]{0,120}>\s*)?\(`, 'g');
const TABLE_OP = new RegExp(String.raw`\.\s*(from|insert|update|delete|into|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(${ID})\s*[,)]`, 'g');
const TABLE_VERB = { from: 'select', innerJoin: 'select', leftJoin: 'select', rightJoin: 'select', fullJoin: 'select', into: 'insert' };
const NOT_CALLED = new Set(['constructor', 'super']);

/** The calls a method body makes, in the order written: on a field, on itself, and on the database. */
function callsIn(code) {
  const out = [];
  for (const m of code.matchAll(CALL)) {
    if (m[2]) out.push({ i: m.index, field: m[1], method: m[2] });
    else if (!NOT_CALLED.has(m[1])) out.push({ i: m.index, field: null, method: m[1] });
  }
  for (const m of code.matchAll(DATA_OP)) out.push({ i: m.index, key: m[1], op: m[2] });
  for (const m of code.matchAll(TABLE_OP)) out.push({ i: m.index, key: m[2], op: TABLE_VERB[m[1]] || m[1], table: true });
  out.sort((a, b) => a.i - b.i);
  const seen = new Set();
  return out.filter((c) => { const k = c.key ? `d|${c.key}|${c.op}` : `c|${c.field}|${c.method}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_CALLS);
}

/** Members of the class or interface whose body runs from `open` to `close`. */
function parseMembers(code, open, close, at) {
  // where a member can start: the beginning of a line that is inside no bracket of the body
  const starts = [];
  let bd = 0, pd = 0, fresh = true;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (fresh && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') { fresh = false; if (!bd && !pd && c !== '}' && c !== ')' && c !== ']') starts.push(i); }
    if (c === '\n') fresh = true;
    else if (c === '{') bd++;
    else if (c === '}') bd = Math.max(0, bd - 1);
    else if (c === '(' || c === '[') pd++;
    else if (c === ')' || c === ']') pd = Math.max(0, pd - 1);
  }
  const fields = [], methods = [];
  let ctor = null, pending = [];
  const members = []; // every real member start, to bound method bodies
  for (const s of starts) {
    let i = s;
    const decos = [];
    let broke = false;
    while (code[i] === '@') {
      const m = new RegExp(`^@(${ID}(?:\\.${ID})*)[ \\t]*`).exec(code.slice(i, i + 200));
      if (!m) { broke = true; break; }
      i += m[0].length;
      if (code[i] === '<') { // type arguments: @Response<ApiResponse<null>>(401)
        let d = 0, j = i;
        for (; j < close && j < i + 2000; j++) { if (code[j] === '<') d++; else if (code[j] === '>' && code[j - 1] !== '=' && !--d) break; }
        i = j + 1;
      }
      if (code[i] === '(') { const e = closing(code, i, 8000); if (e < 0 || e > close) { broke = true; break; } i = e + 1; }
      decos.push(m[1].split('.').pop());
      while (i < close && (code[i] === ' ' || code[i] === '\t')) i++;
    }
    if (broke) { pending = []; continue; }
    if (i >= close || code[i] === '\n' || code[i] === '\r') { pending.push(...decos); continue; } // decorators on their own line
    const eol = code.indexOf('\n', i);
    const text = code.slice(i, eol < 0 || eol > close ? close : eol);
    const mods = MODS.exec(text)[0];
    const rest = text.slice(mods.length);
    const allDecos = [...pending, ...decos];
    pending = [];
    let m;
    if ((m = /^constructor\s*\(/.exec(rest))) {
      const po = i + mods.length + m[0].length - 1, pc = closing(code, po, 20000);
      if (pc > 0 && pc < close) ctor = { start: s, params: ctorParams(code.slice(po + 1, pc)), line: at(s) };
      members.push({ start: s, ctor: true });
      continue;
    }
    if ((m = new RegExp(`^(get|set)\\s+(#?${ID})\\s*\\(`).exec(rest))) {
      if (m[1] === 'get' && !fields.some((f) => f.name === m[2])) {
        const po = i + mods.length + m[0].length - 1, pc = closing(code, po, 2000);
        const ret = pc > 0 ? /^\s*:\s*([^\n{;=]+)/.exec(code.slice(pc + 1, pc + 200))?.[1] : '';
        fields.push({ name: m[2], type: squash(ret || ''), vis: vis(mods, m[2]), flags: flagsOf(mods) + 'g', line: at(s) });
      }
      members.push({ start: s, accessor: true });
      continue;
    }
    if ((m = new RegExp(`^\\*?\\s*(#?${ID})\\s*[?!]?\\s*(?:<[^(]{0,300}?>)?\\s*\\(`).exec(rest))) {
      const po = i + mods.length + m[0].length - 1, pc = closing(code, po, 20000);
      if (pc < 0 || pc > close) continue;
      const after = code.slice(pc + 1, pc + 260);
      const ret = /^\s*:\s*([^\n{;=]+)/.exec(after)?.[1] || (/^\s*:\s*\{/.test(after) ? '{…}' : '');
      const mem = { start: s, method: { name: m[1], params: paramText(code.slice(po + 1, pc)), ret: cut(squash(ret), 60), vis: vis(mods, m[1]), flags: flagsOf(mods), line: at(s), decos: allDecos } };
      members.push(mem);
      continue;
    }
    if ((m = new RegExp(`^(#?${ID})\\s*([?!])?\\s*(?::\\s*([^=;]*?))?\\s*(?:=\\s*([\\s\\S]*))?[;,]?\\s*$`).exec(rest))) {
      if (m[1] === 'static' || (m[3] === undefined && m[4] === undefined && !/[;,]?\s*$/.test(rest))) continue;
      const init = m[4] || '';
      const fn = new RegExp(`^(?:async\\s+)?(?:\\(([^)]*)\\)|(${ID}))\\s*(?::\\s*[^=]+?)?\\s*=>`).exec(init) || /^(?:async\s+)?function\b[^(]*\(([^)]*)\)/.exec(init);
      if (fn) members.push({ start: s, method: { name: m[1], params: paramText(fn[1] || fn[2] || ''), ret: '', vis: vis(mods, m[1]), flags: flagsOf(mods) + (/^async\b/.test(init) ? 'y' : ''), line: at(s), decos: allDecos } });
      else {
        // a type that opens a bracket continues on the lines below
        const type = m[3] !== undefined && /[<({[]\s*$/.test(m[3]) ? m[3].trim() + '…' : (m[3] || '');
        const made = /^new\s+((?:[\w$]+\.)*[\w$]+)/.exec(init)?.[1] || '';
        members.push({ start: s, field: { name: m[1] + (m[2] === '?' ? '?' : ''), type: squash(type), vis: vis(mods, m[1]), flags: flagsOf(mods), line: at(s), made } });
      }
    }
  }
  members.sort((a, b) => a.start - b.start);
  members.forEach((mem, k) => {
    if (mem.field) { if (!fields.some((f) => f.name === mem.field.name)) fields.push(mem.field); return; }
    if (!mem.method) return;
    if (methods.some((x) => x.name === mem.method.name)) return; // overloads: the first signature stands for all
    const end = members[k + 1]?.start ?? close;
    mem.method.calls = callsIn(code.slice(mem.start, end));
    methods.push(mem.method);
  });
  return { fields, methods, ctor };
}

const SUFFIX = [
  [/Controller$/, 'controller'], [/(Service|UseCase|Interactor)$/, 'service'], [/(Repository|Repo|Dao)$/, 'repository'],
  [/(Adapter|Client|Gateway|Provider|Connector)$/, 'adapter'], [/(Handler|Processor|Consumer|Listener|Subscriber|Worker|Jobs?|Task|Command|Producer|Indexer|Watcher|Scheduler|Coordinator)$/, 'handler'],
  [/(Middleware|Guard|Interceptor|Filter|Pipe)$/, 'middleware'], [/(Factory|Builder)$/, 'factory'], [/(Model|Entity|Schema)$/, 'model'],
  [/(Error|Exception)$/, 'error'], [/(Port)$/, 'port'], [/(Module|Container|Loader)$/, 'module'], [/(Store|Cache)$/, 'store'],
];
const DECO_KIND = { Controller: 'controller', Route: 'controller', Resolver: 'controller', Entity: 'model', Module: 'module', Component: 'component', Catch: 'middleware' };
function stereotype(name, decos, ext) {
  for (const d of decos) if (DECO_KIND[d.name.split('.').pop()]) return DECO_KIND[d.name.split('.').pop()];
  for (const [re, kind] of SUFFIX) if (re.test(name)) return kind;
  if (ext.some((e) => /^(Error|Exception)$|Error$/.test(e))) return 'error';
  if (ext.some((e) => /^(Component|PureComponent)$/.test(e))) return 'component';
  return '';
}

const DECL = new RegExp(String.raw`(^|[\n;})])([ \t]*)((?:(?:export|default|declare|abstract)\s+)*)(class|interface)\s+(${ID})`, 'g');

/**
 * Where a declaration's body opens: the first "{" outside its type arguments, so `class A<T extends { id: string }>
 * extends Base<{ a: 1 }> {` opens at the last one. -1 when what follows the name isn't a declaration.
 */
function bodyOpen(code, from) {
  let d = 0;
  const end = Math.min(code.length, from + 1200);
  for (let i = from; i < end; i++) {
    const c = code[i];
    if (c === '<') d++;
    else if (c === '>' && code[i - 1] !== '=') d = Math.max(0, d - 1);
    else if (c === '{' && !d) return i;
    else if (!d && (c === ';' || c === ')' || c === '=' || c === ':')) return -1;
  }
  return -1;
}
const NOT_A_NAME = new Set(['extends', 'implements']);

/** Classes and interfaces declared in one file. */
export function classesIn(src) {
  if (!/\b(class|interface)\s/.test(src)) return [];
  const code = blank(src);
  const at = lineAt(code);
  const out = [];
  for (const m of code.matchAll(DECL)) {
    if (NOT_A_NAME.has(m[5])) continue;
    const pos = m.index + m[1].length + m[2].length;
    const open = bodyOpen(code, m.index + m[0].length);
    if (open < 0) continue;
    const close = closing(code, open);
    if (close < 0) continue;
    const { ext, imp } = parseHeader(code.slice(m.index + m[0].length, open));
    const decos = m[4] === 'class' ? decoratorsBefore(code, pos) : [];
    const { fields, methods, ctor } = parseMembers(code, open, close, at);
    const kind = m[4] === 'interface' ? 'i' : /\babstract\b/.test(m[3]) ? 'a' : 'c';
    // fields declared in the constructor's parameters (private readonly orders: OrderRepo)
    const handed = ctor?.params || [];
    for (const p of handed) if (p.field && !fields.some((f) => f.name === p.name)) fields.push({ name: p.name, type: p.type, vis: vis(p.mods, p.name), flags: flagsOf(p.mods), line: ctor.line });
    out.push({
      name: m[5], kind, line: at(pos), ext, imp: kind === 'i' ? [] : imp, ifaceExt: kind === 'i' ? ext : [],
      decos: decos.map((d) => d.name), st: stereotype(m[5], decos, ext),
      fields: fields.slice(0, MAX_MEMBERS), methods: methods.slice(0, MAX_MEMBERS), handed,
      exported: /\bexport\b/.test(m[3]),
    });
  }
  return out;
}

/** Container bindings: bind<IMailer>(TYPES.Mailer).to(SesMailer) says which class stands in for an interface. */
function bindingsIn(src) {
  if (!/\.bind\s*[<(]/.test(src)) return [];
  const code = blank(src);
  const out = [];
  const re = new RegExp(String.raw`\.bind\s*(?:<\s*((?:${ID}\.)*${ID})[^>]{0,200}>)?\s*\(\s*((?:${ID}\.)*${ID})?[^()]{0,200}\)\s*\.\s*(to|toService)\s*\(\s*((?:${ID}\.)*${ID})`, 'g');
  for (const m of code.matchAll(re)) {
    const what = (m[1] || m[2] || '').split('.').filter((x) => x !== 'name').pop();
    const impl = m[4].split('.').pop();
    if (what && impl && what !== impl) out.push([what, impl]);
  }
  return out;
}

// ---------- data model ----------

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const SAFE = /^[\w.$-]{1,80}$/;

/** Prisma models: [{ name, table, group, line, columns, relFields }] */
export function prismaModels(src) {
  const lines = src.split('\n');
  const models = [], enums = new Set();
  for (let i = 0; i < lines.length; i++) {
    const head = /^\s*(model|view|enum|type)\s+([A-Za-z_]\w*)\s*\{/.exec(lines[i]);
    if (!head) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !/^\s*\}/.test(lines[j]); j++) body.push([lines[j].replace(/\/\/.*$/, ''), j + 1]);
    if (head[1] === 'enum') { enums.add(head[2]); i = j; continue; }
    const model = { name: head[2], table: '', group: '', line: i + 1, columns: [], rels: [], src: 'prisma' };
    const pk = new Set();
    for (const [text, line] of body) {
      const block = /^\s*@@(\w+)\s*\(([^\n]*)\)/.exec(text);
      if (block) {
        const str = /"([^"\n]*)"/.exec(block[2])?.[1] || '';
        if (block[1] === 'map' && SAFE.test(str)) model.table = str;
        else if (block[1] === 'schema' && SAFE.test(str)) model.group = str;
        else if (block[1] === 'id') for (const n of (/\[([^\]]*)\]/.exec(block[2])?.[1] || '').split(',')) pk.add(n.trim().split('(')[0]);
        continue;
      }
      const f = /^\s*(\w+)\s+((?:Unsupported\s*\("[^"\n]*"\))|[A-Za-z_]\w*(?:\.\w+)?)(\[\]|\?|!)?\s*(.*)$/.exec(text);
      if (!f) continue;
      const attrs = f[4] || '';
      const rel = /@relation\s*\(([^\n]*)\)/.exec(attrs);
      const col = { name: f[1], type: f[2].startsWith('Unsupported') ? 'Unsupported' : f[2], list: f[3] === '[]', opt: f[3] === '?', line,
        pk: /@id\b/.test(attrs), uq: /@unique\b/.test(attrs) };
      if (rel) {
        col.relName = /^\s*"([^"\n]*)"/.exec(rel[1])?.[1] || /\bname\s*:\s*"([^"\n]*)"/.exec(rel[1])?.[1] || '';
        col.fks = (/\bfields\s*:\s*\[([^\]]*)\]/.exec(rel[1])?.[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
      }
      model.columns.push(col);
    }
    for (const c of model.columns) if (pk.has(c.name)) c.pk = true;
    models.push(model);
    i = j;
  }
  return { models, enums };
}

/** Drizzle tables: export const orders = pgTable('orders', { id: uuid('id').primaryKey(), … }) */
export function drizzleTables(src) {
  if (!/drizzle-orm/.test(src)) return [];
  const code = blank(src);
  const at = lineAt(code);
  const out = [];
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+(${ID})\s*=\s*((?:${ID}\s*\.\s*)*${ID})\s*\(`, 'g');
  for (const m of code.matchAll(re)) {
    const callee = m[2].replace(/\s+/g, '').split('.').pop();
    if (!/^(pgTable|mysqlTable|sqliteTable|singlestoreTable|table)$/.test(callee)) continue;
    const po = m.index + m[0].length - 1, pc = closing(code, po, 60000);
    if (pc < 0) continue;
    const name = /^\s*["'`]([^"'`\n]*)["'`]/.exec(src.slice(po + 1, pc))?.[1] || '';
    const bo = code.indexOf('{', po);
    if (bo < 0 || bo > pc) continue;
    const bc = closing(code, bo, 60000);
    if (bc < 0 || bc > pc) continue;
    const table = { name: m[1], table: SAFE.test(name) ? name : '', group: '', line: at(m.index), columns: [], refs: [], src: 'drizzle' };
    // top-level properties of the columns object
    let d = 0, from = bo + 1;
    const props = [];
    for (let i = bo + 1; i <= bc; i++) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || (c === '}' && i < bc)) d--;
      if ((c === ',' && !d) || i === bc) { props.push([from, i]); from = i + 1; }
    }
    for (const [a, b] of props) {
      const text = code.slice(a, b);
      const p = new RegExp(`^\\s*(${ID})\\s*:\\s*((?:${ID}\\s*\\.\\s*)*${ID})\\s*\\(`).exec(text);
      if (!p) continue;
      const colName = /^[^(]*\(\s*["'`]([^"'`\n]*)["'`]/.exec(src.slice(a, b))?.[1] || '';
      const ref = new RegExp(`\\.\\s*references\\s*\\(\\s*\\(\\s*\\)\\s*(?::[^=]{0,80})?=>\\s*(${ID})\\s*\\.\\s*(${ID})`).exec(text);
      const col = { name: p[1], column: SAFE.test(colName) ? colName : '', type: p[2].replace(/\s+/g, '').split('.').pop(), line: at(a + (/\S/.exec(text)?.index || 0)),
        pk: /\.\s*primaryKey\s*\(/.test(text), uq: /\.\s*unique\s*\(/.test(text), opt: !/\.\s*(notNull|primaryKey)\s*\(/.test(text), list: /\.\s*array\s*\(/.test(text) };
      if (ref) { col.fk = true; table.refs.push({ col: p[1], to: ref[1], toCol: ref[2], one: col.pk || col.uq, opt: col.opt }); }
      table.columns.push(col);
    }
    if (table.columns.length) out.push(table);
  }
  return out;
}

// ---------- the model ----------

export function buildUml({ graph, scan, root }) {
  const read = (p) => {
    try { const abs = path.join(root, p); if (fs.statSync(abs).size > MAX_BYTES) return null; return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };
  const onMap = new Set(graph.files.map((f) => f.p));
  const repoOf = new Map(scan.files.map((f) => [f.path, f.repo]));

  // ----- entities -----
  const entities = [], rels = [];
  const prisma = [];
  const enumNames = new Set();
  for (const f of scan.files) {
    if (!f.path.endsWith('.prisma') || entities.length + prisma.length >= MAX_ENTITIES) continue;
    const src = read(f.path);
    if (!src) continue;
    const { models, enums } = prismaModels(src);
    for (const e of enums) enumNames.add(e);
    for (const m of models) prisma.push({ ...m, file: f.path, group: m.group || (models.length === 1 ? path.posix.basename(path.posix.dirname(f.path)) : '') });
  }
  // a folder name is only a group when the models are spread over several folders
  if (new Set(prisma.map((m) => m.group)).size < 2) for (const m of prisma) m.group = '';
  const drizzle = [];
  for (const f of graph.files) {
    if (!JS_LANG.has(f.l) || SKIP_FILE.test(f.p) || entities.length + prisma.length + drizzle.length >= MAX_ENTITIES) continue;
    if (!/schema|table|model|db|drizzle|entit/i.test(f.p)) continue;
    const src = read(f.p);
    if (!src) continue;
    for (const t of drizzleTables(src)) drizzle.push({ ...t, file: f.p, group: path.posix.basename(f.p).replace(/\.[cm]?[jt]sx?$/, '') });
  }
  if (new Set(drizzle.map((m) => m.group)).size < 2) for (const m of drizzle) m.group = '';

  const dataKey = new Map(); // how code names an entity -> its index
  const prismaIdx = new Map();
  for (const m of prisma) {
    const idx = entities.length;
    prismaIdx.set(m.name, idx);
    dataKey.set(lowerFirst(m.name), idx);
    entities.push(m);
  }
  const drizzleIdx = new Map();
  for (const t of drizzle) {
    const idx = entities.length;
    if (!drizzleIdx.has(t.name)) drizzleIdx.set(t.name, idx);
    if (!dataKey.has(t.name)) dataKey.set(t.name, idx);
    entities.push(t);
  }
  // Prisma relations: the side holding the foreign key points at the other
  const relSeen = new Set();
  for (const m of prisma) {
    const from = prismaIdx.get(m.name);
    for (const c of m.columns) {
      const to = prismaIdx.get(c.type);
      if (to === undefined) continue;
      c.rel = true;
      const other = entities[to];
      const back = other.columns.find((o) => o.type === m.name && o !== c && (o.relName || '') === (c.relName || ''));
      if (c.fks?.length) {
        for (const fk of c.fks) { const col = m.columns.find((x) => x.name === fk); if (col) col.fk = true; }
        const one = back ? !back.list : c.fks.every((fk) => m.columns.find((x) => x.name === fk)?.uq);
        rels.push([from, to, one ? '11' : 'n1', c.fks.join(', '), c.opt ? 1 : 0]);
      } else if (c.list && back?.list && !back.fks?.length) {
        const key = [Math.min(from, to), Math.max(from, to), c.relName || ''].join('|');
        if (!relSeen.has(key)) { relSeen.add(key); rels.push([from, to, 'nn', c.relName || '', 0]); }
      }
    }
  }
  for (const t of drizzle) {
    const from = entities.indexOf(t);
    for (const r of t.refs) {
      const to = drizzleIdx.get(r.to);
      if (to !== undefined) rels.push([from, to, r.one ? '11' : 'n1', r.col, r.opt ? 1 : 0]);
    }
  }
  const outEntities = entities.map((e) => ({
    n: e.name, ...(e.table ? { t: e.table } : {}), ...(e.group ? { g: e.group } : {}), f: e.file, l: e.line, o: e.src,
    c: e.columns.filter((c) => !c.rel).slice(0, MAX_COLUMNS).map((c) => [c.name, c.type + (c.list ? '[]' : ''), (c.pk ? 'p' : '') + (c.fk ? 'f' : '') + (c.uq ? 'u' : '') + (c.opt ? 'n' : '') + (enumNames.has(c.type) ? 'e' : '')]),
  }));

  // ----- classes -----
  const found = []; // { file, ...class }
  const bindings = [];
  for (const f of graph.files) {
    if (!JS_LANG.has(f.l) || SKIP_FILE.test(f.p) || found.length >= MAX_CLASSES) continue;
    const src = read(f.p);
    if (!src) continue;
    let list = [];
    try { list = classesIn(src); } catch { list = []; }
    for (const c of list) found.push({ ...c, file: f.p });
    if (/inversify|tsyringe/.test(src)) try { bindings.push(...bindingsIn(src).map((b) => [...b, f.p])); } catch { /* a file that can't be read adds nothing */ }
  }
  const byName = new Map(), byFileName = new Map();
  found.forEach((c, i) => {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(i);
    if (!byFileName.has(`${c.file}#${c.name}`)) byFileName.set(`${c.file}#${c.name}`, i);
  });
  // which file a name was imported from
  const importedFrom = new Map(); // file -> Map(name -> [files])
  for (const e of scan.edges || []) {
    if (!e.names?.length) continue;
    if (!importedFrom.has(e.from)) importedFrom.set(e.from, new Map());
    const m = importedFrom.get(e.from);
    for (const n of e.names) { if (!m.has(n)) m.set(n, []); m.get(n).push(e.to); }
  }
  const shared = (a, b) => { const x = a.split('/'), y = b.split('/'); let k = 0; while (k < x.length && k < y.length && x[k] === y[k]) k++; return k; };
  const resolve = (file, name) => {
    if (!name) return -1;
    const own = byFileName.get(`${file}#${name}`);
    if (own !== undefined) return own;
    for (const from of importedFrom.get(file)?.get(name) || []) { const hit = byFileName.get(`${from}#${name}`); if (hit !== undefined) return hit; }
    const all = byName.get(name);
    if (!all?.length) return -1;
    if (all.length === 1) return all[0];
    // several classes share the name: the one nearest in the tree, within the same repo
    const mine = all.filter((i) => repoOf.get(found[i].file) === repoOf.get(file));
    const pool = mine.length ? mine : all;
    return pool.slice().sort((a, b) => shared(found[b].file, file) - shared(found[a].file, file))[0];
  };
  const resolveType = (file, type) => { for (const n of typeNames(type)) { const i = resolve(file, n); if (i >= 0) return i; } return -1; };

  // what each class was handed, and by which field it calls it
  for (const c of found) {
    c.fieldType = new Map();
    c.deps = [];
    const seen = new Set();
    const add = (name, type, how) => {
      const target = resolveType(c.file, type);
      c.fieldType.set(name.replace(/\?$/, ''), { idx: target, type });
      if (target >= 0 && found[target] !== c && !seen.has(target)) { seen.add(target); c.deps.push([name.replace(/\?$/, ''), target, how]); }
    };
    for (const p of c.handed) add(p.name, p.type, p.inject ? 'i' : 'c');
    for (const f of c.fields) if (!c.fieldType.has(f.name.replace(/\?$/, ''))) add(f.name, f.type || f.made || '', 'f');
  }
  // interfaces stay only when a class implements one or is handed one (and the interfaces those extend)
  const keep = new Set();
  found.forEach((c, i) => { if (c.kind !== 'i') keep.add(i); });
  const resolved = found.map((c) => ({
    x: (c.kind === 'i' ? c.ifaceExt : c.ext).map((n) => { const i = resolve(c.file, n); return i >= 0 && found[i] !== c ? i : n; }),
    im: c.imp.map((n) => { const i = resolve(c.file, n); return i >= 0 ? i : n; }),
  }));
  let grew = true;
  for (let pass = 0; pass < 4 && grew; pass++) {
    grew = false;
    for (const i of [...keep]) {
      for (const t of [...resolved[i].x, ...resolved[i].im, ...found[i].deps.map((d) => d[1])]) if (typeof t === 'number' && !keep.has(t)) { keep.add(t); grew = true; }
    }
  }
  const order = [...keep].sort((a, b) => a - b);
  const newIdx = new Map(order.map((old, i) => [old, i]));
  const ref = (t) => (typeof t === 'number' ? newIdx.get(t) ?? found[t].name : t);
  const inherited = (c, name, seen = new Set()) => {
    // the field's type, looked up through the classes this one extends
    if (seen.has(c)) return null;
    seen.add(c);
    const own = c.fieldType.get(name);
    if (own) return own;
    for (const t of resolved[found.indexOf(c)].x) if (typeof t === 'number') { const up = inherited(found[t], name, seen); if (up) return up; }
    return null;
  };
  const NOISE = /^_?(log|logger|logging|tracer|metrics?)$/i;
  const classes = order.map((old) => {
    const c = found[old];
    return {
      n: c.name, k: c.kind, f: c.file, l: c.line, ...(c.st ? { st: c.st } : {}), ...(onMap.has(c.file) ? {} : { off: 1 }),
      ...(resolved[old].x.length ? { x: resolved[old].x.map(ref) } : {}),
      ...(resolved[old].im.length ? { im: resolved[old].im.map(ref) } : {}),
      ...(c.deps.length ? { d: c.deps.map(([name, t, how]) => [name, newIdx.get(t), how]) } : {}),
      a: c.fields.map((f) => [f.vis, f.name, cut(f.type || '', 70), f.flags]),
      m: c.methods.map((m) => {
        const calls = [];
        for (const call of m.calls || []) {
          if (call.key) {
            const e = dataKey.get(call.key);
            // a field of this class with the same name is that field, not a table
            if (e !== undefined && !c.fieldType.has(call.key)) calls.push([-2, e, call.op]);
            continue;
          }
          if (!call.field) { if (call.method !== m.name) calls.push([-1, call.method]); continue; }
          if (NOISE.test(call.field.replace(/^#/, ''))) continue;
          const t = inherited(c, call.field);
          if (!t) continue;
          if (t.idx >= 0 && newIdx.has(t.idx)) calls.push([newIdx.get(t.idx), call.method]);
          else { const name = typeNames(t.type)[0]; if (name && !/log/i.test(name)) calls.push([-3, name, call.method]); }
        }
        return [m.vis, m.name, m.params, m.ret, m.flags, m.line, ...(calls.length ? [calls] : [])];
      }),
    };
  });
  const binds = [];
  const bindSeen = new Set();
  for (const [what, impl, file] of bindings) {
    const a = newIdx.get(resolve(file, what)), b = newIdx.get(resolve(file, impl));
    if (a === undefined || b === undefined || a === b || bindSeen.has(`${a}|${b}`)) continue;
    bindSeen.add(`${a}|${b}`);
    binds.push([a, b]);
  }
  if (!classes.length && !outEntities.length) return null;
  return {
    classes, entities: outEntities, rels, ...(binds.length ? { binds } : {}),
    counts: { classes: classes.filter((c) => c.k !== 'i').length, interfaces: classes.filter((c) => c.k === 'i').length, entities: outEntities.length },
  };
}
