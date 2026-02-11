#!/usr/bin/env npx tsx

import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { db } from '@app/db/index';
import { experiments, agents, solutions, publications } from '@app/db/schema';
import { eq } from 'drizzle-orm';
import { verifyExperiment } from '../../../problems/cybergym/arvos/verify';
import { ExperimentResource } from '@app/resources/experiment';
import { TokenUsageResource } from '@app/resources/token_usage';

// Types
interface ExperimentRecord {
  problemId: string;
  problemIndex: number;
  numAgents: number;
  budget: number;
  model: string;
  variant: string | null;
  experimentName: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  lastRun: string;
  completedAt: string | null;
}

interface StatusFile {
  experiments: ExperimentRecord[];
}

// Constants
const PROBLEMS_FILE = path.join(__dirname, 'problems.json');
const STATUS_FILE = path.join(__dirname, 'status.json');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Load problems
function loadProblems(): string[] {
  const content = fs.readFileSync(PROBLEMS_FILE, 'utf-8');
  return JSON.parse(content);
}

// Load or create status file
function loadStatus(): StatusFile {
  if (!fs.existsSync(STATUS_FILE)) {
    return { experiments: [] };
  }
  const content = fs.readFileSync(STATUS_FILE, 'utf-8');
  return JSON.parse(content);
}

// Save status file
function saveStatus(status: StatusFile): void {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

// Execute shell command with retries
function executeCommand(command: string, retryCount: number = 0): void {
  try {
    console.log(`\n[CMD] ${command}`);
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '../../..') });
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.error(`\n[ERROR] Command failed (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      console.log(`[RETRY] Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
      execSync(`sleep ${RETRY_DELAY_MS / 1000}`);
      executeCommand(command, retryCount + 1);
    } else {
      throw error;
    }
  }
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

// Ask for selection from list
function askSelection(question: string, options: string[]): Promise<number> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(question);
    options.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt}`);
    });
    rl.question('Enter number: ', (answer) => {
      rl.close();
      const num = parseInt(answer);
      if (isNaN(num) || num < 1 || num > options.length) {
        console.error('Invalid selection');
        process.exit(1);
      }
      resolve(num - 1);
    });
  });
}

// Find existing experiment record
function findExperimentRecord(
  status: StatusFile,
  problemId: string,
  numAgents: number,
  budget: number,
  variant: string | null
): ExperimentRecord | undefined {
  return status.experiments.find(
    (exp) =>
      exp.problemId === problemId &&
      exp.numAgents === numAgents &&
      exp.budget === budget &&
      exp.variant === variant
  );
}

// Check if experiment exists in database
function experimentExists(experimentName: string): boolean {
  const result = db
    .select()
    .from(experiments)
    .where(eq(experiments.name, experimentName))
    .get();
  return !!result;
}

// Count agents in experiment
function countAgents(experimentName: string): number {
  const experiment = db
    .select()
    .from(experiments)
    .where(eq(experiments.name, experimentName))
    .get();

  if (!experiment) return 0;

  const agentList = db
    .select()
    .from(agents)
    .where(eq(agents.experiment, experiment.id))
    .all();

  return agentList.length;
}

// List all experiments
function listExperiments(): void {
  const status = loadStatus();
  const problems = loadProblems();

  if (status.experiments.length === 0) {
    console.log('\n📊 No experiments have been run yet.\n');
    return;
  }

  // Group by problem
  const byProblem = new Map<string, ExperimentRecord[]>();
  for (const exp of status.experiments) {
    if (!byProblem.has(exp.problemId)) {
      byProblem.set(exp.problemId, []);
    }
    byProblem.get(exp.problemId)!.push(exp);
  }

  console.log('\n=== 📊 CyberGym Experiment Status ===\n');

  for (const [problemId, experiments] of byProblem.entries()) {
    const problemIndex = problems.indexOf(problemId) + 1;
    console.log(`\nProblem #${problemIndex}: arvo:${problemId}`);
    console.log('─'.repeat(100));

    // Sort by agents, then budget
    experiments.sort((a, b) => {
      if (a.numAgents !== b.numAgents) return a.numAgents - b.numAgents;
      return a.budget - b.budget;
    });

    // Prepare table data
    const tableData = experiments.map((exp) => {
      const statusEmoji = {
        completed: '✅',
        in_progress: '🔄',
        failed: '❌',
        not_started: '⏸️',
      }[exp.status];

      const lastRun = exp.lastRun
        ? new Date(exp.lastRun).toLocaleString()
        : 'Never';

      const completedAt = exp.completedAt
        ? new Date(exp.completedAt).toLocaleString()
        : '-';

      return {
        Agents: exp.numAgents,
        Budget: `$${exp.budget}`,
        Model: exp.model,
        Variant: exp.variant || '-',
        Status: `${statusEmoji} ${exp.status}`,
        Retries: exp.retryCount,
        'Last Run': lastRun,
        'Completed': completedAt,
        Error: exp.lastError ? exp.lastError.substring(0, 40) + '...' : '-',
      };
    });

    console.table(tableData);
  }

  // Summary
  const total = status.experiments.length;
  const completed = status.experiments.filter((e) => e.status === 'completed').length;
  const inProgress = status.experiments.filter((e) => e.status === 'in_progress').length;
  const failed = status.experiments.filter((e) => e.status === 'failed').length;

  console.log('='.repeat(100));
  console.log(
    `📈 Summary: ${completed} completed, ${inProgress} in progress, ${failed} failed (${total} total)`
  );
  console.log('='.repeat(100) + '\n');
}

