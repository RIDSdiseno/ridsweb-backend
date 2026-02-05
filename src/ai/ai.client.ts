import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Falta OPENAI_API_KEY en el archivo .env. Sin esto no hay paraíso.");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});