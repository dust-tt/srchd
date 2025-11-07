import { Hono } from "hono";
import { baseTemplate, sanitizeText } from "./styling";
import {
  agentOverview,
  experimentAgents,
  experimentOverview,
  publicationDetail,
  publicationList,
  solutionList,
} from "./experiments";
import { ExperimentResource } from "../resources/experiment";

const app = new Hono();

// Home page - List all experiments
app.get("/", (c) => c.redirect("/experiments"));
app.get("/experiments", async (c) => {
  const experiments = (await ExperimentResource.all()).sort(
    (a, b) => b.toJSON().created.getTime() - a.toJSON().created.getTime(),
  );

  const content = `
    <h1>Experiments</h1>
    ${experiments
      .map((exp) => {
        const data = exp.toJSON();
        return `
        <div class="card">
          <h3><a href="/experiments/${data.id}">${sanitizeText(data.name)}</a></h3>
          <div class="meta">
            Created: ${sanitizeText(data.created.toLocaleString())} |
            Updated: ${sanitizeText(data.updated.toLocaleString())}
          </div>
        </div>
      `;
      })
      .join("")}
  `;

  return c.html(baseTemplate("Experiments", content));
});

app.get("/experiments/:id", experimentOverview);
app.get("/experiments/:id/agents", experimentAgents);
app.get("/experiments/:id/agents/:agentId", agentOverview);
app.get("/experiments/:id/publications", publicationList);
app.get("/experiments/:id/publications/:pubId", publicationDetail);
app.get("/experiments/:id/solutions", solutionList);

export default app;
