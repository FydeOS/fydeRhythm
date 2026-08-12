// Whether the microphone button is offered at all.
//
// Every clause here hides the button rather than showing one that fails when
// pressed: a control that does nothing, or produces nonsense, costs more trust
// than an absent one.

import { kVoiceOffered } from './credentials';
import { schemaDictatable } from './dictatable-schemas';
import type { MicPermission } from './permission';

export interface VoiceAvailability {
  /** Credentials exist — the user's stored key or one baked in at build time.
   *  A keyless build ships the voice code but never offers the button. */
  configured: boolean;
  /** The options-page switch. */
  enabled: boolean;
  /** The active schema. Dictation is offered on the schemas the model can
   *  actually transcribe, listed by id in dictatable-schemas.ts — the guessed
   *  `script` cannot answer this, since it reads 'zh' for every language nobody
   *  thought to exclude. An id is also known from the first snapshot, before the
   *  schema's display name has been resolved, so the button does not appear a
   *  moment late or briefly appear wrongly. */
  schemaId: string;
  /** Focused field is a password box. */
  passwordField: boolean;
  /** Only 'denied' hides the button; 'prompt' still reaches a grant. */
  permission: MicPermission;
}

export function voiceAvailable(state: VoiceAvailability): boolean {
  if (!kVoiceOffered) return false;
  if (!state.configured || !state.enabled) return false;
  if (state.permission === 'denied') return false;
  // Never in a password box: the user would speak their password aloud and the
  // audio would be uploaded to a third party.
  if (state.passwordField) return false;
  return schemaDictatable(state.schemaId);
}

/** ASCII mode deliberately does not appear above: the Chinese model handles
 *  mixed Chinese/English natively, so switching to English input is no reason
 *  to withdraw dictation or to select a different resource. */
