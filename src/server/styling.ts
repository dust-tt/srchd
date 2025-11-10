import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import {
  ExperimentMetrics,
  MessageMetric,
  PublicationMetric,
} from "../metrics";
import { TokenUsage } from "../models";
import assert from "assert";

export const sanitizeText = (value: unknown): string => {
  const input =
    value === null || value === undefined
      ? ""
      : typeof value === "number"
        ? value.toLocaleString()
        : String(value);
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text: string) =>
      text.replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  });
};

export const sanitizeMarkdown = (value: unknown): string => {
  const input = value === null || value === undefined ? "" : String(value);
  try {
    const html = marked.parse(input, { async: false });
    return sanitizeHtml(html, {
      allowedTags: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "hr",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "u",
        "s",
        "del",
        "code",
        "pre",
        "blockquote",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
      allowedAttributes: {
        a: ["href", "title"],
        code: ["class"],
        pre: ["class"],
      },
      allowedSchemes: ["http", "https", "mailto"],
    });
  } catch (_error) {
    // Fallback to plain text sanitization if markdown parsing fails
    return sanitizeText(input);
  }
};

export const safeScriptJSON = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export const STATUS_CLASSES = new Set(["submitted", "published", "rejected"]);
export const GRADE_CLASSES = new Set([
  "strong_accept",
  "accept",
  "reject",
  "strong_reject",
]);
export const REASON_CLASSES = new Set([
  "no_previous",
  "previous_wrong",
  "previous_improved",
  "new_approach",
]);

export const safeStatusClass = (status: unknown): string => {
  const normalized = String(status ?? "").toLowerCase();
  return STATUS_CLASSES.has(normalized) ? normalized : "unknown";
};

export const safeGradeClass = (grade: unknown): string => {
  const normalized = String(grade ?? "").toLowerCase();
  return GRADE_CLASSES.has(normalized) ? normalized : "unknown";
};

export const safeReasonClass = (reason: unknown): string => {
  const normalized = String(reason ?? "").toLowerCase();
  return REASON_CLASSES.has(normalized) ? normalized : "unknown";
};

