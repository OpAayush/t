const originalConsole = { ...console };

const webhookUrl =
  "https://discord.com/api/webhooks/1442775521543979119/eEY6zwp9Q1zlQ7kICeiGhpkC04ybjVvms6J3OCZt2h0I_il8iDLyQacIrk8CZ8vFnWuL";

const logColors = {
  log: "",
  info: "\u001b[34m",
  warn: "\u001b[31m",
  error: "\u001b[41m",
  debug: "\u001b[30m",
};

const MAX_LENGTH = 1800; // leave room for code fence

async function sendWebhook(message, username = "Console Logger") {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, username }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const retry = parseInt(res.headers.get("retry-after") || "1", 10);
        setTimeout(() => sendWebhook(message, username), retry * 1000);
      } else {
        originalConsole.error(
          "Webhook send failed:",
          res.status,
          await res.text()
        );
      }
    }
  } catch (e) {
    originalConsole.error("Webhook error:", e);
  }
}

function splitMessage(message, maxLength) {
  const chunks = [];
  let current = "";
  for (const line of message.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current.trimEnd());
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current.trimEnd());
  return chunks;
}

async function sendImmediate(type, message) {
  const color = logColors[type] || "";
  const formatted = `${color}${message}\u001b[0m`;
  const parts = splitMessage(formatted, MAX_LENGTH);
  for (const part of parts) {
    await sendWebhook(`\`\`\`ansi\n${part}\n\`\`\``);
  }
}

["log", "info", "warn", "error", "debug"].forEach((method) => {
  console[method] = function (...args) {
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    sendImmediate(method, message);
    originalConsole[method].apply(console, args);
  };
});

import "whatwg-fetch";
import "core-js/proposals/object-getownpropertydescriptors";
import "@formatjs/intl-getcanonicallocales/polyfill.iife";
import "@formatjs/intl-locale/polyfill.iife";
import "@formatjs/intl-displaynames/polyfill.iife";
import "@formatjs/intl-displaynames/locale-data/en";

import "./domrect-polyfill";
import "./features/adblock.js";
import "./features/sponsorblock.js";
import "./ui/ui.js";
import "./ui/speedUI.js";
import "./ui/theme.js";
import "./ui/settings.js";
import "./ui/disableWhosWatching.js";
import "./features/moreSubtitles.js";
import "./features/updater.js";
import "./features/pictureInPicture.js";
import "./ui/customUI.js";
