import { describe, it, expect } from 'vitest';
import { getModuleCompletionDetails } from './moduleCompletion';

describe('getModuleCompletionDetails for RE modules', () => {
  it('keeps RE-00 as untouched informational state', () => {
    const completion = getModuleCompletionDetails({ module_key: 'RISK_ENGINEERING', data: { anything: 'x' } as any });
    expect(completion.state).toBe('untouched');
  });

  it('does not mark RE-09 recommendations register as complete', () => {
    const completion = getModuleCompletionDetails({ module_key: 'RE_13_RECOMMENDATIONS', data: { some: 'value' } as any });
    expect(completion.state).toBe('untouched');
  });

  it('marks RE-02 complete when required building inputs and site score exist', () => {
    const completion = getModuleCompletionDetails({
      module_key: 'RE_02_CONSTRUCTION',
      data: {
        construction: {
          buildings: [
            {
              ref: 'B1',
              roof_area_m2: 1200,
              mezzanine_area_m2: 0,
              frame_type: 'protected_steel',
              compartmentation_minutes: 120,
            },
          ],
          completion: {
            site_score: 3.6,
          },
        },
      } as any,
    });

    expect(completion.state).toBe('complete');
    expect(completion.missingRequirements).toEqual([]);
  });

  it('marks RE-02 incomplete with user-facing missing guidance', () => {
    const completion = getModuleCompletionDetails({
      module_key: 'RE_02_CONSTRUCTION',
      data: {
        construction: {
          buildings: [
            {
              ref: 'B1',
              roof_area_m2: 1200,
              mezzanine_area_m2: 0,
              frame_type: 'unknown',
            },
          ],
        },
      } as any,
    });

    expect(completion.state).toBe('incomplete');
    expect(completion.missingRequirements).toContain('Complete required construction details for all included buildings');
    expect(completion.missingRequirements).toContain('Ensure site construction score can be calculated');
  });

  it('treats RE-10 supporting docs as optional unless policy flag requires it', () => {
    const optionalCompletion = getModuleCompletionDetails({
      module_key: 'RE_10_SITE_PHOTOS',
      data: {} as any,
    });
    expect(optionalCompletion.state).toBe('complete');

    const requiredButMissing = getModuleCompletionDetails({
      module_key: 'RE_10_SITE_PHOTOS',
      data: { supporting_documentation_required: true } as any,
    });
    expect(requiredButMissing.state).toBe('incomplete');

    const requiredAndComplete = getModuleCompletionDetails({
      module_key: 'RE_10_SITE_PHOTOS',
      data: {
        supporting_documentation_required: true,
        completion_confirmed: true,
      } as any,
    });
    expect(requiredAndComplete.state).toBe('complete');
  });
});
