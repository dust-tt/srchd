import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import {
  ExperimentMetrics,
  MessageMetric,
  PublicationMetric,
  RuntimeMetric,
} from "@app/metrics";
import {
  Message,
  TextContent,
  Thinking,
  TokenUsage,
  ToolResult,
  ToolUse,
} from "@app/models";
import assert from "assert";

// Format numbers with K/M suffixes (e.g., 32.5M, 862k)
export const formatNumber = (value: number): string => {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return thousands % 1 === 0 ? `${thousands}k` : `${thousands.toFixed(1)}k`;
  }
  return value.toString();
};

// Format runtime in human-readable format (e.g., "2h 15m 30s")
export const formatRuntime = (totalMs: number): string => {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = "";
  if (hours > 0) {
    formatted += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    formatted += `${minutes}m `;
  }
  formatted += `${seconds}s`;
  return formatted.trim();
};

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
        // Add KaTeX tags
        "span",
        "math",
        "annotation",
        "semantics",
        "mrow",
        "mi",
        "mo",
        "mn",
        "msup",
        "msub",
        "mfrac",
        "mroot",
        "msqrt",
        "mtext",
        "mspace",
      ],
      allowedAttributes: {
        a: ["href", "title"],
        code: ["class"],
        pre: ["class"],
        // Add KaTeX attributes
        span: ["class", "style", "aria-hidden"],
        math: ["xmlns"],
        annotation: ["encoding"],
      },
      allowedSchemes: ["http", "https", "mailto"],
      // Preserve text content (important for $ delimiters)
      textFilter: (text) => text,
    });
  } catch (_error) {
    // Fallback to plain text sanitization if markdown parsing fails
    return sanitizeText(input);
  }
};

/**
 * Detects if content is a patch/diff file by checking for common patch patterns
 * This is strict to avoid false positives with markdown containing code blocks with patches
 */
export const isPatchContent = (content: string): boolean => {
  if (!content || typeof content !== "string") return false;

  const lines = content.trim().split("\n");
  if (lines.length < 3) return false;

  // First line must be a patch indicator (not markdown)
  const firstLine = lines[0].trim();
  const hasValidFirstLine =
    firstLine.startsWith("diff --git") ||
    firstLine.startsWith("--- ") ||
    firstLine.startsWith("Index: ") ||
    firstLine.startsWith("From ") ||
    firstLine.startsWith("@@");

  if (!hasValidFirstLine) return false;

  // Check for patch-specific patterns in the first 20 lines
  let hasFileHeaders = false;
  let hasHunkHeaders = false;
  const checkLines = lines.slice(0, Math.min(20, lines.length));

  for (const line of checkLines) {
    // Check for unified diff headers
    if ((line.startsWith("--- ") && line.length > 4) ||
      (line.startsWith("+++ ") && line.length > 4)) {
      hasFileHeaders = true;
    }
    // Check for hunk headers (@@)
    if (line.startsWith("@@") && line.includes("@@")) {
      hasHunkHeaders = true;
    }
    // Check for diff --git
    if (line.startsWith("diff --git ")) {
      hasFileHeaders = true;
    }
  }

  // Must have either file headers or hunk headers to be considered a patch
  return hasFileHeaders || hasHunkHeaders;
};

/**
 * Sanitizes patch/diff content for safe HTML display as plain text
 */
