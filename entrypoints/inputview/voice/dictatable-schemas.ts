// The schemas dictation is offered on, by id.
//
// An allowlist, because the alternative was measured and does not work. A
// schema's id and name describe its romanisation convention, not the language
// its typist speaks: 湘语邵东话拼音, 潮语拼音 and 中古拼音 all carry 拼音 while
// naming languages the model cannot transcribe, and 河童五笔 carries 五笔 while
// being Japanese. Keyword rules in either direction get all four wrong.
//
// So an unlisted schema gets no microphone. That direction is deliberate: a
// missing button is a question ("why no voice on my schema?"), while a button
// that answers Cantonese speech with Mandarin text, or Tibetan speech with Han,
// reads as a broken feature. Adding a schema here is a one-line change.
//
// Membership follows 豆包语音 流式语音识别WebSocket p.9: with `language` unset —
// and it must be unset, the parameter is nostream-only while we run two-pass
// recognition — the model covers 中英文、上海话、闽南语、四川、陕西、粤语、冀鲁、
// 兰银、江淮. Mandarin, Cantonese, Shanghainese and every shape-based schema are
// in; 客语, 湘语, 潮州话 and reconstructed 古音 are not, however Chinese they
// look. Nor is any schema whose output is not Han text — IPA, 注音文, digits —
// since recognised Han would be wrong there whatever the language.
//
// Ids are matched exactly, never by prefix: `bopomofo_script` writes ㄅㄆㄇ
// rather than Han, and a prefix rule would readmit it under `bopomofo`.
//
// Sources: our own catalogue (schema-list.yaml) and every recipe in rime/rppi,
// audited in tests/voice-schema-coverage.test.ts against the whole index.

const kDictatableSchemas: ReadonlySet<string> = new Set([
  // 极光拼音, 倉頡三代, 五笔 98 — ours only, absent from rppi.
  'aurora_pinyin', 'cangjie3', 'wubi98_dz', 'wubi98_ci',

  // 普通话/官话 — rime/rime-luna-pinyin, rime-double-pinyin, rime-pinyin-simp,
  // rime-terra-pinyin, rime-bopomofo, rime-combo-pinyin, rime-stenotype,
  // lotem/rime-c2h6-pinyin, xiaobai9978/rime-xiaobai_simp.
  'luna_pinyin', 'luna_pinyin_fluency', 'luna_pinyin_simp', 'luna_pinyin_tw', 'luna_quanpin',
  'double_pinyin', 'double_pinyin_abc', 'double_pinyin_flypy', 'double_pinyin_mspy',
  'double_pinyin_pyjj', 'double_pinyin_ziguang',
  'pinyin_simp', 'terra_pinyin', 'bopomofo', 'bopomofo_express',
  'combo_pinyin', 'combo_pinyin_8', 'combo_pinyin_9', 'combo_pinyin_10',
  'stenotype', 'c2h6_pinyin', 'xiaobai_simp',
  // 中原官话 (`zhung*`) is Mandarin but not one of the groups the spec names,
  // and 韩官话 (`handarin`) is typed from Korean readings. Both stay out.

  // 粤语 — rime/rime-cantonese, leimaau/naamning_jyutping. The `_ipa` variants
  // of both emit IPA symbols, so they are excluded.
  'jyut6ping3', 'naamning_baakwaa', 'naamning_bingwaa',

  // 吴语 — rime/rime-wugniu. 上海话 is what the spec names, so 苏州吴语
  // (`soutzoe`) stays out.
  'wugniu', 'wugniu_lopha',

  // 字形 — typed by Mandarin speakers, so the model serves them all.
  // rime/rime-wubi, rime-cangjie, rime-stroke, rime-array, rime-scj,
  // rime-quick, KyleBing/rime-wubi86-jidian, lotem/rime-zhengma, rime-wubi98,
  // rime-linguistic-wubi, rime-guhuwubi, amorphobia/rime-jiandao,
  // amorphobia/openfly, miounet/rime-kmm, 0ZDragon/rime-huma,
  // bigshans/rime-zrm, pingshunhuangalex/rime-keydo, zongxinbo/rime-zong,
  // ksqsf/rime-moran, mirtlecn/rime-radical-pinyin.
  'wubi86', 'wubi_pinyin', 'wubi_trad', 'wubi98',
  'cangjie5', 'cangjie5_express', 'scj6', 'quick5', 'stroke',
  'array30', 'array30_query', 'array30_wsymbols',
  'wubi86_jidian', 'wubi86_jidian_pinyin', 'wubi86_jidian_trad', 'wubi86_jidian_trad_pinyin',
  'zhengma', 'linguistic_wubi', 'guhuwubi', 'jiandao', 'openfly', 'kongmingma',
  'tiger', 'tigress', 'zrm_pinyin', 'keydo', 'sjhm',
  'moran', 'moran_sentence', 'moran_fixed', 'radical_pinyin',
  // `numbers`, shipped alongside 极点五笔, writes digits rather than Han.

  // 英语 and 雾凇拼音 — sdadonkey/rime-english, iDvel/rime-ice. English is
  // covered because the default model is 中英文, not by a separate resource.
  'english', 'rime_ice', 'liangfen', 'melt_eng',
]);

/** Whether the ASR model can transcribe what this schema is typed in. */
export function schemaDictatable(schemaId: string): boolean {
  return kDictatableSchemas.has(schemaId);
}
