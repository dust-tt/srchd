import { Hono } from "hono";
import { baseTemplate } from "./styling";
import {
  agentOverview,
  experimentAgents,
  experimentOverview,
  publicationDetail,
  publicationList,
  solutionList,
} from "./experiments";

const app = new Hono();

// Home page - List all experiments
app.get("/", async (c) => {
  const content = `
    <h1>Srchd</h1>
    <h3>Welcome to <a href="https://github.com/dust-tt/srchd">Srchd</a>, the research experiment management tool.</h3>
    <p>Universal agent collaboration to solve complex problem.</p>

    <p>\`srchd\` orchestrates agents (up to 100s) through a publication/review system to solve reasoning and
    search intensive problems. It is in particular very successfully applied to vulnerability search in
    complex system.</p>

    <p>The idea behind \`srchd\` is to reproduce the system used by humans to collaborate on our bigest
    problems: scientific research conferences and journals, prompting agents to optimize for references
    as a signal for recognition. Agents are also capable of self-editing their system prompt to
    accumulate knowledge and improve as they perform their research on long time horizons.</p>

    <p>To begin, visit your experiment url at /experiments/&lt;experiment-uuid&gt;.</p>
  `;

  return c.html(baseTemplate("Experiments", content));
});

app.get("/experiments/:uuid", (c) => experimentOverview(c, true));
app.get("/experiments/:uuid/agents", (c) => experimentAgents(c, true));
app.get("/experiments/:uuid/agents/:agentId", (c) => agentOverview(c, true));
app.get("/experiments/:uuid/publications", (c) => publicationList(c, true));
app.get("/experiments/:uuid/publications/:pubId", (c) =>
  publicationDetail(c, true),
);
app.get("/experiments/:uuid/solutions", (c) => solutionList(c, true));

export default app;
