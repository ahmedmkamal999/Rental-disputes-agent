import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// 1. Session Management
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const sessionTimestamps = new Map<string, number>();

const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'RentalDisputesBot'
});

async function ensureSession(userId: string, sessionId: string) {
  // Clear old sessions
  const lastActivity = sessionTimestamps.get(sessionId);
  if (lastActivity && Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
    console.log(`⏱️ Session ${sessionId} timed out. Clearing context...`);
    await runner.sessionService.deleteSession({ appName: 'RentalDisputesBot', userId, sessionId }).catch(() => {});
    sessionTimestamps.delete(sessionId);
  }
  sessionTimestamps.set(sessionId, Date.now());

  const session = await runner.sessionService.getSession({ appName: 'RentalDisputesBot', userId, sessionId });
  if (!session) {
    await runner.sessionService.createSession({ appName: 'RentalDisputesBot', userId, sessionId, state: {} });
  }
}

// 2. The Fixed Download Function
async function downloadFile(fileId: string) {
  if (!TELEGRAM_TOKEN) throw new Error("No Token");
  
  // Get path
  const fileInfo = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  
  // Download binary
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  
  // ⚡ CRITICAL FIX: FORCE MIME TYPES ⚡
  // Telegram often sends "application/octet-stream" which Gemini REJECTS.
  // We manually force the correct type based on the extension.
  let mimeType = response.headers['content-type'];
  const lowerPath = filePath.toLowerCase();

  if (lowerPath.endsWith('.pdf')) {
    mimeType = 'application/pdf'; // Force PDF
    console.log("📄 Forced MIME type to application/pdf");
  } else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (lowerPath.endsWith('.png')) {
    mimeType = 'image/png';
  }

  console.log(`⬇️ Downloaded: ${filePath} | Size: ${response.data.length} | Type: ${mimeType}`);

  return {
    inlineData: {
      data: Buffer.from(response.data).toString('base64'),
      mimeType: mimeType
    }
  };
}

async function extractTextFromPdf(buffer: Buffer) {
  const result = await pdfParse(buffer);
  return result.text || '';
}

async function extractTextFromImage(buffer: Buffer) {
  const result = await Tesseract.recognize(buffer, 'eng+ara', { logger: () => {} });
  return result.data.text || '';
}

async function downloadFileBuffer(fileId: string) {
  if (!TELEGRAM_TOKEN) throw new Error("No Token");

  const fileInfo = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

  const lowerPath = filePath.toLowerCase();
  let mimeType = response.headers['content-type'];
  if (lowerPath.endsWith('.pdf')) mimeType = 'application/pdf';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  if (lowerPath.endsWith('.png')) mimeType = 'image/png';

  return { buffer: Buffer.from(response.data), mimeType, filePath };
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  let userText = message.text || message.caption || "";
  const sessionId = `telegram_${chatId}`;
  const userId = `user_${chatId}`;

  try {
    // --- COMMANDS ---
    if (userText === '/reset' || userText === '/start') {
       await runner.sessionService.deleteSession({ appName: 'RentalDisputesBot', userId, sessionId }).catch(() => {});
       sessionTimestamps.delete(sessionId);
       if (TELEGRAM_TOKEN) {
         await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
           chat_id: chatId, text: "✅ System Ready. Please upload your Rental Contract (PDF or Image)."
         });
       }
       return res.sendStatus(200);
    }

    // --- GATHER PARTS ---
    const messageParts: any[] = [];
    let hasFile = false;
    let extractedText = '';
    let detectedMime: string | undefined;

    if (message.photo) {
      const photo = message.photo[message.photo.length - 1]; 
      const { buffer, mimeType } = await downloadFileBuffer(photo.file_id);
      detectedMime = mimeType;
      extractedText = await extractTextFromImage(buffer);
      hasFile = true;
    } 
    else if (message.document) {
      // Accept PDFs and Images
      const mime = message.document.mime_type || "";
      if (mime.includes('pdf') || mime.includes('image') || message.document.file_name?.toLowerCase().endsWith('.pdf')) {
        const { buffer, mimeType } = await downloadFileBuffer(message.document.file_id);
        detectedMime = mimeType;
        if (mimeType === 'application/pdf') {
          extractedText = await extractTextFromPdf(buffer);
        } else {
          extractedText = await extractTextFromImage(buffer);
        }
        hasFile = true;
      }
    }

    // --- INJECT PROMPT ---
    if (hasFile) {
      if (!userText) userText = "Analyze this document.";
      const trimmedText = extractedText.trim();
      const textSnippet = trimmedText ? trimmedText.slice(0, 8000) : '';

      userText += `\n\n[DOCUMENT TEXT EXTRACTED LOCALLY]\n`;
      userText += `Mime: ${detectedMime || 'unknown'}\n`;
      userText += `Text:\n${textSnippet}`;
      userText += `\n\nPlease extract: landlord name, tenant name, property address, rent amount, and contract dates.`;
    }

    if (userText) messageParts.push({ text: userText });
    if (messageParts.length === 0) return res.sendStatus(200);

    // --- EXECUTE ---
    await ensureSession(userId, sessionId);
    console.log(`🚀 Processing message for ${chatId}...`);

    const events = runner.runAsync({
      userId, sessionId,
      newMessage: { role: 'user', parts: messageParts }
    });

    let replyText = '';
    for await (const event of events) {
      const text = stringifyContent(event);
      if (text) replyText += text;
    }

    // --- FINAL CHECK ---
    if (!replyText) {
      console.log("❌ Gemini Blocked Response.");
      replyText = "⚠️ **Security Filter Triggered**\n\nThe AI refused to read this file. This usually happens with Rental Contracts containing private data.\n\n**Solution:** Please send a **Screenshot (Image)** of the first page instead of the PDF file.";
    }

    if (TELEGRAM_TOKEN) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: replyText,
        parse_mode: "Markdown"
      });
    }

  } catch (error) {
    console.error("❌ Crash:", error);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});