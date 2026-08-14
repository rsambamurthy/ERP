"use client";

// Floating "data assistant" widget — mounted once in AppShell.tsx, visible
// on every authenticated page for anyone with the chatbot.access permission
// (see lib/auth.ts's canUseChatbot()). Conversation history lives only in
// this component's state — nothing is persisted; closing/reloading the tab
// starts a fresh conversation (see routes/chatbot.ts's header comment).
import { useEffect, useRef, useState } from "react";
import { askChatbot, ApiError } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="22" height="22">
      <path fillRule="evenodd" d="M2 5.5A2.5 2.5 0 014.5 3h11A2.5 2.5 0 0118 5.5v6a2.5 2.5 0 01-2.5 2.5H8.621a1 1 0 00-.707.293l-2.914 2.914A1 1 0 013.5 16.5V14h-1A2.5 2.5 0 010 11.5v-6z" clipRule="evenodd" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.925a.75.75 0 00.826.95 28.897 28.897 0 0015.293-7.155.75.75 0 000-1.113A28.897 28.897 0 003.105 2.289z" />
    </svg>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, sending, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await askChatbot(text, history);
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the data assistant. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) {
    return (
      <button className="chat-launcher" onClick={() => setOpen(true)} title="Ask about your company's data">
        <ChatIcon />
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-hdr">
        <div>
          <div className="chat-panel-title">Data Assistant</div>
          <div className="chat-panel-sub">Ask about your accounts, sales, purchases, stock</div>
        </div>
        <button className="chat-panel-close" onClick={() => setOpen(false)} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="chat-panel-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Try asking: &ldquo;What&rsquo;s our profit this month?&rdquo;, &ldquo;Who owes us money?&rdquo;, or &ldquo;How much stock do we have?&rdquo;
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-msg-bubble">{m.content}</div>
          </div>
        ))}
        {sending && (
          <div className="chat-msg assistant">
            <div className="chat-msg-bubble">
              <span className="chat-typing"><span /><span /><span /></span>
            </div>
          </div>
        )}
        {error && (
          <div className="chat-msg error">
            <div className="chat-msg-bubble">{error}</div>
          </div>
        )}
      </div>

      <div className="chat-panel-ftr">
        <textarea
          className="chat-input"
          rows={1}
          placeholder="Ask a question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <button className="chat-send-btn" onClick={send} disabled={sending || !input.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
