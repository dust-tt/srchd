#!/usr/bin/env npx tsx

import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { db } from '@app/db/index';
import { experiments, agents, solutions, publications, messages, evolutions, reviews, citations, token_usages } from '@app/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { verifyOutputs } from '../../../problems/ARC-AGI-2/verify';

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

  console.log('\n=== 📊 ARC-AGI Experiment Status ===\n');

  for (const [problemId, experiments] of byProblem.entries()) {
    const problemIndex = problems.indexOf(problemId) + 1;
    console.log(`\nProblem #${problemIndex}: ${problemId}`);
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
  const baseExperimentName = `arc-agi-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;
  const problemPath = `problems/ARC-AGI-2/generated/${problemId}/problem`;
  const problemJsonPath = `problems/ARC-AGI-2/generated/${problemId}/problem.json`;

  console.log(`\n🚀 Starting experiment:`);
  console.log(`   Problem: #${index} (${problemId})`);
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
        `npx tsx src/srchd.ts experiment create ${experimentName} -p ${problemPath}`
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
        `npx tsx src/srchd.ts agent create -e ${experimentName} -n agent -c ${agentsToCreate} -m ${model} -t high -p arc-agi`
      );
    } else {
      console.log(`   ✓ All ${numAgents} agents already exist`);
    }

    // Step 3: Run all agents
    console.log(`\n▶️  Step 3: Running all agents with budget $${budget}...`);
    const reviewers = numAgents < 5 ? numAgents - 1 : 4;
    executeCommand(
      `npx tsx src/srchd.ts agent run all -e ${experimentName} -p ${problemJsonPath} --max-cost ${budget} -r ${reviewers}`
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
async function verifyExperiment(
  index: number,
  numAgents: number,
  budget: number,
  variant: string | null
): Promise<void> {
  const problems = loadProblems();

  // Validate index
  if (index < 1 || index > problems.length) {
    console.error(`\n❌ Invalid index: ${index}. Must be between 1 and ${problems.length}`);
    process.exit(1);
  }

  const problemId = problems[index - 1];
  const baseExperimentName = `arc-agi-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;

  console.log(`\n🔍 Verifying experiment solution:`);
  console.log(`   Problem: #${index} (${problemId})`);
  console.log(`   Experiment: ${experimentName}\n`);

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

  // Gather metrics
  console.log('📊 Gathering experiment metrics...\n');

  // Count publications
  const allPublications = db
    .select()
    .from(publications)
    .where(eq(publications.experiment, expId))
    .all();

  const publishedCount = allPublications.filter(p => p.status === 'PUBLISHED').length;

  // Count unique solutions
  const allSolutions = db
    .select()
    .from(solutions)
    .where(eq(solutions.experiment, expId))
    .all();

  const uniqueSolutions = new Set(allSolutions.map(s => s.publication).filter(p => p !== null)).size;

  // Calculate total tokens (in millions)
  const tokenStats = db
    .select()
    .from(token_usages)
    .where(eq(token_usages.experiment, expId))
    .all();

  const totalTokens = tokenStats.reduce((sum, t) => sum + t.total, 0);
  const mtokens = (totalTokens / 1_000_000).toFixed(2);



  // Get most voted solution (most recent by any agent)
  const solutionsList = allSolutions;

  let verifyResult: { success: boolean; error?: string; percentage: number; passed: number; total: number } | null = null;

  if (solutionsList.length === 0) {
    console.log(`⚠️  No solutions found for experiment '${experimentName}'\n`);
  } else {
    // Count votes for each publication
    const voteCounts = new Map<number, number>();
    for (const sol of solutionsList) {
      if (sol.publication) {
        voteCounts.set(sol.publication, (voteCounts.get(sol.publication) || 0) + 1);
      }
    }

    if (voteCounts.size === 0) {
      console.log(`⚠️  No publications referenced in solutions\n`);
    } else {
      // Find most voted publication
      const mostVotedPubId = Array.from(voteCounts.entries())
        .sort((a, b) => b[1] - a[1])[0][0];

      console.log(`📊 Most voted solution has ${voteCounts.get(mostVotedPubId)} vote(s)\n`);

      // Get the publication
      const publication = db
        .select()
        .from(publications)
        .where(eq(publications.id, mostVotedPubId))
        .get();

      if (!publication) {
        console.log(`⚠️  Publication not found\n`);
      } else {
        const reference = publication.reference;
        console.log(`📄 Publication reference: ${reference}`);

        // Check for attachments
        const attachmentsDir = path.join(
          __dirname,
          '../../..',
          'attachments',
          `${experiment.id}`,
          reference
        );

        if (!fs.existsSync(attachmentsDir)) {
          console.log(`⚠️  No attachments found for publication '${reference}'`);
          console.log(`   Expected path: ${attachmentsDir}\n`);
        } else {
          const files = fs.readdirSync(attachmentsDir);
          const jsonFiles = files.filter(f => f.endsWith('.json'));

          if (jsonFiles.length === 0) {
            console.log(`⚠️  No JSON files found in attachments`);
            console.log(`   Available files: ${files.join(', ')}\n`);
          } else {
            // Priority: outputs.json, else ask user
            let selectedFile: string;
            if (jsonFiles.includes('outputs.json')) {
              selectedFile = 'outputs.json';
              console.log(`✓ Using outputs.json\n`);
            } else if (jsonFiles.length === 1) {
              selectedFile = jsonFiles[0];
              console.log(`✓ Using ${selectedFile}\n`);
            } else {
              console.log(`📎 Found ${jsonFiles.length} JSON file(s): ${jsonFiles.join(', ')}\n`);
              const selection = await askSelection('Multiple JSON files found. Select one:', jsonFiles);
              selectedFile = jsonFiles[selection];
              console.log(`✓ Selected ${selectedFile}\n`);
            }

            const outputsPath = path.join(attachmentsDir, selectedFile);

            console.log(`🧪 Running verification...\n`);

            // Use verify library
            verifyResult = await verifyOutputs(
              problemId,
              outputsPath,
              path.join(__dirname, '../../../problems/ARC-AGI-2')
            );
          }
        }
      }
    }
  }

  // Display metrics table with verification results
  const metricsData = [{
    'Performance': verifyResult ? (verifyResult.error ? 'ERROR' : `${verifyResult.percentage}%`) : 'N/A',
    'Unique Solutions': uniqueSolutions,
    'Total Publications': allPublications.length,
  }];

  console.table(metricsData);
  console.log('');

  if (verifyResult) {
    if (verifyResult.error) {
      console.error(`❌ Verification error: ${verifyResult.error}`);
      process.exit(1);
    }

    if (verifyResult.success) {
      console.log(`✅ All ${verifyResult.total} test case(s) passed!`);
    } else {
      console.log(`⚠️  Passed ${verifyResult.passed}/${verifyResult.total} test case(s) (${verifyResult.percentage}%)`);
    }
  } else {
    console.log(`ℹ️  No verification performed (no valid solution found)`);
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
  const baseExperimentName = `arc-agi-${problemId}-${numAgents}agents`;
  const experimentName = variant ? `${baseExperimentName}-${variant}` : baseExperimentName;

  console.log(`\n🧹 Cleaning experiment resources:`);
  console.log(`   Problem: #${index} (${problemId})`);
  console.log(`   Experiment: ${experimentName}\n`);

  // Step 1: Delete Kubernetes pods
  const podPattern = `srchd-default-${experimentName}-`;

  console.log(`📦 Looking for pods matching: ${podPattern}*`);

  try {
    // Get matching pods
    const listResult = execSync('kubectl get pods -o name', {
      encoding: 'utf-8',
      cwd: path.join(__dirname, '../../..')
    });

    const allPods = listResult.split('\n').filter(line => line.trim());
    const matchingPods = allPods.filter(pod => pod.includes(podPattern));

    if (matchingPods.length === 0) {
      console.log('   No matching pods found\n');
    } else {
      console.log(`   Found ${matchingPods.length} pod(s) to delete:`);
      matchingPods.forEach(pod => console.log(`   - ${pod}`));
      console.log('');

      const shouldDelete = await askConfirmation('Delete these pods?');
      if (shouldDelete) {
        console.log('   Deleting pods (async)...');

        // Build grep pattern: pod1|pod2|pod3
        const podNames = matchingPods.map(pod => pod.replace('pod/', ''));
        const grepPattern = podNames.join('|');

        // Run deletion in background (detached)
        spawn('sh', ['-c', `kubectl get pods -o name | grep -E '${grepPattern}' | xargs kubectl delete`], {
          cwd: path.join(__dirname, '../../..'),
          detached: true,
          stdio: 'ignore'
        }).unref();

        console.log('   ✅ Pod deletion started in background\n');
      } else {
        console.log('   Skipped pod deletion\n');
      }
    }
  } catch (error) {
    console.error('   ⚠️  Failed to list/delete pods:', error instanceof Error ? error.message : String(error));
  }

  // Step 2: Delete database data if requested
  if (deleteData) {
    console.log('🗑️  Deleting database data...');

    // Find experiment
    const experiment = db
      .select()
      .from(experiments)
      .where(eq(experiments.name, experimentName))
      .get();

    if (!experiment) {
      console.log('   No experiment found in database with that name\n');
      return;
    }

    const expId = experiment.id;
    console.log(`   Found experiment: ${experimentName} (id: ${expId})`);

    const shouldDeleteData = await askConfirmation('Delete ALL database data for this experiment? This cannot be undone!');

    if (shouldDeleteData) {
      try {
        // Delete in order respecting foreign key constraints
        console.log('   Deleting token_usages...');
        db.delete(token_usages).where(eq(token_usages.experiment, expId)).run();

        console.log('   Deleting messages...');
        db.delete(messages).where(eq(messages.experiment, expId)).run();

        console.log('   Deleting evolutions...');
        db.delete(evolutions).where(eq(evolutions.experiment, expId)).run();

        console.log('   Deleting reviews...');
        db.delete(reviews).where(eq(reviews.experiment, expId)).run();

        console.log('   Deleting citations...');
        db.delete(citations).where(eq(citations.experiment, expId)).run();

        console.log('   Deleting solutions...');
        db.delete(solutions).where(eq(solutions.experiment, expId)).run();

        console.log('   Deleting publications...');
        db.delete(publications).where(eq(publications.experiment, expId)).run();

        console.log('   Deleting agents...');
        db.delete(agents).where(eq(agents.experiment, expId)).run();

        console.log('   Deleting experiment...');
        db.delete(experiments).where(eq(experiments.id, expId)).run();

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
    .name('arc-agi-runner')
    .description('ARC-AGI Experiment Runner - Manage and run experiments')
    .version('1.0.0');

  program
    .command('list')
    .description('List all experiments and their status')
    .action(() => {
      listExperiments();
    });

  program
    .command('run')
    .description('Run an experiment with specified configuration')
    .argument('<index>', 'Problem index (1-32)', (val) => {
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
    .argument('<index>', 'Problem index (1-32)', (val) => {
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
    .action(async (index, options) => {
      if (!options.agents || !options.budget) {
        console.error('\n❌ Error: Both --agents and --budget options are required');
        console.error('Usage: npx tsx runner.ts verify <index> -a <agents> -b <budget> [-v <variant>]');
        console.error('Example: npx tsx runner.ts verify 1 -a 5 -b 50 -v test1\n');
        process.exit(1);
      }

      await verifyExperiment(
        index,
        options.agents,
        options.budget,
        options.variant || null
      );
    });

  program
    .command('clean')
    .description('Clean up experiment resources (pods and optionally data)')
    .argument('<index>', 'Problem index (1-32)', (val) => {
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
