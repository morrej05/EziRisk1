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

  it('accepts RE-01 assessment date from canonical document metadata source', () => {
    const completion = getModuleCompletionDetails(
      {
        module_key: 'RE_01_DOC_CONTROL',
        data: {
          client_site: { site: 'Main Site' },
          assessor: { name: 'A. Surveyor' },
          dates: { assessment_date: null },
        } as any,
      },
      {
        documentAssessmentDate: '2026-03-20',
      },
    );

    expect(completion.state).toBe('complete');
    expect(completion.missingRequirements).toEqual([]);
  });

  it('uses canonical RISK_ENGINEERING industry for RE-03 completion checks', () => {
    const completion = getModuleCompletionDetails(
      {
        module_key: 'RE_03_OCCUPANCY',
        data: {} as any,
      },
      {
        allModules: [
          {
            module_key: 'RISK_ENGINEERING',
            data: {
              industry_key: 'warehouse_distribution',
              ratings: {
                exposures_fire_department_response: 3,
                occupancy_combustible_loading_control: 3,
              },
            },
          } as any,
        ],
      },
    );

    expect(completion.missingRequirements).not.toContain('Select an industry classification');
  });

  it('keeps RE-06 incomplete until sprinkler, detection and water-score fields are genuinely completed', () => {
    const base = {
      module_key: 'RE_06_FIRE_PROTECTION',
      data: {
        fire_protection: {
          buildings: {
            b1: {
              sprinklerData: {
                sprinklers_installed: 'Yes',
                sprinkler_coverage_installed_pct: 100,
                sprinkler_coverage_required_pct: 100,
                system_type: 'Wet pipe',
                sprinkler_adequacy: 'Adequate',
                sprinkler_score_1_5: 4,
                detection_installed: 'Yes',
              },
            },
          },
          site: { water_score_1_5: null },
        },
      } as any,
    };

    const incomplete = getModuleCompletionDetails(base);
    expect(incomplete.state).toBe('incomplete');
    expect(incomplete.missingRequirements).toContain('Complete sprinkler, detection and scoring fields for assessed buildings');
    expect(incomplete.missingRequirements).toContain('Complete fire water supply reliability score');

    const complete = getModuleCompletionDetails({
      ...base,
      data: {
        fire_protection: {
          buildings: {
            b1: {
              sprinklerData: {
                ...base.data.fire_protection.buildings.b1.sprinklerData,
                detection_score_1_5: 4,
              },
            },
          },
          site: { water_score_1_5: 4 },
        },
      } as any,
    });

    expect(complete.state).toBe('complete');
    expect(complete.missingRequirements).toEqual([]);
  });

  it('requires RE-06 no-sprinkler knockout judgement before showing complete', () => {
    const missingJudgement = getModuleCompletionDetails({
      module_key: 'RE_06_FIRE_PROTECTION',
      data: {
        fire_protection: {
          buildings: { b1: { sprinklerData: { sprinklers_installed: 'No' } } },
          site: { water_score_1_5: 3 },
        },
      } as any,
    });

    expect(missingJudgement.state).toBe('incomplete');
    expect(missingJudgement.missingRequirements).toContain('Complete sprinkler, detection and scoring fields for assessed buildings');

    const notWarranted = getModuleCompletionDetails({
      module_key: 'RE_06_FIRE_PROTECTION',
      data: {
        fire_protection: {
          buildings: { b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'No' } } },
          site: { water_score_1_5: 3 },
        },
      } as any,
    });

    expect(notWarranted.state).toBe('complete');
  });

});
