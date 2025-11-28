export type Human = "human";
export function isHuman(model: string): model is Human {
  return model === "human";
}
