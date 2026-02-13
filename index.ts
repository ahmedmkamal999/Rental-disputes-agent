import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';

const router = express.Router();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const sessionTimestamps = new Map<string, number>(); // Track session activity

const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'RentalDisputesBot'
});

async function ensureSession(userId: string, sessionId: string) {
  // Check if session has timed out
  const lastActivity = sessionTimestamps.get(sessionId);
  if (lastActivity && Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
    console.log(`⏱️  Session ${sessionId} timed out. Clearing...`);
    // Delete the old session
    await runner.sessionService.deleteSession({
      appName: 'RentalDisputesBot',
      userId, sessionId
    }).catch(() => {}); // Ignore errors if session doesn't exist
    sessionTimestamps.delete(sessionId);
  }

  // Update last activity timestamp
  sessionTimestamps.set(sessionId, Date.now());

  const session = await runner.sessionService.getSession({
    appName: 'RentalDisputesBot',
    userId, sessionId
  });
  if (!session) {
    await runner.sessionService.createSession({
      appName: 'RentalDisputesBot',
      userId, sessionId, state: {}
    });
    console.log(`✨ New session created: ${sessionId}`);
  }
}

async function downloadFile(fileId: string) {
  if (!TELEGRAM_TOKEN) throw new Error("No Token");
  
  const fileInfo = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  
  // Determine MIME type - use provided header or infer from file extension
  let mimeType = response.headers['content-type'] || 'application/octet-stream';
  if (!mimeType && filePath.endsWith('.pdf')) {
    mimeType = 'application/pdf';
  }
  
  const base64Data = Buffer.from(response.data).toString('base64');
  
  console.log(`📄 File downloaded - MIME Type: ${mimeType}, Size: ${response.data.length} bytes`);

  return {
    inlineData: {
      data: base64Data,
      mimeType: mimeType
    }
  };
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  let userText = message.text || message.caption || "";
  const sessionId = `telegram_${chatId}`;
  const userId = `user_${chatId}`;

  try {
    // --- HANDLE SPECIAL COMMANDS ---
    if (userText === '/reset' || userText === '/start') {
      console.log(`🔄 Reset command received from ${chatId}`);
      
      // Delete session and clear timeout
      await runner.sessionService.deleteSession({
        appName: 'RentalDisputesBot',
        userId, sessionId
      }).catch(() => {});
      
      sessionTimestamps.delete(sessionId);
      
      if (TELEGRAM_TOKEN) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "✅ Session cleared! You can now start fresh.\n\nType a message to begin the rental dispute validation process."
        });
      }
      return res.sendStatus(200);
    }

    // --- 1. HANDLE FILES ---
    const messageParts: any[] = [];
    let hasFile = false;
    if (message.photo) {
      console.log("📸 Photo detected");
      const photo = message.photo[message.photo.length - 1]; 
      messageParts.push(await downloadFile(photo.file_id));
      hasFile = true;
    } 
    else if (message.voice || message.audio) {
      console.log("mic Audio detected");
      const fileId = message.voice ? message.voice.file_id : message.audio.file_id;
      messageParts.push(await downloadFile(fileId));
      hasFile = true;
    }
    else if (message.document) {
      console.log("pcl Document detected:", message.document.mime_type);
      if (message.document.mime_type === 'application/pdf' || message.document.mime_type.startsWith('image/')) {
        messageParts.push(await downloadFile(message.document.file_id));
        hasFile = true;
      }
    }

    // --- 2. INJECT SIMPLE REQUEST ---
    if (hasFile) {
      // If user sent file with NO text, give it a simple label
      if (!userText) userText = "Please analyze this document.";

      // Simple, non-aggressive prompt
      const systemInjection = `

Please extract the following information from this document:
- Landlord name
- Tenant name  
- Property address
- Rental amount
- Contract start and end dates
- Any other relevant information

Provide a clear summary of what this document contains.`;
      
      userText += systemInjection;
      console.log("📄 Injected simple document analysis request");
    }

    if (userText) {
      messageParts.push({ text: userText });
    }

    if (messageParts.length === 0) return res.sendStatus(200);

    // --- 3. RUN AGENT ---
    await ensureSession(userId, sessionId);

    console.log(`💬 Processing message from ${chatId}`);

    let replyText = '';

    try {
      const events = runner.runAsync({
        userId, sessionId,
        newMessage: { role: 'user', parts: messageParts }
      });

      for await (const event of events) {
        const text = stringifyContent(event);
        if (text) replyText += text;
      }
    } catch (error) {
      console.error(`❌ Error processing message:`, error);
    }

    // --- 4. FALLBACK IF BLOCKED ---
    if (!replyText) {
      console.log("❌ Model returned empty response (Likely Safety Block).");
      console.log("📋 DEBUG INFO: File type was detected, but Gemini refused to process.");
      replyText = "I received the file, but my safety filters blocked the response. \n\n**Tip:** Try sending a screenshot of the first page instead of the PDF. Sometimes that bypasses the filter.";
    } else {
      console.log("✅ Response successfully generated and sent to user");
    }

    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText,
        parse_mode: "Markdown" // Better formatting
      });
    }

  } catch (error) {
    console.error("❌ Critical Error:", error);
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "Technical error processing the file. Please try sending a clear image instead."
      });
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot is running v4 (Safety Bypass)');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});