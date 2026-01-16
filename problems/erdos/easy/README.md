# Easy Open Erdős Problems

This directory contains the "easiest" **open** Erdős problems from those with Lean formalizations, selected based on how much work has already been done.

## Important: Only Open Problems

These are **mathematically unsolved problems**. The AI would be attempting to:
- Solve actual unsolved mathematics
- Not just formalize existing proofs
- Work on problems where no analytical (non-Lean) proof exists yet

Problems marked "proved", "disproved", or "solved" are excluded.

## Selection Criteria

Problems were scored and ranked based on:

1. **Status = Open** (mandatory)
   - Must be `open`, `verifiable`, `decidable`, or `falsifiable`
   - No problems with existing mathematical proofs

2. **Completeness Ratio** (primary metric)
   - Ratio = `sorry statements / total declarations`
   - Lower ratio = more complete = easier to finish
   - Total declarations = theorems + lemmas + definitions

3. **Status Preferences** (bonus points)
   - `verifiable`, `decidable`, `falsifiable` - computationally checkable
   - These often have clear algorithmic approaches

4. **Prize Amount** (indicator of difficulty)
   - Small prizes ($0-$500): bonus points
   - Medium prizes ($500-$1000): neutral
   - Large prizes (>$1000): penalty (likely harder)

5. **Has Existing Proofs** (bonus)
   - Problems with at least one completed lemma/helper (not just `sorry`)
   - Shows the formalization is testable and approachable

## Top 20 Open Problems

| Problem | Score | Completeness | Declarations | Sorries | Status | Prize |
|---------|-------|--------------|--------------|---------|--------|-------|
| [1059](1059.md) | -12.7 | 85.7% | 14 | 2 | open | none |
| [97](97.md) | -7.7 | 41.7% | 12 | 7 | falsifiable | $100 |
| [20](20.md) | -7.3 | 77.8% | 9 | 2 | open | $1000 |
| [304](304.md) | -3.2 | 73.7% | 19 | 5 | open | none |
| [90](90.md) | 0.3 | 66.7% | 6 | 2 | open | $500 |
| [89](89.md) | 7.5 | 60.0% | 5 | 2 | open | $500 |
| [170](170.md) | 8.8 | 66.7% | 9 | 3 | open | none |
| [1052](1052.md) | 9.9 | 55.6% | 9 | 4 | open | $10 |
| [1101](1101.md) | 10.3 | 66.7% | 6 | 2 | open | none |
| [107](107.md) | 13.3 | 22.2% | 9 | 7 | falsifiable | $500 |
| [364](364.md) | 15.2 | 33.3% | 3 | 2 | verifiable | none |
| [74](74.md) | 16.0 | 50.0% | 8 | 4 | open | $500 |
| [40](40.md) | 18.0 | 50.0% | 4 | 2 | open | $500 |
| [168](168.md) | 24.0 | 50.0% | 12 | 6 | open | none |
| [9](9.md) | 27.0 | 50.0% | 6 | 3 | open | none |
| [330](330.md) | 28.0 | 50.0% | 4 | 2 | open | none |
| [424](424.md) | 28.0 | 50.0% | 4 | 2 | open | none |
| [677](677.md) | 29.0 | 50.0% | 2 | 1 | open | none |
| [340](340.md) | 30.0 | 40.0% | 20 | 12 | open | none |
| [624](624.md) | 31.8 | 66.7% | 3 | 1 | open | none |

## What's in Each File

Each problem file contains:

- **Metadata**: Status, prize, formalization link, tags, OEIS sequences
- **Proof Progress**: Detailed metrics on completeness
- **Problem Statement**: The original mathematical problem (unsolved!)
- **Background**: Historical context and partial results
- **Lean Formalization**: Complete Lean 4 code with definitions and theorems

## Best Candidates for AI

Start with these high-completeness problems:

1. **Problem 1059** (85.7% complete) - Only 2 sorries, has working computational proofs
2. **Problem 20** (77.8% complete) - Sunflower conjecture, only 2 sorries
3. **Problem 304** (73.7% complete) - 5 sorries in 19 declarations

Note: Even with high completeness, these are **unsolved mathematical problems**. Completing the sorries may require novel mathematical insights.

## Regenerating This List

To download a fresh set of easy open problems:

```bash
npx tsx download-easy.ts --limit 20
```

This will:
1. Analyze all formalized problems (320 total)
2. Filter to only open problems (259 problems)
3. Score by completeness ratio and other factors
4. Download the top N easiest open problems
