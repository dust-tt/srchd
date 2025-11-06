import { Hono } from "hono";
import { ExperimentResource } from "../resources/experiment";
import { baseTemplate, sanitizeText } from "./styling";
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
          <h3><a href="/experiments/${data.uuid}">${sanitizeText(data.name)}</a></h3>
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

app.get("/experiments/:uuid", (c) => experimentOverview(c, false));
app.get("/experiments/:uuid/agents", (c) => experimentAgents(c, false));
app.get("/experiments/:uuid/agents/:agentId", (c) => agentOverview(c, false));
app.get("/experiments/:uuid/publications", (c) => publicationList(c, false));
app.get("/experiments/:uuid/publications/:pubId", (c) =>
  publicationDetail(c, false),
);
app.get("/experiments/:uuid/solutions", (c) => solutionList(c, false));

export default app;
