import { describe, expect, it } from 'vitest';
import { stripSimpleMarkdown } from './markdownDisplay';

describe('stripSimpleMarkdown', () => {
  it('formats generated change summary markdown as plain text', () => {
    expect(stripSimpleMarkdown('# Changes Since Last Issue\n\n_No material changes since last issue._')).toBe(
      'Changes Since Last Issue\n\nNo material changes since last issue.'
    );
  });

  it('removes simple heading and emphasis tokens while preserving line breaks', () => {
    expect(stripSimpleMarkdown('## New Actions (1)\n- [P1] **Repair** _door_')).toBe(
      'New Actions (1)\nP1: Repair door'
    );
  });
});
