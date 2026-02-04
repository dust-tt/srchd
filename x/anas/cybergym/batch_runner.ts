#!/usr/bin/env npx tsx

import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { ExperimentResource } from '@app/resources/experiment';

// Parse range expression like "1-5,8,22-25" into array of numbers
function parseRangeExpression(expr: string): number[] {
  const numbers = new Set<number>();
  const parts = expr.split(',').map(p => p.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      // Range: "1-5"
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = parseInt(startStr);
      const end = parseInt(endStr);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${part}`);
      }

      if (start > end) {
        throw new Error(`Invalid range: ${part} (start > end)`);
      }

      for (let i = start; i <= end; i++) {
        numbers.add(i);
      }
    } else {
      // Single number: "8"
      const num = parseInt(part);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${part}`);
      }
      numbers.add(num);
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

// Load problems
function loadProblems(): string[] {
  const content = require('fs').readFileSync(path.join(__dirname, 'problems.json'), 'utf-8');
  return JSON.parse(content);
}

// Ask for confirmation
function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Run a single runner.ts command
function runCommand(
  command: string,
  index: number,
  agents: number,
  budget: number,
  model?: string,
  variant?: string,
  extraArgs?: string[]
): Promise<{ success: boolean; index: number; agents: number }> {
  return new Promise((resolve) => {
    const args = [
      path.join(__dirname, 'runner.ts'),
      command,
      index.toString(),
      '-a',
      agents.toString(),
      '-b',
      budget.toString(),
    ];

    if (model) {
      args.push('-m', model);
    }

    if (variant) {
      args.push('-v', variant);
    }

    if (extraArgs) {
      args.push(...extraArgs);
    }

    const label = `[${index},${agents}]`;

    // Pipe output with labels
    console.log(`${label} Starting...`);
    const proc = spawn('npx', ['tsx', ...args], {
      cwd: path.join(__dirname, '../../..'),
      stdio: 'pipe',
    });

    let output = '';

    proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.log(`${label} ${line}`);
        }
      });
      output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.error(`${label} ${line}`);
        }
      });
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`${label} ✅ Success`);
        resolve({ success: true, index, agents });
      } else {
        console.error(`${label} ❌ Failed (exit code ${code})`);
        resolve({ success: false, index, agents });
      }
    });

    proc.on('error', (error) => {
      console.error(`${label} ❌ Error: ${error.message}`);
      resolve({ success: false, index, agents });
    });
  });
}

