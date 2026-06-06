-- RE auto-recommendation lifecycle — database constraint verification
--
-- Run this in: Supabase Dashboard → SQL Editor
--   or: psql "$(supabase status | grep DB URL | awk '{print $NF}')" -f scripts/re-lifecycle-verify.sql
--
-- Prerequisites:
--   1. Replace <PASTE_ANY_DOCUMENT_ID_HERE> below with a real document id
--      from your database.  Any existing draft RE document will do.
--        SELECT id, title FROM documents WHERE document_type = 'RISK_ENGINEERING' LIMIT 5;
--
--   2. This script runs inside a transaction and rolls back at the end.
--      Nothing is committed to the database.
--
-- Expected output: a series of NOTICE lines each starting with PASS or FAIL.

DO $$
DECLARE
  -- ── CONFIG: paste a real document id here ───────────────────────────────
  v_doc_id   uuid := '<PASTE_ANY_DOCUMENT_ID_HERE>';
  -- ────────────────────────────────────────────────────────────────────────

  v_mod_key  text := 'RE_03_OCCUPANCY';
  v_fac_key  text := '__verify_test_factor__';
  v_rec1_id  uuid;
  v_rec2_id  uuid;
  v_rec3_id  uuid;
  v_count    int;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  -- ── Guard ─────────────────────────────────────────────────────────────────
  IF v_doc_id = '<PASTE_ANY_DOCUMENT_ID_HERE>' THEN
    RAISE EXCEPTION 'Set v_doc_id to a real document id before running this script.';
  END IF;

  -- ── Test 1: First insert of an auto rec succeeds ──────────────────────────
  BEGIN
    INSERT INTO public.re_recommendations (
      document_id, source_type, source_module_key, source_factor_key,
      title, observation_text, action_required_text, hazard_text
    ) VALUES (
      v_doc_id, 'auto', v_mod_key, v_fac_key,
      'Verify test rec', 'Observation', 'Action required', 'Hazard'
    ) RETURNING id INTO v_rec1_id;

    RAISE NOTICE 'Test 1 PASS  First auto rec insert succeeded (id: %)', v_rec1_id;
    v_pass := v_pass + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 1 FAIL  First auto rec insert failed: %', SQLERRM;
    v_fail := v_fail + 1;
  END;

  -- ── Test 2: Duplicate auto rec for same identity is rejected ──────────────
  BEGIN
    INSERT INTO public.re_recommendations (
      document_id, source_type, source_module_key, source_factor_key,
      title, observation_text, action_required_text, hazard_text
    ) VALUES (
      v_doc_id, 'auto', v_mod_key, v_fac_key,
      'Duplicate auto rec — should be blocked', 'Observation', 'Action', 'Hazard'
    ) RETURNING id INTO v_rec2_id;

    -- If we reach here, the unique index did NOT fire — that is a failure
    RAISE NOTICE 'Test 2 FAIL  Duplicate auto rec was accepted (id: %). Unique index may be missing.', v_rec2_id;
    v_fail := v_fail + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Test 2 PASS  Duplicate auto rec correctly rejected by unique partial index';
    v_pass := v_pass + 1;
  END;

  -- ── Test 3: Manual rec with same module/factor IS allowed ─────────────────
  BEGIN
    INSERT INTO public.re_recommendations (
      document_id, source_type, source_module_key, source_factor_key,
      title, observation_text, action_required_text, hazard_text
    ) VALUES (
      v_doc_id, 'manual', v_mod_key, v_fac_key,
      'Manual rec — different source_type, should be allowed', 'Observation', 'Action', 'Hazard'
    ) RETURNING id INTO v_rec3_id;

    RAISE NOTICE 'Test 3 PASS  Manual rec with same module/factor accepted (id: %)', v_rec3_id;
    v_pass := v_pass + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 3 FAIL  Manual rec incorrectly rejected: %', SQLERRM;
    v_fail := v_fail + 1;
  END;

  -- ── Test 4: Different factor key for same module IS allowed ───────────────
  BEGIN
    INSERT INTO public.re_recommendations (
      document_id, source_type, source_module_key, source_factor_key,
      title, observation_text, action_required_text, hazard_text
    ) VALUES (
      v_doc_id, 'auto', v_mod_key, v_fac_key || '_different',
      'Auto rec with different factor key — should be allowed', 'Observation', 'Action', 'Hazard'
    );

    RAISE NOTICE 'Test 4 PASS  Auto rec with different factor key accepted';
    v_pass := v_pass + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 4 FAIL  Auto rec with different factor key incorrectly rejected: %', SQLERRM;
    v_fail := v_fail + 1;
  END;

  -- ── Test 5: Exactly one auto rec row exists for the original identity ──────
  SELECT COUNT(*) INTO v_count
  FROM public.re_recommendations
  WHERE document_id = v_doc_id
    AND source_type = 'auto'
    AND source_module_key = v_mod_key
    AND source_factor_key = v_fac_key;

  IF v_count = 1 THEN
    RAISE NOTICE 'Test 5 PASS  Exactly 1 auto rec exists for the test identity (count: %)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'Test 5 FAIL  Expected 1 auto rec, found % for the test identity', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ── Test 6: Index is present and is a partial index (WHERE source_type='auto') ──
  DECLARE
    v_idx_def text;
  BEGIN
    SELECT pg_get_indexdef(i.indexrelid)
    INTO v_idx_def
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    WHERE n.nspname = 'public'
      AND tc.relname = 're_recommendations'
      AND ic.relname = 're_recommendations_auto_identity_idx';

    IF v_idx_def IS NULL THEN
      RAISE NOTICE 'Test 6 FAIL  Index re_recommendations_auto_identity_idx not found';
      v_fail := v_fail + 1;
    ELSIF v_idx_def ILIKE '%where%auto%' OR v_idx_def ILIKE '%source_type%' THEN
      RAISE NOTICE 'Test 6 PASS  Partial unique index found: %', v_idx_def;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'Test 6 WARN  Index found but may not be a partial index — review: %', v_idx_def;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- ── Summary ───────────────────────────────────────────────────────────────
  RAISE NOTICE '─────────────────────────────────────────────────';
  RAISE NOTICE 'Result: % passed, % failed', v_pass, v_fail;
  IF v_fail = 0 THEN
    RAISE NOTICE 'All DB constraint checks PASSED';
  ELSE
    RAISE NOTICE 'Some checks FAILED — review output above';
  END IF;

  -- ── Rollback all test data ────────────────────────────────────────────────
  RAISE EXCEPTION 'ROLLBACK_SENTINEL — rolling back all test inserts (this is expected)';

EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ROLLBACK_SENTINEL%' THEN
      RAISE NOTICE 'Test data rolled back. No changes committed.';
    ELSE
      RAISE;
    END IF;
END $$;
