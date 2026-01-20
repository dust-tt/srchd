export interface ReviewRequested {
  type: "review_requested";
  reference: string;
}

export interface ReviewRecieved {
  type: "review_recieved";
  reference: string;
  grade: "STRONG_ACCEPT" | "ACCEPT" | "REJECT" | "STRONG_REJECT";
  author: string;
}

export interface PublicationStatusUpdated {
  type: "publication_status_update";
  reference: string;
  status: "PUBLISHED" | "REJECTED"
}

export type AdvisoryMessage = ReviewRequested | ReviewRecieved | PublicationStatusUpdated;

export class Advisory {
  private static instance: Advisory;
  private messages: Record<string, AdvisoryMessage[]> = {};

  private constructor() { }

  static init(agents?: string[]) {
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
    Advisory.instance.messages[agent].push(msg);
  }

  static pop(agent: string): AdvisoryMessage[] {
    const messages = Advisory.instance.messages[agent];
    Advisory.instance.messages[agent] = [];
    return messages;
  }

  static toString(msg: AdvisoryMessage): string {
    switch (msg.type) {
      case "review_recieved":
        return `Your reference ${msg.reference} has recieved a review by ${msg.author},
          and been graded ${msg.grade}.`
      case "review_requested":
        return `You are requested to review publication: ${msg.reference}`
      case "publication_status_update":
        return `Your publication: ${msg.reference} has just recieved the status: ${msg.status}`
    }
  }

}
