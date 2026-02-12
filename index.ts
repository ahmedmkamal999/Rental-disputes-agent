import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import dns from 'node:dns';

// =================================================================
// ☢️ NUCLEAR FIX: MANUAL DNS OVERRIDE
// We explicitly tell Node: "If you see api.telegram.org, go to 149.154.167.220"
// This bypasses the broken container DNS completely.
// =================================================================
const originalLookup = dns.lookup.bind(dns);
type DnsLookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
  let resolvedOptions: dns.LookupOptions | undefined;
  let resolvedCallback: DnsLookupCallback;

  if (typeof options === 'function') {
    resolvedCallback = options as DnsLookupCallback;
  } else {
    resolvedOptions = options as dns.LookupOptions | undefined;
    resolvedCallback = callback as DnsLookupCallback;
  }

  if (hostname === 'api.telegram.org') {
    // console.log('⚡ Using Hardcoded IP for Telegram');
    return resolvedCallback(null, '149.154.167.220', 4); // Telegram's Public IP
  }

  return originalLookup(hostname, resolvedOptions ?? {}, resolvedCallback as any);
}) as typeof dns.lookup;
// =================================================================

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 7860;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('===== Environment Check =====');
console.log('PORT:', PORT);
console.log('TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? '✓ Set' : '✗ Missing');

const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'RentalDisputesBot'
});

async function ensureSession(userId: string, sessionId: string) {
  const session = await runner.sessionService.getSession({
    appName: 'RentalDisputesBot',
    userId,
    sessionId
  });

  if (!session) {
    await runner.sessionService.createSession({
      appName: 'RentalDisputesBot',
      userId,
      sessionId,
      state: {}
    });
  }
}

// Helper function to send to Telegram using Native Fetch
async function sendToTelegram(chatId: number, text: string) {
  if (!TELEGRAM_TOKEN) return;
  
  // Note: We still use the domain name here. 
  // Our custom dns.lookup above will silently swap it for the IP in the background.
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Telegram API Error: ${response.status} ${errText}`);
    } else {
      console.log('📤 Reply sent to Telegram');
    }
  } catch (error) {
    console.error("❌ Network Error sending to Telegram:", error);
  }
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  console.log(`💬 Processing: ${userText}`);

  try {
    const sessionId = `telegram_${chatId}`;
    const userId = `user_${chatId}`;
    await ensureSession(userId, sessionId);

    const events = runner.runAsync({
      userId,
      sessionId,
      newMessage: { role: 'user', parts: [{ text: userText }] }
    });

    let replyText = '';
    for await (const event of events) {
      const text = stringifyContent(event);
      if (text) replyText += text;
    }

    if (!replyText) replyText = "Thinking...";

    console.log(`✅ Generated reply: ${replyText.substring(0, 50)}...`);
    
    await sendToTelegram(chatId, replyText);

  } catch (error) {
    console.error("❌ Agent Error:", error);
    await sendToTelegram(chatId, "Sorry, I encountered an error. Please try again.");
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.json({ status: 'running', dns_patch: 'active' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT} with DNS Patch`);
});