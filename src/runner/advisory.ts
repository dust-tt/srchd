export interface ReviewRequestedValue {
  type: "review_requested";
  reference: string;
}

export interface ReviewRecievedValue {
  type: "review_recieved";
  reference: string;
  grade: "STRONG_ACCEPT" | "ACCEPT" | "REJECT" | "STRONG_REJECT";
  author: string;
}

export interface PublicationStatusValue {
  type: "publication_status_update";
  reference: string;
  status: "PUBLISHED" | "REJECTED"
}

export type Status = ReviewRequestedValue | ReviewRecievedValue | PublicationStatusValue;

export class Advisory {
  private static instance: Advisory;
  private data: Record<string, Status[]> = {};

  private constructor() { }

  static init(agents?: string[]) {
    if (!Advisory.instance) {
      Advisory.instance = new Advisory();
      if (agents) {
        for (const agent of agents) {
          Advisory.instance.data[agent] = [];
        }
      }
    }
  }

  static push(agent: string, status: Status) {
    Advisory.instance.data[agent].push(status);
  }

  static pop(agent: string): Status[] {
    const statuses = Advisory.instance.data[agent];
    Advisory.instance.data[agent] = [];
    return statuses;
  }

  static toMessage(status: Status): string {
    switch (status.type) {
      case "review_recieved":
        return `Your reference ${status.reference} has recieved a review by ${status.author},
          and been graded ${status.grade}.`
      case "review_requested":
        return `You are requested to review publication: ${status.reference}`
      case "publication_status_update":
        return `Your publication: ${status.reference} has just recieved the status: ${status.status}`
    }
  }

}
