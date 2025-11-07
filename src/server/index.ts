import { Hono } from "hono";
import {
  agentOverview,
  experimentAgents,
  experimentOverview,
  experimentsList,
  publicationDetail,
  publicationList,
  solutionList,
} from "./experiments";

const app = new Hono();

// Home page - List all experiments
app.get("/", (c) => c.redirect("/experiments"));

app.get("/experiments", experimentsList);
app.get("/experiments/:id", experimentOverview);
app.get("/experiments/:id/agents", experimentAgents);
app.get("/experiments/:id/agents/:agentId", agentOverview);
app.get("/experiments/:id/publications", publicationList);
app.get("/experiments/:id/publications/:pubId", publicationDetail);
app.get("/experiments/:id/solutions", solutionList);

export default app;
