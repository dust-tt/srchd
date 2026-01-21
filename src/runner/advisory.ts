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

export interface PublicationAnnounced {
  type: "publication_announced";
  reference: string;
  title: string;
  status: "PUBLISHED" | "REJECTED"
}

export type AdvisoryMessage = ReviewRequested | ReviewReceived | PublicationStatusUpdated | PublicationAnnounced;

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
    if (msg.type === "publication_status_update") {
      for (const otherAgent of Object.keys(Advisory.instance.messages).filter(a => a !== agent)) {
        // Also announce to all agents the status of the publication
        Advisory.instance.messages[otherAgent].push({
          type: "publication_announced",
          title: msg.title,
          reference: msg.reference,
          status: msg.status,
        });
      }
    }
  }

  static pop(agent: string): AdvisoryMessage[] {
    const messages = Advisory.instance.messages[agent];
    Advisory.instance.messages[agent] = [];
    return messages;
  }

  static toString(msg: AdvisoryMessage): string {
    switch (msg.type) {
      case "review_received":
        return `Your publication: "${msg.title}" (${msg.reference}) has recieved a review by ${msg.author},
          and been graded ${msg.grade}.`
      case "review_requested":
        return `You are requested to review publication: "${msg.title}" (${msg.reference}).`
      case "publication_status_update":
        return msg.status === "PUBLISHED" ? `Your publication: "${msg.title}" (${msg.reference}) has just been published.`
          : `Your publication: "${msg.title}" (${msg.reference}) has just been rejected.`
      case "publication_announced":
        return `The publication: "${msg.title}" (${msg.reference}) has just been updated to status: ${msg.status}.
        -- no further action required, this is just an announcement.`
    }
  }

}
