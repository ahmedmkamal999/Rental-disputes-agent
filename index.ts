import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Initialize Runner
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

// Helper: Download file from Telegram and convert to Base64
async function downloadFile(fileId: string) {
  if (!TELEGRAM_TOKEN) throw new Error("No Token");
  
  const fileInfo = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

  return {
    inlineData: {
      data: Buffer.from(response.data).toString('base64'),
      mimeType: response.headers['content-type']
    }
  };
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text || message.caption || "";
  
  const messageParts: any[] = [];
  
  try {
    // --- 1. HANDLE FILES ---
    let hasFile = false;

    // Photos
    if (message.photo) {
      console.log("📸 Photo detected");
      const photo = message.photo[message.photo.length - 1]; 
      messageParts.push(await downloadFile(photo.file_id));
      hasFile = true;
    } 
    // Voice/Audio
    else if (message.voice || message.audio) {
      console.log("mic Audio detected");
      const fileId = message.voice ? message.voice.file_id : message.audio.file_id;
      messageParts.push(await downloadFile(fileId));
      hasFile = true;
    }
    // Documents (PDFs)
    else if (message.document) {
      console.log("📄 Document detected:", message.document.mime_type);
      if (message.document.mime_type === 'application/pdf' || message.document.mime_type.startsWith('image/')) {
        messageParts.push(await downloadFile(message.document.file_id));
        hasFile = true;
      }
    }

    // --- 2. ADD TEXT (OR FORCE PROMPT) ---
    if (userText) {
      messageParts.push({ text: userText });
    } else if (hasFile) {
      // ⚡ FIX: If user sent a file but NO text, force the AI to look at it.
      console.log("⚡ Injecting hidden prompt for file analysis...");
      messageParts.push({ text: "I have uploaded a file. Please analyze it and summarize the key relevant details for our rental dispute case." });
    }

    // If still empty (no file, no text), ignore
    if (messageParts.length === 0) return res.sendStatus(200);

    // --- 3. RUN AGENT ---
    const sessionId = `telegram_${chatId}`;
    const userId = `user_${chatId}`;
    await ensureSession(userId, sessionId);

    console.log(`💬 Processing message from ${chatId}`);

    const events = runner.runAsync({
      userId, sessionId,
      newMessage: { role: 'user', parts: messageParts }
    });

    let replyText = '';
    
    // Improved Event Loop to catch all text types
    for await (const event of events) {
      const text = stringifyContent(event);
      if (text) {
        replyText += text;
      } else {
        // Log non-text events for debugging (check Cloud Run logs if this happens)
        console.log("Non-text event received:", JSON.stringify(event));
      }
    }

    if (!replyText) {
      console.log("❌ Model returned empty response.");
      replyText = "I received your document, but I'm not sure what you want me to do with it. Could you please ask a specific question about it?";
    }

    // --- 4. SEND REPLY ---
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText
      });
    }

  } catch (error) {
    console.error("❌ Critical Error:", error);
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "I encountered a technical error reading that file. Please try sending it again as a PDF or Image."
      });
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot is running v3 (File Fix)');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});