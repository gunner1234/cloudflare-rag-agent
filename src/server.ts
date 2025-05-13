import { routeAgentRequest, type Schedule } from "agents";

import { unstable_getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { createWorkersAI } from 'workers-ai-provider';
import { tools, executions } from "./tools";
//import { agentContext } from "./context"; //NEW ADDED


//import { AsyncLocalStorage } from "node:async_hooks";   CAN ADD BACK LATER
//import { env } from "cloudflare:workers";


// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

// we use ALS to expose the agent context to the tools
//export const agentContext = new AsyncLocalStorage<Chat>();    ----HERE IF NEEDED-------------
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
    * Handles incoming chat messages and manages the response stream
    * @param onFinish - Callback function executed when streaming completes
    */
  // biome-ignore lint/complexity/noBannedTypes: <explanation>
  async onChatMessage(onFinish: StreamTextOnFinishCallback<{}>) {
    console.log("onChatMessage triggered");

    // Attempting to initialize Workers AI helper... (Log added for earlier diagnosis)
    try {
      // Initialize Workers AI helper with your AI binding
      const ai = createWorkersAI({ binding: this.env.AI_MODEL });
      // Workers AI helper initialized successfully. (Log added for earlier diagnosis)
      // AI binding: [object Object] (Log added for earlier diagnosis)
      // AI helper object: [object Object] (Log added for earlier diagnosis)


      // 1. Get the latest user message
      // Getting user message... (Log added for earlier diagnosis)
      const userMessage = [...this.messages].reverse().find((msg) => msg.role === "user")?.content;
      // User message: [user message] (Log added for earlier diagnosis)

      if (!userMessage) {
        console.warn("No user message found.");
        return new Response("No user message provided", { status: 400 });
      }

      // 2. Correctly embed user message with embedding model
      // Attempting to create embedding model instance... (Log added for earlier diagnosis)
      const embeddingModel = ai("@cf/baai/bge-base-en-v1.5");
      // Embedding model instance created. (Log added for earlier diagnosis)
      // Attempting to run embedding model... (Log added for earlier diagnosis)

      const embeddingResponse: { data?: [number], shape?: number } | null = await this.env.AI_MODEL.run(
        "@cf/baai/bge-base-en-v1.5",
        { text: [userMessage] } // Input format for bge model is an array of texts
      ) as { data?: [number], shape?: number } | null; // Type assertion for clarity

      // Embedding model run complete. (Log added for earlier diagnosis)
      console.log("emebedding response", embeddingResponse); // Keep this log

      const embedding = embeddingResponse?.data?.[0]; // Extract the first (and only) embedding vector

      if (!embedding) {
        console.error("Failed to generate embedding.");
        return new Response("Failed to generate embedding", { status: 500 });
      }

      // Attempting to query Vectorize... (Log added for earlier diagnosis)
      const vectorizeResults = await this.env.VDB.query(embedding, { // Use a different variable name for clarity
        topK: 5,
        returnMetadata: true,
      });;
      // Vectorize query complete. (Log added for earlier diagnosis)
      console.log("vectorizeResults", vectorizeResults); // Keep this log

      // --- Updated Code for Building Vector Context (using the correct 'chunk' key) ---

      // Build context from retrieved vector matches
      // Present the context as a block of relevant information for the AI
      console.log("Building vector context string (using 'chunk' key)..."); // Updated log message

      const vectorContext = "Relevant Information:\n\n" +
        vectorizeResults.matches
          .map((match) => match.metadata?.chunk || "") // ***** CHANGED .text TO .chunk *****
          .join("\n\n---\n\n"); // Use a clear separator like "---" between chunks

      console.log(`Retrieved ${vectorizeResults.matches.length} vector matches.`); // Keep this log
      console.log("Vector Context (formatted for AI):", vectorContext); // Keep this log

      // --- End of Updated Code for Building Vector Context ---


      // 3. Stream AI response using the retrieved context
      // Creating data stream response... (Log added for earlier diagnosis)
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          // Data stream execute function triggered. (Log added for earlier diagnosis)

          const genModel = ai("@cf/meta/llama-3-8b-instruct");
          // Generator model instance created. (Log added for earlier diagnosis)

          const messagesForModel = [
            {
              role: 'system',
              content: 'You are a helpful assistant. Use the provided context to answer the user\'s question. If you cannot find the answer in the context, state that you don\'t have enough information.'
            },
            // Include previous conversation history, excluding the latest user message
            // Filter based on both role and content to correctly identify the latest user message
            ...this.messages.filter(msg => !(msg.role === "user" && msg.content === userMessage)),
            {
              role: 'user',
              // Combine context and the latest user message, clearly separating them
              content: `Context:
${vectorContext}

Question: ${userMessage}`
            }
          ];
          // Messages array for model prepared. (Log added for earlier diagnosis)

          // --- Error Handling Around Streaming (Kept from previous step) ---

          try {
            // Attempting to stream text... (Log added for earlier diagnosis)
            const aiStreamResult = streamText({
              model: genModel,
              messages: messagesForModel,
              onFinish,
              onError: (err) => {
                console.error("AI Stream Error:", err);
                // You might also want to signal the dataStream to close or error out
                // dataStream.getWriter().error(err); // Uncomment if you want to propagate the error to the client stream
              },
              maxSteps: 10,
            });
            // streamText initiated. (Log added for earlier diagnosis)

            // Attempting to merge stream into data stream... (Log added for earlier diagnosis)
            await aiStreamResult.mergeIntoDataStream(dataStream);
            // Stream merge complete. (Log added for earlier diagnosis)


            // You can optionally merge the Vectorize results here if you want their metadata
            // to also be part of the streamed response data (often for debugging or specific client needs).
            // If you only want the AI's text in the chat, you might remove this line.
            // vectorizeResults.mergeIntoDataStream(dataStream);


          } catch (streamMergeError) {
            console.error("Stream Merge Catch Error:", streamMergeError);
            // dataStream.getWriter().error(streamMergeError); // Uncomment if you want to propagate the error to the client stream
          }
          // --- End of Error Handling Around Streaming ---

        },
      });
      // Data stream response created. (Log added for earlier diagnosis)
      console.log("Data stream response" ,dataStreamResponse)
      return dataStreamResponse; // Return the data stream response
    } catch (initError) {
      console.error("Error during early initialization:", initError); // Catch errors in the initial part (Log added for earlier diagnosis)
      return new Response("Internal Server Error during initialization", { status: 500 }); // Return an error response
    }
  }

}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!env.OPENAI_API_KEY; //if needs be add .process back to the front
      return Response.json({
        success: hasOpenAIKey,
      });
    }
    if (!env.OPENAI_API_KEY) { //again here add procces. infront if needs be
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;