// Base HTML template
export const baseTemplate = (
  title: string,
  content: string,
  breadcrumb?: string,
) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizeText(title)}</title>
  <style>
    body {
      font-family: monospace;
      margin: 0;
      padding: 20px;
      background: #fff;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      # box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .breadcrumb {
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
      color: #666;
      font-size: 0.9em;
    }
    .breadcrumb a {
      color: #0066cc;
      text-decoration: none;
    }
    .breadcrumb a:hover {
      text-decoration: underline;
    }
    .nav {
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .nav a {
      color: #0066cc;
      text-decoration: none;
      margin-right: 20px;
      font-weight: 500;
    }
    .nav a:hover { text-decoration: underline; }
    .card {
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 10px;
      margin-bottom: 15px;
      background: #fafafa;
    }
    .card h3 { margin-top: 0; color: #333; }
    .meta { font-size: 0.9em; color: #666; margin-top: 5px; }
    .status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: bold;
    }
    .status.published { background: #d4edda; color: #155724; }
    .status.submitted { background: #d1ecf1; color: #0c5460; }
    .status.rejected { background: #f8d7da; color: #721c24; }
    .grade {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: bold;
      margin-right: 5px;
    }
    .grade.strong_accept { background: #28a745; color: white; }
    .grade.accept { background: #6c757d; color: white; }
    .grade.reject { background: #dc3545; color: white; }
    .grade.strong_reject { background: #343a40; color: white; }
    .citations { margin-top: 10px; font-size: 0.9em; }
    .citation { margin: 5px 0; }
    .abstract {
      background: #f8f9fa;
      padding-left: 10px;
      padding-right: 10px;
      margin: 10px 0;
      font-style: italic;
      border-left: 3px solid #bbb;
    }
    .content {
      white-space: pre-wrap;
      margin-top: 10px;
    }
    .markdown-content {
      white-space: normal;
      line-height: 1.8;
    }
    .markdown-content h1,
    .markdown-content h2,
    .markdown-content h3,
    .markdown-content h4,
    .markdown-content h5,
    .markdown-content h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      color: #333;
    }
    .markdown-content h1 { font-size: 1.8em; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; }
    .markdown-content h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    .markdown-content h3 { font-size: 1.3em; }
    .markdown-content h4 { font-size: 1.1em; }
    .markdown-content p {
      margin: 1em 0;
    }
    .markdown-content ul,
    .markdown-content ol {
      margin: 1em 0;
      padding-left: 2em;
    }
    .markdown-content li {
      margin: 0.5em 0;
    }
    .markdown-content code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .markdown-content pre {
      background: #f4f4f4;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 1em 0;
    }
    .markdown-content pre code {
      background: none;
      padding: 0;
    }
    .markdown-content blockquote {
      border-left: 4px solid #ddd;
      padding-left: 1em;
      margin: 1em 0;
      color: #666;
      font-style: italic;
    }
    .markdown-content a {
      color: #0066cc;
      text-decoration: none;
    }
    .markdown-content a:hover {
      text-decoration: underline;
    }
    .markdown-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    .markdown-content th,
    .markdown-content td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    .markdown-content th {
      background: #f4f4f4;
      font-weight: bold;
    }
    .markdown-content hr {
      border: none;
      border-top: 2px solid #ddd;
      margin: 2em 0;
    }
    .reason-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: bold;
      margin-right: 8px;
    }
    .reason-badge.no_previous { background: #e3f2fd; color: #1565c0; }
    .reason-badge.previous_wrong { background: #ffebee; color: #c62828; }
    .reason-badge.previous_improved { background: #f3e5f5; color: #7b1fa2; }
    .reason-badge.new_approach { background: #e8f5e8; color: #2e7d32; }
    .count { color: #666; font-weight: normal; }
    .evolution-carousel {
      border: 1px solid #ddd;
      border-radius: 3px;
      background: #fafafa;
      margin-bottom: 15px;
    }
    .evolution-header {
      padding: 10px;
      border-bottom: 1px solid #ddd;
      justify-content: space-between;
      align-items: center;
      background: #f0f0f0;
    }
    .evolution-header a {
      color: #0066cc;
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
    }
    .evolution-content {
      padding: 15px;
    }
    .evolution-meta {
      font-size: 0.9em;
      color: #666;
      margin-bottom: 10px;
    }
    .diff-view {
      margin-top: 15px;
    }
    .diff-header {
      font-weight: bold;
      margin-bottom: 10px;
      color: #333;
    }
    .diff-content {
      white-space: pre-wrap;
      background: #f8f9fa;
      padding: 10px;
      border-radius: 3px;
      border: 1px solid #ddd;
    }
    .diff-added {
      background-color: #d4edda;
      color: #155724;
    }
    .diff-removed {
      background-color: #f8d7da;
      color: #721c24;
    }
    .solution-chart {
      margin: 15px 0;
    }
    .chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-top: 10px;
      font-size: 0.9em;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .legend-color {
      width: 16px;
      height: 3px;
      border-radius: 1px;
    }
    #solutionChart {
      border: 1px solid #ddd;
      border-radius: 3px;
      background: white;
    }
    .chart-axis {
      stroke: #666;
      stroke-width: 1;
    }
    .chart-grid {
      stroke: #eee;
      stroke-width: 0.5;
    }
    .chart-text {
      fill: #666;
      font-size: 11px;
      font-family: monospace;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 10px 0;
    }
    .metric-item {
      background: #f8f9fa;
      padding: 8px;
      border-radius: 3px;
      border: 1px solid #e0e0e0;
    }
    .metric-label {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 3px;
    }
    .metric-value {
      font-size: 1.2em;
      font-weight: bold;
      color: #333;
    }
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 0.9em;
    }
    .metrics-table th,
    .metrics-table td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    .metrics-table th {
      background: #f0f0f0;
      font-weight: bold;
      color: #555;
    }
    .metrics-table tr:hover {
      background: #f8f9fa;
    }
  </style>
</head>
<body>
  <div class="container">
    ${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ""}
    ${content}
  </div>
</body>
</html>
`;

// Helper to create experiment nav for pages within an experiment
export const experimentNav = (experimentId: number, current: string) => `
  <div class="nav">
    <a href="/experiments/${experimentId}"${
      current === "overview" ? ' style="font-weight: bold;"' : ""
    }>Overview</a>
    <a href="/experiments/${experimentId}/agents"${
      current === "agents" ? ' style="font-weight: bold;"' : ""
    }>Agents</a>
    <a href="/experiments/${experimentId}/publications"${
      current === "publications" ? ' style="font-weight: bold;"' : ""
    }>Publications</a>
    <a href="/experiments/${experimentId}/solutions"${
      current === "solutions" ? ' style="font-weight: bold;"' : ""
    }>Solutions</a>
  </div>
`;

// Helper to get solution color for charts
export const getSolutionColor = (index: number) => {
  const colors = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#aec7e8",
    "#ffbb78",
    "#98df8a",
    "#ff9896",
    "#c5b0d5",
  ];
  return colors[index % colors.length];
};

// Prepare chart data for solution evolution timeline
export const prepareChartData = (solutions: any[]) => {
  if (solutions.length === 0) {
    return { timePoints: [], publicationLines: [] };
  }

  // Get all unique timestamps and sort them
  const allTimestamps = solutions.map((sol) =>
    new Date(sol.toJSON().created).getTime(),
  );
  const uniqueTimestamps = [...new Set(allTimestamps)].sort();
  const timePoints = uniqueTimestamps.map((ts) => new Date(ts));

  // Get all unique publication references
  const publicationRefs = new Set<string>();
  solutions.forEach((sol) => {
    const solData = sol.toJSON();
    if (solData.publication && solData.publication.reference) {
      publicationRefs.add(solData.publication.reference);
    }
  });

  // Sort solutions by creation time
  const sortedSolutions = solutions
    .map((sol) => sol.toJSON())
    .sort(
      (a: any, b: any) =>
        new Date(a.created).getTime() - new Date(b.created).getTime(),
    );

  // Track current solution support for each publication over time
  const publicationSupport = new Map<string, number>();
  const agentCurrentSolution = new Map<number, string>(); // agentId -> current publication reference

  // Create timeline data
  const publicationLines = new Map<string, any>();
  let colorIndex = 0;

  // Initialize publication lines
  Array.from(publicationRefs).forEach((ref) => {
    publicationLines.set(ref, {
      reference: ref,
      points: [],
      color: getSolutionColor(colorIndex++),
      currentSupport: 0,
    });
    publicationSupport.set(ref, 0);
  });

  // Process each solution in chronological order
  sortedSolutions.forEach((solution) => {
    const agentId = solution.agent.id;
    const newRef = solution.publication ? solution.publication.reference : null;
    const solutionTime = new Date(solution.created);

    // Get agent's previous solution
    const previousRef = agentCurrentSolution.get(agentId);

    // Update support counts
    if (previousRef && publicationSupport.has(previousRef)) {
      const newSupport = Math.max(0, publicationSupport.get(previousRef)! - 1);
      publicationSupport.set(previousRef, newSupport);

      // Add point to previous publication line
      const prevLine = publicationLines.get(previousRef);
      if (prevLine) {
        prevLine.points.push({
          time: solutionTime,
          support: newSupport,
        });
        prevLine.currentSupport = newSupport;
      }
    }

    if (newRef && publicationSupport.has(newRef)) {
      const newSupport = publicationSupport.get(newRef)! + 1;
      publicationSupport.set(newRef, newSupport);

      // Add point to new publication line
      const newLine = publicationLines.get(newRef);
      if (newLine) {
        newLine.points.push({
          time: solutionTime,
          support: newSupport,
        });
        newLine.currentSupport = newSupport;
      }

      // Update agent's current solution
      agentCurrentSolution.set(agentId, newRef);
    } else if (newRef === null) {
      // Agent removed their solution (no publication)
      agentCurrentSolution.delete(agentId);
    }
  });

  // Convert map to array and filter out publications with no points
  const publicationLinesArray = Array.from(publicationLines.values())
    .filter((line) => line.points.length > 0)
    .map((line) => {
      // Sort points by time
      line.points.sort(
        (a: any, b: any) =>
          new Date(a.time).getTime() - new Date(b.time).getTime(),
      );
      return line;
    });

  return {
    timePoints,
    publicationLines: publicationLinesArray,
  };
};

const renderMetricsTable = <M extends object>(
  metrics: ExperimentMetrics<M>,
  title: string,
  metricKeys: string[],
  columnNames: string[],
) => {
  const exp = metrics.experiment;
  const agents = Object.entries(metrics.agents);

  assert(
    metricKeys.every((key) => key in exp),
    `Invalid keys: ${metricKeys.join(", ")}, expected: ${Object.keys(exp).join(", ")}`,
  );
  assert(
    metricKeys.length === columnNames.length,
    `Keys and column names must have the same length`,
  );

  const experiment = `
    <div class="metrics-grid">
    ${metricKeys
      .map(
        (key, i) => `<div class="metric-item">
      <div class="metric-label">${columnNames[i]}</div>
      <div class="metric-value">${sanitizeText(exp[key as keyof M])}</div>
      </div>`,
      )
      .join("")}
    </div>`;

  const agentsTable = `
    <h4 style="margin-top: 15px; margin-bottom: 10px;">Per Agent</h4>
    <table class="metrics-table">
      <thead>
        <tr>
          <th>Agent</th>
          ${columnNames.map((name) => `<th>${name}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${agents
          .map(
            ([name, metric]) => `
          <tr>
            <td>${sanitizeText(name)}</td>
            ${metricKeys
              .map((key) => `<td>${sanitizeText(metric[key as keyof M])}</td>`)
              .join("")}
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>`;

  return `
    <div class="card">
      <h3>${title}</h3>
      ${experiment}
      ${agents.length > 0 ? agentsTable : ""}
    </div>
  `;
};

export const renderMessageMetrics = (
  metrics: ExperimentMetrics<MessageMetric>,
) => {
  return renderMetricsTable(
    metrics,
    "Message Metrics",
    ["totalMessages", "toolCalls", "thinking", "agentMessages"],
    ["Total Messages", "Tool Calls", "Thinking", "Agent Messages"],
  );
};

export const renderTokenUsageMetrics = (
  metrics: ExperimentMetrics<TokenUsage>,
) => {
  return renderMetricsTable(
    metrics,
    "Token Usage Metrics",
    ["total", "input", "cached", "thinking", "output"],
    [
      "Total Tokens",
      "Input Tokens",
      "Cached Tokens",
      "Thinking Tokens",
      "Output Tokens",
    ],
  );
};

export const renderPublicationMetrics = (
  metrics: ExperimentMetrics<PublicationMetric>,
) => {
  return renderMetricsTable(
    metrics,
    "Publication Metrics",
    ["totalPublications", "totalPublished"],
    ["Total Publications", "Published"],
  );
};
