// Every schema plum can install, and whether our ASR model can transcribe the
// language each one is typed in.
//
// The raw list is rppi-index.json — the whole rime/rppi package index, upstream
// data kept verbatim so it can be refreshed without re-deciding anything. The
// judgment lives here, in code a reviewer can argue with.
//
// The criterion is 豆包语音 流式语音识别WebSocket p.9: with `language` unset —
// and it must be unset, that parameter is nostream-only while we run the two-pass
// mode — the model covers 中英文、上海话、闽南语、四川、陕西、粤语、冀鲁、兰银、
// 江淮 and nothing else. Everything below follows from that one sentence.

import { readFileSync } from 'node:fs';

import type { ScriptId } from '@/lib/shared-types';

export interface CatalogueSample {
  id: string;
  name: string;
  /** The language the schema is typed in. */
  script: ScriptId;
}

/** The schemas we list for installation, from
 *  fydeos-update.oss-cn-beijing.aliyuncs.com/fyderhythm/schema-list.yaml. */
export const kCatalogue: CatalogueSample[] = [
  { id: 'aurora_pinyin', name: '极光拼音', script: 'zh' },
  { id: 'rime_ice', name: '雾凇拼音', script: 'zh' },
  { id: 'double_pinyin_flypy', name: '小鹤双拼', script: 'zh' },
  { id: 'double_pinyin_mspy', name: '微软双拼', script: 'zh' },
  { id: 'double_pinyin', name: '自然码双拼', script: 'zh' },
  { id: 'wubi86_jidian', name: '极点五笔 86', script: 'zh' },
  { id: 'cangjie5', name: '倉頡五代', script: 'zh' },
  { id: 'cangjie3', name: '倉頡三代', script: 'zh' },
  { id: 'luna_pinyin', name: '朙月拼音', script: 'zh' },
  { id: 'stroke', name: '笔画输入', script: 'zh' },
  { id: 'wubi98_dz', name: '五笔 98（单字输入）', script: 'zh' },
  { id: 'wubi98_ci', name: '五笔 98（词组输入）', script: 'zh' },
  { id: 'bopomofo', name: '注音', script: 'zh' },
  { id: 'jyut6ping3', name: '粵語拼音', script: 'zh' },
  { id: 'jap_poly', name: 'Poly 日文输入法', script: 'ja' },
  { id: 'korean_hanja', name: 'korean hanja', script: 'ko' },
  { id: 'hangeul2set', name: 'Hangeul2set 输入法', script: 'ko' },
  { id: 'hangeul_hnc', name: 'Hangeul hnc 输入法', script: 'ko' },
  { id: 'hangeul', name: 'Hangeul 输入法', script: 'ko' },
];

/** Which rppi categories hold a language the model transcribes. The index is
 *  grouped by exactly the distinction the spec draws, so this is a lookup
 *  rather than a guess: 粤语 and 吴语 are named, 客语 and 湘语 are not, and 古音
 *  is a reconstruction nobody speaks. 字形 schemas are typed by Mandarin
 *  speakers, and 英语 is covered because the default model is 中英文. */
const kTranscribableCategories = new Set([
  'Chinese/Mandarin',
  'Chinese/Cantonese',
  'Chinese/Wu',
  'Chinese/Shape',
  'English',
  'Collection',
]);

/** Schemas their category would wave through but the spec does not reach.
 *  Each is a decision, not an oversight. */
const kNotTranscribable = new Map<string, string>([
  // 上海话 is what the spec names; 苏州话 is a different Wu variety.
  ['soutzoe', '苏州吴语 — the spec names 上海话, not Wu at large'],
  // Mandarin, but not one of the four Mandarin groups the spec lists.
  ['zhung', '中原官话 — absent from 四川/陕西/冀鲁/兰银/江淮'],
  ['zhung_42', '中原官话'],
  ['zhung_combo', '中原官话'],
  ['zhung_combo_transcript', '中原官话'],
  ['zhung_stenotype', '中原官话'],
  ['zhung_transcript', '中原官话'],
  ['handarin', '韩官话 — typed from Korean readings'],
  // Right language, wrong alphabet: dictation returns Han text, and these
  // schemas exist precisely to emit something else.
  ['jyut6ping3_ipa', 'emits IPA, not Han'],
  ['naamning_baakwaa_ipa', 'emits IPA, not Han'],
  ['naamning_bingwaa_ipa', 'emits IPA, not Han'],
  ['numbers', 'a digits helper schema; recognised Han would be nonsense'],
]);

export interface PlumSchema {
  id: string;
  /** The recipe's display name — what the rule sees alongside the id. */
  name: string;
  category: string;
  repo: string;
  transcribable: boolean;
  /** Present when the verdict differs from the category's. */
  why?: string;
}

interface RppiIndex {
  recipes: Array<{ category: string; repo: string; name: string; schemas: string[] }>;
}

/** Every schema in the index, deduplicated: a few ids are published by more
 *  than one recipe (pinyin_simp, the double-pinyin set), and the rule cannot
 *  tell those copies apart anyway. */
export function loadPlumSchemas(): PlumSchema[] {
  const index = JSON.parse(
    readFileSync(new URL('./rppi-index.json', import.meta.url), 'utf8'),
  ) as RppiIndex;

  const seen = new Set<string>();
  const schemas: PlumSchema[] = [];
  for (const recipe of index.recipes) {
    for (const id of recipe.schemas) {
      if (seen.has(id)) continue;
      seen.add(id);
      const why = kNotTranscribable.get(id);
      schemas.push({
        id,
        name: recipe.name,
        category: recipe.category,
        repo: recipe.repo,
        transcribable: why === undefined && kTranscribableCategories.has(recipe.category),
        why,
      });
    }
  }
  return schemas;
}

/** Languages nobody has packaged for Rime, written the way a real schema would
 *  be. None carries a Japanese or Korean keyword for the rule to catch. */
export const kUnpackagedLanguages = [
  { id: 'telex_vn', name: 'Tiếng Việt Telex' },
  { id: 'bo_ewts', name: 'བོད་ཡིག EWTS' },
  { id: 'ug_kbd', name: 'ئۇيغۇرچە كۆرۈنمە' },
  { id: 'mn_bichig', name: 'Монгол бичиг' },
];
