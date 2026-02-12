import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import dns from 'node:dns'; // <--- NEW IMPORT

// 1. THE NUCLEAR FIX: Force Node to prefer IPv4 globally
// This fixes the "ENOTFOUND" error in 99% of containers
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

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
    
    // Send using the new helper
    await sendToTelegram(chatId, replyText);

  } catch (error) {
    console.error("❌ Agent Error:", error);
    await sendToTelegram(chatId, "Sorry, I encountered an error. Please try again.");
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.json({ status: 'running', ipv4_forced: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});