// Whether the microphone button is offered at all.
//
// Every clause here hides the button rather than showing one that fails when
// pressed: a control that does nothing, or produces nonsense, costs more trust
// than an absent one.

import type { ScriptId } from '@/lib/shared-types';

/** Scripts the streaming endpoint can actually transcribe.
 *
 *  Chinese only, and that is a documented boundary rather than a guess. The
 *  `language` parameter is accepted solely by the non-streaming endpoint and
 *  explicitly not under second-pass recognition, so our path always runs the
 *  default model — which the API doc says covers 中英文、上海话、闽南语、四川、
 *  陕西、粤语、冀鲁、兰银、江淮. That is the Chinese-language family, which is
 *  what `script === 'zh'` selects.
 *
 *  So Cantonese and the major dialects are supported and must NOT be excluded;
 *  Japanese and Korean are not, and feeding them to a Mandarin model yields
 *  plausible-looking Chinese garbage — a feature that reads as broken, which is
 *  worse than one that is absent.
 *
 *  Japanese and Korean are reachable, just not here: `bigmodel_nostream` with
 *  an explicit `language` handles 25 languages, at the cost of live partials
 *  and of `definite`, which the whole commit design rests on.
 *
 *  What this cannot catch: a schema for a non-Chinese language whose id and
 *  name miss guessScriptForSchema's ja/ko patterns — Vietnamese, Tibetan,
 *  Uyghur, Mongolian — falls through to 'zh'. A blocklist of those would never
 *  be complete, so the options page states the supported languages instead and
 *  lets the user judge. */
const kSupportedScripts: ReadonlySet<ScriptId> = new Set<ScriptId>(['zh']);

export interface VoiceAvailability {
  /** The build carries Volcano credentials. Absent in any build made without
   *  .env — CI, a release — which is what keeps voice out of them entirely. */
  configured: boolean;
  /** The options-page switch. */
  enabled: boolean;
  script: ScriptId;
  /** Focused field is a password box. */
  passwordField: boolean;
}

export function voiceAvailable(state: VoiceAvailability): boolean {
  if (!state.configured || !state.enabled) return false;
  // Never in a password box: the user would speak their password aloud and the
  // audio would be uploaded to a third party.
  if (state.passwordField) return false;
  return kSupportedScripts.has(state.script);
}

/** ASCII mode deliberately does not appear above: the Chinese model handles
 *  mixed Chinese/English natively, so switching to English input is no reason
 *  to withdraw dictation or to select a different resource. */
export function voiceSupportsScript(script: ScriptId): boolean {
  return kSupportedScripts.has(script);
}