export const sanitizePatchContent = (content: string): string => {
  if (!content) return "";

  // Just escape HTML special characters, no syntax highlighting
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  <link rel="stylesheet" href="/styles.css">
  <!-- KaTeX CSS -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
</head>
<body>
  <div class="container">
    ${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ""}
    ${content}
  </div>
  <!-- KaTeX JavaScript -->
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <script>
    // Render math in all markdown content areas
    document.addEventListener('DOMContentLoaded', function() {
      const markdownElements = document.querySelectorAll('.markdown-content');
      markdownElements.forEach(function(element) {
        if (window.renderMathInElement) {
          renderMathInElement(element, {
            delimiters: [
              {left: '$$', right: '$$', display: true},
              {left: '$', right: '$', display: false},
              {left: '\\\\[', right: '\\\\]', display: true},
              {left: '\\\\(', right: '\\\\)', display: false}
            ],
            throwOnError: false,
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
          });
        }
      });
    });
  </script>
</body>
</html>
`;

// Helper to create experiment nav for pages within an experiment
export const experimentNav = (experimentId: number, current: string) => `
  <div class="nav">
    <a href="/experiments/${experimentId}"${current === "overview" ? ' style="font-weight: bold;"' : ""
  }>Overview</a>
    <a href="/experiments/${experimentId}/agents"${current === "agents" ? ' style="font-weight: bold;"' : ""
  }>Agents</a>
    <a href="/experiments/${experimentId}/publications"${current === "publications" ? ' style="font-weight: bold;"' : ""
  }>Publications</a>
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
  extraExperimentValues?: Record<string, any>,
) => {
  const exp = metrics.experiment;
  const agents = Object.entries(metrics.agents);

  // Filter out extra keys for validation
  const extraKeys = extraExperimentValues ? Object.keys(extraExperimentValues) : [];
  const keysToValidate = metricKeys.filter((key) => !extraKeys.includes(key));

  assert(
    keysToValidate.every((key) => key in exp),
    `Invalid keys: ${keysToValidate.join(", ")}, expected: ${Object.keys(exp).join(", ")}`,
  );
  assert(
    metricKeys.length === columnNames.length,
    `Keys and column names must have the same length`,
  );

  const experiment = `
    <div class="metrics-grid">
    ${metricKeys
      .map(
        (key, i) => {
          const value = extraExperimentValues && key in extraExperimentValues
            ? extraExperimentValues[key]
            : exp[key as keyof M];
          return `<div class="metric-item">
      <div class="metric-label">${columnNames[i]}</div>
      <div class="metric-value">${sanitizeText(value)}</div>
      </div>`;
        },
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
            .map((key) => {
              const value = extraExperimentValues && key in extraExperimentValues
                ? "-"
                : metric[key as keyof M];
              return `<td>${sanitizeText(value)}</td>`;
            })
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

export const renderAgentTokenMetrics = (tokens: TokenUsage) => {
  return `
    <div class="card">
      <h3>Token Usage</h3>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-label">Total Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(tokens.total))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Input Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(tokens.input))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Cached Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(tokens.cached))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Thinking Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(tokens.thinking))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Output Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(tokens.output))}</div>
        </div>
      </div>
    </div>
  `;
};

export const renderAgentMessageMetrics = (metric: MessageMetric) => {
  return `
    <div class="card">
      <h3>Message Metrics</h3>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-label">Total Messages</div>
          <div class="metric-value">${sanitizeText(formatNumber(metric.totalMessages))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Tool Calls</div>
          <div class="metric-value">${sanitizeText(formatNumber(metric.toolCalls))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Thinking</div>
          <div class="metric-value">${sanitizeText(formatNumber(metric.thinking))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Agent Messages</div>
          <div class="metric-value">${sanitizeText(formatNumber(metric.agentMessages))}</div>
        </div>
      </div>
    </div>
  `;
};

export const renderTokenUsageMetrics = (
  metrics: ExperimentMetrics<TokenUsage>,
) => {
  const exp = metrics.experiment;

  return `
    <div class="card">
      <h3>Token Usage Details</h3>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-label">Total Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(exp.total))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Input Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(exp.input))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Cached Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(exp.cached))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Thinking Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(exp.thinking))}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Output Tokens</div>
          <div class="metric-value">${sanitizeText(formatNumber(exp.output))}</div>
        </div>
      </div>
    </div>
  `;
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

export const renderRuntimeMetrics = (metrics: RuntimeMetric) => {
  // Format the runtime
  const totalSeconds = Math.floor(metrics.totalRuntimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = "";
  if (hours > 0) {
    formatted += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    formatted += `${minutes}m `;
  }
  formatted += `${seconds}s`;
  return `
    <div class="card">
      <h3>Runtime Metrics</h3>
      <div class="metrics-grid">
        <div class="metric-item">
          <span class="metric-label">Total Runtime:</span>
          <span class="metric-value">${sanitizeText(formatted)}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Total Runtime (ms):</span>
          <span class="metric-value">${sanitizeText(metrics.totalRuntimeMs)}</span>
        </div>
      </div>
    </div>
  `;
};

const renderContentBlock = (
  maxPreviewLength = 150,
  typeLabel: string,
  tags: Record<string, string>,
  content: string,
  blockClass?: string,
) => {
  // Helper to truncate content
  const truncate = (text: string) => {
    if (text.length <= maxPreviewLength) {
      return { preview: text, isTruncated: false };
    }
    return { preview: text.substring(0, maxPreviewLength), isTruncated: true };
  };

  const { preview, isTruncated } = truncate(content);
  const tagContent =
    Object.keys(tags).length > 0
      ? `
    ${Object.entries(tags)
        .map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)
        .join("")}
  `
      : "";
  const fullContent = `<pre>${sanitizeText(content)}</pre>`;
  const previewContent = `${sanitizeText(preview)}${isTruncated ? "..." : ""}`;

  return `
    <div class="content-block ${blockClass ?? ""}">
      <div class="content-type">${typeLabel}</div>
      <div class="content-preview">${previewContent}</div>
      <div class="content-full" style="display: none;">
        ${tagContent}
        ${fullContent}
      </div>
    </div>
  `;
};

const renderText = (c: TextContent, maxPreviewLength = 150) => {
  return renderContentBlock(maxPreviewLength, "Text", {}, c.text);
};
const renderThinking = (c: Thinking, maxPreviewLength = 150) => {
  return renderContentBlock(
    maxPreviewLength,
    "Thinking",
    {},
    c.thinking,
    "thinking",
  );
};
const renderToolUse = (c: ToolUse, maxPreviewLength = 150) => {
  return renderContentBlock(
    maxPreviewLength,
    `Tool Use: ${c.name}`,
    {
      toolId: c.id,
      toolName: c.name,
    },
    JSON.stringify(c.input, null, 2),
    "tool-call",
  );
};
const renderToolResult = (c: ToolResult, maxPreviewLength = 150) => {
  return renderContentBlock(
    maxPreviewLength,
    `Tool Result: ${c.toolUseName}`,
    {
      toolId: c.toolUseId,
      toolName: c.toolUseName,
      status: c.isError ? "Error" : "Success",
    },
    c.content
      .map((c) =>
        c.type === "text" ? c.text : JSON.stringify(c, null, 2),
      )
      .join("\n"),
    c.isError ? "tool-error" : "tool-success",
  );
};

export const renderMessage = (
  message: Message,
  index: number,
  maxPreviewLength = 150,
) => {
  const roleClass = message.role === "user" ? "message-user" : "message-agent";

  const contentBlocks = message.content
    .map((c) => {
      switch (c.type) {
        case "text":
          return renderText(c, maxPreviewLength);
        case "thinking":
          return renderThinking(c, maxPreviewLength);
        case "tool_use":
          return renderToolUse(c, maxPreviewLength);
        case "tool_result":
          return renderToolResult(c, maxPreviewLength);
      }
    })
    .join("");

  return `
    <div class="message-card ${roleClass}" onclick="toggleMessageCard(this)">
      <div class="message-header">
        <span class="message-role">${sanitizeText(message.role.toUpperCase())}</span>
        <span class="message-meta">Position: ${index} | Blocks: ${message.content.length}</span>
      </div>
      <div class="message-content">
        ${contentBlocks}
      </div>
    </div>
  `;
};
