import { describe, expect, it } from 'vitest';
import {
  getActiveIgnitionSourceCards,
  getEffectiveIgnitionPresence,
  HAZARD_TO_SOURCE_MAPPINGS,
  hasCommercialKitchenContext,
} from './ignitionSourceActivation';

const sourceKeys = ['electrical', 'fixed_wiring_eicr', 'smoking', 'cooking', 'laundry', 'contractor_controls', 'maintenance_controls', 'hot_works', 'high_risk_other', 'hazardous_substances_dsear', 'arson', 'portable_heaters'];

describe('FRA ignition source activation', () => {
  it('documents required broad hazard mappings', () => {
    expect(HAZARD_TO_SOURCE_MAPPINGS).toEqual(expect.arrayContaining([
      expect.objectContaining({ broadKey: 'smoking', sourceKey: 'smoking' }),
      expect.objectContaining({ broadKey: 'hot_work', sourceKey: 'hot_works' }),
      expect.objectContaining({ broadKey: 'commercial_kitchens', sourceKey: 'cooking', commercialKitchenContext: true }),
      expect.objectContaining({ broadKey: 'laundry_operations', sourceKey: 'laundry' }),
      expect.objectContaining({ broadKey: 'contractor_works', sourceKey: 'contractor_controls' }),
      expect.objectContaining({ broadKey: 'maintenance_activities', sourceKey: 'maintenance_controls' }),
      expect.objectContaining({ broadKey: 'other', sourceKey: 'high_risk_other' }),
      expect.objectContaining({ broadKey: 'electrical_equipment', sourceKey: 'electrical' }),
      expect.objectContaining({ broadKey: 'portable_heaters', sourceKey: 'portable_heaters' }),
      expect.objectContaining({ broadKey: 'flammable_liquids', sourceKey: 'hazardous_substances_dsear', dsearPrompt: true }),
      expect.objectContaining({ broadKey: 'high', sourceKey: 'arson' }),
    ]));
  });

  it('activates contextual source cards from broad selections and derives presence', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: {
        ignition_sources: ['smoking'],
        high_risk_activities: ['hot_work'],
        fuel_sources: [],
        arson_risk: 'low',
      },
      sourceAssessments: {},
      sourceKeys,
    });

    expect(result.activeSourceKeys).toEqual(['smoking', 'hot_works']);
    expect(result.optionalSourceKeys).toEqual(['electrical', 'fixed_wiring_eicr', 'cooking', 'laundry', 'contractor_controls', 'maintenance_controls', 'high_risk_other', 'hazardous_substances_dsear', 'arson', 'portable_heaters']);
    expect(getEffectiveIgnitionPresence({
      sourceKey: 'smoking',
      assessment: {},
      broadSelections: { ignition_sources: ['smoking'] },
    })).toBe('present');
  });

  it('preserves legacy detailed cards when broad selections are absent', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: { ignition_sources: [], high_risk_activities: [], fuel_sources: [] },
      sourceAssessments: {
        electrical: { existing_controls: 'EICR reviewed.' },
      },
      sourceKeys,
    });

    expect(result.activeSourceKeys).toEqual(['electrical']);
    expect(result.completedLegacySourceKeys).toEqual(['electrical']);
    expect(getEffectiveIgnitionPresence({
      sourceKey: 'electrical',
      assessment: { existing_controls: 'EICR reviewed.' },
      broadSelections: {},
    })).toBe('unknown');
  });

  it('surfaces DSEAR prompt without forcing module activation', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: { fuel_sources: ['flammable_liquids'] },
      sourceAssessments: {},
      sourceKeys,
    });

    expect(result.activeSourceKeys).toContain('hazardous_substances_dsear');
    expect(result.dsearPrompt).toBe(true);
  });

  it('keeps fixed wiring concerns as triage only without activating a generic contextual card', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: { ignition_sources: ['fixed_wiring_concerns'] },
      sourceAssessments: {},
      sourceKeys,
    });

    expect(result.activeSourceKeys).toEqual([]);
    expect(result.optionalSourceKeys).toContain('fixed_wiring_eicr');
    expect(getEffectiveIgnitionPresence({
      sourceKey: 'fixed_wiring_eicr',
      assessment: {},
      broadSelections: { ignition_sources: ['fixed_wiring_concerns'] },
    })).toBe('');
  });


  it('merges cooking and commercial kitchens into one cooking source card', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: {
        ignition_sources: ['cooking'],
        high_risk_activities: ['commercial_kitchens'],
        fuel_sources: [],
      },
      sourceAssessments: {},
      sourceKeys,
    });

    expect(result.activeSourceKeys.filter((sourceKey) => sourceKey === 'cooking')).toEqual(['cooking']);
    expect(result.activeSourceKeys).toEqual(['cooking']);
    expect(getEffectiveIgnitionPresence({
      sourceKey: 'cooking',
      assessment: {},
      broadSelections: { ignition_sources: ['cooking'], high_risk_activities: ['commercial_kitchens'] },
    })).toBe('present');
    expect(hasCommercialKitchenContext('cooking', { high_risk_activities: ['commercial_kitchens'] })).toBe(true);
  });

  it('activates the same cooking source card from commercial kitchens alone', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: {
        ignition_sources: [],
        high_risk_activities: ['commercial_kitchens'],
        fuel_sources: [],
      },
      sourceAssessments: {},
      sourceKeys,
    });

    expect(result.activeSourceKeys).toEqual(['cooking']);
    expect(hasCommercialKitchenContext('cooking', { high_risk_activities: ['commercial_kitchens'] })).toBe(true);
  });


  it('preserves fixed wiring legacy detail without rendering the generic contextual card', () => {
    const result = getActiveIgnitionSourceCards({
      broadSelections: { ignition_sources: [], high_risk_activities: [], fuel_sources: [] },
      sourceAssessments: {
        fixed_wiring_eicr: { existing_controls: 'Legacy fixed wiring notes.' },
      },
      sourceKeys,
    });

    expect(result.activeSourceKeys).not.toContain('fixed_wiring_eicr');
    expect(result.completedLegacySourceKeys).toContain('fixed_wiring_eicr');
  });
});
