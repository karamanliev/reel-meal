import OpenAI from "openai";
import { config } from "./config.js";

export const openAIClient = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});
