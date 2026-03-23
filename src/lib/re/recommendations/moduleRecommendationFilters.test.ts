import { describe, expect, it } from 'vitest';
import {
  filterReRecommendationsByScope,
  hasReRecommendationWorkflow,
  isReRecommendationsRegisterModule,
  shouldForceDocumentRecommendationScope,
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

describe('hasReRecommendationWorkflow', () => {
  it('disables recommendation workflow for RE-08 Loss & Values', () => {
    expect(hasReRecommendationWorkflow('RE_12_LOSS_VALUES')).toBe(false);
  });

  it('disables recommendation workflow for RE-10 Supporting Documentation', () => {
    expect(hasReRecommendationWorkflow('RE_10_SITE_PHOTOS')).toBe(false);
  });

  it('keeps recommendation workflow enabled for supported RE modules', () => {
    expect(hasReRecommendationWorkflow('RE_03_OCCUPANCY')).toBe(true);
  });
});

describe('shouldForceDocumentRecommendationScope', () => {
  it('forces document scope for RE summary module', () => {
    expect(shouldForceDocumentRecommendationScope('RISK_ENGINEERING')).toBe(true);
  });

  it('forces document scope for RE recommendations register module', () => {
    expect(shouldForceDocumentRecommendationScope('RE_13_RECOMMENDATIONS')).toBe(true);
  });

  it('does not force document scope for regular RE source modules', () => {
    expect(shouldForceDocumentRecommendationScope('RE_06_FIRE_PROTECTION')).toBe(false);
  });
});
