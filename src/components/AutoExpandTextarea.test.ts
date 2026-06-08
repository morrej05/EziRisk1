import { describe, expect, it } from 'vitest';
import { getAutoExpandTextareaHeight } from './AutoExpandTextarea';

describe('getAutoExpandTextareaHeight', () => {
  it('returns the minimum height when content is short', () => {
    expect(getAutoExpandTextareaHeight(24, 3)).toBe(92);
  });

  it('expands to the scroll height for text-heavy content', () => {
    expect(getAutoExpandTextareaHeight(240, 3)).toBe(240);
  });
});
