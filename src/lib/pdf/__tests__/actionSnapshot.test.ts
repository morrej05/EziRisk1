import { describe, expect, it } from 'vitest';
import { getActionSnapshotText } from '../pdfUtils';

describe('getActionSnapshotText', () => {
  it('prefers explicit snapshot fields before recommended_action', () => {
    expect(getActionSnapshotText({
      title: 'Replace impaired sprinkler valve',
      summary: 'Ignored summary',
      short_description: 'Ignored short description',
      recommended_action: 'Ignored full recommendation text that remains in the recommendation section.',
    })).toBe('Replace impaired sprinkler valve');
  });

  it('falls back to the first non-empty short field', () => {
    expect(getActionSnapshotText({
      title: '   ',
      summary: 'Confirm weekly fire pump churn test records',
      recommended_action: 'The duty holder should confirm weekly fire pump churn test records and retain evidence.',
    })).toBe('Confirm weekly fire pump churn test records');
  });

  it('summarises recommended_action without ending in ellipses', () => {
    const snapshot = getActionSnapshotText({
      recommended_action: 'It is recommended that the duty holder should replace the damaged fire door seals to the warehouse escape corridor so that the protected route maintains its fire-resisting performance during evacuation and emergency response.',
    });

    expect(snapshot.length).toBeLessThanOrEqual(140);
    expect(snapshot).toBe('Replace the damaged fire door seals to the warehouse escape corridor');
    expect(snapshot).not.toMatch(/\.\.\.$|…$/);
  });

  it('shortens long explicit text at a word boundary without appending ellipses', () => {
    const snapshot = getActionSnapshotText({
      short_description: 'Commission a competent contractor to inspect, repair and document the automatic fire detection coverage throughout the production building mezzanine and adjoining storage rooms before the next audit cycle.',
    });

    expect(snapshot.length).toBeLessThanOrEqual(140);
    expect(snapshot).not.toMatch(/\.\.\.$|…$/);
    expect(snapshot).not.toMatch(/[\s,;:.-]$/);
  });
});
