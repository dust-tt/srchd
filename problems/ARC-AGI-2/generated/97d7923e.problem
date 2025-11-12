Solve the following ARC-AGI-2 problem by analyzing the training examples to identify the transformation rule, then applying it to predict the correct output for the test case(s). You can rely on coding on the computer you have access to to test and verify your hypotheses.

## Problem Format

ARC-AGI problems consist of:

- **Training examples**: 3 input-output grid pairs showing the transformation pattern
- **Test case(s)**: 1-2 input grids where you must predict the output
- **Grids**: 2D matrices with integers 0-9 representing different colors
- **Solution**: The correct output grid for each test case

## Problem Data

Problem: 97d7923e

**Training Examples:**

INPUT:
2 0 0 0 0 0 0 0 0 0 0 0 0 0 0
2 0 0 0 2 0 0 0 0 0 0 0 0 0 0
0 0 0 0 5 0 0 0 0 0 0 0 0 0 0
0 0 0 0 5 0 0 2 0 0 0 0 0 0 0
0 0 0 0 5 0 0 5 0 0 0 0 0 0 0
0 0 0 0 5 0 0 5 0 0 0 0 0 0 0
0 0 2 0 5 0 0 5 0 0 0 0 0 0 0
0 0 5 0 5 0 0 5 0 0 0 0 0 0 0
0 0 5 0 5 0 0 5 0 0 0 0 0 0 0
0 0 2 0 2 0 0 2 0 0 0 0 0 0 0
OUTPUT:
2 0 0 0 0 0 0 0 0 0 0 0 0 0 0
2 0 0 0 2 0 0 0 0 0 0 0 0 0 0
0 0 0 0 5 0 0 0 0 0 0 0 0 0 0
0 0 0 0 5 0 0 2 0 0 0 0 0 0 0
0 0 0 0 5 0 0 2 0 0 0 0 0 0 0
0 0 0 0 5 0 0 2 0 0 0 0 0 0 0
0 0 2 0 5 0 0 2 0 0 0 0 0 0 0
0 0 5 0 5 0 0 2 0 0 0 0 0 0 0
0 0 5 0 5 0 0 2 0 0 0 0 0 0 0
0 0 2 0 2 0 0 2 0 0 0 0 0 0 0

INPUT:
2 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 2 0 0 0
0 0 0 0 0 0 3 0 0 0
0 0 0 0 0 0 3 0 0 0
0 0 2 0 0 0 3 0 0 0
0 0 3 0 0 0 3 0 0 0
0 0 3 0 0 0 3 0 0 0
0 0 2 0 0 0 2 0 0 0
OUTPUT:
2 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 2 0 0 0
0 0 0 0 0 0 2 0 0 0
0 0 0 0 0 0 2 0 0 0
0 0 2 0 0 0 2 0 0 0
0 0 3 0 0 0 2 0 0 0
0 0 3 0 0 0 2 0 0 0
0 0 2 0 0 0 2 0 0 0

INPUT:
1 0 3 0 0 0 0 0 0 0 0 0 0 0 0
0 0 3 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 1 0 0 0 0 0 0 0 3 0 0 0 0
0 0 7 0 0 0 0 0 0 0 5 0 0 0 0
0 0 7 0 0 1 0 0 0 0 5 0 0 3 0
0 0 7 0 0 7 0 1 0 0 5 0 0 5 0
0 0 7 0 0 7 0 7 0 0 5 0 0 5 0
0 0 1 0 0 1 0 1 0 0 3 0 0 3 0
OUTPUT:
1 0 3 0 0 0 0 0 0 0 0 0 0 0 0
0 0 3 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 1 0 0 0 0 0 0 0 3 0 0 0 0
0 0 1 0 0 0 0 0 0 0 5 0 0 0 0
0 0 1 0 0 1 0 0 0 0 5 0 0 3 0
0 0 1 0 0 7 0 1 0 0 5 0 0 3 0
0 0 1 0 0 7 0 7 0 0 5 0 0 3 0
0 0 1 0 0 1 0 1 0 0 3 0 0 3 0

**Test Case(s):**

INPUT:
1 2 3 4 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
1 0 3 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0
0 0 3 0 0 0 0 0 0 0 0 0 0 0 0 0 5 0 0 0
0 0 0 0 0 0 0 0 3 0 0 0 0 0 0 0 5 0 0 0
0 2 0 0 0 0 0 0 5 0 0 0 0 0 0 0 5 0 1 0
0 5 0 4 0 0 0 0 5 0 0 0 0 0 0 0 5 0 5 0
0 5 0 5 0 0 0 0 5 0 3 0 0 0 0 0 5 0 5 1
0 5 0 5 0 0 3 0 5 0 5 0 0 2 0 4 5 0 5 5
0 5 0 5 0 0 5 0 5 0 5 0 0 5 0 5 5 0 5 5
0 2 0 4 0 0 3 0 3 0 3 0 0 2 0 4 1 0 1 1

## Solution Requirements

Solutions to the problem must:

- Correctly identify the underlying transformation rule from the training examples (code is preferred but not required)
- Apply this rule consistently to generate the test outputs (log of executions accepted)
- Produce outputs that exactly match the expected results (perfect accuracy required)
- Demonstrate clear reasoning about the pattern you discovered

Focus on careful analysis of the visual patterns, spatial relationships, and logical transformations shown in the training examples. If possible, produce code that can be checked on training examples and applied to the test-case(s). Make sure to provide the test-case(s) output(s) in publications that propose a solution.
