import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('RE-04 recommendation fallback mapping content', () => {
  const file = readFileSync(resolve(process.cwd(), 'src/lib/re/recommendations/recommendationPipeline.ts'), 'utf8');

  it('contains targeted fallback entries for new RE-04 factor keys', () => {
    expect(file).toContain('re06_fp_adequacy_critical_area_coverage');
    expect(file).toContain('Extend protection to unprotected critical areas');
    expect(file).toContain('re06_fp_localised_required_provided');
    expect(file).toContain('Provide or improve localised/special hazard protection');
    expect(file).toContain('re06_fp_evidence_design_performance_change_control');
    expect(file).toContain('documentation, performance evidence, and change-control discipline');
  });

  it('retains localised knockout mapping', () => {
    expect(file).toContain('re06_fp_localised_required_installation');
  });
});
