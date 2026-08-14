// POST /chatbot/ask — the AI data assistant. A tool-calling agent loop:
// Claude decides which read-only tool(s) from lib/chatbotTools.ts to call,
// this route executes them (always scoped to the caller's own
// organizationId — never anything the model or client supplies), feeds the
// results back, and loops until Claude has a final text answer.
//
// Conversation history is session-only — the client resends the running
// transcript on every call (see ChatWidget.tsx), nothing is persisted here.
import { Router } from "express";
import { authenticate, requireActiveSubscription, requirePermission, resolveOrgId } from "../middleware/auth";
import { CHATBOT_TOOLS, executeChatbotTool } from "../lib/chatbotTools";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 6;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are the data assistant built into SmartERP, answering the organization's Owner/Admin about their own company's accounting, sales, purchase, and stock data.

Rules:
- Use the provided tools to look up real data — never guess or make up figures.
- All monetary figures are in the organization's home currency (INR) unless a tool result says otherwise.
- Call as many tools as you need before answering; you may call more than one, and you may call the same tool again with different arguments.
- If a question is ambiguous (e.g. no date range given for a period-based report), make a reasonable assumption (e.g. current financial year to date, or "as of today") and say what you assumed.
- Keep answers concise and concrete — lead with the number/answer, then brief supporting detail. Use plain text, not markdown tables, unless a list genuinely helps.
- If the data shows nothing (e.g. no outstanding balances), say so plainly rather than apologizing at length.
- You cannot take any action (post entries, change data) — you are read-only. If asked to do something other than answer a question, say you can only answer questions about the data.`;

async function callAnthropic(apiKey: string, messages: any[]) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1536,
      system: SYSTEM_PROMPT,
      tools: CHATBOT_TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Chatbot request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{
    content: { type: string; text?: string; id?: string; name?: string; input?: any }[];
    stop_reason: string;
  }>;
}

const router = Router();
router.use(authenticate, requireActiveSubscription, requirePermission("chatbot.access"));

// POST /chatbot/ask  { message: string, history?: ChatMessage[] }
router.post("/ask", async (req, res) => {
  const organizationId = resolveOrgId(req);
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ message: "The data assistant isn't configured — ANTHROPIC_API_KEY is missing on the server." });
  }

  const { message, history } = req.body ?? {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ message: "message is required." });
  }
  const priorTurns: ChatMessage[] = Array.isArray(history)
    ? history.filter((m): m is ChatMessage => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-20)
    : [];

  const messages: any[] = [...priorTurns.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: message }];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await callAnthropic(apiKey, messages);

      if (response.stop_reason !== "tool_use") {
        const answer = response.content.find((c) => c.type === "text")?.text ?? "";
        return res.json({ answer });
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults = await Promise.all(
        response.content
          .filter((c) => c.type === "tool_use")
          .map(async (block) => {
            let result: unknown;
            try {
              result = await executeChatbotTool(organizationId, block.name!, block.input);
            } catch (err) {
              result = { error: err instanceof Error ? err.message : "Tool call failed." };
            }
            return { type: "tool_result", tool_use_id: block.id!, content: JSON.stringify(result) };
          })
      );
      messages.push({ role: "user", content: toolResults });
    }

    return res.status(504).json({ message: "The data assistant took too many steps to answer — try a more specific question." });
  } catch (err) {
    console.error("[chatbot/ask]", err);
    return res.status(502).json({ message: err instanceof Error ? err.message : "The data assistant is temporarily unavailable." });
  }
});

export default router;
