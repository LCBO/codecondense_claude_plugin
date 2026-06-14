// Single funnel that wraps a tool result into an MCP CallTool response.
//
// Guarantees a NON-EMPTY content array with no empty text block. An empty
// tool_result (content: [] or a "" text block) can stall the agent — it waits
// on content that never arrives — so every slim tool result passes through here
// and is floored. Today's tool paths already avoid empty output (the content
// search always emits a header block; other paths stringify an object), but
// routing through one guarded funnel makes the invariant explicit so a future
// return shape can't silently regress it.
export function toContent({ blocks, text } = {}) {
  if (Array.isArray(blocks) && blocks.length > 0) {
    return {
      content: blocks.map((t) => ({
        type: "text",
        text: typeof t === "string" && t.length > 0 ? t : "(empty)",
      })),
    };
  }
  const safe = typeof text === "string" && text.trim().length > 0 ? text : "{}";
  return { content: [{ type: "text", text: safe }] };
}
