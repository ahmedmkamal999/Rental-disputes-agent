import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';
import https from 'https';

// =================================================================
// ☢️ NUCLEAR FIX V3: DIRECT IP + SSL BYPASS
// We stop asking "Where is Telegram?" and just go to the door directly.
// =================================================================
const TELEGRAM_IP = '149.154.167.220'; // Official Telegram API IP
const BYPASS_AGENT = new https.Agent({
  rejectUnauthorized: false // Required because we are connecting to an IP, not a Domain
});
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

// Helper function to send to Telegram using AXIOS + DIRECT IP
async function sendToTelegram(chatId: number, text: string) {
  if (!TELEGRAM_TOKEN) return;
  
  // We construct a URL using the IP ADDRESS, not the domain
  const url = `https://${TELEGRAM_IP}/bot${TELEGRAM_TOKEN}/sendMessage`;
  
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: text
    }, {
      headers: {
        'Host': 'api.telegram.org', // Trick Telegram into thinking we used the domain
        'Content-Type': 'application/json'
      },
      httpsAgent: BYPASS_AGENT, // Allow the SSL mismatch
      timeout: 10000 // 10 second timeout
    });
    console.log('📤 Reply sent to Telegram (via Direct IP)');
  } catch (error) {
    console.error("❌ Network Error sending to Telegram:", error instanceof Error ? error.message : error);
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
  res.json({ status: 'running', mode: 'direct_ip_bypass' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});