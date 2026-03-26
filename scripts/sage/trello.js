/**
 * scripts/sage/trello.js
 *
 * Full Trello integration for Sage.
 * Reads TRELLO_API_KEY, TRELLO_TOKEN, and TRELLO_BOARD_ID from .env.local.
 *
 * Exports every function so Sage (publish.js) or any agent script can
 * call individual actions.
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Load credentials from .env.local ────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

const ENV = loadEnv();
const API_KEY = ENV.TRELLO_API_KEY;
const TOKEN = ENV.TRELLO_TOKEN;
const BOARD_ID = ENV.TRELLO_BOARD_ID;
const BASE = "https://api.trello.com/1";

if (!API_KEY || !TOKEN) {
  throw new Error("Missing TRELLO_API_KEY or TRELLO_TOKEN in .env.local");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Auth query string appended to every request */
function auth() {
  return `key=${API_KEY}&token=${TOKEN}`;
}

async function trelloFetch(endpoint, options = {}) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${BASE}${endpoint}${sep}${auth()}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Board & list operations ─────────────────────────────────────────────────

/** Get all lists on the board */
export async function getLists(boardId = BOARD_ID) {
  return trelloFetch(`/boards/${boardId}/lists`);
}

/** Find a list by name (case-insensitive partial match) */
export async function findList(name, boardId = BOARD_ID) {
  const lists = await getLists(boardId);
  const lower = name.toLowerCase();
  return lists.find((l) => l.name.toLowerCase().includes(lower));
}

/** Get all cards in a list */
export async function getCardsInList(listId) {
  return trelloFetch(`/lists/${listId}/cards`);
}

/** Get all cards on the board */
export async function getBoardCards(boardId = BOARD_ID) {
  return trelloFetch(`/boards/${boardId}/cards`);
}

/** Get all labels on the board */
export async function getBoardLabels(boardId = BOARD_ID) {
  return trelloFetch(`/boards/${boardId}/labels`);
}

// ── Card CRUD ───────────────────────────────────────────────────────────────

/** Create a new card in the specified list */
export async function createCard(listId, { name, desc, due, idLabels } = {}) {
  const params = new URLSearchParams();
  params.set("idList", listId);
  if (name) params.set("name", name);
  if (desc) params.set("desc", desc);
  if (due) params.set("due", due); // ISO 8601 date string
  if (idLabels) params.set("idLabels", idLabels); // comma-separated label IDs

  return trelloFetch(`/cards?${params.toString()}`, { method: "POST" });
}

/** Move a card to a different list */
export async function moveCard(cardId, listId) {
  return trelloFetch(`/cards/${cardId}?idList=${listId}`, { method: "PUT" });
}

/** Update a card's description */
export async function updateCardDesc(cardId, desc) {
  return trelloFetch(
    `/cards/${cardId}?desc=${encodeURIComponent(desc)}`,
    { method: "PUT" }
  );
}

/** Set or update a card's due date (ISO 8601 string or null to clear) */
export async function setDueDate(cardId, due) {
  const val = due === null ? "" : due;
  return trelloFetch(
    `/cards/${cardId}?due=${encodeURIComponent(val)}`,
    { method: "PUT" }
  );
}

/** Update card name */
export async function updateCardName(cardId, name) {
  return trelloFetch(
    `/cards/${cardId}?name=${encodeURIComponent(name)}`,
    { method: "PUT" }
  );
}

/** Get a single card by ID */
export async function getCard(cardId) {
  return trelloFetch(`/cards/${cardId}`);
}

// ── Comments ────────────────────────────────────────────────────────────────

/** Add a comment to a card */
export async function addComment(cardId, text) {
  return trelloFetch(`/cards/${cardId}/actions/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** Get all comments on a card */
export async function getComments(cardId) {
  return trelloFetch(`/cards/${cardId}/actions?filter=commentCard`);
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** Add a label to a card by label ID */
export async function addLabel(cardId, labelId) {
  return trelloFetch(`/cards/${cardId}/idLabels?value=${labelId}`, {
    method: "POST",
  });
}

/** Remove a label from a card */
export async function removeLabel(cardId, labelId) {
  return trelloFetch(`/cards/${cardId}/idLabels/${labelId}`, {
    method: "DELETE",
  });
}

// ── Attachments ─────────────────────────────────────────────────────────────

/** Attach an image file to a card */
export async function attachImage(cardId, filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // Build multipart form data manually with node-fetch
  const { FormData, File } = await import("node-fetch");
  const form = new FormData();
  form.append("file", new File([fileBuffer], fileName));

  return trelloFetch(`/cards/${cardId}/attachments`, {
    method: "POST",
    body: form,
  });
}

/** Attach a URL to a card */
export async function attachUrl(cardId, url, name) {
  const params = new URLSearchParams();
  params.set("url", url);
  if (name) params.set("name", name);

  return trelloFetch(`/cards/${cardId}/attachments?${params.toString()}`, {
    method: "POST",
  });
}

// ── Convenience ─────────────────────────────────────────────────────────────

/**
 * High-level helper: create a card in a list found by name.
 * Returns the full card object from Trello.
 */
export async function createCardInList(
  listName,
  { name, desc, due, idLabels, boardId } = {}
) {
  const list = await findList(listName, boardId || BOARD_ID);
  if (!list) throw new Error(`List "${listName}" not found on board`);
  return createCard(list.id, { name, desc, due, idLabels });
}

/**
 * High-level helper: move a card to a list found by name.
 */
export async function moveCardToList(cardId, listName, boardId) {
  const list = await findList(listName, boardId || BOARD_ID);
  if (!list) throw new Error(`List "${listName}" not found on board`);
  return moveCard(cardId, list.id);
}
