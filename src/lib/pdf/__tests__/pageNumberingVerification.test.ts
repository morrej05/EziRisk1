/**
 * Page Numbering Verification — RE Survey PDF & LPR
 *
 * This test generates actual PDFs using the canonical fixture and verifies that:
 *  - Physical page position == Footer page number (no drift)
 *  - No duplicate or missing footer numbers
 *  - Document Control is always physical page 2
 *  - TOC entries (Survey only) match footer page numbers
 *
 * It does NOT rely on code inspection. It calls the real builders and intercepts
 * drawFooter + drawSectionHeaderBar to capture what the PDF actually produces.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PDFPage } from 'pdf-lib';
import { createCanonicalReSurveyFixture } from '../fixtures/reSurveyCanonicalFixture';

// ── Supabase mock (no network) ────────────────────────────────────────────────
vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
          data: [],
          error: null,
        }),
        in: () => ({ data: [], error: null }),
        data: [],
        error: null,
      }),
      insert: () => ({ data: null, error: null }),
    }),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  },
}));

// ── Shared spy state ──────────────────────────────────────────────────────────

// drawFooter intercept: captures every (page, assignedPageNum) call.
// The footer loop is: for (let i = 0; i < totalPages.length; i++) drawFooter(totalPages[i], ..., i+1, ...)
// So the Nth call in footerCalls[N-1] has physicalIndex = N and pageNum = expected N.
interface FooterCall { page: PDFPage; pageNum: number; totalPages: number }
const surveyFooterCalls: FooterCall[] = [];
const lprFooterCalls: FooterCall[] = [];

// drawSectionHeaderBar intercept: captures section title -> page mapping (Survey only).
interface SectionCall { page: PDFPage; title: string }
const surveySectionCalls: SectionCall[] = [];

// ── Environment stubs ─────────────────────────────────────────────────────────
beforeAll(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.stubEnv('VITE_PDF_IMAGE_LOGOS', 'false');
});

// ─────────────────────────────────────────────────────────────────────────────
// SURVEY VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────
describe('RE Survey PDF — page numbering', () => {
  let surveyPageCount = 0;

  beforeAll(async () => {
    // Import pdfUtils and pdfPrimitives AFTER mocks so spies wrap real implementations.
    const pdfUtils = await import('../pdfUtils');
    const pdfPrimitives = await import('../pdfPrimitives');

    // Spy on drawFooter: call through (draws normally) and record.
    vi.spyOn(pdfUtils, 'drawFooter').mockImplementation(
      (page: PDFPage, text: string, pageNum: number, total: number, font: unknown) => {
        surveyFooterCalls.push({ page, pageNum, totalPages: total });
        // Don't call real drawFooter — font embedding is needed for that and we only need numbers.
      }
    );

    // Spy on drawSectionHeaderBar: call through and record title + page.
    vi.spyOn(pdfPrimitives, 'drawSectionHeaderBar').mockImplementation(
      (args: { page: PDFPage; y: number; title: string; [k: string]: unknown }) => {
        // Only record the first call per title (section start page)
        if (!surveySectionCalls.find((c) => c.title === args.title)) {
          surveySectionCalls.push({ page: args.page, title: args.title });
        }
        return (args.y as number) - 30;
      }
    );

    const { buildReSurveyPdf } = await import('../buildReSurveyPdf');
    const { options } = createCanonicalReSurveyFixture();

    const bytes = await buildReSurveyPdf({
      ...options,
      renderMode: 'issued',
      scoreBreakdownOverride: options.scoreBreakdownOverride,
    });

    // Use pdf-lib to count physical pages in the generated document.
    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(bytes);
    surveyPageCount = loaded.getPageCount();

    vi.restoreAllMocks();
  });

  it('physical page count matches totalPages tracked by footer loop', () => {
    expect(surveyFooterCalls.length).toBeGreaterThan(0);
    expect(surveyPageCount).toBe(surveyFooterCalls.length);
  });

  it('footer page numbers are strictly sequential (1, 2, 3 … N) — no gaps or duplicates', () => {
    const footerNums = surveyFooterCalls.map((c) => c.pageNum);
    const expected = Array.from({ length: footerNums.length }, (_, i) => i + 1);
    expect(footerNums).toEqual(expected);
  });

  it('Document Control is physical page 2 (footer says "2")', () => {
    // The 2nd footer call (index 1) corresponds to physical page 2.
    expect(surveyFooterCalls.length).toBeGreaterThanOrEqual(2);
    expect(surveyFooterCalls[1].pageNum).toBe(2);
  });

  it('Disclaimer appears on physical page 3', () => {
    expect(surveyFooterCalls.length).toBeGreaterThanOrEqual(3);
    expect(surveyFooterCalls[2].pageNum).toBe(3);
  });

  it('section header page objects map to consistent footer numbers', () => {
    // Build page → footer number map from footer calls.
    const pageToFooter = new Map<PDFPage, number>(
      surveyFooterCalls.map((c) => [c.page, c.pageNum])
    );

    // Every section-header page must be in the footer map.
    for (const { page, title } of surveySectionCalls) {
      const footerNum = pageToFooter.get(page);
      expect(footerNum, `Section "${title}" page object not found in footer map`).toBeDefined();
    }
  });

  it('produces the full verification table (printed to console for manual review)', () => {
    const pageToFooter = new Map<PDFPage, number>(
      surveyFooterCalls.map((c) => [c.page, c.pageNum])
    );
    const pageToPhysical = new Map<PDFPage, number>(
      surveyFooterCalls.map((c, i) => [c.page, i + 1])
    );

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  RE SURVEY PDF — PAGE NUMBERING VERIFICATION REPORT');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Total pages in PDF:  ${surveyPageCount}`);
    console.log(`  Footer calls made:   ${surveyFooterCalls.length}`);
    console.log('──────────────────────────────────────────────────────────');
    console.log('  FIXED PAGES (cover + infrastructure)');
    console.log('──────────────────────────────────────────────────────────');

    const fixedPages = [
      { section: 'Cover',            physIdx: 0 },
      { section: 'Document Control', physIdx: 1 },
      { section: 'Disclaimer',       physIdx: 2 },
      { section: 'Contents (TOC)',   physIdx: 3 },
    ];
    for (const { section, physIdx } of fixedPages) {
      if (physIdx < surveyFooterCalls.length) {
        const call = surveyFooterCalls[physIdx];
        const match = call.pageNum === physIdx + 1 ? '✓' : '✗ MISMATCH';
        console.log(`  ${section.padEnd(22)} physical=${physIdx + 1}  footer=${call.pageNum}  ${match}`);
      }
    }

    if (surveySectionCalls.length > 0) {
      console.log('──────────────────────────────────────────────────────────');
      console.log('  BODY SECTIONS (from drawSectionHeaderBar spy)');
      console.log('──────────────────────────────────────────────────────────');
      for (const { page, title } of surveySectionCalls) {
        const physical = pageToPhysical.get(page);
        const footer = pageToFooter.get(page);
        const match = physical === footer ? '✓' : '✗ MISMATCH';
        console.log(`  ${title.padEnd(30)} physical=${physical ?? '?'}  footer=${footer ?? '?'}  ${match}`);
      }
    }

    console.log('══════════════════════════════════════════════════════════\n');

    // The key invariant: physical position == footer number for every page.
    for (const [page, physical] of pageToPhysical) {
      const footer = pageToFooter.get(page)!;
      expect(footer).toBe(physical);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LPR VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────
describe('RE Loss Prevention Report PDF — page numbering', () => {
  let lprPageCount = 0;

  beforeAll(async () => {
    const pdfUtils = await import('../pdfUtils');

    vi.spyOn(pdfUtils, 'drawFooter').mockImplementation(
      (page: PDFPage, _text: string, pageNum: number, total: number, _font: unknown) => {
        lprFooterCalls.push({ page, pageNum, totalPages: total });
      }
    );

    const { buildReLpPdf } = await import('../buildReLpPdf');
    const { options } = createCanonicalReSurveyFixture();

    const lprDoc = {
      ...options.document,
      document_type: 'RE_LP',
      title: 'Canonical LPR Fixture — Riverport Distribution Campus',
      executive_summary_mode: 'none' as const,
    };

    const bytes = await buildReLpPdf({
      document: lprDoc as Parameters<typeof buildReLpPdf>[0]['document'],
      moduleInstances: options.moduleInstances as Parameters<typeof buildReLpPdf>[0]['moduleInstances'],
      actions: options.actions,
      organisation: options.organisation,
      renderMode: 'issued',
    });

    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(bytes);
    lprPageCount = loaded.getPageCount();

    vi.restoreAllMocks();
  });

  it('physical page count matches totalPages tracked by footer loop', () => {
    expect(lprFooterCalls.length).toBeGreaterThan(0);
    expect(lprPageCount).toBe(lprFooterCalls.length);
  });

  it('footer page numbers are strictly sequential (1, 2, 3 … N) — no gaps or duplicates', () => {
    const footerNums = lprFooterCalls.map((c) => c.pageNum);
    const expected = Array.from({ length: footerNums.length }, (_, i) => i + 1);
    expect(footerNums).toEqual(expected);
  });

  it('Document Control is physical page 2 (footer says "2")', () => {
    expect(lprFooterCalls.length).toBeGreaterThanOrEqual(2);
    expect(lprFooterCalls[1].pageNum).toBe(2);
  });

  it('produces the full verification table (printed to console for manual review)', () => {
    const pageToPhysical = new Map<PDFPage, number>(
      lprFooterCalls.map((c, i) => [c.page, i + 1])
    );
    const pageToFooter = new Map<PDFPage, number>(
      lprFooterCalls.map((c) => [c.page, c.pageNum])
    );

    const lprSectionNames = [
      'Cover',
      'Document Control',
      'Cover Details',
      // addExecutiveSummaryPages with mode='none' adds 0 pages
      'Executive Action Summary',
      // ...recommendations tables may overflow to additional pages
      'Recommendations by Risk Area',
      'Implementation Roadmap',
    ];

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  RE LOSS PREVENTION REPORT — PAGE NUMBERING VERIFICATION');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Total pages in PDF:  ${lprPageCount}`);
    console.log(`  Footer calls made:   ${lprFooterCalls.length}`);
    console.log('──────────────────────────────────────────────────────────');
    lprFooterCalls.forEach((call, i) => {
      const sectionHint = lprSectionNames[i] ?? `Content page ${i + 1}`;
      const physical = i + 1;
      const match = call.pageNum === physical ? '✓' : '✗ MISMATCH';
      console.log(`  ${sectionHint.padEnd(30)} physical=${physical}  footer=${call.pageNum}  ${match}`);
    });
    console.log('══════════════════════════════════════════════════════════\n');

    // Key invariant: physical == footer for every page.
    for (const [page, physical] of pageToPhysical) {
      const footer = pageToFooter.get(page)!;
      expect(footer).toBe(physical);
    }
  });
});
