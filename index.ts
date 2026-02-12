import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000; // Render uses port 3000 by default usually
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Simple Agent runner
const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'RentalDisputesBot'
});

async function ensureSession(userId: string, sessionId: string) {
  const session = await runner.sessionService.getSession({
    appName: 'RentalDisputesBot',
    userId, sessionId
  });
  if (!session) {
    await runner.sessionService.createSession({
      appName: 'RentalDisputesBot',
      userId, sessionId, state: {}
    });
  }
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  try {
    const sessionId = `telegram_${chatId}`;
    const userId = `user_${chatId}`;
    await ensureSession(userId, sessionId);

    const events = runner.runAsync({
      userId, sessionId,
      newMessage: { role: 'user', parts: [{ text: userText }] }
    });

    let replyText = '';
    for await (const event of events) {
      const text = stringifyContent(event);
      if (text) replyText += text;
    }

    if (!replyText) replyText = "Thinking...";

    // Clean, standard Axios call
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText
      });
    }

  } catch (error) {
    console.error("Agent Error:", error);
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Agent is running on Render!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});