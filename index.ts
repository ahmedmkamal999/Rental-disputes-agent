import express from 'express';
import bodyParser from 'body-parser';
import { rootAgent } from './agent.js'; 
import { InMemoryRunner, stringifyContent } from '@google/adk';
import axios from 'axios';
import pdfParse from 'pdf-parse';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MAX_DOCUMENT_TEXT_SNIPPET = 3500;
const TYPING_REFRESH_MS = 4000;

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

async function extractTextFromPdf(buffer: Buffer) {
  const result = await pdfParse(buffer);
  return result.text || '';
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

  const sendTypingAction = async () => {
    if (!TELEGRAM_TOKEN) return;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing'
    }).catch(() => {});
  };

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
      extractedText = '';
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
          extractedText = '';
        }
        hasFile = true;
      }
    }

    // --- INJECT PROMPT ---
    if (hasFile) {
      if (!userText) userText = "Analyze this document.";
      const trimmedText = extractedText.trim();
      const textSnippet = trimmedText ? trimmedText.slice(0, MAX_DOCUMENT_TEXT_SNIPPET) : '';

      userText += `\n\n[DOCUMENT TEXT EXTRACTED LOCALLY]\n`;
      userText += `Mime: ${detectedMime || 'unknown'}\n`;
      userText += `Text:\n${textSnippet}`;
      userText += `\n\nPlease extract: landlord name, tenant name, property address, rent amount, and contract dates.`;
    }

    if (userText) messageParts.push({ text: userText });
    if (messageParts.length === 0) return res.sendStatus(200);

    // --- EXECUTE WITH STREAMING ---
    await ensureSession(userId, sessionId);
    console.log(`🚀 Processing message for ${chatId}...`);

    // Keep typing indicator alive while model is processing
    await sendTypingAction();
    const typingInterval = setInterval(() => {
      void sendTypingAction();
    }, TYPING_REFRESH_MS);

    let replyText = '';
    let lastSentLength = 0;
    let messageId: number | null = null;
    let lastEditAt = 0;

    // Send placeholder immediately so user sees instant response
    if (TELEGRAM_TOKEN) {
      const placeholder = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: '⏳ Processing your request...'
      }).catch(() => null);
      messageId = placeholder?.data?.result?.message_id ?? null;
    }

    const events = runner.runAsync({
      userId, sessionId,
      newMessage: { role: 'user', parts: messageParts }
    });
    try {
      for await (const event of events) {
        const text = stringifyContent(event);
        if (text) replyText += text;

        const now = Date.now();
        const shouldEdit = replyText.length - lastSentLength > 80 || (now - lastEditAt > 1800 && replyText.length > 0);
        if (shouldEdit && TELEGRAM_TOKEN && messageId) {
          try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
              chat_id: chatId,
              message_id: messageId,
              text: replyText
            }).catch(() => {});
            lastSentLength = replyText.length;
            lastEditAt = now;
          } catch (e) {
            console.log("Stream update failed (non-critical):", (e as any).message);
          }
        }
      }

      // --- FINAL RESPONSE ---
      if (!replyText) {
        console.log("❌ Gemini Blocked Response.");
        replyText = "⚠️ Security Filter Triggered\n\nThe AI refused to read this file. This usually happens with Rental Contracts containing private data.\n\nSolution: Please send a Screenshot (Image) of the first page instead of the PDF file.";
      }

      if (TELEGRAM_TOKEN && messageId) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: replyText
        }).catch(() => {});
      } else if (TELEGRAM_TOKEN && !messageId) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: replyText
        });
      }
    } finally {
      clearInterval(typingInterval);
    }

  } catch (error) {
    console.error("❌ Crash:", error);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});