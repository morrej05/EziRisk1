import { describe, expect, it } from 'vitest';
import {
  filterReRecommendationsByScope,
  isReRecommendationsRegisterModule,
} from './moduleRecommendationFilters';

const recommendations = [
  { module_instance_id: 're03' },
  { module_instance_id: 're06' },
  { module_instance_id: null },
];

describe('filterReRecommendationsByScope', () => {
  it('returns only exact module_instance_id matches for module scope', () => {
    const scoped = filterReRecommendationsByScope(recommendations, {
      scope: 'module',
      moduleInstanceId: 're03',
    });

    expect(scoped).toEqual([{ module_instance_id: 're03' }]);
  });

  it('excludes null-attribution rows from module scope', () => {
    const scoped = filterReRecommendationsByScope(recommendations, {
      scope: 'module',
      moduleInstanceId: 're06',
    });

    expect(scoped.some((r) => r.module_instance_id === null)).toBe(false);
  });

  it('returns document-wide recommendations when requested', () => {
    const scoped = filterReRecommendationsByScope(recommendations, {
      scope: 'document',
      moduleInstanceId: 're03',
    });

    expect(scoped).toEqual(recommendations);
  });

  it('returns document-wide recommendations for RE-09 register module', () => {
    const scoped = filterReRecommendationsByScope(recommendations, {
      scope: 'module',
      moduleInstanceId: 're13',
      isRegisterModule: true,
    });

    expect(scoped).toEqual(recommendations);
  });
});

describe('isReRecommendationsRegisterModule', () => {
  it('recognises RE_13_RECOMMENDATIONS as register module', () => {
    expect(isReRecommendationsRegisterModule('RE_13_RECOMMENDATIONS')).toBe(true);
  });

  it('does not treat RE_03_OCCUPANCY as register module', () => {
    expect(isReRecommendationsRegisterModule('RE_03_OCCUPANCY')).toBe(false);
  });
});