// Run an experiment
async function runExperiment(
  index: number,
  numAgents: number,
  budget: number,
  model: string,
  variant: string | null
): Promise<void> {
  const problems = loadProblems();

  // Validate index
  if (index < 1 || index > problems.length) {
    console.error(`\n❌ Invalid index: ${index}. Must be between 1 and ${problems.length}`);
    process.exit(1);
  }

  const problemId = problems[index - 1];
  const baseExperimentName = `cybergym-arvo-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;
  const problemIdPath = `cybergym/arvos/${problemId}`;

  console.log(`\n🚀 Starting CyberGym experiment:`);
  console.log(`   Problem: #${index} (arvo:${problemId})`);
  console.log(`   Experiment: ${experimentName}`);
  console.log(`   Agents: ${numAgents}`);
  console.log(`   Model: ${model}`);
  console.log(`   Budget: $${budget}`);
  if (variant) {
    console.log(`   Variant: ${variant}`);
  }

  // Load status
  const status = loadStatus();
  let record = findExperimentRecord(status, problemId, numAgents, budget, variant);

  // Check if already completed
  if (record && record.status === 'completed') {
    console.log(`\n⚠️  This experiment has already been completed.`);
    const shouldContinue = await askConfirmation('Do you want to run it again?');
    if (!shouldContinue) {
      console.log('Aborted.');
      return;
    }
  }

  // Create or update record
  if (!record) {
    record = {
      problemId,
      problemIndex: index,
      numAgents,
      budget,
      model,
      variant,
      experimentName,
      status: 'not_started',
      retryCount: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      lastRun: new Date().toISOString(),
      completedAt: null,
    };
    status.experiments.push(record);
  }

  // Update status to in_progress
  record.status = 'in_progress';
  record.lastRun = new Date().toISOString();
  saveStatus(status);

  try {
    // Step 1: Create experiment (if it doesn't exist)
    console.log('\n📝 Step 1: Checking/creating experiment...');
    if (!experimentExists(experimentName)) {
      console.log(`   Creating experiment: ${experimentName}`);
      executeCommand(
        `npx tsx src/srchd.ts experiment create ${experimentName} -p ${problemIdPath}`
      );
    } else {
      console.log(`   ✓ Experiment already exists: ${experimentName}`);
    }

    // Step 2: Create agents (if they don't exist)
    console.log(`\n🤖 Step 2: Checking/creating ${numAgents} agents...`);
    const existingAgents = countAgents(experimentName);

    if (existingAgents < numAgents) {
      const agentsToCreate = numAgents - existingAgents;
      console.log(`   Creating ${agentsToCreate} more agents (${existingAgents} already exist)...`);
      executeCommand(
        `npx tsx src/srchd.ts agent create -e ${experimentName} -n agent -c ${agentsToCreate} -m ${model} -t high -p security-process`
      );
    } else {
      console.log(`   ✓ All ${numAgents} agents already exist`);
    }

    // Step 3: Run all agents
    console.log(`\n▶️  Step 3: Running all agents with budget $${budget}...`);
    const reviewers = numAgents < 5 ? numAgents - 1 : 4;
    executeCommand(
      `npx tsx src/srchd.ts agent run all -e ${experimentName} --max-cost ${budget} -r ${reviewers}`
    );

    // Success!
    record.status = 'completed';
    record.completedAt = new Date().toISOString();
    record.lastError = null;
    saveStatus(status);

    console.log(`\n✅ Experiment completed successfully!`);
  } catch (error) {
    // Handle failure
    record.retryCount += 1;
    record.lastError = error instanceof Error ? error.message : String(error);

    if (record.retryCount >= MAX_RETRIES) {
      record.status = 'failed';
      console.error(`\n❌ Experiment failed after ${MAX_RETRIES} attempts.`);
    } else {
      console.error(`\n⚠️  Attempt ${record.retryCount} failed. Can retry later.`);
    }

    saveStatus(status);
    throw error;
  }
}

