import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import {
  agentOverview,
  experimentAgents,
  experimentOverview,
  experimentsList,
  publicationDetail,
  publicationDownload,
  publicationAttachmentDownload,
  publicationList,
  solutionList,
} from "./experiments";

export type BasicAuthConfig = {
  username: string;
  password: string;
};

export const createApp = (auth?: BasicAuthConfig) => {
  const app = new Hono();

  if (auth) {
    app.use(
      "*",
      basicAuth({
        username: auth.username,
        password: auth.password,
      }),
    );
  }

  // Home page - List all experiments
  app.get("/", (c) => c.redirect("/experiments"));

  app.get("/experiments", experimentsList);
  app.get("/experiments/:id", experimentOverview);
  app.get("/experiments/:id/agents", experimentAgents);
  app.get("/experiments/:id/agents/:agentId", agentOverview);
  app.get("/experiments/:id/publications", publicationList);
  app.get("/experiments/:id/publications/:pubId", publicationDetail);
  app.get("/experiments/:id/publications/:pubId/download", publicationDownload);
  app.get("/experiments/:id/publications/:pubId/attachments/:attachment", publicationAttachmentDownload);
  app.get("/experiments/:id/solutions", solutionList);

  return app;
};

export default createApp();
