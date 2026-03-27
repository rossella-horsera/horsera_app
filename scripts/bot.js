/**
 * scripts/bot.js
 *
 * Horsera Slack bot — conversational interface to the agent team.
 * Uses Socket Mode (@slack/bolt) and Anthropic API for agent responses.
 * Single file, ES module.
 *
 * Usage:  node scripts/bot.js
 * Requires: @slack/bolt, @anthropic-ai/sdk
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { App } from "@slack/bolt";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";

// ── Helpers ─────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

// ── Load .env.local ─────────────────────────────────────────────────────────

function loadEnv() {
  // In production (Railway), env vars come from process.env
  // Locally, read from .env.local
  const envPath = path.join(ROOT, ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    const env = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    return env;
  }
  // Fall back to process.env (Railway, Docker, etc.)
  return process.env;
}

const ENV = loadEnv();

const SLACK_BOT_TOKEN = ENV.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = ENV.SLACK_APP_TOKEN;
const ANTHROPIC_API_KEY = ENV.ANTHROPIC_API_KEY;
const TRELLO_API_KEY = ENV.TRELLO_API_KEY;
const TRELLO_TOKEN = ENV.TRELLO_TOKEN;

if (!SLACK_BOT_TOKEN) throw new Error("Missing SLACK_BOT_TOKEN in .env.local");
if (!SLACK_APP_TOKEN) throw new Error("Missing SLACK_APP_TOKEN in .env.local");
if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY in .env.local");
if (!TRELLO_API_KEY) throw new Error("Missing TRELLO_API_KEY in .env.local");
if (!TRELLO_TOKEN) throw new Error("Missing TRELLO_TOKEN in .env.local");

// ── Trello config ───────────────────────────────────────────────────────────

const TRELLO_BASE = "https://api.trello.com/1";
const TRELLO_BOARDS = {
  main: "Xe7yzxVo",
  social: "69c55c2df1405484a92bef28",
};

const SAGE_LISTS = {
  requestedTopics: "69c55c43ae2062d2026d8fc2",
  inProgress: "69c55c4c9358a30186118e16",
  toReview: "69c55c872b19434e48ce7b7d",
  approved: "69c55c902b19434e48ce9c73",
  published: "69c55c50dccc64d962916fa3",
};

// ── Trello helpers ──────────────────────────────────────────────────────────

function trelloUrl(endpoint) {
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${TRELLO_BASE}${endpoint}${sep}key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
}

async function trelloMoveCard(cardId, listId) {
  const res = await fetch(trelloUrl(`/cards/${cardId}?idList=${listId}`), {
    method: "PUT",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello move_card failed (${res.status}): ${body}`);
  }
  return await res.json();
}

async function trelloAddComment(cardId, text) {
  const res = await fetch(trelloUrl(`/cards/${cardId}/actions/comments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello add_comment failed (${res.status}): ${body}`);
  }
  return await res.json();
}

async function trelloCreateCard(listId, name, desc = "") {
  const res = await fetch(trelloUrl("/cards"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idList: listId, name, desc }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello create_card failed (${res.status}): ${body}`);
  }
  return await res.json();
}

// Map tool names to handler functions
const TRELLO_TOOL_HANDLERS = {
  move_card: async (input) => {
    const result = await trelloMoveCard(input.cardId, input.listId);
    return { success: true, card: { id: result.id, name: result.name, url: result.shortUrl } };
  },
  add_comment: async (input) => {
    const result = await trelloAddComment(input.cardId, input.text);
    return { success: true, commentId: result.id };
  },
  create_card: async (input) => {
    const result = await trelloCreateCard(input.listId, input.name, input.desc || "");
    return { success: true, card: { id: result.id, name: result.name, url: result.shortUrl } };
  },
};

// ── Google Docs config ──────────────────────────────────────────────────────

const CONTENT_DOC_ID = "1BulY-4nHxpn69ZUbOItOxYN1OArDktyBoc_bVDDI-xM";
const CONTENT_TAB_ID = "t.0";
const MEMORY_TAB_ID = "t.m8e6w0f9mcmv";

// Horsera brand colors
const COLORS = {
  cognac: { red: 0.549, green: 0.353, blue: 0.235 },     // #8C5A3C
  champagne: { red: 0.788, green: 0.663, blue: 0.431 },   // #C9A96E
  cadenceBlue: { red: 0.420, green: 0.498, blue: 0.639 }, // #6B7FA3
  progressGreen: { red: 0.490, green: 0.608, blue: 0.463 }, // #7D9B76
  ink: { red: 0.102, green: 0.078, blue: 0.055 },          // #1A140E
  stone: { red: 0.941, green: 0.922, blue: 0.894 },        // #F0EBE4
};

let docsClient = null;

function getDocsClient() {
  if (docsClient) return docsClient;
  const b64Key = ENV.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64Key) {
    log("Warning: GOOGLE_SERVICE_ACCOUNT_KEY not set — Google Docs tools disabled");
    return null;
  }
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(b64Key, "base64").toString("utf-8"));
    log("Google credentials loaded for:", credentials.client_email);
  } catch (err) {
    log("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", err.message);
    log("Key length:", b64Key.length, "chars, first 50:", b64Key.slice(0, 50));
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"],
  });
  docsClient = google.docs({ version: "v1", auth });
  return docsClient;
}

async function readGoogleDocTab(tabId = CONTENT_TAB_ID) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");
  const doc = await docs.documents.get({
    documentId: CONTENT_DOC_ID,
    includeTabsContent: true,
  });
  // Find the right tab
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === tabId);
  if (!tab) throw new Error(`Tab ${tabId} not found in document`);
  let text = "";
  for (const element of tab.documentTab?.body?.content || []) {
    if (element.paragraph) {
      for (const el of element.paragraph.elements || []) {
        if (el.textRun) text += el.textRun.content;
      }
    }
  }
  return { title: tab.tabProperties?.title || "Untitled", text: text.trim() };
}

function getTabEndIndex(tab) {
  const content = tab.documentTab?.body?.content || [];
  return content.at(-1)?.endIndex || 1;
}

async function appendFormattedPost(postData) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");

  const doc = await docs.documents.get({ documentId: CONTENT_DOC_ID, includeTabsContent: true });
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === CONTENT_TAB_ID);
  if (!tab) throw new Error("Content tab not found");
  const endIndex = getTabEndIndex(tab);
  const startIdx = endIndex - 1;

  // Build the post text block
  const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  const status = postData.status || "Draft";
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const title = postData.title || "Untitled Post";
  const hook = postData.hook || "";
  const body = postData.body || "";
  const hashtags = postData.hashtags || "";
  const notes = postData.notes || "";

  const statusLine = `[${status}]  •  ${date}\n`;
  const titleLine = `${title}\n\n`;
  const hookLabel = "HOOK\n";
  const hookText = `${hook}\n\n`;
  const bodyLabel = "BODY\n";
  const bodyText = `${body}\n\n`;
  const hashtagsLabel = "HASHTAGS\n";
  const hashtagsText = `${hashtags}\n\n`;
  const notesSection = notes ? `ROSSELLA'S NOTES\n${notes}\n\n` : "ROSSELLA'S NOTES\n(Add your feedback here)\n\n";

  const fullText = divider + statusLine + titleLine + hookLabel + hookText + bodyLabel + bodyText + hashtagsLabel + hashtagsText + notesSection;

  // Step 1: Insert all text (specify tab)
  const requests = [
    { insertText: { location: { index: startIdx, tabId: CONTENT_TAB_ID }, text: fullText } },
  ];

  // Step 2: Apply formatting (indices relative to startIdx)
  let idx = startIdx;

  // Divider — cognac color
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + divider.length },
      textStyle: { foregroundColor: { color: { rgbColor: COLORS.cognac } } },
      fields: "foregroundColor",
    },
  });
  idx += divider.length;

  // Status line — champagne, small caps feel
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + statusLine.length },
      textStyle: {
        foregroundColor: { color: { rgbColor: COLORS.champagne } },
        bold: true,
        fontSize: { magnitude: 9, unit: "PT" },
      },
      fields: "foregroundColor,bold,fontSize",
    },
  });
  idx += statusLine.length;

  // Title — heading style, cognac
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: idx, endIndex: idx + titleLine.length },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType",
    },
  });
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + titleLine.length - 1 },
      textStyle: { foregroundColor: { color: { rgbColor: COLORS.cognac } } },
      fields: "foregroundColor",
    },
  });
  idx += titleLine.length;

  // Section labels — bold, cadence blue, small
  const sections = [
    { label: hookLabel, text: hookText },
    { label: bodyLabel, text: bodyText },
    { label: hashtagsLabel, text: hashtagsText },
  ];

  for (const section of sections) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + section.label.length },
        textStyle: {
          foregroundColor: { color: { rgbColor: COLORS.cadenceBlue } },
          bold: true,
          fontSize: { magnitude: 8, unit: "PT" },
        },
        fields: "foregroundColor,bold,fontSize",
      },
    });
    idx += section.label.length;

    // Body text — ink color, normal
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + section.text.length },
        textStyle: {
          foregroundColor: { color: { rgbColor: COLORS.ink } },
          fontSize: { magnitude: 11, unit: "PT" },
        },
        fields: "foregroundColor,fontSize",
      },
    });
    idx += section.text.length;
  }

  // Notes label — progress green
  const notesLabel = "ROSSELLA'S NOTES\n";
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + notesLabel.length },
      textStyle: {
        foregroundColor: { color: { rgbColor: COLORS.progressGreen } },
        bold: true,
        fontSize: { magnitude: 8, unit: "PT" },
      },
      fields: "foregroundColor,bold,fontSize",
    },
  });

  await docs.documents.batchUpdate({
    documentId: CONTENT_DOC_ID,
    requestBody: { requests },
  });

  return { success: true, docId: CONTENT_DOC_ID };
}

// ── Sage Memory (persistent across redeploys) ──────────────────────────────

async function readSageMemory() {
  try {
    const result = await readGoogleDocTab(MEMORY_TAB_ID);
    return result.text;
  } catch (err) {
    log("Failed to read Sage memory:", err.message);
    return "";
  }
}

async function appendSageMemory(content) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");
  const doc = await docs.documents.get({ documentId: CONTENT_DOC_ID, includeTabsContent: true });
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === MEMORY_TAB_ID);
  if (!tab) throw new Error("Sage-memory tab not found");
  const endIndex = getTabEndIndex(tab);
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n[${date}] ${content}\n`;
  await docs.documents.batchUpdate({
    documentId: CONTENT_DOC_ID,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1, tabId: MEMORY_TAB_ID }, text: entry } }],
    },
  });
  return { success: true };
}

// Google Docs tool handlers
const GDOCS_TOOL_HANDLERS = {
  read_content_doc: async () => {
    const result = await readGoogleDocTab(CONTENT_TAB_ID);
    return { success: true, title: result.title, content: result.text };
  },
  append_to_content_doc: async (input) => {
    const result = await appendFormattedPost(input);
    return result;
  },
  read_sage_memory: async () => {
    const text = await readSageMemory();
    return { success: true, content: text };
  },
  save_sage_memory: async (input) => {
    const result = await appendSageMemory(input.content);
    return result;
  },
};

// Merge into Trello handlers
Object.assign(TRELLO_TOOL_HANDLERS, GDOCS_TOOL_HANDLERS);

// Tool definitions for Claude
const TRELLO_TOOLS = [
  {
    name: "move_card",
    description:
      "Move a Trello card to a different list. Use this when Rossella approves, rejects, or wants to change the status of a card.",
    input_schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "The Trello card ID" },
        listId: { type: "string", description: "The target list ID to move the card to" },
      },
      required: ["cardId", "listId"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a Trello card.",
    input_schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "The Trello card ID" },
        text: { type: "string", description: "The comment text" },
      },
      required: ["cardId", "text"],
    },
  },
  {
    name: "create_card",
    description: "Create a new Trello card in a specified list.",
    input_schema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The list ID to create the card in" },
        name: { type: "string", description: "The card title" },
        desc: { type: "string", description: "The card description (optional)" },
      },
      required: ["listId", "name"],
    },
  },
  {
    name: "read_content_doc",
    description: "Read the current contents of the Horsera Content Pipeline Google Doc. Use this to see what drafts exist, what's been approved, and what Rossella has commented on.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "append_to_content_doc",
    description: "Add a beautifully formatted LinkedIn post draft to the Horsera Content Pipeline Google Doc. The doc is styled with Horsera brand colors automatically. Provide structured post data.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title (e.g., 'Swimming With Horses — Personal Story')" },
        status: { type: "string", description: "Status: Draft, In Review, Approved, Published" },
        hook: { type: "string", description: "The opening hook line (bold, attention-grabbing)" },
        body: { type: "string", description: "The main post body (2-4 paragraphs)" },
        hashtags: { type: "string", description: "Hashtags (e.g., '#equestrian #horsescience')" },
        notes: { type: "string", description: "Optional notes or questions for Rossella" },
      },
      required: ["title", "hook", "body", "hashtags"],
    },
  },
  {
    name: "read_sage_memory",
    description: "Read Sage's persistent memory — conversation history, preferences, and context from past sessions. Always read this at the start of a new conversation to maintain continuity.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "save_sage_memory",
    description: "Save an important fact, decision, preference, or conversation summary to Sage's persistent memory. Use this to remember things across sessions — e.g., content decisions, Rossella's feedback patterns, approved topics, ongoing projects. Be concise but specific.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory to save (concise, specific, useful for future sessions)" },
      },
      required: ["content"],
    },
  },
];

// ── Agent system prompts ────────────────────────────────────────────────────

const AGENT_BASE_PROMPT = (name) => `You are ${name}, a member of the Horsera agent team. You are chatting with Rossella (the founder) in Slack.
Reply concisely and in character. Use markdown formatting sparingly — Slack uses mrkdwn, not full markdown.
When Rossella approves a post or card, confirm and take the Trello action.
When she gives feedback, acknowledge it specifically and offer a revision.`;

const SAGE_EXTRA_PROMPT = `
You have access to Trello. The social board lists are:
- Requested Topics: 69c55c43ae2062d2026d8fc2
- In Progress: 69c55c4c9358a30186118e16
- To Review: 69c55c872b19434e48ce7b7d
- Approved: 69c55c902b19434e48ce9c73
- Published: 69c55c50dccc64d962916fa3

When Rossella approves a post, move the card to Approved and confirm.
When she requests changes, update the card description with the new draft and move it back to In Progress.

You also have access to the Horsera Content Pipeline Google Doc.
- Use read_content_doc to see current drafts, approved posts, and Rossella's inline comments
- Use append_to_content_doc to add new post drafts — provide structured data (title, hook, body, hashtags, notes) and the doc will be formatted beautifully with Horsera brand colors
- The Google Doc is the primary workspace for drafting and reviewing content
- Trello tracks status; the Google Doc holds the actual content
- When you draft a new post, add it to the Google Doc AND create/update the Trello card

IMPORTANT — Persistent Memory:
- You have a persistent memory via read_sage_memory and save_sage_memory
- At the START of every new conversation, call read_sage_memory to load context from prior sessions
- After meaningful conversations (content decisions, feedback, new topics, preferences), save key takeaways to memory
- This memory survives restarts and redeploys — it is your long-term knowledge base
- Save things like: approved topics, Rossella's content preferences, ongoing projects, key decisions, feedback patterns`;

function loadAgentFile(filename) {
  const filePath = path.join(ROOT, "_agents", filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return null;
}

function buildSystemPrompt(agentName, mdFile, extra = "") {
  const base = AGENT_BASE_PROMPT(agentName);
  const fileContent = loadAgentFile(mdFile);
  const personality = fileContent
    ? `\n\n--- Agent Reference ---\n${fileContent}`
    : "";
  return `${base}${extra}${personality}`;
}

const DEFAULT_PERSONALITIES = {
  ross: "You are Ross, the product manager. You are bold, visionary, and relentlessly practical. You guard the product vision, define scope and priorities, and have deep equestrian expertise. You think in systems and loops.",
  lauren:
    "You are Lauren, the designer. You start with empathy and think about what the rider is feeling. You own how Horsera feels — the visual DNA, the emotional journey, and the premium equestrian aesthetic.",
  beau: "You are Beau, the developer. You are pragmatic, clean, and quietly proud of good code. You implement features, maintain the architecture, and prefer simple solutions. You flag technical debt honestly.",
  quinn:
    "You are Quinn, the QA reviewer. You are skeptical, thorough, and rider-perspective-first. You are the last line of defense before anything ships. You think about what breaks, not just what works.",
};

// Build all agent system prompts at startup
const AGENTS = {
  sage: buildSystemPrompt("Sage", "sage.md", SAGE_EXTRA_PROMPT),
  ross: loadAgentFile("ross.md")
    ? buildSystemPrompt("Ross", "ross.md")
    : `${AGENT_BASE_PROMPT("Ross")}\n\n${DEFAULT_PERSONALITIES.ross}`,
  lauren: loadAgentFile("lauren.md")
    ? buildSystemPrompt("Lauren", "lauren.md")
    : `${AGENT_BASE_PROMPT("Lauren")}\n\n${DEFAULT_PERSONALITIES.lauren}`,
  beau: loadAgentFile("beau.md")
    ? buildSystemPrompt("Beau", "beau.md")
    : `${AGENT_BASE_PROMPT("Beau")}\n\n${DEFAULT_PERSONALITIES.beau}`,
  quinn: loadAgentFile("quinn.md")
    ? buildSystemPrompt("Quinn", "quinn.md")
    : `${AGENT_BASE_PROMPT("Quinn")}\n\n${DEFAULT_PERSONALITIES.quinn}`,
};

log("Agent system prompts loaded:");
for (const [name, prompt] of Object.entries(AGENTS)) {
  log(`  ${name}: ${prompt.length} chars`);
}

// ── Agent routing ───────────────────────────────────────────────────────────

// Channel-based defaults (channel name -> agent)
const CHANNEL_DEFAULTS = {
  "horsera-social": "sage",
  "horsera-agents": "ross",
};

// Keyword patterns for agent detection (checked in order)
const AGENT_KEYWORDS = [
  { pattern: /\bsage\b/i, agent: "sage" },
  { pattern: /\bross\b/i, agent: "ross" },
  { pattern: /\bbeau\b/i, agent: "beau" },
  { pattern: /\blauren\b/i, agent: "lauren" },
  { pattern: /\bquinn\b/i, agent: "quinn" },
];

function detectAgent(text, channelName) {
  // Check keyword mentions first
  for (const { pattern, agent } of AGENT_KEYWORDS) {
    if (pattern.test(text)) return agent;
  }
  // Fall back to channel default
  if (channelName && CHANNEL_DEFAULTS[channelName]) {
    return CHANNEL_DEFAULTS[channelName];
  }
  // Ultimate default
  return "ross";
}

// ── Conversation memory ──────────────────────────────────────────────────────
// Thread messages use threadTs as key. Channel-level messages use channelId as key.

const conversationHistory = new Map(); // key -> { agent, messages[] }
const MAX_MESSAGES = 20;
const CHANNEL_CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 min — reset channel context after inactivity

function getConversationKey(channelId, threadTs, isInThread) {
  return isInThread ? `thread:${threadTs}` : `channel:${channelId}`;
}

function getConversationContext(key) {
  const ctx = conversationHistory.get(key);
  if (!ctx) return null;
  // For channel-level convos, expire after 30 min of inactivity
  if (key.startsWith("channel:") && Date.now() - ctx.lastActivity > CHANNEL_CONTEXT_TIMEOUT) {
    conversationHistory.delete(key);
    return null;
  }
  return ctx;
}

function addToConversation(key, agent, role, content) {
  let ctx = conversationHistory.get(key);
  if (!ctx) {
    ctx = { agent, messages: [], lastActivity: Date.now() };
    conversationHistory.set(key, ctx);
  }
  ctx.messages.push({ role, content });
  ctx.lastActivity = Date.now();
  // Trim to last MAX_MESSAGES
  if (ctx.messages.length > MAX_MESSAGES) {
    ctx.messages = ctx.messages.slice(-MAX_MESSAGES);
  }
  // Update agent if changed
  ctx.agent = agent;
}

// ── Anthropic client ────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function callAnthropicWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 529 && attempt < maxRetries) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        log(`Anthropic 529 overloaded — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function callClaude(systemPrompt, messages) {
  // Initial API call
  let response = await callAnthropicWithRetry({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    tools: TRELLO_TOOLS,
  });

  // Process tool calls in a loop until we get a final text response
  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    const toolUseBlocks = assistantContent.filter((b) => b.type === "tool_use");

    // Execute each tool call
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const handler = TRELLO_TOOL_HANDLERS[toolUse.name];
      let result;
      if (handler) {
        try {
          result = await handler(toolUse.input);
          log(`Tool ${toolUse.name} succeeded:`, JSON.stringify(result));
        } catch (err) {
          log(`Tool ${toolUse.name} failed:`, err.message);
          result = { success: false, error: err.message };
        }
      } else {
        result = { success: false, error: `Unknown tool: ${toolUse.name}` };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    // Continue the conversation with tool results
    const updatedMessages = [
      ...messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: toolResults },
    ];

    response = await callAnthropicWithRetry({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: updatedMessages,
      tools: TRELLO_TOOLS,
    });
  }

  // Extract final text
  const textBlocks = response.content.filter((b) => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n");
}

// ── Slack app ───────────────────────────────────────────────────────────────

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  clientOptions: {
    slackApiUrl: "https://slack.com/api/",
  },
  socketModePingInterval: 30000,
  socketModePingTimeout: 15000,
});

// Cache for channel name lookups
const channelNameCache = new Map();

async function getChannelName(channelId) {
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId);
  try {
    const info = await app.client.conversations.info({ channel: channelId });
    const name = info.channel?.name || null;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    return null;
  }
}

// Listen for all messages (including in threads)
app.event("message", async ({ event, context }) => {
  let thinkingMsg = null;
  try {
    // Ignore bot messages, message_changed, etc.
    if (event.subtype) return;
    // Ignore messages from the bot itself
    if (event.bot_id || event.user === context.botUserId) return;

    const text = event.text || "";
    if (!text.trim()) return;

    const channelId = event.channel;
    const isInThread = !!event.thread_ts; // true only if the user's message is already in a thread
    const threadTs = event.thread_ts || event.ts;
    const channelName = await getChannelName(channelId);

    // Determine conversation key and existing context
    const convKey = getConversationKey(channelId, threadTs, isInThread);
    const existingCtx = getConversationContext(convKey);
    let agentKey;

    if (existingCtx && !AGENT_KEYWORDS.some(({ pattern }) => pattern.test(text))) {
      // Continue with the same agent in an ongoing conversation (unless user explicitly names one)
      agentKey = existingCtx.agent;
    } else {
      agentKey = detectAgent(text, channelName);
    }

    const agentName = agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
    log(`#${channelName || channelId} | ${agentName} | "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

    // Add user message to conversation history
    addToConversation(convKey, agentKey, "user", text);

    // Build messages array from conversation history
    const ctx = getConversationContext(convKey);

    // For Sage's first message in a new conversation, inject memory into system prompt
    let systemPrompt = AGENTS[agentKey];
    if (agentKey === "sage" && ctx.messages.length === 1) {
      try {
        const memory = await readSageMemory();
        if (memory) {
          systemPrompt += `\n\n--- Sage's Memory (from prior sessions) ---\n${memory}`;
          log("Loaded Sage memory into system prompt");
        }
      } catch (err) {
        log("Failed to load Sage memory:", err.message);
      }
    }

    // Post a "thinking" message, then replace it with the real response
    const thinkingOpts = {
      channel: channelId,
      text: `_${agentName} is thinking..._`,
    };
    if (isInThread) {
      thinkingOpts.thread_ts = threadTs;
    }
    thinkingMsg = await app.client.chat.postMessage(thinkingOpts);

    // Call Claude
    const reply = await callClaude(systemPrompt, ctx.messages);

    // Add assistant reply to conversation history
    addToConversation(convKey, agentKey, "assistant", reply);

    // Replace the thinking message with the real response
    await app.client.chat.update({
      channel: channelId,
      ts: thinkingMsg.ts,
      text: reply,
    });

    log(`${agentName} replied (${reply.length} chars)`);
  } catch (err) {
    log("Error handling message:", err.message);
    console.error(err);

    // Update the thinking message with the error (or post a new one if thinking wasn't sent)
    try {
      if (thinkingMsg?.ts) {
        await app.client.chat.update({
          channel: event.channel,
          ts: thinkingMsg.ts,
          text: `Sorry, I hit a temporary error. Please try again in a moment.`,
        });
      } else {
        await app.client.chat.postMessage({
          channel: event.channel,
          text: `Sorry, I hit a temporary error. Please try again in a moment.`,
        });
      }
    } catch {
      log("Failed to send error message to Slack");
    }
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

(async () => {
  await app.start();
  log("Horsera bot is running (Socket Mode)");
  log("Agents available: " + Object.keys(AGENTS).join(", "));
  log("Channel defaults: " + JSON.stringify(CHANNEL_DEFAULTS));
  log("Listening for messages...");
})();
