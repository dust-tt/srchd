import { ExperimentResource } from "../resources/experiment";
import { AgentResource } from "../resources/agent";
import { PublicationResource } from "../resources/publication";
import { SolutionResource } from "../resources/solutions";
import {
  baseTemplate,
  experimentNav,
  prepareChartData,
  safeGradeClass,
  safeReasonClass,
  safeScriptJSON,
  safeStatusClass,
  sanitizeMarkdown,
  sanitizeText,
} from "./styling";
import { BlankEnv, BlankInput } from "hono/types";
import { Context } from "hono";

type Input = Context<BlankEnv, any, BlankInput>;

// Experiment overview
export const experimentOverview = async (c: Input) => {
  const id = parseInt(c.req.param("id"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const experimentAgents = await AgentResource.listByExperiment(experiment);
  const experimentPublications =
    await PublicationResource.listByExperiment(experiment);
  const experimentSolutions =
    await SolutionResource.listByExperiment(experiment);

  const expData = experiment.toJSON();

  const experimentName = sanitizeText(expData.name);
  const content = `
    ${experimentNav(id, "overview")}
    <div class="card">
      <h3>${experimentName}</h3>
      <div class="meta">
        Created: ${sanitizeText(expData.created.toLocaleString())} |
        Updated: ${sanitizeText(expData.updated.toLocaleString())} |
        Agents: ${experimentAgents.length} |
        Publications: ${experimentPublications.length} |
        Solutions: ${experimentSolutions.length}
      </div>
    </div>
    <div class="card">
      <div class="content">${sanitizeText(expData.problem)}</div>
    </div>
  `;

  const breadcrumb = `<a href="/">Experiments</a> > ${experimentName}`;
  return c.html(baseTemplate(expData.name, content, breadcrumb));
};

// Experiment agents
export const experimentAgents = async (c: Input) => {
  const id = parseInt(c.req.param("id"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const experimentAgents = await AgentResource.listByExperiment(experiment);
  const expData = experiment.toJSON();
  const experimentName = sanitizeText(expData.name);

  const content = `
    ${experimentNav(id, "agents")}
    ${experimentAgents
      .map((agent) => {
        const agentData = agent.toJSON();
        return `
        <div class="card">
          <h3><a href="/experiments/${id}/agents/${agentData.id}">${sanitizeText(
            agentData.name,
          )}</a></h3>
          <div class="meta">
            Provider: ${sanitizeText(agentData.provider)} | Model: ${sanitizeText(
              agentData.model,
            )} |
            Thikning: ${sanitizeText(agentData.thinking)} | Evolutions: ${
              agentData.evolutions.length
            } |
            Tools: ${sanitizeText(agentData.tools.join(", "))} |
            Created: ${sanitizeText(agentData.created.toLocaleString())}
          </div>
        </div>
      `;
      })
      .join("")}
  `;

  const breadcrumb = `<a href="/">Experiments</a> > <a href="/experiments/${id}">${experimentName}</a> > <a href="/experiments/${id}/agents">Agents</a>`;
  return c.html(baseTemplate("Agents", content, breadcrumb));
};

// Agent detail
export const agentOverview = async (c: Input) => {
  const id = parseInt(c.req.param("id"));
  const agentId = parseInt(c.req.param("agentId"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const agents = await AgentResource.listByExperiment(experiment);
  const agent = agents.find((a) => a.toJSON().id === agentId);
  if (!agent) return c.notFound();

  const agentPublications = await PublicationResource.listByAuthor(
    experiment,
    agent,
  );
  const agentSolutions = await SolutionResource.listByAgent(experiment, agent);

  const agentData = agent.toJSON();
  const expData = experiment.toJSON();
  const agentName = sanitizeText(agentData.name);
  const experimentName = sanitizeText(expData.name);

  const evolutionsCarousel =
    agentData.evolutions.length > 0
      ? `

    <h2>Evolutions <span class="count">(${
      agentData.evolutions.length
    })</span></h2>
    <div class="evolution-carousel">
      <div class="evolution-header">
        <a onclick="previousEvolution()" id="prevBtn">← Prev</a>
        <span id="evolutionCounter">1 / ${agentData.evolutions.length}</span>
        <a onclick="nextEvolution()" id="nextBtn">Next →</a>
      </div>
      <div class="evolution-content">
        <div id="evolutionDisplay">
          <div class="evolution-meta" id="evolutionMeta">
            Evolution #${
              agentData.evolutions.length
            } (Latest) - Created: ${sanitizeText(
              agentData.evolutions[0].created.toLocaleString(),
            )}
          </div>
          <div class="diff-content" id="diffContent"></div>
        </div>
      </div>
    </div>
    <script>
      let currentEvolutionIndex = 0;
      const evolutions = ${safeScriptJSON(agentData.evolutions)};
      const escapeHtml = (value) =>
        String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      function updateEvolutionDisplay() {
        const evolution = evolutions[currentEvolutionIndex];
        const evolutionNumber = evolutions.length - currentEvolutionIndex;

        document.getElementById('evolutionMeta').textContent =
          \`Evolution #\${evolutionNumber} - Created: \${new Date(evolution.created).toLocaleString()}\`;
        document.getElementById('evolutionCounter').textContent = \`\${currentEvolutionIndex + 1} / \${evolutions.length}\`;

        document.getElementById('prevBtn').disabled = currentEvolutionIndex === 0;
        document.getElementById('nextBtn').disabled = currentEvolutionIndex === evolutions.length - 1;

        updateDiff();
      }

      function previousEvolution() {
        if (currentEvolutionIndex > 0) {
          currentEvolutionIndex--;
          updateEvolutionDisplay();
        }
      }

      function nextEvolution() {
        if (currentEvolutionIndex < evolutions.length - 1) {
          currentEvolutionIndex++;
          updateEvolutionDisplay();
        }
      }

      function simpleDiff(oldText, newText) {
        const oldLines = String(oldText).split('\\n');
        const newLines = String(newText).split('\\n');
        const result = [];

        let i = 0, j = 0;
        while (i < oldLines.length || j < newLines.length) {
          if (i >= oldLines.length) {
            result.push(\`<span class="diff-added">+ \${escapeHtml(newLines[j])}</span>\`);
            j++;
          } else if (j >= newLines.length) {
            result.push(\`<span class="diff-removed">- \${escapeHtml(oldLines[i])}</span>\`);
            i++;
          } else if (oldLines[i] === newLines[j]) {
            // result.push(\`  \${oldLines[i]}\`);
            i++; j++;
          } else {
            result.push(\`<span class="diff-removed">- \${escapeHtml(oldLines[i])}</span>\`);
            result.push(\`<span class="diff-added">+ \${escapeHtml(newLines[j])}</span>\`);
            i++; j++;
          }
        }

        return result.join('\\n');
      }

      function updateDiff() {
        if (evolutions.length < 2) {
          document.getElementById('diffContent').textContent = 'No base evolution to compare with.';
          return;
        }

        const baseEvolution = evolutions[evolutions.length - 1];
        const currentEvolution = evolutions[currentEvolutionIndex];
        const diff = simpleDiff(baseEvolution.system, currentEvolution.system);

        document.getElementById('diffContent').innerHTML = diff;
      }

      updateEvolutionDisplay();
    </script>
  `
      : "";

  const content = `
    ${experimentNav(id, "agents")}
    <h1>${agentName}</h1>
    <div class="card">
      <p><strong>Provider:</strong> ${sanitizeText(agentData.provider)}</p>
      <p><strong>Model:</strong> ${sanitizeText(agentData.model)}</p>
      <p><strong>Tools:</strong> ${sanitizeText(agentData.tools.join(", "))}</p>
      <div class="meta">Created: ${sanitizeText(
        agentData.created.toLocaleString(),
      )}</div>
    </div>

    ${evolutionsCarousel}

    <h2>Publications <span class="count">(${
      agentPublications.length
    })</span></h2>
    ${agentPublications
      .map((pub) => {
        const pubData = pub.toJSON();
        const statusClass = safeStatusClass(pubData.status);
        return `
        <div class="card">
          <h3><a href="/experiments/${id}/publications/${pubData.id}">${sanitizeText(
            pubData.title,
          )}</a></h3>
          <div class="abstract">${sanitizeText(pubData.abstract)}</div>
          <div class="meta">
            <span class="status ${statusClass}">${sanitizeText(
              pubData.status,
            )}</span> |
            Reference: ${sanitizeText(pubData.reference)}
          </div>
        </div>
      `;
      })
      .join("")}

    <h2>Solutions <span class="count">(${agentSolutions.length})</span></h2>
    ${agentSolutions
      .map((sol) => {
        const solData = sol.toJSON();
        const reasonClass = safeReasonClass(solData.reason);
        return `
        <div class="card">
          <h3>Solution</h3>
          <div><span class="reason-badge ${
            reasonClass
          }">${sanitizeText(solData.reason.replace("_", " "))}</span></div>
          <p>${sanitizeText(solData.rationale)}</p>
          <div class="meta">Created: ${sanitizeText(
            solData.created.toLocaleString(),
          )}</div>
        </div>
      `;
      })
      .join("")}
  `;

  const breadcrumb = `<a href="/">Experiments</a> > <a href="/experiments/${id}">${experimentName}</a> > <a href="/experiments/${id}/agents">Agents</a> > ${agentName}`;
  return c.html(baseTemplate(agentData.name, content, breadcrumb));
};

// Experiment publications
export const publicationList = async (c: Input) => {
  const id = parseInt(c.req.param("id"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const experimentPublications =
    await PublicationResource.listByExperiment(experiment);
  const expData = experiment.toJSON();
  const experimentName = sanitizeText(expData.name);

  const content = `
    ${experimentNav(id, "publications")}
    ${experimentPublications
      .map((pub) => {
        const pubData = pub.toJSON();
        const statusClass = safeStatusClass(pubData.status);
        return `
        <div class="card">
          <h3><a href="/experiments/${id}/publications/${pubData.id}">${sanitizeText(
            pubData.title,
          )}</a></h3>
          <div class="abstract">${sanitizeText(pubData.abstract)}</div>
          <div class="meta">
            Author: ${sanitizeText(pubData.author.name)} |
            <span class="status ${statusClass}">${sanitizeText(
              pubData.status,
            )}</span> |
            Reference: ${sanitizeText(pubData.reference)} |
            Created: ${sanitizeText(pubData.created.toLocaleString())} |
            Citations: ${pubData.citations.to.length} |
            Reviews: ${
              pubData.reviews
                .filter((r) => r.grade)
                .map(
                  (r) =>
                    `<span class="grade ${safeGradeClass(
                      r.grade,
                    )}">${sanitizeText(r.grade ?? "")}</span>`,
                )
                .join("") || "No reviews yet"
            }
          </div>
        </div>
      `;
      })
      .join("")}
  `;

  const breadcrumb = `<a href="/">Experiments</a> > <a href="/experiments/${id}">${experimentName}</a> > Publications`;
  return c.html(baseTemplate("Publications", content, breadcrumb));
};

// Publication detail
export const publicationDetail = async (c: Input) => {
  const id = parseInt(c.req.param("id"));
  const pubId = parseInt(c.req.param("pubId"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const publications = await PublicationResource.listByExperiment(experiment);
  const publication = publications.find((p) => p.toJSON().id === pubId);
  if (!publication) return c.notFound();

  const pubData = publication.toJSON();
  const expData = experiment.toJSON();
  const publicationTitle = sanitizeText(pubData.title);
  const publicationAuthor = sanitizeText(pubData.author.name);
  const publicationStatus = sanitizeText(pubData.status);
  const publicationReference = sanitizeText(pubData.reference);
  const publicationAbstract = sanitizeText(pubData.abstract);
  const publicationCreated = sanitizeText(pubData.created.toLocaleString());
  const experimentName = sanitizeText(expData.name);
  const publicationStatusClass = safeStatusClass(pubData.status);

  const content = `
    ${experimentNav(id, "publications")}
    <h1>${publicationTitle}</h1>
    <div class="card">
      <p><strong>Author:</strong> ${publicationAuthor}</p>
      <p><strong>Status:</strong> <span class="status ${publicationStatusClass}">${publicationStatus}</span></p>
      <p><strong>Reference:</strong> ${publicationReference}</p>
      <div class="abstract"><strong>Abstract:</strong> ${publicationAbstract}</div>
      <div class="meta">Created: ${publicationCreated}</div>
    </div>
    <div class="card">
      <h3>Content</h3>
      <div class="content markdown-content">${sanitizeMarkdown(pubData.content ?? "")}</div>
    </div>
    ${
      pubData.citations.from.length > 0
        ? `
      <h2>Citations From This Publication <span class="count">(${
        pubData.citations.from.length
      })</span></h2>
      <div class="citations">
        ${pubData.citations.from
          .map(
            (cit) => `
          <div class="citation">→ <a href="/experiments/${id}/publications/${cit.to}">${sanitizeText(
            String(cit.to),
          )}</a></div>
        `,
          )
          .join("")}
      </div>
    `
        : ""
    }
    ${
      pubData.citations.to.length > 0
        ? `
      <h2>Citations To This Publication <span class="count">(${
        pubData.citations.to.length
      })</span></h2>
      <div class="citations">
        ${pubData.citations.to
          .map(
            (cit) => `
          <div class="citation">← <a href="/experiments/${id}/publications/${cit.from}">${sanitizeText(
            String(cit.from),
          )}</a></div>
        `,
          )
          .join("")}
      </div>
    `
        : ""
    }
    ${
      pubData.reviews.length > 0
        ? `
      <h2>Reviews <span class="count">(${pubData.reviews.length})</span></h2>
      ${pubData.reviews
        .map(
          (review) => `
        <div class="card">
          <h3>Review by ${sanitizeText(review.author.name || "Unknown")}</h3>
          ${
            review.grade
              ? `<span class="grade ${safeGradeClass(
                  review.grade,
                )}">${sanitizeText(review.grade.replace("_", " "))}</span>`
              : ""
          }
          <div class="meta">Created: ${
            review.created
              ? sanitizeText(new Date(review.created).toLocaleString())
              : "Unknown"
          }</div>
        </div>
        ${
          review.content
            ? `
        <div class="card">
          <div class="content markdown-content">${sanitizeMarkdown(
            review.content || "(empty)",
          )}</div>
        </div>
        `
            : ""
        }
      `,
        )
        .join("")}
    `
        : ""
    }
  `;

  const breadcrumb = `<a href="/">Experiments</a> > <a href="/experiments/${id}">${experimentName}</a> > <a href="/experiments/${id}/publications">Publications</a> > ${publicationTitle}`;
  return c.html(baseTemplate(pubData.title, content, breadcrumb));
};

// Experiment solutions
export const solutionList = async (c: Input) => {
  const id = parseInt(c.req.param("id"));

  const experiment = await ExperimentResource.findById(id);
  if (!experiment) return c.notFound();

  const experimentSolutions =
    await SolutionResource.listByExperiment(experiment);
  const expData = experiment.toJSON();
  const experimentName = sanitizeText(expData.name);

  // Prepare data for the timeline chart
  const chartData = prepareChartData(experimentSolutions);

  const content = `
    ${experimentNav(id, "solutions")}
    ${
      chartData.publicationLines.length > 0
        ? `
    <div class="card">
      <h3>Solution Evolution Timeline</h3>
      <div class="solution-chart">
        <svg id="solutionChart" width="100%" height="300" viewBox="0 0 800 300">
          <!-- Chart will be rendered here by JavaScript -->
        </svg>
        <div class="chart-legend">
          ${chartData.publicationLines
            .map(
              (line, _index) => `
            <div class="legend-item">
              <div class="legend-color" style="background-color: ${line.color};"></div>
              <span>${sanitizeText(
                line.reference,
              )} (current: ${line.currentSupport})</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>

    <script>
      const chartData = ${safeScriptJSON(chartData)};
      const escapeHtml = (value) =>
        String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      function renderSolutionChart(data) {
        const svg = document.getElementById('solutionChart');
        const width = 800;
        const height = 300;
        const margin = { top: 20, right: 20, bottom: 60, left: 60 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        // Clear existing content
        svg.innerHTML = '';

        if (!data.publicationLines || data.publicationLines.length === 0) {
          svg.innerHTML = '<text x="400" y="150" text-anchor="middle" class="chart-text">No publication data available</text>';
          return;
        }

        // Get time and support ranges
        const allTimes = data.publicationLines.flatMap(line => line.points.map(p => new Date(p.time)));
        const allSupport = data.publicationLines.flatMap(line => line.points.map(p => p.support));
        const minTime = Math.min(...allTimes.map(t => t.getTime()));
        const maxTime = Math.max(...allTimes.map(t => t.getTime()));
        const maxSupport = Math.max(...allSupport, 1);

        // Create scales
        const xScale = (time) => margin.left + (new Date(time).getTime() - minTime) / (maxTime - minTime) * chartWidth;
        const yScale = (support) => height - margin.bottom - (support / maxSupport) * chartHeight;

        // Draw grid lines
        const numGridLines = 5;
        for (let i = 0; i <= numGridLines; i++) {
          const x = margin.left + (i / numGridLines) * chartWidth;
          svg.innerHTML += \`<line x1="\${x}" y1="\${margin.top}" x2="\${x}" y2="\${height - margin.bottom}" class="chart-grid" />\`;
        }

        // Draw horizontal grid lines for support levels
        for (let i = 0; i <= maxSupport; i++) {
          const y = yScale(i);
          svg.innerHTML += \`<line x1="\${margin.left}" y1="\${y}" x2="\${width - margin.right}" y2="\${y}" class="chart-grid" />\`;
        }

        // Draw axes
        svg.innerHTML += \`<line x1="\${margin.left}" y1="\${margin.top}" x2="\${margin.left}" y2="\${height - margin.bottom}" class="chart-axis" />\`;
        svg.innerHTML += \`<line x1="\${margin.left}" y1="\${height - margin.bottom}" x2="\${width - margin.right}" y2="\${height - margin.bottom}" class="chart-axis" />\`;

        // Draw time labels
        for (let i = 0; i <= 4; i++) {
          const timeRatio = i / 4;
          const time = new Date(minTime + timeRatio * (maxTime - minTime));
          const x = margin.left + timeRatio * chartWidth;
          svg.innerHTML += \`<text x="\${x}" y="\${height - margin.bottom + 15}" text-anchor="middle" class="chart-text">\${time.toLocaleDateString()}</text>\`;
        }

        // Draw support level labels
        for (let i = 0; i <= maxSupport; i++) {
          const y = yScale(i);
          svg.innerHTML += \`<text x="\${margin.left - 10}" y="\${y + 3}" text-anchor="end" class="chart-text">\${i}</text>\`;
        }

        // Draw publication lines
        data.publicationLines.forEach((line) => {
          if (line.points.length === 0) return;

          let pathData = '';
          let prevX = null;
          let prevY = null;

          line.points.forEach((point, pointIndex) => {
            const x = xScale(point.time);
            const y = yScale(point.support);

            if (pointIndex === 0) {
              // Start from support level 0 at first time point
              const startY = yScale(0);
              pathData += \`M \${x} \${startY} L \${x} \${y}\`;
              prevX = x;
              prevY = y;
            } else {
              // Stairs-style: horizontal then vertical
              pathData += \` L \${x} \${prevY} L \${x} \${y}\`;
              prevX = x;
              prevY = y;
            }
          });

          // Extend line to current time if it's the last point
          if (line.points.length > 0) {
            const lastPoint = line.points[line.points.length - 1];
            const currentX = Math.min(width - margin.right, xScale(new Date()));
            pathData += \` L \${currentX} \${yScale(lastPoint.support)}\`;
          }

          svg.innerHTML += \`<path d="\${pathData}" stroke="\${line.color}" stroke-width="2" fill="none" />\`;

          // Add publication reference label
          if (line.points.length > 0) {
            const lastPoint = line.points[line.points.length - 1];
            const labelX = Math.min(width - margin.right - 5, xScale(new Date()));
            const labelY = yScale(lastPoint.support);
            svg.innerHTML += \`<text x="\${labelX}" y="\${labelY - 5}" text-anchor="end" class="chart-text" fill="\${line.color}">\${escapeHtml(line.reference)}</text>\`;
          }
        });

        // Add axis labels
        svg.innerHTML += \`<text x="\${margin.left - 45}" y="\${height / 2}" text-anchor="middle" class="chart-text" transform="rotate(-90, \${margin.left - 45}, \${height / 2})">Support Count</text>\`;
        svg.innerHTML += \`<text x="\${width / 2}" y="\${height - 10}" text-anchor="middle" class="chart-text">Time</text>\`;
      }

      renderSolutionChart(chartData);
    </script>
    `
        : ""
    }

    ${experimentSolutions
      .map((sol) => {
        const solData = sol.toJSON();
        const reasonClass = safeReasonClass(solData.reason);
        return `
        <div class="card">
          <h3>Solution by ${sanitizeText(solData.agent.name)}</h3>
          <div><span class="reason-badge ${
            reasonClass
          }">${sanitizeText(solData.reason.replace("_", " "))}</span>
          ${
            solData.publication
              ? `
            <a href="/experiments/${id}/publications/${solData.publication.id}">${sanitizeText(
              solData.publication.reference,
            )}</a>`
              : ""
          }
          </div>
          <p>${sanitizeText(solData.rationale)}</p>
          <div class="meta">Created: ${sanitizeText(
            solData.created.toLocaleString(),
          )}</div>
        </div>
      `;
      })
      .join("")}
  `;

  const breadcrumb = `<a href="/">Experiments</a> > <a href="/experiments/${id}">${experimentName}</a> > Solutions`;
  return c.html(baseTemplate("Solutions", content, breadcrumb));
};
