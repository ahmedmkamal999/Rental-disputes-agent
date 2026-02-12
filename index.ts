import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; // Your existing agent file
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 7860; // Hugging Face requirement
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// 1. Webhook Endpoint (Telegram talks to this)
app.post('/webhook', async (req, res) => {
  const message = req.body.message;

  // Basic validation
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text;

  try {
    // 2. Ask the Agent (No network call needed, it's right here!)
    console.log("Asking agent:", userText);

    // Google ADK LlmAgent uses generate() method
    const response = await rootAgent.generate({
      userMessage: userText,
    });
    const replyText = typeof response === 'string' ? response : response.text || "I processed that but have no text to show.";

    // 3. Send Reply to Telegram
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText
      });
    } else {
      console.warn("TELEGRAM_TOKEN not set - skipping Telegram reply");
    }

  } catch (error) {
    console.error("Agent Error:", error);
    // Optional: Error message to user
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "Sorry, I encountered an error processing your request."
      });
    }
  }

  // Always return 200 OK to Telegram
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Agent is running 24/7!'));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
