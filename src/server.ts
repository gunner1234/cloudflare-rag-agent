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
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
//import { agentContext } from "./context"; //NEW ADDED

//import { AsyncLocalStorage } from "node:async_hooks";  CAN ADD BACK LATER 
//import { env } from "cloudflare:workers";



// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

// we use ALS to expose the agent context to the tools
//export const agentContext = new AsyncLocalStorage<Chat>();   ----HERE IF NEEDED-------------
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
  
    console.log("env.AI_MODEL:", this.env.AI_MODEL);
    console.log("model init start");
    console.log("onChatMessage triggered");
  
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        const processedMessages = await processToolCalls({
          messages: this.messages,
          dataStream,
          tools,
          executions,
        });
  
        const workersai = createWorkersAI({ binding: this.env.AI_MODEL });  
        const model = workersai("@cf/meta/llama-3-8b-instruct");       //change back to  env.AI_MODEL if needs be 
        console.log("model created:", model);
  
        const result = streamText({
          model,
          system: `You are a helpful assistant that can do various tasks...`,
          messages: processedMessages,
          tools,
          onFinish,
          onError: (error) => {
            console.error("Error while streaming:", error);
          },
          maxSteps: 10,
        });
  
        result.mergeIntoDataStream(dataStream);
        return dataStream;
      },
    });
  
    return dataStreamResponse;
  }
  
  }
 
/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!env.OPENAI_API_KEY;  //if needs be add .process back to the front 
      return Response.json({
        success: hasOpenAIKey,
      });
    }
    if (!env.OPENAI_API_KEY) {   //again here add procces. infront if needs be
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
