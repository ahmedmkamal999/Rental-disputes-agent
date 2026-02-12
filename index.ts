import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; // Your existing agent file
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';
import https from 'https';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 7860; // Hugging Face requirement
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const telegramAgent = new https.Agent({
  family: 4
});

// Validate required environment variables
console.log('===== Environment Check =====');
console.log('PORT:', PORT);
console.log('TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? '✓ Set' : '✗ Missing');
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? '✓ Set' : '✗ Missing');

if (!TELEGRAM_TOKEN) {
  console.warn('⚠️  TELEGRAM_TOKEN not set - bot will not send replies');
}
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not set - agent will not work!');
}

// Create the runner to execute the agent
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

// 1. Webhook Endpoint (Telegram talks to this)
app.post('/webhook', async (req, res) => {
  console.log('📥 Received webhook request');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  const message = req.body.message;

  // Basic validation
  if (!message || !message.text) {
    console.log('⚠️  No message or text found, skipping');
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text;

  try {
    // 2. Ask the Agent (No network call needed, it's right here!)
    console.log(`💬 Processing message from chat ${chatId}:`, userText);

    // Create a stable session ID per chat to keep conversation state
    const sessionId = `telegram_${chatId}`;
    const userId = `user_${chatId}`;

    await ensureSession(userId, sessionId);

    // Run the agent and collect events
    const events = runner.runAsync({
      userId,
      sessionId,
      newMessage: {
        role: 'user',
        parts: [{ text: userText }]
      }
    });

    // Collect the agent's response from events
    let replyText = '';
    for await (const event of events) {
      // Extract text from the event
      const text = stringifyContent(event);
      if (text) {
        replyText += text;
      }
    }

    if (!replyText) {
      replyText = "I processed that but have no text to show.";
    }

    console.log(`✅ Generated reply (${replyText.length} chars):`, replyText.substring(0, 100) + '...');

    // 3. Send Reply to Telegram
    if (TELEGRAM_TOKEN) {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: chatId,
          text: replyText
        },
        {
          httpsAgent: telegramAgent
        }
      );
      console.log('📤 Reply sent to Telegram');
    } else {
      console.warn("⚠️  TELEGRAM_TOKEN not set - skipping Telegram reply");
    }

  } catch (error) {
    console.error("❌ Agent Error:", error);
    console.error("Error details:", error instanceof Error ? error.message : String(error));
    
    // Determine error message
    let errorReplyText = "Sorry, I encountered an error processing your request. Please try again.";
    if (error instanceof Error && error.message.includes('Session not found')) {
      console.error("💡 Session error - this might be the first message. The session should be created now.");
      errorReplyText = "I'm initializing our conversation. Please send your message again.";
    }
    
    // Send error message to user
    if (TELEGRAM_TOKEN) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
          {
            chat_id: chatId,
            text: errorReplyText
          },
          {
            httpsAgent: telegramAgent,
            timeout: 10000, // 10 second timeout
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('📤 Error message sent to Telegram');
      } catch (sendError) {
        console.error("Failed to send error message to Telegram:", sendError instanceof Error ? sendError.message : String(sendError));
      }
    }
  }

  // Always return 200 OK to Telegram
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  const status = {
    status: 'running',
    telegramToken: TELEGRAM_TOKEN ? 'configured' : 'missing',
    geminiApiKey: GEMINI_API_KEY ? 'configured' : 'missing',
    webhookUrl: TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=YOUR_SPACE_URL/webhook` : 'N/A'
  };
  res.json(status);
});

app.listen(PORT, () => {
  console.log('\n===== Server Started =====');
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log('========================\n');
  
  if (TELEGRAM_TOKEN && GEMINI_API_KEY) {
    console.log('✅ Ready to receive Telegram messages!');
  } else {
    console.log('⚠️  Missing configuration - bot may not work properly');
  }
});
