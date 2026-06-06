/**
 * RE auto-recommendation lifecycle regression tests.
 *
 * Tests the generate-once semantics of ensureRecommendationFromRating.
 * All Supabase I/O is mocked — no credentials or live DB required.
 *
 * Run: npx vitest run src/lib/re/recommendations/recommendationPipeline.lifecycle.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.hoisted() runs before imports, making these values available inside
// vi.mock() factories even though both are hoisted by Vitest's transformer.

const mockCtrl = vi.hoisted(() => {
  // What the existence-check SELECT returns on the next call
  let selectResult: { data: { id: string } | null; error: any } = {
    data: null,
    error: null,
  };

  // What the INSERT returns on the next call
  let insertResult: { data: { id: string } | null; error: any } = {
    data: { id: 'mock-created-id' },
    error: null,
  };

  // Spies the test assertions check against
  const insertSpy = vi.fn<[string, Record<string, unknown>], void>();
  const updateSpy = vi.fn<[string, Record<string, unknown>], void>();

  return {
    setSelectResult: (r: typeof selectResult) => {
      selectResult = r;
    },
    setInsertResult: (r: typeof insertResult) => {
      insertResult = r;
    },
    getSelectResult: () => selectResult,
    getInsertResult: () => insertResult,
    insertSpy,
    updateSpy,
  };
});

// ─── Mock the Supabase module ─────────────────────────────────────────────────
// The real src/lib/supabase.ts throws at import time if env vars are absent.
// This factory replaces it entirely — the pipeline never touches real I/O.

vi.mock('../../supabase', () => {
  const makeBuilder = (table: string) => {
    let isInsert = false;

    const resolve = () => {
      // Library queries always return empty (pipeline falls back to hardcoded text)
      if (table === 're_recommendation_library') {
        return { data: [], error: null };
      }
      // Insert terminal calls get the insert result; select terminals get select result
      return isInsert ? mockCtrl.getInsertResult() : mockCtrl.getSelectResult();
    };

    const b: Record<string, unknown> & { then: Function } = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        isInsert = true;
        mockCtrl.insertSpy(table, payload);
        return b;
      }),
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        mockCtrl.updateSpy(table, payload);
        return b;
      }),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      // Explicit terminals
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(resolve())),
      single: vi.fn().mockImplementation(() => Promise.resolve(resolve())),
      // Direct await (used by the library query: `await supabase.from(...).select(...).eq(...).order(...)`)
      then: vi.fn().mockImplementation((onFulfilled: Function, onRejected?: Function) =>
        Promise.resolve(resolve()).then(onFulfilled as any, onRejected as any)
      ),
    };
    return b;
  };

  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => makeBuilder(table)),
    },
  };
});

// ─── Import the pipeline under test (AFTER mocks are registered) ──────────────

import { ensureRecommendationFromRating } from './recommendationPipeline';

// ─── Shared test params ───────────────────────────────────────────────────────

const BASE_PARAMS = {
  documentId: 'doc-aaa',
  sourceModuleKey: 'RE_03_OCCUPANCY',
  sourceFactorKey: 're03_occ_fire_load_density',
  moduleInstanceId: 'mod-bbb',
  industryKey: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RE auto-recommendation lifecycle — generate-once semantics', () => {
  beforeEach(() => {
    // Reset to default state: no existing row, successful insert
    mockCtrl.setSelectResult({ data: null, error: null });
    mockCtrl.setInsertResult({ data: { id: 'mock-created-id' }, error: null });
    mockCtrl.insertSpy.mockClear();
    mockCtrl.updateSpy.mockClear();
  });

  // ── Scenario 1: Poor rating, first time ─────────────────────────────────────

  it('creates exactly one recommendation when a poor rating is set for the first time', async () => {
    mockCtrl.setSelectResult({ data: null, error: null }); // No existing row

    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 1 });

    expect(state).toBe('created');
    expect(mockCtrl.insertSpy).toHaveBeenCalledTimes(1);
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();

    // INSERT payload must include correct identity fields
    const [, payload] = mockCtrl.insertSpy.mock.calls[0];
    expect(payload).toMatchObject({
      document_id: BASE_PARAMS.documentId,
      source_type: 'auto',
      source_module_key: BASE_PARAMS.sourceModuleKey,
      source_factor_key: BASE_PARAMS.sourceFactorKey,
      module_instance_id: BASE_PARAMS.moduleInstanceId,
    });
  });

  it('stores triggered_by_rating in metadata for traceability', async () => {
    mockCtrl.setSelectResult({ data: null, error: null });

    await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 2 });

    const [, payload] = mockCtrl.insertSpy.mock.calls[0];
    expect((payload as any).metadata).toMatchObject({ triggered_by_rating: 2 });
    expect((payload as any).metadata.triggered_at).toBeDefined();
  });

  // ── Scenario 2: Re-saving the same poor rating ──────────────────────────────

  it('returns exists and does NOT insert when a recommendation already exists', async () => {
    mockCtrl.setSelectResult({ data: { id: 'existing-rec-id' }, error: null }); // Row exists

    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 1 });

    expect(state).toBe('exists');
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();
  });

  it('does NOT overwrite recommendation content when the same poor rating is re-saved', async () => {
    mockCtrl.setSelectResult({ data: { id: 'existing-rec-id' }, error: null });

    await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 1 });

    // Neither insert nor update should be called — record is untouched
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();
  });

  // ── Scenario 3: Improving the rating ────────────────────────────────────────

  it('returns exists and does NOT suppress or update the recommendation when rating improves', async () => {
    mockCtrl.setSelectResult({ data: { id: 'existing-rec-id' }, error: null }); // Rec exists

    // Rating improves to 4 (acceptable)
    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 4 });

    expect(state).toBe('exists');
    // Critical: pipeline must NOT call UPDATE with is_suppressed: true
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
  });

  it('does NOT create a new recommendation when a good rating is set and no rec exists', async () => {
    mockCtrl.setSelectResult({ data: null, error: null }); // No existing row

    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 3 });

    expect(state).toBe('none');
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
  });

  // ── Scenario 4: Manual edits are not overwritten ────────────────────────────

  it('leaves an existing record completely untouched regardless of rating value', async () => {
    // Simulate a manually-edited record (is_suppressed=false, custom status)
    // The pipeline only sees the row's id — it does not inspect or overwrite any other fields
    mockCtrl.setSelectResult({ data: { id: 'manually-edited-rec-id' }, error: null });

    // Re-save with poor rating
    const state1 = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 1 });
    // Re-save with improved rating
    const state2 = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 5 });

    expect(state1).toBe('exists');
    expect(state2).toBe('exists');
    // In both cases: zero mutations
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
  });

  // ── Scenario 5: Manually suppressed/deleted recommendation ─────────────────

  it('does NOT recreate a recommendation that the assessor has deleted (no row found)', async () => {
    // Assessor deleted the rec; SELECT returns null
    mockCtrl.setSelectResult({ data: null, error: null });

    // But rating is good — no trigger
    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 4 });

    expect(state).toBe('none');
    expect(mockCtrl.insertSpy).not.toHaveBeenCalled();
  });

  it('creates a fresh recommendation if assessor deleted it AND a poor rating is set again', async () => {
    // Assessor deleted the rec; SELECT returns null; rating is poor again
    mockCtrl.setSelectResult({ data: null, error: null });

    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 2 });

    // This IS the genuinely-new-trigger-identity case: a brand-new insert is correct
    expect(state).toBe('created');
    expect(mockCtrl.insertSpy).toHaveBeenCalledTimes(1);
  });

  it('returns exists (not suppressed) when an assessor-suppressed row is found', async () => {
    // Assessor set is_suppressed=true manually; the SELECT still returns the row
    // Pipeline sees it as 'exists' — it never reads is_suppressed
    mockCtrl.setSelectResult({ data: { id: 'suppressed-by-assessor-id' }, error: null });

    const state = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: 1 });

    expect(state).toBe('exists');
    // Pipeline must NOT flip is_suppressed back — that's the assessor's call
    expect(mockCtrl.updateSpy).not.toHaveBeenCalled();
  });

  // ── Type contract ────────────────────────────────────────────────────────────

  it('never returns the removed states: updated, restored, suppressed', async () => {
    const removedStates = ['updated', 'restored', 'suppressed'];

    const states: string[] = [];

    // Collect states across all rating + existence combinations
    for (const rating of [1, 2, 3, 4, 5]) {
      for (const existingData of [null, { id: 'some-id' }]) {
        mockCtrl.setSelectResult({ data: existingData, error: null });
        mockCtrl.insertSpy.mockClear();
        const s = await ensureRecommendationFromRating({ ...BASE_PARAMS, rating_1_5: rating });
        states.push(s);
      }
    }

    for (const removed of removedStates) {
      expect(states).not.toContain(removed);
    }

    // Only valid states observed
    for (const s of states) {
      expect(['none', 'created', 'exists']).toContain(s);
    }
  });
});
