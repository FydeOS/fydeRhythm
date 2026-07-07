/* global console, process */
// Generates the romaji→kana `translator/preedit_format` block for the STORE's
// jap_poly schema (schema/jap_poly/build/jap_poly.schema.yaml in the bucket).
// Upstream ships with preedit_format commented out, so the inline preedit
// shows raw romaji; these rules make it display the kana being typed. This is
// a schema-layer fix — the extension deliberately stays schema-agnostic, like
// other Rime frontends (see rime/weasel style/preedit_type for the generic
// frontend alternative). Run: node scripts/gen-jap-poly-preedit.mjs

const vowels = ['a', 'i', 'u', 'e', 'o'];

// 五十音 rows in poly's base (kunrei) spellings: si/ti/tu/hu.
const rows = {
    k: 'かきくけこ', g: 'がぎぐげご',
    s: 'さしすせそ', z: 'ざじずぜぞ',
    t: 'たちつてと', d: 'だぢづでど',
    n: 'なにぬねの', h: 'はひふへほ',
    b: 'ばびぶべぼ', p: 'ぱぴぷぺぽ',
    m: 'まみむめも', r: 'らりるれろ',
};

// 拗音: Cya/Cyu/Cyo → い-column kana + small ゃゅょ.
const youonI = {
    k: 'き', g: 'ぎ', s: 'し', z: 'じ', t: 'ち', d: 'ぢ',
    n: 'に', h: 'ひ', b: 'び', p: 'ぴ', m: 'み', r: 'り',
};

const xform = (from, to) => `xform/${from}/${to}/`;
const rules = [];

// 1. x-prefixed small kana — before anything else eats the trailing chars.
rules.push(xform('xtu', 'っ'), xform('xya', 'ゃ'), xform('xyu', 'ゅ'), xform('xyo', 'ょ'), xform('xwa', 'ゎ'));
['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ'].forEach((small, i) => rules.push(xform(`x${vowels[i]}`, small)));
// 2. 促音: doubled consonant → っ + consonant (kka → っka → っか).
rules.push('xform/([kgsztdnhbpmrwjfcv])\\1/っ$1/');
// 3. Hepburn spellings poly also accepts — before the rows, or "sha" hits /ha/.
for (const [from, to] of [
    ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'], ['shi', 'し'],
    ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'], ['chi', 'ち'],
    ['tsu', 'つ'], ['fu', 'ふ'],
    ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'], ['ji', 'じ'],
]) rules.push(xform(from, to));
// 4. 拗音 (kya きゃ …) — before the two-letter rows.
for (const [c, i] of Object.entries(youonI)) {
    rules.push(xform(`${c}ya`, `${i}ゃ`), xform(`${c}yu`, `${i}ゅ`), xform(`${c}yo`, `${i}ょ`));
}
// 5. Two-letter syllables: rows, や行, わ行 (historical ゐゑ), ゔ.
for (const [c, kana] of Object.entries(rows)) {
    [...kana].forEach((k, i) => rules.push(xform(`${c}${vowels[i]}`, k)));
}
rules.push(xform('ya', 'や'), xform('yu', 'ゆ'), xform('yo', 'よ'));
rules.push(xform('wa', 'わ'), xform('wi', 'ゐ'), xform('we', 'ゑ'), xform('wo', 'を'));
rules.push(xform('vu', 'ゔ'));
// 6. Bare vowels, syllable-final ん, ー; drop the ' delimiter.
['あ', 'い', 'う', 'え', 'お'].forEach((k, i) => rules.push(xform(vowels[i], k)));
rules.push(xform('n', 'ん'), xform('-', 'ー'), "xform/'//");

// --- self-check: simulate librime's sequential xform application ---
function apply(preedit) {
    let s = preedit;
    for (const rule of rules) {
        const m = /^xform\/(.*?)\/(.*?)\/$/.exec(rule);
        s = s.replace(new RegExp(m[1], 'g'), m[2]);
    }
    return s;
}
const checks = [
    ['kana', 'かな'], ['sika', 'しか'], ['kanzi', 'かんじ'], ['nihon', 'にほん'],
    ['gakkou', 'がっこう'], ['toukyou', 'とうきょう'], ['xtu', 'っ'], ['sixyo', 'しょ'],
    ['ra-men', 'らーめん'], ['wi', 'ゐ'], ['vu', 'ゔ'],
    ['shinbun', 'しんぶん'], ['ocha', 'おちゃ'], ['tsunami', 'つなみ'], ['fuji', 'ふじ'],
    ["si'ka", 'しか'], ['k', 'k'], ['kak', 'かk'],
];
let failed = 0;
for (const [input, expected] of checks) {
    const got = apply(input);
    if (got !== expected) { console.error(`FAIL ${input} → ${got} (expected ${expected})`); failed++; }
}
if (failed) process.exit(1);
console.log(`self-check: ${checks.length}/${checks.length} ok\n`);

// --- emit the YAML block to merge into the store's jap_poly.schema.yaml ---
console.log('# Add under the existing `translator:` section of');
console.log('# schema/jap_poly/build/jap_poly.schema.yaml in the store bucket:');
console.log('  preedit_format:');
for (const r of rules) console.log(`    - "${r.replace(/\\/g, '\\\\')}"`);