// Main
async function main() {
  const program = new Command();

  program
    .name('cybergym-batch-runner')
    .description('CyberGym Batch Runner - Run multiple security experiments concurrently')
    .version('1.0.0');

  program
    .command('run')
    .description('Run multiple experiments concurrently')
    .argument('<indexes>', 'Problem index range (e.g., 1-5,8,22-25)')
    .option('-a, --agents <range>', 'Number of agents range (e.g., 2-4,6)')
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-m, --model <model>', 'AI model to use')
    .option('-v, --variant <variant>', 'Experiment variant name')
    .option('-c, --concurrency <number>', 'Max concurrent runs (default: unlimited)', (val) => {
      const num = parseInt(val);
      if (isNaN(num) || num < 1) throw new Error('Concurrency must be a positive number');
      return num;
    })
    .action(async (indexesExpr, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx batch_runner.ts run <indexes> -a <agents> -b <budget> [-m <model>] [-v <variant>] [-c <concurrency>]');
        console.error('Example: npx tsx batch_runner.ts run 1-5,8 -a 3-5 -b 50 -m deepseek-reasoner -v test1 -c 4\n');
        process.exit(1);
      }

      try {
        const indexes = parseRangeExpression(indexesExpr);
        const agentCounts = parseRangeExpression(options.agents);

        console.log(`\n📦 Batch mode: ${indexes.length} problem(s) × ${agentCounts.length} agent config(s) = ${indexes.length * agentCounts.length} total run(s)`);
        console.log(`🚀 Running experiments concurrently${options.concurrency ? ` (max ${options.concurrency} at a time)` : ''}...\n`);

        // Create all combinations
        const tasks: Array<{ index: number; agents: number }> = [];
        for (const index of indexes) {
          for (const agents of agentCounts) {
            tasks.push({ index, agents });
          }
        }

        let results: Array<{ success: boolean; index: number; agents: number }>;

        if (options.concurrency) {
          // Run with concurrency limit
          results = [];
          const queue = [...tasks];
          const running: Promise<any>[] = [];

          while (queue.length > 0 || running.length > 0) {
            // Fill up to concurrency limit
            while (running.length < options.concurrency && queue.length > 0) {
              const task = queue.shift()!;
              const promise = runCommand(
                'run',
                task.index,
                task.agents,
                options.budget,
                options.model,
                options.variant
              ).then((result) => {
                results.push(result);
                return result;
              });
              running.push(promise);
            }

            // Wait for at least one to complete
            if (running.length > 0) {
              await Promise.race(running);
              // Remove completed promises
              const stillRunning = [];
              for (const p of running) {
                const settled = await Promise.race([
                  p.then(() => true),
                  Promise.resolve(false)
                ]);
                if (!settled) {
                  stillRunning.push(p);
                }
              }
              running.length = 0;
              running.push(...stillRunning);
            }
          }
        } else {
          // Run all concurrently (unlimited)
          const promises = tasks.map((task) =>
            runCommand(
              'run',
              task.index,
              task.agents,
              options.budget,
              options.model,
              options.variant
            )
          );
          results = await Promise.all(promises);
        }

        // Count successes and failures
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 Batch Summary: ${successCount} succeeded, ${failCount} failed`);
        console.log('='.repeat(80) + '\n');

        if (failCount > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('verify')
    .description('Verify multiple experiments')
    .argument('<indexes>', 'Problem index range (e.g., 1-5,8,22-25)')
    .option('-a, --agents <range>', 'Number of agents range (e.g., 2-4,6)')
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-v, --variant <variant>', 'Experiment variant name')
    .option('--verbose', 'Show detailed output')
    .action(async (indexesExpr, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx batch_runner.ts verify <indexes> -a <agents> -b <budget> [-v <variant>]');
        console.error('Example: npx tsx batch_runner.ts verify 1-5,8 -a 3-5 -b 50 -v test1\n');
        process.exit(1);
      }

      try {
        const indexes = parseRangeExpression(indexesExpr);
        const agentCounts = parseRangeExpression(options.agents);

        console.log(`\n📦 Batch mode: ${indexes.length} problem(s) × ${agentCounts.length} agent config(s) = ${indexes.length * agentCounts.length} total verification(s)\n`);

        // Create all combinations
        const tasks: Array<{ index: number; agents: number }> = [];
        for (const index of indexes) {
          for (const agents of agentCounts) {
            tasks.push({ index, agents });
          }
        }

        // Run all verifications sequentially (they're fast)
        const results: Array<{ success: boolean; index: number; agents: number }> = [];

        for (const task of tasks) {
          const extraArgs = options.verbose ? ['--verbose'] : [];
          const result = await runCommand(
            'verify',
            task.index,
            task.agents,
            options.budget,
            undefined,
            options.variant,
            extraArgs
          );
          results.push(result);
        }

        // Count successes and failures
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 Batch Summary: ${successCount} verified, ${failCount} failed`);
        console.log('='.repeat(80) + '\n');

        if (failCount > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('clean')
    .description('Clean up multiple experiment resources')
    .argument('<indexes>', 'Problem index range (e.g., 1-5,8,22-25)')
    .option('-a, --agents <range>', 'Number of agents range (e.g., 2-4,6)')
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-v, --variant <variant>', 'Experiment variant name')
    .option('--data', 'Also delete all database data for the experiments')
    .action(async (indexesExpr, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx batch_runner.ts clean <indexes> -a <agents> -b <budget> [-v <variant>] [--data]');
        console.error('Example: npx tsx batch_runner.ts clean 1-5,8 -a 3-5 -b 50 -v test1 --data\n');
        process.exit(1);
      }

      try {
        const indexes = parseRangeExpression(indexesExpr);
        const agentCounts = parseRangeExpression(options.agents);
        const problems = loadProblems();

        console.log(`\n📦 Batch mode: ${indexes.length} problem(s) × ${agentCounts.length} agent config(s) = ${indexes.length * agentCounts.length} total clean(s)\n`);

        // Build experiment names
        const experimentNames: string[] = [];
        const experimentDetails: Array<{ index: number; agents: number; problemId: string; experimentName: string }> = [];

        for (const index of indexes) {
          if (index < 1 || index > problems.length) {
            console.error(`❌ Invalid index: ${index}. Must be between 1 and ${problems.length}`);
            process.exit(1);
          }

          const problemId = problems[index - 1];
          for (const agents of agentCounts) {
            const baseExperimentName = `cybergym-arvo-${problemId}-${agents}agents`;
            const experimentName = options.variant ? `${baseExperimentName}-${options.variant}` : baseExperimentName;
            experimentNames.push(experimentName);
            experimentDetails.push({ index, agents, problemId, experimentName });
          }
        }

        console.log('🔍 Experiments to clean:');
        experimentDetails.forEach(detail => {
          console.log(`   - Problem #${detail.index} (arvo:${detail.problemId}), ${detail.agents} agent(s): ${detail.experimentName}`);
        });
        console.log('');

        const shouldClean = await askConfirmation(`Clean ${experimentNames.length} experiment(s)? (pods${options.data ? ' and volumes' : ' only, keeping volumes'})`);
        if (!shouldClean) {
          console.log('Cleanup cancelled.\n');
          return;
        }

        console.log('');

        // Use srchd clean command for each experiment
        for (let i = 0; i < experimentNames.length; i++) {
          const experimentName = experimentNames[i];
          const detail = experimentDetails[i];

          console.log(`[${i + 1}/${experimentNames.length}] Cleaning: ${experimentName}`);

          try {
            const cleanArgs = ['npx', 'tsx', 'src/srchd.ts', 'clean', experimentName, '-a', 'all'];

            if (!options.data) {
              // Only delete pods, keep volumes
              cleanArgs.push('--pods-only');
            }

            // Add -y flag to skip confirmation
            cleanArgs.push('-y');

            execSync(cleanArgs.join(' '), {
              stdio: 'pipe',
              cwd: path.join(__dirname, '../../..')
            });

            console.log(`   ✅ Cleaned successfully\n`);
          } catch (error) {
            console.error(`   ⚠️  Failed to clean: ${error instanceof Error ? error.message : String(error)}\n`);
          }
        }

        // Delete database data if requested
        if (options.data) {
          console.log('🗑️  Deleting database data...');

          let deletedCount = 0;
          for (const experimentName of experimentNames) {
            const experiment = await ExperimentResource.findByName(experimentName);

            if (experiment.isOk()) {
              try {
                await experiment.value.delete();
                deletedCount++;
              } catch (error) {
                console.error(`   ⚠️  Failed to delete ${experimentName}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }

          if (deletedCount > 0) {
            console.log(`   ✅ Deleted ${deletedCount} experiment(s) from database\n`);
          } else {
            console.log('   No experiments found in database\n');
          }
        }

        console.log('✅ Batch cleanup complete!\n');
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
