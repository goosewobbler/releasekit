import { describe, expect, it } from 'vitest';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import {
  checkLengthBounds,
  checkPastTenseLeaning,
  findDuplicateDependencyChurn,
  findMarkerLeaks,
} from './assertions.js';
import { evalProvider, isLiveMode, loadGoldenCase } from './harness.js';

/**
 * Golden-fixture eval for the LLM-notes pipeline. Runs a real commit set through the real pipeline and
 * checks the output against deterministic quality assertions. By default the provider response is
 * replayed from a committed cache fixture (no keys, deterministic); with RELEASEKIT_EVAL=1 it runs a
 * live model, and with RELEASEKIT_EVAL_RECORD=1 it re-seeds the fixture from the recorded markdown.
 * The assertions are the regression net — they hold whether the response is replayed or freshly
 * generated, so a prompt or post-processing change that degrades output is caught.
 */
describe('notes eval: release notes', () => {
  it(
    'should generate clean release notes for the basic golden case',
    async () => {
      const golden = loadGoldenCase('release-notes-basic');
      const provider = await evalProvider('release-notes-basic');

      const notes = await generateReleaseNotes(provider, golden.entries, golden.context);

      expect(findMarkerLeaks(notes)).toEqual([]);
      expect(findDuplicateDependencyChurn(notes)).toEqual([]);
      expect(checkLengthBounds(notes, 80, 4000)).toEqual([]);
      expect(checkPastTenseLeaning(notes)).toEqual([]);
    },
    isLiveMode ? 180_000 : 10_000,
  );
});
