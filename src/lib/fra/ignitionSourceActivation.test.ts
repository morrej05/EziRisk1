import { describe, expect, it } from 'vitest';
import {
  getActiveIgnitionSourceCards,
  getEffectiveIgnitionPresence,
  HAZARD_TO_SOURCE_MAPPINGS,
} from './ignitionSourceActivation';

const sourceKeys = ['electrical', 'smoking', 'cooking', 'laundry', 'contractor_controls', 'maintenance_controls', 'hot_works', 'high_risk_other', 'hazardous_substances_dsear', 'arson'];

describe('FRA ignition source activation', () => {
  it('documents required broad hazard mappings', () => {
    expect(HAZARD_TO_SOURCE_MAPPINGS).toEqual(expect.arrayContaining([
      expect.objectContaining({ broadKey: 'smoking', sourceKey: 'smoking' }),
      expect.objectContaining({ broadKey: 'hot_work', sourceKey: 'hot_works' }),
      expect.objectContaining({ broadKey: 'commercial_kitchens', sourceKey: 'cooking' }),
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
    expect(result.optionalSourceKeys).toEqual(['electrical', 'cooking', 'laundry', 'contractor_controls', 'maintenance_controls', 'high_risk_other', 'hazardous_substances_dsear', 'arson']);
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
});
