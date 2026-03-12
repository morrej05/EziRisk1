# Canonical RE Survey PDF fixture (dev-only)

A deterministic fixture payload is available for visual QA at:

- `/dev/re-survey-pdf-fixture` (only registered in `import.meta.env.DEV`)

## How to generate locally

1. Start the app:

```bash
npm run dev
```

2. Open:

```text
http://localhost:5173/dev/re-survey-pdf-fixture
```

3. The page auto-generates the canonical RE Survey PDF and shows it inline.
4. Click **Download PDF** to save `RE_SURVEY_CANONICAL_FIXTURE.pdf`.

## Fixture source

- Data fixture: `src/lib/pdf/fixtures/reSurveyCanonicalFixture.ts`
- PDF builder: `src/lib/pdf/buildReSurveyPdf.ts` (uses `scoreBreakdownOverride` when provided)
- Dev preview page: `src/pages/dev/ReSurveyPdfFixturePage.tsx`
