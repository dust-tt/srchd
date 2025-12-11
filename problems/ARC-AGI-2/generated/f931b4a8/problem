Solve the following ARC-AGI-2 problem by analyzing the training examples to identify the transformation rule, then applying it to predict the correct output for the test case(s). You can rely on coding on the computer you have access to to test and verify your hypotheses.

## Problem Format

ARC-AGI problems consist of:

- **Training examples**: 3 input-output grid pairs showing the transformation pattern
- **Test case(s)**: 1-2 input grids where you must predict the output
- **Grids**: 2D matrices with integers 0-9 representing different colors
- **Solution**: The correct output grid for each test case

## Problem Data

Problem: f931b4a8

**Training Examples:**

INPUT:
1 1 1 1 3 3 3 3
1 1 1 1 0 0 0 0
1 1 1 1 0 0 0 0
1 1 1 1 0 0 0 0
5 5 5 5 6 0 6 0
5 5 5 5 0 6 0 6
5 5 5 5 6 0 6 0
5 5 5 5 0 6 0 6
OUTPUT:
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6
6 5 6 5
5 6 5 6

INPUT:
8 8 8 8 6 6 6 6
8 8 8 8 6 6 6 6
8 8 8 8 6 6 6 6
8 8 8 8 6 6 6 6
1 1 1 1 4 4 4 4
5 5 5 5 4 0 0 4
1 1 1 1 4 0 0 4
5 5 5 5 4 4 4 4
OUTPUT:
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 1 1 4 4 1 1 4 4 1 1 4 4 1 1 4
4 1 1 4 4 1 1 4 4 1 1 4 4 1 1 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 5 5 4 4 5 5 4 4 5 5 4 4 5 5 4
4 5 5 4 4 5 5 4 4 5 5 4 4 5 5 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 1 1 4 4 1 1 4 4 1 1 4 4 1 1 4
4 1 1 4 4 1 1 4 4 1 1 4 4 1 1 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4
4 5 5 4 4 5 5 4 4 5 5 4 4 5 5 4
4 5 5 4 4 5 5 4 4 5 5 4 4 5 5 4
4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4

INPUT:
6 6 0 0 0 0 0 0 0 0 0 4 4 4 4 4
6 6 0 0 0 0 0 0 0 0 0 4 4 4 4 4
6 6 0 0 0 0 0 0 0 0 0 0 0 0 0 0
6 6 0 0 0 0 0 0 0 0 0 0 0 0 0 0
6 6 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
1 1 1 1 1 1 1 1 8 0 8 0 0 6 0 6
1 1 1 1 1 1 1 1 0 8 0 0 0 0 6 0
1 1 1 1 1 1 1 1 8 0 8 0 0 6 0 6
1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0
1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0
1 1 1 1 1 1 1 1 6 0 6 0 0 8 0 8
1 1 1 1 1 1 1 1 0 6 0 0 0 0 8 0
1 1 1 1 1 1 1 1 6 0 6 0 0 8 0 8
OUTPUT:
8 1 8 1 1 6 1 6 8 1
1 8 1 1 1 1 6 1 1 8
8 1 8 1 1 6 1 6 8 1
1 1 1 1 1 1 1 1 1 1
1 1 1 1 1 1 1 1 1 1
6 1 6 1 1 8 1 8 6 1
1 6 1 1 1 1 8 1 1 6
6 1 6 1 1 8 1 8 6 1
8 1 8 1 1 6 1 6 8 1
1 8 1 1 1 1 6 1 1 8

INPUT:
4 4 4 4 4 4 4 4
0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0
2 5 2 5 0 0 0 0
2 5 2 5 0 0 0 0
2 5 2 5 0 0 0 0
2 5 2 5 0 0 0 0
OUTPUT:
2 5 2 5
2 5 2 5
2 5 2 5
2 5 2 5

INPUT:
8 0 8 0 4 0 4 0
0 0 0 0 0 0 0 0
0 0 8 0 4 0 0 4
0 0 0 0 0 0 0 0
6 6 6 6 1 1 1 1
6 6 6 6 0 0 0 0
6 6 6 6 1 1 1 1
6 6 6 6 0 0 0 0
OUTPUT:
1 1 1 1
6 6 6 6
1 1 1 1

**Test Case(s):**

INPUT:
2 0 0 5 1 0 1 0
0 3 0 5 0 1 3 1
5 5 5 5 1 0 1 0
0 0 5 2 0 0 3 0
2 2 2 2 0 3 3 3
2 2 2 2 3 2 3 0
2 2 2 2 3 0 0 5
2 2 2 2 3 3 1 0

INPUT:
2 2 5 5
2 2 5 5
7 3 7 0
6 8 0 7

## Solution Requirements

Solutions to the problem must:

- Correctly identify the underlying transformation rule from the training examples (code is preferred but not required)
- Apply this rule consistently to generate the test outputs (log of executions accepted)
- Produce outputs that exactly match the expected results (perfect accuracy required)
- Demonstrate clear reasoning about the pattern you discovered

Focus on careful analysis of the visual patterns, spatial relationships, and logical transformations shown in the training examples. If possible, produce code that can be checked on training examples and applied to the test-case(s). Make sure to provide the test-case(s) output(s) in publications that propose a solution.
