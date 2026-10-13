// Deliberately not a general JavaScript parser: only this fixed token grammar.
const TOKENS = ['export','function','createSchema','(','z',')','{','return','z','.','partialRecord','(','z','.','enum','(','[','string:email',',','string:push',']',')',',','z','.','boolean','(',')',')'];
const LINE = /[\n\r\u2028\u2029]/;
const SPACE = /[ \t\v\f\n\r\u2028\u2029]/;
const DIRECTIVE = /[@#]|\b(?:sourceURL|sourceMappingURL|eslint|prettier|istanbul|jshint|jslint)\b/i;
export function isFixedPatchSource(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source,'utf8') > 8192) return false;
  let i = 0;
  const tokens = [];
  while (i < source.length) {
    let newline = false;
    // Trivia is consumed between tokens, never removed from token spelling.
    while (i < source.length) {
      if (SPACE.test(source[i])) {newline ||= LINE.test(source[i]); i++; continue;}
      if (source.startsWith('//',i) || source.startsWith('/*',i)) {
        const block = source[i+1] === '*', start = i;
        i += 2;
        if (block) {
          const end = source.indexOf('*/',i);
          if (end === -1) return false;
          i = end + 2;
        } else {while (i < source.length && !LINE.test(source[i])) i++;}
        const comment = source.slice(start,i);
        if (DIRECTIVE.test(comment)) return false;
        newline ||= LINE.test(comment);
        continue;
      }
      break;
    }
    if (i === source.length) break;
    // Restricted production: ReturnStatement has no LineTerminator here,
    // including terminators inside multiline comments.
    if (tokens.at(-1) === 'return' && newline) return false;
    const c = source[i];
    if (/[A-Za-z_$]/.test(c)) {
      const start = i++;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++;
      tokens.push(source.slice(start,i));
    } else if (c === '"' || c === "'") {
      const quote = c, start = ++i;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' || LINE.test(source[i])) return false;
        i++;
      }
      if (i === source.length) return false;
      tokens.push('string:'+source.slice(start,i++));
    } else if ('().{}[],;'.includes(c)) {tokens.push(c); i++;}
    else return false;
    if (tokens.length > TOKENS.length + 5) return false;
  }
  // A single trailing comma is harmless only at these three fixed boundaries.
  const trailingCommaAfter = new Set([TOKENS.indexOf('string:push'), TOKENS.indexOf(']'), TOKENS.length - 2]);
  let end = 0;
  for (let expected = 0; expected < TOKENS.length; expected++) {
    if (tokens[end++] !== TOKENS[expected]) return false;
    if (trailingCommaAfter.has(expected) && tokens[end] === ',') end++;
  }
  if (tokens[end] === ';') end++;
  return tokens[end] === '}' && tokens.length === end + 1;
}

// Full source replacement keeps raw line bytes (including CR) and EOF state.
// No formatter or canonicalization is applied to an accepted model candidate.
export function sourceDiff(before,after) {
  const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const old = lines(before), next = lines(after);
  const section = (rows,prefix) => rows.map(line => prefix + line + (line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n')).join('');
  return '--- a/fixtures/zod-settings/schema.mjs\n+++ b/fixtures/zod-settings/schema.mjs\n' +
    `@@ -1,${old.length} +1,${next.length} @@\n` + section(old,'-') + section(next,'+');
}
