import { MessageResource } from "@app/resources/messages";
import {
  err,
  Result } from "@app/lib/error";
import { copyToComputer } from "@app/computer/k8s";
import fs from "fs";
import os from "os";
import path from "path";

const MESSAGE_HISTORY_FILE = "message_history.json";

export async function saveMessageHistoryToComputer(
  computerId: string,
  messages: MessageResource[],
): Promise<Result<void>> {

  // Convert messages to JSON format
  const messageHistory = messages.map((msg) => ({
    position: msg.position(),
    role: msg.toJSON().role,
    content: msg.toJSON().content,
  }));

  // Serialize to JSON with pretty printing
  const jsonContent = JSON.stringify(messageHistory, null, 2);

  let tempFilePath: string | null = null;

  try {
    // Write to temporary file
    tempFilePath = path.join(os.tmpdir(), MESSAGE_HISTORY_FILE);
    fs.writeFileSync(tempFilePath, jsonContent, "utf-8");

    // Copy to agent's computer
    const result = await copyToComputer(
      computerId,
      tempFilePath,
    );

    return result;
  } catch (error) {
    return err(
      "message_history_save_error",
      `Failed to save message history to agent's computer:`,
      error as Error
    );
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
