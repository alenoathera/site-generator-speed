// Fast drop-in for makefun-site 1.0.0

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HTML_TEST = /[&<>"']/;

export function escapeHtml(text) {
  return HTML_TEST.test(text) ? text.replace(/[&<>"']/g, (c) => ESCAPES[c]) : text;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function slugify(text, cache) {
  if (cache) {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
  }
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  const res = out === '' ? 'untitled' : out;
  if (cache) cache.set(text, res);
  return res;
}

export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const REPORT_FILE = 'build-report.txt';
const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// --- Front Matter ---
const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  if (text === '---') return { error: 'the front matter is not closed' };

  let closeIdx = -1;
  let bodyStart = -1;
  let searchFrom = 4;
  while (true) {
    const idx = text.indexOf('\n---', searchFrom);
    if (idx === -1) return { error: 'the front matter is not closed' };
    if (idx + 4 === text.length) {
      closeIdx = idx;
      bodyStart = text.length;
      break;
    }
    if (text.charCodeAt(idx + 4) === 10) {
      closeIdx = idx;
      bodyStart = idx + 5;
      break;
    }
    searchFrom = idx + 4;
  }

  const fmLines = text.slice(4, closeIdx).split('\n');
  const data = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${i + 2} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(bodyStart) };
}

// --- Markdown ---
const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const QUOTE = /^>/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraphFast(line) {
  if (line.length === 0) return true;
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) return BLANK.test(line);
  if (c === 96) return FENCE_OPEN.test(line);
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return HR.test(line);
  return false;
}

const trimLine = (line) => line.replace(/^[ \t]+|[ \t]+$/g, '');

