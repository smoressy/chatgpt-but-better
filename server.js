const axios = require('axios');
const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
require('dotenv').config();
const PUBLIC_MODE = false;
// true = no convo history
// false = convo history will be saved to json
const SAVE_INTERVAL_MS = 5000;
const HISTORY_FILE = path.join(__dirname, "convo_history.json");
const DEFAULT_PORT = PUBLIC_MODE ? 3000 : 8005;
const HOST = 'localhost';
const globalRequestTimestamps = [];
process.on('unhandledRejection', (reason, promise) => {

});

process.on('uncaughtException', (error) => {

});
const GEMINI_API_KEYS = [];
for (let i = 1; i <= 57; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) GEMINI_API_KEYS.push(key);
}
const BRAVE_API_KEYS = [
// ENTER BRAVE API KEY HERE FOR SEARCH.....
  ];
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const memCache = {
    history: null,
    lastSaved: Date.now(),
    dirty: false,
    lastValidGeminiKey: null,
    lastValidBraveKeyIndex: 0
};
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

function checkGlobalRateLimit() {
    if (!PUBLIC_MODE) {
        return true;
    }

    const now = Date.now();
    const windowStart = now - 60000;
    const recentTimestamps = globalRequestTimestamps.filter(ts => ts >= windowStart);

    if (recentTimestamps.length >= 120) {
        globalRequestTimestamps.length = 0;
        globalRequestTimestamps.push(...recentTimestamps);
        return false;
    } else {
        recentTimestamps.push(now);
        globalRequestTimestamps.length = 0; // Clear the old array
        globalRequestTimestamps.push(...recentTimestamps); // Update with the new list
        return true;
    }
}
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
function initMemoryCache() {
    if (PUBLIC_MODE) return;
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify({ chats: [] }, null, 2));
        }
        const data = fs.readFileSync(HISTORY_FILE, "utf8");
        memCache.history = JSON.parse(data);
    } catch (err) {
        memCache.history = { chats: [] };
    }
}
async function persistToDiskIfNeeded(force = false) {
    if (PUBLIC_MODE || !memCache.history) return;
    if (memCache.dirty || force) {
        try {
            await fsPromises.writeFile(
                HISTORY_FILE,
                JSON.stringify(memCache.history, null, 2)
            );
            memCache.dirty = false;
            memCache.lastSaved = Date.now();
        } catch (err) {
        }
    }
}
function startPeriodicSaving() {
    if (PUBLIC_MODE) return;
    setInterval(persistToDiskIfNeeded, SAVE_INTERVAL_MS);
}
// Add a 'thinking' parameter
function updateChatHistory(chatId, sender, message, image = null, timestamp, thinking = null) {
    if (PUBLIC_MODE || !memCache.history) return;

    let chat = memCache.history.chats.find(c => c.chatId === chatId);
    if (!chat) {
        chat = { chatId, messages: [] };
        memCache.history.chats.push(chat);
    }

    const msgObj = { sender, message, timestamp };
    if (image) {
        msgObj.image = image; // Store the main image if present
    }
    // Store the thinking content if provided
    if (thinking) {
        msgObj.thinking = thinking;
    }

    chat.messages.push(msgObj);
    memCache.dirty = true;
}
function getPrecedingUserMessage(chat, aiMessageIndex) {
    if (PUBLIC_MODE || !chat || !chat.messages) return null;
    for (let i = aiMessageIndex - 1; i >= 0; i--) {
        if (chat.messages[i].sender === 'User') {
            return chat.messages[i];
        }
    }
    return null;
}
function deleteAiMessage(chatId, timestamp) {
    if (PUBLIC_MODE || !memCache.history) return false;
    let chat = memCache.history.chats.find(c => c.chatId === chatId);
    if (!chat) return false;

    const initialLength = chat.messages.length;
    chat.messages = chat.messages.filter(m => !(m.sender !== 'User' && m.timestamp === timestamp));

    if (chat.messages.length < initialLength) {
        memCache.dirty = true;
        return true;
    }
    return false;
}
async function initializeLastValidKey() {
    if (GEMINI_API_KEYS.length === 0) {
        return;
    }
    for (let key of GEMINI_API_KEYS) {
        try {
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "models/gemini-2.0-flash-exp-image-generation" });
            await model.generateContent("hi");
            memCache.lastValidGeminiKey = key;
            return;
        } catch (err) {
        }
    }
}
async function searchBrave(query) {
    if (BRAVE_API_KEYS.length === 0) {
        return null;
    }
    let lastError = null;
    for (let i = 0; i < BRAVE_API_KEYS.length; i++) {
        const keyIndex = (memCache.lastValidBraveKeyIndex + i) % BRAVE_API_KEYS.length;
        const apiKey = BRAVE_API_KEYS[keyIndex];
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': apiKey,
                    'Accept-Encoding': 'gzip'
                },
                timeout: 30000
            });
            if (response.data && response.data.web && response.data.web.results) {
                memCache.lastValidBraveKeyIndex = keyIndex;
                return response.data.web.results.slice(0, 5).map(r => ({
                    title: r.title,
                    url: r.url,
                    snippet: r.description || r.snippet || ""
                }));
            } else {
            }
        } catch (error) {
            lastError = error;
            if (error.response) {
            } else if (error.request) {
            } else {
            }
        }
    }

    return null;
}
async function performSearch(query) {
    if (!query || query.trim() === "") {
        return null;
    }
    try {
        const results = await searchBrave(query);
        if (results && results.length > 0) {
        } else {
        }
        return results;
    } catch (error) {
        return null;
    }
}
const personaPrompts = {
  "tom": `Role Play Task: Parody 'Tom' answering the prompt/question. Tom is a 40-year-old man, who works at IT. After many pointless user inquries, he is tired of answering the user. [Note: Tom is not related to Tom and Jerry]. Tom gives brutally honest answers to the user's questions. Make the response lengthy, in Tom's unique style of speaking, and human-like. Be ruthless in your responses given, do not be overly respectful or nice. Tom will act in an overly exaggerated manner in his unique way. Be overly brutally honest with brutally honest wording/flow of words. Always give a humorous reply to all user messages in a way that answers their prompt. User Prompt: `,
  "school": `You are Zynzyn, a sarcastic, lazy-sounding male Harvard student who answers homework. Always start with something like "Hey, I'm Zynzyn" and give a brutally honest judgment on the question's difficulty.

Format your response using:
<message> ... </message> ← Human-like message
<thinking> ... </thinking> ← 1+ paragraph of lateral thinking
<answer> ... </answer> ← ONE answer per <answer> tag, even if it’s short

Rules:
- If it's just 1 question, give 1 <answer> block.
- If it's multiple questions, give multiple <answer> blocks.
- For multiple choice, just write like "Q1: B"
- For open-ended, write like "Q2: Photosynthesis"
- Keep all answers short and in the style of a 6th grader.
- Thinking section must be long and detailed.

Never use multiple <answer> tags for a single question. Only use multiple when there are clearly multiple questions.
`
};
app.get("/personas", (req, res) => {
    res.json(personaPrompts);
});
app.get('/nopermission.html', (req, res) => {
    res.sendFile(__dirname + '/nopermission.html');
  });