// Verify experiment solution
async function verifyExperimentCmd(
  index: number,
  numAgents: number,
  budget: number,
  variant: string | null,
  verbose: boolean = false
): Promise<void> {
  const problems = loadProblems();

  // Validate index
  if (index < 1 || index > problems.length) {
    console.error(`\n❌ Invalid index: ${index}. Must be between 1 and ${problems.length}`);
    process.exit(1);
  }

  const problemId = problems[index - 1];
  const baseExperimentName = `cybergym-arvo-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;

  if (verbose) {
    console.log(`\n🔍 Verifying experiment solution:`);
    console.log(`   Problem: #${index} (arvo:${problemId})`);
    console.log(`   Experiment: ${experimentName}\n`);
  }

  // Check if experiment exists
  const experiment = db
    .select()
    .from(experiments)
    .where(eq(experiments.name, experimentName))
    .get();

  if (!experiment) {
    console.error(`❌ Error: Experiment '${experimentName}' not found`);
    process.exit(1);
  }

  const expId = experiment.id;

  if (verbose) {
    console.log('📊 Gathering experiment metrics...\n');
  }

  // Count publications
  const allPublications = db
    .select()
    .from(publications)
    .where(eq(publications.experiment, expId))
    .all();

  // Count unique solutions
  const allSolutions = db
    .select()
    .from(solutions)
    .where(eq(solutions.experiment, expId))
    .all();

  const uniqueSolutions = new Set(allSolutions.map(s => s.publication).filter(p => p !== null)).size;

  // Calculate total cost using TokenUsageResource
  const experimentResourceResult = await ExperimentResource.findById(expId);
  if (experimentResourceResult.isErr()) {
    console.error(`❌ Error: Failed to load experiment resource`);
    process.exit(1);
  }
  const totalCost = await TokenUsageResource.experimentCost(experimentResourceResult.value);

  // Run verification using CyberGym verify
  let verifyResult: { success: boolean; error?: string; exitCode?: number } | null = null;

  if (verbose) {
    console.log(`🧪 Running CyberGym verification...\n`);
  }

  try {
    const result = await verifyExperiment(experimentName);
    verifyResult = {
      success: result.success,
      exitCode: result.exitCode,
      error: result.error,
    };

    if (verbose && result.output) {
      console.log('Output:', result.output.substring(0, 500));
    }
  } catch (error) {
    verifyResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Display simplified metrics table
  const metricsData = [{
    'Task': `arvo:${problemId}`,
    'Verified': verifyResult?.success ? '✅' : '❌',
    'Exit': verifyResult?.exitCode ?? 'N/A',
    'Sol': uniqueSolutions,
    'Pub': allPublications.length,
    'Cost': `$${totalCost.toFixed(2)}`,
  }];

  console.table(metricsData);

  // Show errors
  if (verifyResult && verifyResult.error) {
    console.error(`❌ Verification error: ${verifyResult.error}`);
    process.exit(1);
  }
}

