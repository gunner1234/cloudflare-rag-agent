/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool } from "ai";
import { z } from "zod";
//import { agentContext } from "./context";


//import { agentContext } from "./server"; ---HERE IF NEEDED--------------
import {
  unstable_getSchedulePrompt,
  unstable_scheduleSchema,
} from "agents/schedule";


const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;
const VECTORIZE_INDEX_NAME = process.env.VECTORIZE_INDEX_NAME!;



const searchDocuments = tool({
  description: "Search planning documents using a query and optional local authority",
  parameters: z.object({
    query: z.string(),
    localAuthority: z.string().optional(),
  }),
  execute: async ({ query, localAuthority }) => {
    console.log("searchdocuments triggered");
    console.log("query:", query);
    console.log("local authority:", localAuthority || "none");
    
    // Step 1: Embed the query
    const embedRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: query }),
      }
    );

    const embedData = await embedRes.json();
    const embedding = embedData.result;
    console.log("Embedding result:", embedding);  
    // Step 2: Query Vectorize
    const vectorRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/indexes/${VECTORIZE_INDEX_NAME}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vector: embedding,
          topK: 5,
          filter: localAuthority
            ? { local_authority: localAuthority.toLowerCase() }
            : undefined,
        }),
      }
    );

    const vectorData = await vectorRes.json();
    console.log("vectorize result", json.stringify(vectorData, null, 2));
    const chunks = vectorData?.result?.matches ?? [];


    if (chunks.length === 0) {
      console.log("no relevant chunks found");
      return "No relevant documents found.";
    }

    return chunks
      .map((chunk, i) => `Result ${i + 1}:\n${chunk.metadata?.text || ""}`)
      .join("\n\n---\n\n");
  },
});



/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 * The actual implementation is in the executions object below
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  parameters: z.object({ city: z.string() }),
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  parameters: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  },
});



/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  //searchDocuments,  //my one
  getWeatherInformation,
  getLocalTime,
  //scheduleTask,
  //getScheduledTasks,
  //cancelScheduledTask,
};

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  },
};