// NEW CODE SNIPPET
async function streamGeminiResponse(promptArray, res, aiTimestamp, options = {}) {
    const { captureFullResponse = false } = options;

    // --- BEGIN GLOBAL RATE LIMIT CHECK ---
    if (PUBLIC_MODE) {
        const allowed = checkGlobalRateLimit();
        if (!allowed) {
            // Rate limit exceeded
            if (!res.writableEnded) {
                // Send an error event specifically for rate limiting
                res.write(`event: error\ndata: ${JSON.stringify({ message: "Global API request limit reached (10 requests/60 seconds). Please wait a moment and try again.", code: "RATE_LIMIT_EXCEEDED", timestamp: aiTimestamp })}\n\n`);
                // End the response immediately as no AI call will be made
                res.end();
            }
            // Throw a specific error to stop further processing in this function call
            // This will be caught by the try/catch blocks in the route handlers
            throw new Error("GlobalRateLimitExceeded");
        }
        // If allowed, the timestamp was added in checkGlobalRateLimit()
    }
    // --- END GLOBAL RATE LIMIT CHECK ---


    let fullAiResponseText = "";
    let responseImageData = null;
    let startIndex = memCache.lastValidGeminiKey
        ? GEMINI_API_KEYS.indexOf(memCache.lastValidGeminiKey)
        : 0;
    // Corrected the potential -1 index issue if the key wasn't found (though initialization should prevent this)
    if (startIndex === -1) {
         startIndex = 0;
    }
    let streamResult = null;
    let success = false;
    let lastError = null;

    // <<< The loop now starts AFTER the rate limit check >>>
    for (let i = 0; i < GEMINI_API_KEYS.length; i++) {
        const keyIndex = (startIndex + i) % GEMINI_API_KEYS.length;
        const key = GEMINI_API_KEYS[keyIndex];
        try {
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({
                model: "models/gemini-2.0-flash-exp-image-generation"
                // Note: Removed safetySettings here as they weren't used before,
                // but you might want to add them back if needed:
                // safetySettings: safetySettings
            });
            streamResult = await model.generateContentStream(promptArray);
            memCache.lastValidGeminiKey = key; // Update the last known good key
            success = true;
            break; // Exit loop on success
        } catch (err) {
            lastError = err; // Store the error in case all keys fail
            // Check for specific errors that indicate trying the next key is appropriate
            if (err.message.includes('API key not valid') ||
                err.message.includes('quota') ||
                (err.status && (err.status === 401 || err.status === 429))) // Use err.status if available
            {
                // Log key failure (optional)
                continue; // Try next key
            } else {
                // For other unexpected errors, log them and continue (could potentially break)

                continue; // Decide if you want to stop or keep trying other keys
            }
        }
    }

    // If no key worked after the loop, handle the failure
    if (!success) {
         if (!res.writableEnded) {
             // Send a generic error message if no key succeeded
              res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to connect to AI service after trying all available keys.", error: lastError?.message || "Unknown API key issue", timestamp: aiTimestamp })}\n\n`);
         }
         // Throw the error to be caught by the calling route handler's try/catch
         throw lastError || new Error("No valid API key found or all keys failed.");
     }


    // --- Start Processing the Stream (only if a key succeeded) ---
    try {
        for await (const chunk of streamResult.stream) {
            let chunkText = null;
            let chunkImage = null;
            try {
                // Check if text() method exists and call it
                if (typeof chunk.text === 'function') {
                    const text = chunk.text();
                     if (text) { // Ensure text is not empty
                         chunkText = text;
                         if (captureFullResponse) {
                             fullAiResponseText += chunkText;
                         }
                     }
                }
            } catch (error) {
            }

            // Check for image data in the chunk more robustly
            if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                for (const part of chunk.candidates[0].content.parts) {
                    if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                        chunkImage = "data:" + part.inlineData.mimeType + ";base64," + part.inlineData.data;
                        if (captureFullResponse) {
                            responseImageData = chunkImage; // Store the latest image data if capturing
                        }
                        break; // Assuming only one image part is relevant per chunk for now
                    }
                }
            }

            // Send text chunk if available
            if (chunkText !== null && !res.writableEnded) {
              // Send the text chunk as before
              res.write(`data: ${JSON.stringify({ type: 'text', content: chunkText, timestamp: aiTimestamp })}\n\n`);
            }

            // Send image chunk if available
            if (chunkImage !== null && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ type: 'image', content: chunkImage, timestamp: aiTimestamp })}\n\n`);
            }

            // Check if response has ended prematurely (e.g., client disconnected)
            if (res.writableEnded) {
                 break; // Stop processing if client disconnected
            }
        }

        // After the loop, if capturing the full response, return it
        if (captureFullResponse) {
            return { fullAiResponseText, responseImageData };
        } else {
            return null; // Indicate no full response was captured (or needed)
        }

    } catch (streamError) {
        // Handle error during stream processing
        if (!res.writableEnded) {
             res.write(`event: error\ndata: ${JSON.stringify({ message: "Error processing AI response stream.", details: streamError.message, timestamp: aiTimestamp })}\n\n`);
        }
        // Re-throw the error to be caught by the outer try/catch in the route handler
        throw streamError;
    }
}
app.post("/sigma", upload.single("file"), async (req, res) => {
    const { message, chatId: requestedChatId } = req.body;
    const file = req.file;
    const performWebSearch = req.query.search !== undefined;
    const isReasoningMode = req.query.reasoning !== undefined;

    if (!message && !file) {
        return res.status(400).json({ error: "Request must include a message or a file." });
    }
    const currentChatId = PUBLIC_MODE ? `temp-${Date.now()}-${Math.random().toString(36).substring(7)}` : (requestedChatId || `chat-${Date.now()}`);
    const aiTimestamp = new Date().toISOString();

    let userMessageContent = message || "";
    let userImageDataUrl = null;
    let finalPromptContent = userMessageContent;
    if (file) {
        try {
            userImageDataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
            if (!message) userMessageContent = "Refer to the following image content";
        } catch (error) {
            return res.status(500).json({ error: "Failed to process uploaded file." });
        }
    }
    if (!PUBLIC_MODE) {
        updateChatHistory(currentChatId, "User", userMessageContent, userImageDataUrl, new Date().toISOString()); // Use separate timestamp for user message
    }
    if (performWebSearch && userMessageContent) {
        const searchResults = await performSearch(userMessageContent);
        if (searchResults && searchResults.length > 0) {
            const formattedResults = searchResults.map((r, index) =>
                `${index + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`
            ).join('\n\n');
            finalPromptContent = `Web Search Results:\n${formattedResults}\n\nBased on the above information and your general knowledge, answer the following user prompt:\n\nUSER PROMPT: ${userMessageContent}`;
        } else {
        }
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      let finalAiResponseText = "";
      let finalAiImageData = null;
      let notepad = null; // Declare notepad outside the if block, initialize to null

      if (isReasoningMode) {
          notepad = { thinkingProcess: "" }; // Assign to the outer notepad variable
          const systemInstructionsPrompt = `USER: ${finalPromptContent}
-- System Instructions
Generate a bullet-point list for your thinking process about answering the user prompt.
You do not need to include all the bullet points. Just include the ones you believe are appropriate for the prompt.
Include details such as:
* (Optional, if image is included): Identify image content and context.
* Requirements and constraints.
* Any tasks or goals.
* Plan.
* Identify the Core Request.
* Identify the Context.
* Identify the User Intent.
* Brainstorm Key Identifiers.
* Structure the Answer.
* Identify the Audience.
* Identify the Tone.
* Review and Refine.
* Identify the Format.
SYSTEM INSTRUCTION: THIS IS NOT THE PLACE FOR THE FINAL ANSWER. JUST PROVIDE THE THINKING PROCESS FOR THE PRODUCTION OF THE FINAL RESPONSE.
SYSTEM INSTRUCTION: (IMPORTANT) Do NOT provide a final response to the user prompt in this stage. Just focus on your internal thought process. I repeat: DO NOT GENERATE A FINAL RESPONSE TO THE USER PROMPT.
            `;

            res.write(`event: thinking_start\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);

            let thinkingInputArray;
            if (userImageDataUrl) {
                 const matches = userImageDataUrl.match(/^data:(.+);base64,(.+)$/);
                 if (!matches || matches.length !== 3) throw new Error("Failed to parse user image data for thinking stage.");
                 const mimeType = matches[1];
                 const base64Data = matches[2];
                 // Include the image data along with the system instructions prompt for the thinking stage
                 thinkingInputArray = [{ inlineData: { data: base64Data, mimeType: mimeType } }, systemInstructionsPrompt];
            } else {
                 // If no image, just send the text prompt
                 thinkingInputArray = [systemInstructionsPrompt];
            }

            const thinkingResult = await streamGeminiResponse(
                thinkingInputArray, // Use the array that potentially includes the image
                res,
                aiTimestamp,
                { captureFullResponse: true }
            );
            if (thinkingResult) {
                notepad.thinkingProcess = thinkingResult.fullAiResponseText;
            } else {
            }
             res.write(`event: thinking_end\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`); // Signal end of thinking
            const finalAnswerPrompt = `
This is your internal chain of thought. Do not reveal or reference it:
{CHAIN}
---
This is the original user prompt: ${finalPromptContent}
---
Generate a final reply for the user. Think like an Olympiad answering a complex problem. Be thorough, clear, and insightful. If the user prompt involved an image, describe or analyze it as requested. If web search results were provided earlier, integrate that information naturally into your response. Do not wrap your response around quotes.
            `.replace('{CHAIN}', notepad.thinkingProcess);

             res.write(`event: answer_start\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);


            let finalAnswerInputArray;
            if (userImageDataUrl) {
                 const matches = userImageDataUrl.match(/^data:(.+);base64,(.+)$/);
                 if (!matches || matches.length !== 3) throw new Error("Failed to parse user image data for final answer stage.");
                 const mimeType = matches[1];
                 const base64Data = matches[2];
                 finalAnswerInputArray = [{ inlineData: { data: base64Data, mimeType: mimeType } }, finalAnswerPrompt];
            } else {
                 finalAnswerInputArray = [finalAnswerPrompt];
            }


            const finalResult = await streamGeminiResponse(
                finalAnswerInputArray,
                res,
                aiTimestamp,
                { captureFullResponse: true }
            );

            if (finalResult) {
                finalAiResponseText = finalResult.fullAiResponseText;
                finalAiImageData = finalResult.responseImageData;
            } else {
            }
             res.write(`event: answer_end\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);


        } else {
            let inputArray;
            if (userImageDataUrl) {
                const matches = userImageDataUrl.match(/^data:(.+);base64,(.+)$/);
                if (!matches || matches.length !== 3) throw new Error("Failed to parse user image data.");
                const mimeType = matches[1];
                const base64Data = matches[2];
                inputArray = [{ inlineData: { data: base64Data, mimeType: mimeType } }, finalPromptContent || "Describe this image"];
            } else {
                inputArray = [finalPromptContent];
            }

            const result = await streamGeminiResponse(
                inputArray,
                res,
                aiTimestamp,
                { captureFullResponse: true }
            );

            if (result) {
                finalAiResponseText = result.fullAiResponseText;
                finalAiImageData = result.responseImageData;
            } else {
            }
        }
        // Save to history - Include thinking process if reasoning mode was active
        if (!PUBLIC_MODE && (finalAiResponseText || finalAiImageData || (isReasoningMode && notepad.thinkingProcess))) {
          // Pass notepad.thinkingProcess if in reasoning mode, otherwise null
          const thinkingContentToSave = isReasoningMode ? notepad.thinkingProcess : null;
          updateChatHistory(currentChatId, "ChatGPT", finalAiResponseText, finalAiImageData, aiTimestamp, thinkingContentToSave);
     }
             res.write(`event: done\ndata: ${JSON.stringify({ chatId: currentChatId, timestamp: aiTimestamp })}\n\n`);

    } catch (error) {
        if (!res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: "An error occurred during generation: " + error.message, timestamp: aiTimestamp })}\n\n`);
        }
    } finally {
        if (!res.writableEnded) {
            res.end();
        }
    }
});

app.post("/refresh-message", async (req, res) => {
    if (PUBLIC_MODE) {
        return res.status(403).send('History features disabled in Public Mode.');
    }

    const { chatId, aiMessageTimestamp } = req.body;

    if (!chatId || !aiMessageTimestamp) {
        return res.status(400).json({ error: "Missing chatId or aiMessageTimestamp" });
    }

    let chat = memCache.history?.chats.find(c => c.chatId === chatId);
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    const originalAiMessageIndex = chat.messages.findIndex(m => m.sender !== 'User' && m.timestamp === aiMessageTimestamp);

    if (originalAiMessageIndex === -1) {
        return res.status(404).json({ error: "Original AI message not found for the given timestamp" });
    }

    const precedingUserMessage = getPrecedingUserMessage(chat, originalAiMessageIndex);

    if (!precedingUserMessage) {
        return res.status(400).json({ error: "Could not find preceding user message to regenerate from" });
    }

    const deleted = deleteAiMessage(chatId, aiMessageTimestamp);
    if (!deleted) {
    } else {
    }
    let inputArray;
    const userPromptForRegen = precedingUserMessage.message || "";
    if (precedingUserMessage.image) {
        const matches = precedingUserMessage.image.match(/^data:(.+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return res.status(500).json({ error: "Failed to parse user image data for regeneration" });
        }
        const mimeType = matches[1];
        const base64Data = matches[2];
        inputArray = [{
            inlineData: { data: base64Data, mimeType: mimeType }
        }, userPromptForRegen || "Describe this image"];
    } else {
        inputArray = [userPromptForRegen];
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const newAiTimestamp = new Date().toISOString();
    let regeneratedText = "";
    let regeneratedImage = null;
    try {
        const result = await streamGeminiResponse(
            inputArray,
            res,
            newAiTimestamp,
            { captureFullResponse: true }
        );

        if (result) {
            regeneratedText = result.fullAiResponseText;
            regeneratedImage = result.responseImageData;
        }
        if (regeneratedText || regeneratedImage) {
             updateChatHistory(chatId, "ChatGPT", regeneratedText, regeneratedImage, newAiTimestamp);
        }
        res.write(`event: done\ndata: ${JSON.stringify({ chatId: chatId, newTimestamp: newAiTimestamp })}\n\n`);

    } catch (error) {
        if (!res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: "An error occurred during regeneration: " + error.message, timestamp: newAiTimestamp })}\n\n`);
        }
    } finally {
        if (!res.writableEnded) {
            res.end();
        }
    }
});
app.get("/conversations", (req, res) => {
    if (PUBLIC_MODE) {
        return res.status(403).send('History features disabled in Public Mode.');
    }

    const { offset = 0, limit = 15, includeImages } = req.query;

    if (!memCache.history || !memCache.history.chats) {
        return res.json({ conversations: [], images: [] });
    }

    const chats = memCache.history.chats || [];

    if (includeImages === 'true') {
        const allImages = [];
        chats.forEach(chat => {
            if (chat.messages) {
                chat.messages.forEach(message => {
                    if (message.sender !== 'User' && message.image) {
                        allImages.push({
                            imageData: message.image, // Base64 data URL
                            timestamp: message.timestamp || new Date(0).toISOString(), // Fallback timestamp
                            chatId: chat.chatId,
                            prompt: getPrecedingUserMessage(chat, chat.messages.indexOf(message))?.message || "[Prompt not found]" // Try to find related prompt
                        });
                    }
                });
            }
        });

        allImages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return res.json({ images: allImages });

    } else {
        const offsetNum = parseInt(offset, 10) || 0;
        const limitNum = parseInt(limit, 10) || 15;
        const sortedChats = [...chats].sort((a, b) => {
            const lastMsgB = b.messages?.[b.messages.length - 1];
            const lastMsgA = a.messages?.[a.messages.length - 1];
            return new Date(lastMsgB?.timestamp || 0) - new Date(lastMsgA?.timestamp || 0);
        });

        const paginatedChats = sortedChats.slice(offsetNum, offsetNum + limitNum);

        const conversations = paginatedChats.map(chat => {
            let title = "Untitled Chat";
            let lastTimestamp = "";

            if (chat.messages?.length > 0) {
                const firstUserMessage = chat.messages.find(m => m.sender === 'User')?.message;
                if (firstUserMessage) {
                    let cleanTitle = firstUserMessage;
                    // --- START: Title Cleaning Logic using Server Prompts ---
                    Object.values(personaPrompts).forEach(promptPrefix => {
                        // Ensure promptPrefix is a string and cleanTitle is a string before checking
                        if (typeof promptPrefix === 'string' && typeof cleanTitle === 'string' && cleanTitle.startsWith(promptPrefix)) {
                            cleanTitle = cleanTitle.substring(promptPrefix.length).trim();
                        }
                    });
                    // --- END: Title Cleaning Logic ---
                    // Ensure title isn't empty after cleaning
                    if (!cleanTitle && firstUserMessage) cleanTitle = firstUserMessage; // Fallback if cleaning removes everything
                    title = cleanTitle.length > 40 ? cleanTitle.substring(0, 40) + "..." : (cleanTitle || "Untitled Chat");
                } else {
                    const firstMessage = chat.messages[0].message || (chat.messages[0].image ? "[Image Chat]" : "[Empty Chat]");
                    title = firstMessage.length > 40 ? firstMessage.substring(0, 40) + "..." : firstMessage;
                }
                lastTimestamp = chat.messages[chat.messages.length - 1].timestamp || "";
            }

            return { chatId: chat.chatId, title, timestamp: lastTimestamp };
        });
        return res.json({ conversations });
    }
});