function lex(src) {
  const lines = src.split('\n');
  const tokens = [];
  let i = 0;
  const numLines = lines.length;
  while (i < numLines) {
    const line = lines[i];
    if (line.length === 0 || ((line.charCodeAt(0) === 32 || line.charCodeAt(0) === 9) && BLANK.test(line))) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 96) {
      const fence = FENCE_OPEN.exec(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < numLines && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
        i++;
        tokens.push({ type: 'code', lang: fence[1], lines: body });
        continue;
      }
    }
    if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        tokens.push({ type: 'heading', depth: heading.depth, text: heading.text });
        i++;
        continue;
      }
    }
    if (c0 === 45 || c0 === 42) {
      if (HR.test(line)) {
        tokens.push({ type: 'hr' });
        i++;
        continue;
      }
    }
    if (c0 === 62) {
      const body = [];
      while (i < numLines && lines[i].charCodeAt(0) === 62) body.push(lines[i++].replace(/^> ?/, ''));
      tokens.push({ type: 'blockquote', lines: body.map(trimLine).filter((l) => l !== '') });
      continue;
    }
    if (c0 === 45 || c0 === 42 || (c0 >= 48 && c0 <= 57)) {
      const bullet = BULLET.exec(line);
      const ordered = bullet === null ? ORDERED.exec(line) : null;
      if (bullet !== null || ordered !== null) {
        const isOrdered = ordered !== null;
        const marker = isOrdered ? ORDERED : BULLET;
        const items = [];
        while (i < numLines) {
          const m = marker.exec(lines[i]);
          if (m !== null) {
            items.push([trimLine(isOrdered ? m[2] : m[1])]);
            i++;
          } else if (CONTINUED.test(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        tokens.push({ type: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: items.map((parts) => parts.join('\n')) });
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < numLines && !endsParagraphFast(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({ type: 'paragraph', text: body.join('\n') });
  }
  return tokens;
}

const ESCAPABLE_CODES = new Uint8Array(128);
for (const c of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) {
  ESCAPABLE_CODES[c.charCodeAt(0)] = 1;
}
const SPECIAL_CODES = new Uint8Array(128);
for (const c of ['\\', '`', '*', '[', '&', '<', '>', '"', "'"]) {
  SPECIAL_CODES[c.charCodeAt(0)] = 1;
}

function findUnescaped(s, what, from) {
  const whatLen = what.length;
  const sLen = s.length;
  for (let j = from; j <= sLen - whatLen; j++) {
    const code = s.charCodeAt(j);
    if (code === 92 && j + 1 < sLen && ESCAPABLE_CODES[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  const sLen = s.length;
  for (let j = from; j < sLen; j++) {
    const code = s.charCodeAt(j);
    if (code === 92 && j + 1 < sLen && ESCAPABLE_CODES[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (code !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

function inline(s, env) {
  let out = '';
  let i = 0;
  const len = s.length;
  let runStart = 0;
  while (i < len) {
    const code = s.charCodeAt(i);
    if (code >= 128 || !SPECIAL_CODES[code]) {
      i++;
      continue;
    }
    if (i > runStart) out += s.slice(runStart, i);

    if (code === 92) {
      if (i + 1 < len && s.charCodeAt(i + 1) < 128 && ESCAPABLE_CODES[s.charCodeAt(i + 1)]) {
        const nextChar = s[i + 1];
        out += nextChar === '>' ? '&gt;' : nextChar;
        i += 2;
        runStart = i;
        continue;
      }
    } else if (code === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out += '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
        runStart = i;
        continue;
      } else {
        out += '`';
        i++;
        runStart = i;
        continue;
      }
    } else if (code === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          out += '<strong>' + inline(s.slice(i + 2, j), env) + '</strong>';
          i = j + 2;
          runStart = i;
          continue;
        } else {
          out += '**';
          i += 2;
          runStart = i;
          continue;
        }
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        out += '<em>' + inline(s.slice(i + 1, j), env) + '</em>';
        i = j + 1;
        runStart = i;
        continue;
      } else {
        out += '*';
        i++;
        runStart = i;
        continue;
      }
    } else if (code === 91) {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        out += '<a href="' + escapeHtml(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
        i = m + 1;
        runStart = i;
        continue;
      }
      out += '[';
      i++;
      runStart = i;
      continue;
    } else if (code === 38) {
      out += '&amp;';
      i++;
      runStart = i;
      continue;
    } else if (code === 60) {
      out += '&lt;';
      i++;
      runStart = i;
      continue;
    } else if (code === 62) {
      out += '&gt;';
      i++;
      runStart = i;
      continue;
    } else if (code === 34) {
      out += '&quot;';
      i++;
      runStart = i;
      continue;
    } else if (code === 39) {
      out += '&#39;';
      i++;
      runStart = i;
      continue;
    }
    out += s[i];
    i++;
    runStart = i;
  }
  if (i > runStart) out += s.slice(runStart, i);
  return out;
}

function renderMarkdown(src, env, slugCache) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  for (const t of lex(src)) {
    switch (t.type) {
      case 'heading': {
        const id = uniqueSlug(slugify(t.text, slugCache), ids);
        const html = inline(t.text, env);
        blocks.push(`<h${t.depth} id="${id}">${html}</h${t.depth}>`);
        if (t.depth === 2 || t.depth === 3) toc.push({ level: t.depth, id, html });
        break;
      }
      case 'code': {
        const cls = t.lang === '' ? '' : ` class="language-${escapeHtml(t.lang)}"`;
        blocks.push(`<pre><code${cls}>${t.lines.map((l) => `${escapeHtml(l)}\n`).join('')}</code></pre>`);
        break;
      }
      case 'hr':
        blocks.push('<hr>');
        break;
      case 'blockquote':
        blocks.push(t.lines.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(t.lines.join('\n'), env)}</p>\n</blockquote>`);
        break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        const open = t.ordered && t.start !== 1 ? `<ol start="${t.start}">` : `<${tag}>`;
        blocks.push(`${open}\n${t.items.map((item) => `<li>${inline(item, env)}</li>\n`).join('')}</${tag}>`);
        break;
      }
      case 'paragraph': {
        const html = inline(t.text, env);
        if (excerpt === null) excerpt = html;
        blocks.push(`<p>${html}</p>`);
        break;
      }
    }
  }
  return { html: blocks.map((b) => `${b}\n`).join(''), toc, excerpt: excerpt ?? '' };
}

// --- Templates ---
class TemplateError extends Error {}

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function lookup1(scope, p0) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, p0)) s = s.parent;
  if (s === null) return undefined;
  return s.vars[p0];
}

function lookup2(scope, p0, p1) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, p0)) s = s.parent;
  if (s === null) return undefined;
  const v = s.vars[p0];
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, p1)) return undefined;
  return v[p1];
}

function lookupN(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

let varCounter = 0;
function compileNodes(nodes, strings) {
  const parts = [];
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': {
        const idx = strings.length;
        strings.push(n.text);
        parts.push(`out += strings[${idx}];`);
        break;
      }
      case 'var': {
        const p = n.path;
        if (p.length === 1) {
          parts.push(`out += escape(textOf(lookup1(scope, ${JSON.stringify(p[0])})));`);
        } else if (p.length === 2) {
          parts.push(`out += escape(textOf(lookup2(scope, ${JSON.stringify(p[0])}, ${JSON.stringify(p[1])})));`);
        } else {
          parts.push(`out += escape(textOf(lookupN(scope, ${JSON.stringify(p)})));`);
        }
        break;
      }
      case 'raw': {
        const p = n.path;
        if (p.length === 1) {
          parts.push(`out += textOf(lookup1(scope, ${JSON.stringify(p[0])}));`);
        } else if (p.length === 2) {
          parts.push(`out += textOf(lookup2(scope, ${JSON.stringify(p[0])}, ${JSON.stringify(p[1])}));`);
        } else {
          parts.push(`out += textOf(lookupN(scope, ${JSON.stringify(p)}));`);
        }
        break;
      }
      case 'if': {
        const p = n.path;
        const getVal = p.length === 1 ? `lookup1(scope, ${JSON.stringify(p[0])})` :
                       p.length === 2 ? `lookup2(scope, ${JSON.stringify(p[0])}, ${JSON.stringify(p[1])})` :
                       `lookupN(scope, ${JSON.stringify(p)})`;
        const cond = n.not ? `!truthy(${getVal})` : `truthy(${getVal})`;
        parts.push(`if (${cond}) { ${compileNodes(n.then, strings)} }`);
        if (n.else !== null) {
          parts.push(`else { ${compileNodes(n.else, strings)} }`);
        }
        break;
      }
      case 'for': {
        const p = n.path;
        const getVal = p.length === 1 ? `lookup1(scope, ${JSON.stringify(p[0])})` :
                       p.length === 2 ? `lookup2(scope, ${JSON.stringify(p[0])}, ${JSON.stringify(p[1])})` :
                       `lookupN(scope, ${JSON.stringify(p)})`;
        const inner = compileNodes(n.body, strings);
        const pScopeVar = 'pScope_' + (++varCounter);
        const xsVar = 'xs_' + varCounter;
        const iVar = 'i_' + varCounter;
        const lenVar = 'len_' + varCounter;
        parts.push(`{
          const ${xsVar} = ${getVal};
          if (Array.isArray(${xsVar})) {
            const ${pScopeVar} = scope;
            const ${lenVar} = ${xsVar}.length;
            for (let ${iVar} = 0; ${iVar} < ${lenVar}; ${iVar}++) {
              const scope = { vars: { ${JSON.stringify(n.name)}: ${xsVar}[${iVar}], loop: { index: ${iVar} + 1, first: ${iVar} === 0, last: ${iVar} === ${lenVar} - 1, length: ${lenVar} } }, parent: ${pScopeVar} };
              ${inner}
            }
          }
        }`);
        break;
      }
      case 'include': {
        parts.push(`{
          const fn = ctx.compiled.get(${JSON.stringify(n.name)});
          if (fn !== undefined && depth < 8) out += fn(scope, ctx, depth + 1);
        }`);
        break;
      }
    }
  }
  return parts.join('\n');
}

function compileTemplate(nodes) {
  const strings = [];
  const body = compileNodes(nodes, strings);
  return new Function('strings', 'lookup1', 'lookup2', 'lookupN', 'truthy', 'textOf', 'escape', `
    return function render(scope, ctx, depth) {
      let out = "";
      ${body}
      return out;
    };
  `)(strings, lookup1, lookup2, lookupN, truthy, textOf, escapeHtml);
}

// --- Main build / run ---
export function run(input) {
  const slugCache = new Map();
  const compiled = new Map();
  const validTemplates = new Set();
  const report = [];

  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      const nodes = parseTemplate(name, input.templates[name]);
      validTemplates.add(name);
      compiled.set(name, compileTemplate(nodes));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const sources = [];
  const statics = [];
  const staticPaths = new Set();
  const bySource = new Map();
  const broken = new Set();
  const output = {};

  // 1. readSources
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    } else {
      statics.push({ path: f.path, content: f.content });
      staticPaths.add(f.path);
    }
  }

  // 2. frontMatter
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!validTemplates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. permalinks
  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    return set;
  };

  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, slugCache), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. markdown
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. collections
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  const postLen = posts.length;
  for (let k = 0; k < postLen; k++) {
    const p = posts[k];
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === postLen - 1 ? null : posts[k + 1];
  }

  // 6. tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    return (s.data.tags ?? []).filter((name) => {
      const sl = slugify(name, slugCache);
      if (seen.has(sl)) return false;
      seen.add(sl);
      return true;
    });
  };

  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }

  for (const s of kept) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const sl = slugify(name, slugCache);
        const tag = bySlug.get(sl);
        return tag !== undefined ? tag : { name, slug: sl, url: '', posts: [] };
      });
    }
  }

  const tagList = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. layouts
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) });

  function cardOf(s) {
    return {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
  }

  function pageOf(s) {
    return {
      ...cardOf(s),
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
  }

  const cards = new Map();
  for (const p of posts) {
    cards.set(p, cardOf(p));
  }

  const site = { title: input.site.title, base_url: base };
  const allTags = tagList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));

  const ctx = { compiled, escape: escapeHtml };
  const sharedBaseScope = { vars: { site, tags: allTags, recent }, parent: null };

  const render = (name, vars) => {
    const fn = compiled.get(name);
    return fn === undefined ? null : fn({ vars, parent: sharedBaseScope }, ctx, 0);
  };

  for (const s of kept) {
    output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  }

  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }

  for (const t of tagList) {
    const html = render('tag', { tag: tagOf(t) });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }

  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;

  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. report
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pCount} pages, ${posts.length} posts, ${tagList.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;

  return output;
}
