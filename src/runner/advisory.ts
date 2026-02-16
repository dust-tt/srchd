export interface ReviewRequested {
  type: "review_requested";
  reference: string;
  title: string;
}

export interface ReviewReceived {
  type: "review_received";
  reference: string;
  title: string;
  grade: "STRONG_ACCEPT" | "ACCEPT" | "REJECT" | "STRONG_REJECT";
  author: string;
}

export interface PublicationStatusUpdated {
  type: "publication_status_update";
  reference: string;
  title: string;
  status: "PUBLISHED" | "REJECTED"
}


export type AdvisoryMessage = ReviewRequested | ReviewReceived | PublicationStatusUpdated;

export class Advisory {
  private static instance: Advisory;
  private messages: Record<string, AdvisoryMessage[]> = {};

  private constructor() { }

  static register(agents?: string[]) {
    if (!Advisory.instance) {
      Advisory.instance = new Advisory();
      if (agents) {
        for (const agent of agents) {
          Advisory.instance.messages[agent] = [];
        }
      }
    }
  }

  static push(agent: string, msg: AdvisoryMessage) {
    if (!Advisory.instance.messages[agent]) {
      Advisory.instance.messages[agent] = [];
    }
    Advisory.instance.messages[agent].push(msg);
  }

  static pop(agent: string): AdvisoryMessage[] {
    const messages = Advisory.instance.messages[agent] ?? [];
    Advisory.instance.messages[agent] = [];
    return messages;
  }

  static toString(msg: AdvisoryMessage): string {
    switch (msg.type) {
      case "review_received":
        return `Your publication "${msg.title}" [${msg.reference}] received a ${msg.grade} review from ${msg.author}.`;
      case "review_requested":
        return `You are requested to review publication "${msg.title}" [${msg.reference}].`;
      case "publication_status_update":
        return msg.status === "PUBLISHED"
          ? `Your publication "${msg.title}" [${msg.reference}] was published.`
          : `Your publication "${msg.title}" [${msg.reference}] was rejected.`;
    }
  }
}