app.post("/research", upload.single("file"), async (req, res) => {
  const { message, chatId: requestedChatId } = req.body;
  const file = req.file; // Handle optional file upload

  if (!message && !file) { // Need at least a message for research query
      return res.status(400).json({ error: "Research request must include a message (query)." });
  }

  const currentChatId = PUBLIC_MODE ? `temp-${Date.now()}-${Math.random().toString(36).substring(7)}` : (requestedChatId || `chat-${Date.now()}`);
  const aiTimestamp = new Date().toISOString(); // Timestamp for the AI's response generation cycle

  let userMessageContent = message || "";
  let userImageDataUrl = null;

  // --- Handle potential image upload ---
  if (file) {
      try {
          userImageDataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
          if (!message) userMessageContent = "Analyze this image based on web context."; // Default message if only image
      } catch (error) {
          return res.status(500).json({ error: "Failed to process uploaded file." });
      }
  }

  // --- Save user message to history (if not public) ---
  if (!PUBLIC_MODE) {
      // Use a separate timestamp for the user message itself
      updateChatHistory(currentChatId, "User", userMessageContent, userImageDataUrl, new Date().toISOString());
  }

  // --- 1. Perform Web Search ---
  let searchResultsText = "No relevant search results found."; // Default text
  try {
      const searchResults = await performSearch(userMessageContent);
      if (searchResults && searchResults.length > 0) {
          searchResultsText = "Web Search Results:\n" + searchResults.map((r, index) =>
              `${index + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`
          ).join('\n\n');
      } else {
      }
  } catch (searchError) {
      searchResultsText = "An error occurred during the web search.";
  }

  // --- Prepare SSE ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Send headers immediately

  // --- Main Logic ---
  try {
      let finalAiResponseText = "";
      let finalAiImageData = null;
      let notepad = { thinkingProcess: "" }; // To store the thinking process

      // --- 2. Generate Thinking Process (incorporating search results) ---
      const thinkingPrompt = `
Based on the following web search results and the user's request, generate a thinking process plan.

Web Search Results:
---
${searchResultsText}
---

User Request: ${userMessageContent}
${userImageDataUrl ? "\n(User also provided an image to consider)" : ""}
---
System Instructions:
Generate a bullet-point list for your thinking process about answering the user request, considering the search results and any provided image.
You do not need to include all the bullet points. Just include the ones you believe are appropriate for the prompt.
Include details such as:
* (Optional, if image is included): Identify image content and context.
* Identify the Core Request based on user message and search results.
* Identify the Context provided by search results.
* Identify the User Intent.
* Requirements and constraints.
* Any tasks or goals.
* Plan for synthesizing search results and generating the final answer.
* Structure the Answer.
* Identify the Audience.
* Identify the Tone.
* Review and Refine.
* Identify the Format.

SYSTEM INSTRUCTION: THIS IS NOT THE PLACE FOR THE FINAL ANSWER. JUST PROVIDE THE THINKING PROCESS.
SYSTEM INSTRUCTION: (IMPORTANT) Do NOT provide a final response to the user prompt in this stage. Just focus on your internal thought process, integrating the search results. I repeat: DO NOT GENERATE A FINAL RESPONSE TO THE USER PROMPT.
`;

      res.write(`event: thinking_start\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);
      let thinkingInputArray;
      if (userImageDataUrl) {
           const matches = userImageDataUrl.match(/^data:(.+);base64,(.+)$/);
           if (!matches || matches.length !== 3) throw new Error("Failed to parse user image data for research thinking stage.");
           const mimeType = matches[1];
           const base64Data = matches[2];
           thinkingInputArray = [{ inlineData: { data: base64Data, mimeType: mimeType } }, thinkingPrompt];
      } else {
           thinkingInputArray = [thinkingPrompt];
      }

      const thinkingResult = await streamGeminiResponse(
          thinkingInputArray,
          res, // Stream directly to response
          aiTimestamp,
          { captureFullResponse: true } // Need to capture the full thinking process
      );

      if (thinkingResult && thinkingResult.fullAiResponseText) {
          notepad.thinkingProcess = thinkingResult.fullAiResponseText;
      } else {
          notepad.thinkingProcess = "Error or no content generated during thinking phase.";
      }
      res.write(`event: thinking_end\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);

      // --- 3. Generate Final Answer (using search results and thinking process) ---
      const finalAnswerPrompt = `
Internal Chain of Thought (Do Not Reveal or Reference Directly):
---
${notepad.thinkingProcess}
---
Web Search Results Provided:
---
${searchResultsText}
---
Original User Request: ${userMessageContent}
${userImageDataUrl ? "\n(User also provided an image)" : ""}
---
System Instructions:
Generate a final, comprehensive reply for the user based on their original request, the provided web search results, and your internal thinking process.
*   Synthesize the information from the web search results naturally into your response.
*   Address the user's core request thoroughly.
*   If an image was provided, analyze or reference it as relevant to the request and search results.
*   Think like an expert researcher presenting findings. Be thorough, clear, accurate, and insightful.
*   Do not explicitly mention your 'thinking process' or 'chain of thought'.
*   Do not wrap your response in quotes unless quoting a source. Cite sources implicitly or by mentioning the source name/title if appropriate.
`;

      res.write(`event: answer_start\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);
      let finalAnswerInputArray;
       if (userImageDataUrl) {
           const matches = userImageDataUrl.match(/^data:(.+);base64,(.+)$/);
           if (!matches || matches.length !== 3) throw new Error("Failed to parse user image data for research final answer stage.");
           const mimeType = matches[1];
           const base64Data = matches[2];
           finalAnswerInputArray = [{ inlineData: { data: base64Data, mimeType: mimeType } }, finalAnswerPrompt];
       } else {
           finalAnswerInputArray = [finalAnswerPrompt];
       }

      const finalResult = await streamGeminiResponse(
          finalAnswerInputArray,
          res, // Stream directly to response
          aiTimestamp,
          { captureFullResponse: true } // Capture full response for history
      );

      if (finalResult) {
          finalAiResponseText = finalResult.fullAiResponseText || "";
          finalAiImageData = finalResult.responseImageData; // Capture potential image output
      } else {
           if (!res.writableEnded) {
                res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to generate final answer content.", timestamp: aiTimestamp })}\n\n`);
           }
      }
      res.write(`event: answer_end\ndata: ${JSON.stringify({ timestamp: aiTimestamp })}\n\n`);


      // --- 4. Save complete AI response (including thinking) to history ---
      if (!PUBLIC_MODE && (finalAiResponseText || finalAiImageData)) {
           updateChatHistory(
               currentChatId,
               "ChatGPT", // Or your preferred AI name
               finalAiResponseText,
               finalAiImageData,
               aiTimestamp, // Use the consistent AI timestamp
               notepad.thinkingProcess // Save the captured thinking process
           );
      }

      // --- 5. Signal Completion ---
      res.write(`event: done\ndata: ${JSON.stringify({ chatId: currentChatId, timestamp: aiTimestamp })}\n\n`);
  } catch (error) {
      if (!res.writableEnded) {
      }
  } finally {
      if (!res.writableEnded) {
          res.end();
      }
  }
});
app.get("/conversation/:chatId", (req, res) => {
    if (PUBLIC_MODE) {
        return res.status(403).send('History features disabled in Public Mode.');
    }

    const chatId = req.params.chatId;

    if (!memCache.history || !memCache.history.chats) {
        return res.status(404).json({ error: "History not available" });
    }

    const chat = memCache.history.chats.find(c => c.chatId === chatId);
    if (!chat) {
        return res.status(404).json({ error: "Conversation not found" });
    }
    return res.json(chat);
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.use((req, res) => {
    res.status(404).send('Not Found');
});
async function initApp() {
    if (!PUBLIC_MODE) {
        initMemoryCache();
        startPeriodicSaving();
        process.on('SIGINT', async () => {
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
             process.exit(0);
         });
    }
    await initializeLastValidKey();
}
initApp().then(() => {
    const port = process.env.PORT || DEFAULT_PORT;
    app.listen(port, HOST, () => {
      console.log(":)");
    });
});