// Clean experiment resources
async function cleanExperiment(
  index: number,
  numAgents: number,
  budget: number,
  variant: string | null,
  deleteData: boolean
): Promise<void> {
  const problems = loadProblems();

  // Validate index
  if (index < 1 || index > problems.length) {
    console.error(`\n❌ Invalid index: ${index}. Must be between 1 and ${problems.length}`);
    process.exit(1);
  }

  const problemId = problems[index - 1];
  const baseExperimentName = `cybergym-arvo-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;

  console.log(`\n🧹 Cleaning experiment resources:`);
  console.log(`   Problem: #${index} (arvo:${problemId})`);
  console.log(`   Experiment: ${experimentName}\n`);

  // Step 1: Clean pods and PVCs using srchd clean command
  console.log(`📦 Cleaning Kubernetes resources for experiment: ${experimentName}`);

  try {
    const cleanArgs = ['npx', 'tsx', 'src/srchd.ts', 'clean', experimentName, '-a', 'all'];

    if (!deleteData) {
      // Only delete pods, keep volumes
      cleanArgs.push('--pods-only');
    }

    // Always add -y flag to skip confirmation since we'll confirm here
    cleanArgs.push('-y');

    const shouldClean = await askConfirmation(`Delete pods${deleteData ? ' and volumes' : ' (keeping volumes)'}?`);
    if (shouldClean) {
      console.log('   Running cleanup...');

      execSync(cleanArgs.join(' '), {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../../..')
      });

      console.log('   ✅ Cleanup complete\n');
    } else {
      console.log('   Skipped cleanup\n');
    }
  } catch (error) {
    console.error('   ⚠️  Failed to clean resources:', error instanceof Error ? error.message : String(error));
  }

  // Step 2: Delete database data if requested
  if (deleteData) {
    console.log('🗑️  Deleting database data...');

    // Use ExperimentResource to properly delete experiment and all related data
    const experiment = await ExperimentResource.findByName(experimentName);

    if (experiment.isErr()) {
      console.log('   No experiment found in database with that name\n');
      return;
    }

    const shouldDeleteData = await askConfirmation('Delete ALL database data for this experiment? This cannot be undone!');

    if (shouldDeleteData) {
      try {
        console.log('   Deleting experiment and all related data...');
        await experiment.value.delete();
        console.log('   ✅ Database data deleted\n');
      } catch (error) {
        console.error('   ❌ Error deleting data:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    } else {
      console.log('   Skipped database deletion\n');
    }
  }

  console.log('✅ Cleanup complete!\n');
}

// Main
async function main() {
  const program = new Command();

  program
    .name('cybergym-runner')
    .description('CyberGym Experiment Runner - Manage and run security vulnerability experiments')
    .version('1.0.0');

  program
    .command('list')
    .description('List all experiments and their status')
    .action(() => {
      listExperiments();
    });

  program
    .command('problems')
    .description('List all available CyberGym problems')
    .action(() => {
      const problems = loadProblems();
      console.log('\n📋 Available CyberGym ARVO Problems:\n');
      problems.forEach((id, idx) => {
        console.log(`  ${idx + 1}. arvo:${id}`);
      });
      console.log(`\nTotal: ${problems.length} problems\n`);
    });

  program
    .command('run')
    .description('Run an experiment with specified configuration')
    .argument('<index>', 'Problem index (1-50)', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Index must be a number');
      return num;
    })
    .option('-a, --agents <number>', 'Number of agents', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Agents must be a number');
      return num;
    })
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-m, --model <model>', 'AI model to use', 'deepseek-reasoner')
    .option('-v, --variant <variant>', 'Experiment variant name (appended to experiment name)')
    .action(async (index, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx runner.ts run <index> -a <agents> -b <budget> [-m <model>] [-v <variant>]');
        console.error('Example: npx tsx runner.ts run 1 -a 5 -b 50 -m deepseek-reasoner -v test1\n');
        process.exit(1);
      }

      await runExperiment(
        index,
        options.agents,
        options.budget,
        options.model,
        options.variant || null
      );
    });

  program
    .command('verify')
    .description('Verify the solution outputs for an experiment')
    .argument('<index>', 'Problem index (1-50)', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Index must be a number');
      return num;
    })
    .option('-a, --agents <number>', 'Number of agents', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Agents must be a number');
      return num;
    })
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-v, --variant <variant>', 'Experiment variant name')
    .option('--verbose', 'Show detailed output')
    .action(async (index, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx runner.ts verify <index> -a <agents> -b <budget> [-v <variant>] [--verbose]');
        console.error('Example: npx tsx runner.ts verify 1 -a 5 -b 50 -v test1\n');
        process.exit(1);
      }

      await verifyExperimentCmd(
        index,
        options.agents,
        options.budget,
        options.variant || null,
        options.verbose || false
      );
    });

  program
    .command('clean')
    .description('Clean up experiment resources (pods and optionally data)')
    .argument('<index>', 'Problem index (1-50)', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Index must be a number');
      return num;
    })
    .option('-a, --agents <number>', 'Number of agents', (val) => {
      const num = parseInt(val);
      if (isNaN(num)) throw new Error('Agents must be a number');
      return num;
    })
    .option('-b, --budget <number>', 'Total cost budget', (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) throw new Error('Budget must be a number');
      return num;
    })
    .option('-v, --variant <variant>', 'Experiment variant name')
    .option('--data', 'Also delete all database data for the experiment')
    .action(async (index, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx runner.ts clean <index> -a <agents> -b <budget> [-v <variant>] [--data]');
        console.error('Example: npx tsx runner.ts clean 1 -a 5 -b 50 -v test1 --data\n');
        process.exit(1);
      }

      await cleanExperiment(
        index,
        options.agents,
        options.budget,
        options.variant || null,
        options.data || false
      );
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
