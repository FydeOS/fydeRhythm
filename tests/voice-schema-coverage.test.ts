// Which schemas the microphone is offered on, measured over every schema plum
// can install — not over a hand-picked sample.
//
// Dictation is allowlisted by schema id, so this file is what keeps the list
// honest in both directions: every schema the model can serve must keep its
// microphone, and no schema it cannot serve may have one. The shipped catalogue
// is read from disk rather than copied, so a new built-in schema fails this test
// until someone decides what voice should do on it.
//
// `script` is still checked for our own catalogue: it drives the ASCII-toggle
// badge, where a wrong guess is cosmetic, and it must not silently drift.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { schemaDictatable } from '../entrypoints/inputview/voice/dictatable-schemas';
import type { ScriptId } from '../lib/shared-types';
import { guessScriptForSchema, resolveLayoutForSchema } from '../lib/utils';
import { kCatalogue, kUnpackagedLanguages, loadPlumSchemas } from './rime-schema-samples';

/** What the badge's guess decides for a schema, exactly as the background does
 *  it: the layout is itself guessed from id+name before the script is. */
function scriptOf(id: string, name: string): ScriptId {
  return guessScriptForSchema(id, name, resolveLayoutForSchema(undefined, id, name));
}

function offersVoice(id: string): boolean {
  return schemaDictatable(id);
}

/** The shipped catalogue, minimally parsed — one `- id:`/`name:` pair per entry,
 *  which is all this file needs. */
function parseShippedList(): Array<{ id: string; name: string }> {
  const text = readFileSync(new URL('../public/builtin/schema-list.yaml', import.meta.url), 'utf8');
  const entries: Array<{ id: string; name: string }> = [];
  for (const line of text.split('\n')) {
    const id = /^\s*-\s*id:\s*(\S+)/.exec(line);
    if (id) entries.push({ id: id[1], name: '' });
    const name = /^\s*name:\s*(.+)$/.exec(line);
    if (name && entries.length) entries[entries.length - 1].name = name[1].trim();
  }
  return entries;
}

const kPlum = loadPlumSchemas();

describe('the schemas we ship', () => {
  // Narrower than it looks, and worth being honest about: this file holds only
  // the bootstrap entry (极光拼音). The catalogue users actually browse is
  // fetched at runtime from kRepoUrl into storage.local, so nothing here can
  // notice a schema added to the remote list — kCatalogue is a hand copy of it.
  // Closing that needs a script that fetches, not a unit test.
  it('classifies the built-in bootstrap schema', () => {
    const shipped = parseShippedList();
    expect(shipped.length).toBeGreaterThan(0);
    for (const schema of shipped) {
      const known = kCatalogue.find(entry => entry.id === schema.id.trim());
      expect(known, `built-in schema ${schema.id} has no expected voice verdict`).toBeDefined();
      expect(scriptOf(schema.id.trim(), schema.name)).toBe(known?.script);
    }
  });
});

describe('the schemas we list for installation', () => {
  it.each(kCatalogue)('reads $id as $script', ({ id, name, script }) => {
    expect(scriptOf(id, name)).toBe(script);
  });

  it('offers dictation on every Chinese schema and on no other', () => {
    const offered = kCatalogue.filter(entry => offersVoice(entry.id));
    expect(offered.map(entry => entry.id)).toEqual(
      kCatalogue.filter(entry => entry.script === 'zh').map(entry => entry.id),
    );
  });
});

describe('every schema in the plum index', () => {
  it('covers the whole index, so a shrunken fixture cannot pass quietly', () => {
    expect(kPlum.length).toBe(109);
    expect(kPlum.filter(schema => schema.transcribable).length).toBe(62);
  });

  // Mandarin, Cantonese, Shanghainese and the shape schemas are all inside the
  // model's own list. Each must keep its microphone.
  it.each(kPlum.filter(schema => schema.transcribable))(
    'keeps dictation on $id ($category)',
    ({ id }) => {
      expect(offersVoice(id)).toBe(true);
    },
  );

  // The other half of the allowlist's promise, and the case the old keyword rule
  // could not make: 客语, 湘语, 潮州话 and reconstructed 古音 are Chinese and
  // still unservable, 河童五笔 is Japanese with 五笔 in its name, and IPA, 注音文
  // and the digits helper emit something other than Han whatever the language.
  it.each(kPlum.filter(schema => !schema.transcribable))(
    'withholds dictation from $id ($category)',
    ({ id }) => {
      expect(offersVoice(id)).toBe(false);
    },
  );

  it('leaves nothing offered that the model cannot serve', () => {
    const wronglyOffered = kPlum.filter(schema => !schema.transcribable && offersVoice(schema.id));
    expect(wronglyOffered.map(schema => schema.id)).toEqual([]);
  });

  it('offers dictation on every schema the model can serve', () => {
    const wronglyWithheld = kPlum.filter(schema => schema.transcribable && !offersVoice(schema.id));
    expect(wronglyWithheld.map(schema => schema.id)).toEqual([]);
  });
});

describe('a language nobody has packaged for Rime', () => {
  // The point of an allowlist: the badge's guess still reads these as Chinese —
  // no keyword rule could ever catch them all — and dictation is withheld
  // anyway, because nothing ever put them on the list.
  it.each(kUnpackagedLanguages)('withholds dictation from $id', ({ id, name }) => {
    expect(scriptOf(id, name)).toBe('zh');
    expect(offersVoice(id)).toBe(false);
  });
});
