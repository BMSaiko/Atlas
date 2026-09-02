// test/sanitize-stdio.test.mjs
// Cobre o helper sanitize() em server/api.ts (byte-level filter C1 0x80-0x9F + U+FFFD no stdout/stderr do child).
// SOURCE EQUALITY + 12 assercoes de comportamento.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const apiSrc = readFileSync(join(repoRoot, 'server', 'api.ts'), 'utf8')

// ponytail: byte-level mirror of server/api.ts::sanitize
function sanitize(d) {
  return Buffer.from(d.toString('utf8').replace(/[\u0080-\u009F\uFFFD]/g, ''), 'utf8')
}

let failures = 0
const ok = (cond, msg) => { if (cond) console.log('  ok:', msg); else { console.error('  FAIL:', msg); failures++ } }

ok(sanitize(Buffer.from([0x80])).length === 0, 'lone 0x80 dropped')
ok(sanitize(Buffer.from([0x9B, 0x5B, 0x32, 0x4A])).length === 3, 'CSI: 0x9B dropped, rest kept')
ok(sanitize(Buffer.from('ola mundo\n')).toString('utf8') === 'ola mundo\n', 'utf-8 text intact')
ok(sanitize(Buffer.from([0xc3, 0xa7, 0x0a])).toString('utf8') === '\u00e7\n', 'c3 a7 (UTF-8 ç) preserved')
ok(sanitize(Buffer.from('before\u0080after')).toString('utf8') === 'beforeafter', 'mid 0x80 dropped')
ok(sanitize(Buffer.from([0x80, 0x81, 0x82, 0x83, 0x9f])).length === 0, 'all 5 C1 controls dropped')
ok(sanitize(Buffer.from('HTTP/1.1 200 OK\r\n[0x80]done\n')).toString('utf8').includes('HTTP/1.1'), 'real chunk text preserved')
ok(!sanitize(Buffer.from('HTTP/1.1 200 OK\r\n[0x80]done\n')).toString('utf8').includes('\u0080'), 'real chunk 0x80 dropped')
ok(sanitize(Buffer.from('\n\t')).length === 2, 'C0 0x00-0x1F preserved (\n\t)')
ok(sanitize(Buffer.from([0xC2, 0xA7])).toString('utf8') === '\u00a7', 'UTF-8 >= 0xA0 preserved (\u00a7)')
ok(sanitize(Buffer.from([0x48, 0x69, 0x80, 0x21])).toString('utf8') === 'Hi!', '0x80 mid-stream dropped, no replacement char')
ok(sanitize(Buffer.from('Portugu\u00eas!')).toString('utf8').includes('Portugu'), 'multi-byte UTF-8 (Português) survives')

console.log('\n[13] SOURCE EQUALITY')
ok(apiSrc.includes("function sanitize(d: Buffer): Buffer"), 'helper exists')
ok(apiSrc.includes("[\\u0080-\\u009F\\uFFFD]"), 'regex covers C1 + U+FFFD')
ok(apiSrc.includes("ws.write(sanitize(d))"), 'apply in stdout/stderr (2 sites)')
ok((apiSrc.match(/ws\.write\(sanitize\(d\)\)/g) || []).length === 8, '8 call sites (4 launch* wrappers x 2 stdout+stderr)')

// ponytail: card t02krhls — endpoints que re-leem o .log file e devolvem-no a UI tb devem sanitize
ok(apiSrc.includes('function _sanitizeText('), '_sanitizeText helper exists')
ok((apiSrc.split("_sanitizeText(await readFile(logPath, 'utf8'))").length - 1) === 3, '3 _sanitizeText reads (2 /orphans + 1 /output/:cardId)')
ok(apiSrc.includes('full = _sanitizeText(await readFile(logPath, \'utf8\'))'), '_sanitizeText in /output/:cardId read')

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ': ' + failures + ' failures')
process.exit(failures === 0 ? 0 : 1)
