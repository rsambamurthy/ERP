cd path/to/ERP
git add -A
git commit -m "Add AI data assistant chatbot (chatbot.access permission, floating widget)

- backend/src/lib/reports.ts: extract Trial Balance/P&L/Balance Sheet/
  Cash Book/Receipts & Payments computations out of routes/journal.ts so
  both the report endpoints and the chatbot share exactly one
  implementation.
- backend/src/lib/permissions.ts: new chatbot.access permission
  (Owner/Admin by default, grantable to custom roles).
- backend/src/lib/chatbotTools.ts: tool catalogue + executors (trial
  balance, P&L, balance sheet, cash book, receipts & payments, GSTR-1/3B
  summaries, stock summary, recent sales invoices/purchase bills,
  outstanding customer/vendor balances) — every executor scoped to the
  caller's own organizationId only.
- backend/src/routes/chatbot.ts: POST /chatbot/ask — tool-calling agent
  loop against Claude's Messages API (reuses ANTHROPIC_API_KEY), gated by
  chatbot.access, session-only history (nothing persisted server-side).
- frontend: askChatbot() in lib/api.ts, canUseChatbot() in lib/auth.ts,
  ChatMessage type + chatbot.access permission entries in lib/types.ts,
  new components/chatbot/ChatWidget.tsx (floating widget), mounted in
  AppShell.tsx gated by canUseChatbot(). New .chat-* styles in
  app/globals.css matching the existing navy/blue design system.
- backend/README.md: document POST /chatbot/ask and the shared
  ANTHROPIC_API_KEY requirement."
git push
