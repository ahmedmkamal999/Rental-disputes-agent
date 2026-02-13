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
  
  // 1. Get file path from Telegram
  const fileInfo = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;

  // 2. Download the binary data
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

  // 3. Return as Base64 with MimeType
  // Telegram voice notes are usually OGG/Opus, which Gemini supports
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
  
  // Prepare message parts
  const messageParts: any[] = [];
  
  if (userText) {
    messageParts.push({ text: userText });
  }

  try {
    // --- 1. HANDLE PHOTOS ---
    if (message.photo) {
      console.log("📸 Photo detected");
      const photo = message.photo[message.photo.length - 1]; // Best quality
      const imagePart = await downloadFile(photo.file_id);
      messageParts.push(imagePart);
    } 
    
    // --- 2. HANDLE VOICE NOTES ---
    else if (message.voice) {
      console.log("mic Voice Note detected");
      const voicePart = await downloadFile(message.voice.file_id);
      messageParts.push(voicePart);
      // If no text was sent with the voice, add a prompt so the AI knows what to do
      if (!userText) {
        messageParts.push({ text: "Please listen to this audio and respond." });
      }
    }

    // --- 3. HANDLE AUDIO FILES (MP3/Music) ---
    else if (message.audio) {
      console.log("🎵 Audio File detected");
      const audioPart = await downloadFile(message.audio.file_id);
      messageParts.push(audioPart);
    }

    // --- 4. HANDLE DOCUMENTS (PDFs) ---
    else if (message.document) {
      console.log("📄 Document detected:", message.document.mime_type);
      if (message.document.mime_type === 'application/pdf' || message.document.mime_type.startsWith('image/')) {
        const docPart = await downloadFile(message.document.file_id);
        messageParts.push(docPart);
      } else {
        if (TELEGRAM_TOKEN) {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Unsupported file type. I can currently only read Images, PDFs, and Audio."
          });
        }
        return res.sendStatus(200);
      }
    }

    // If empty message, stop
    if (messageParts.length === 0) return res.sendStatus(200);

    // Run Agent
    const sessionId = `telegram_${chatId}`;
    const userId = `user_${chatId}`;
    await ensureSession(userId, sessionId);

    console.log(`💬 Processing message from ${chatId}`);

    const events = runner.runAsync({
      userId, sessionId,
      newMessage: { 
        role: 'user', 
        parts: messageParts 
      }
    });

    let replyText = '';
    for await (const event of events) {
      const text = stringifyContent(event);
      if (text) replyText += text;
    }

    if (!replyText) replyText = "I processed your input but have no response.";

    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText
      });
    }

  } catch (error) {
    console.error("❌ Error processing message:", error);
    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "Sorry, I encountered an error processing that message."
      });
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot is running with Voice, Image, and PDF support!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});