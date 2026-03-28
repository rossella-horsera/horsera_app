/**
 * scripts/linkedin-auth.js
 *
 * One-time OAuth2 flow to get a LinkedIn access token.
 * Run: node scripts/linkedin-auth.js
 * Then open the URL in your browser, log in, and the token will be saved.
 */

import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env.local
function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
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

const ENV = loadEnv();
const CLIENT_ID = ENV.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = ENV.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3939/callback";
const SCOPES = "openid profile w_member_social";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in .env.local");
  process.exit(1);
}

// Step 1: Show the auth URL
const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;

console.log("\n=== LinkedIn OAuth2 Setup ===\n");
console.log("Open this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for callback...\n");

// Step 2: Start a local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3939`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description")}</p>`);
      server.close();
      return;
    }

    if (!code) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>No code received</h1>");
      server.close();
      return;
    }

    // Exchange code for access token
    try {
      const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        const token = tokenData.access_token;

        // Get user profile
        const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const profile = await profileRes.json();

        console.log("✅ Access token obtained!");
        console.log(`   Expires in: ${tokenData.expires_in} seconds`);
        console.log(`   LinkedIn user: ${profile.name} (${profile.sub})`);

        // Try to find organizations this user is admin of
        let orgInfo = "";
        try {
          const orgRes = await fetch(
            "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(localizedName,vanityName),roleAssignee))",
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const orgData = await orgRes.json();
          const orgs = orgData.elements || [];

          if (orgs.length > 0) {
            console.log("\n📋 Organizations you admin:");
            for (const org of orgs) {
              const orgUrn = org.organization;
              const orgName = org["organization~"]?.localizedName || "Unknown";
              const orgId = orgUrn.split(":").pop();
              console.log(`   ${orgName} → urn:li:organization:${orgId}`);
              orgInfo += `\nLINKEDIN_ORG_URN=urn:li:organization:${orgId}`;
            }
          } else {
            console.log("\n⚠️  No organization admin access found. You may need to check the LinkedIn app's products (Community Management API).");
          }
        } catch (err) {
          console.log("\n⚠️  Could not fetch organizations:", err.message);
          console.log("   You may need to add 'Community Management API' to your LinkedIn app products.");
        }

        // Append to .env.local
        const envPath = path.join(ROOT, ".env.local");
        const additions = `\nLINKEDIN_ACCESS_TOKEN=${token}\nLINKEDIN_PERSON_URN=urn:li:person:${profile.sub}${orgInfo}\n`;
        fs.appendFileSync(envPath, additions);

        console.log("\n✅ Saved to .env.local:");
        console.log(`   LINKEDIN_ACCESS_TOKEN=...${token.slice(-20)}`);
        console.log(`   LINKEDIN_PERSON_URN=urn:li:person:${profile.sub}`);
        if (orgInfo) console.log(`   LINKEDIN_ORG_URN=${orgInfo.split("=").pop()}`);
        console.log("\nAdd these same values to Railway Variables for the bot to publish.");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>✅ Success!</h1><p>LinkedIn connected as <strong>${profile.name}</strong>.</p>${orgInfo ? "<p>Organization access found — posts will appear as Horsera.</p>" : "<p>⚠️ No org access yet — check LinkedIn app products.</p>"}<p>You can close this window.</p>`);
      } else {
        console.error("Token exchange failed:", tokenData);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      }
    } catch (err) {
      console.error("Error:", err.message);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
    }

    server.close();
  }
});

server.listen(3939, () => {
  console.log("Local server listening on http://localhost:3939");
});
