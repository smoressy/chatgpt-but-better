# 🚀 ChatGPT... but Better

Welcome to **ChatGPT... but Better** — a full-stack AI chat experience built with Node.js and a sleek, modern frontend. Designed to mimic the ChatGPT interface while offering expanded features, model support, and full user control. Essentially, this is the best local ChatGPT UI that there ever is. It has all the features such as a collapsible sidebar, and more.

> ⚠️ **Status: Beta.** Expect UI bugs, unfinished features, and the occasional chaos. Ongoing updates will be posted here when possible.

---

## 📦 Features

* ✅ ChatGPT-style conversational UI
* ✅ Node.js backend with simple API routing
* ✅ Customizable settings & themes
* ✅ API key integration (Brave, Gemini, GPT-4 via gpt4free

---

## 🛠️ Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/smoressy/chatgpt-but-better.git
cd chatgpt-but-better
```

### 2. Install Dependencies

```bash
npm install
```

Simple. Fast. Don’t overthink it.

### 3. Configure GPT-4 (Optional, But Highly Recommended)

To unlock GPT-4 access **without** paying OpenAI:

* Install [gpt4free](https://github.com/xtekky/gpt4free) locally.
* Follow their setup guide. This acts as a free GPT-4 proxy.
* Make sure it’s running before launching this project.
> Note: It is slow.
### 4. API Key Setup (Mandatory)

#### Brave Search API

* Create a free API key here: [https://search.brave.com/settings](https://search.brave.com/settings)
* Replace the placeholder key in the codebase.

#### Gemini (Google AI) API Key

* Create a `.env` file in the root directory.
* Add your key like this:

```env
GEMINI_API_KEY=your_super_secret_key
```

⚠️ Keep your keys private. If you leak them, that’s on you.

---

### 5. Launch the Server

```bash
node s.js
```

Or, if your entry file is different:

```bash
node your_file.js
```

You should see `Server is running` — if not, retrace your steps and try again.

---

## 🧹 Notes & Warnings

* This is an **experimental build**. Not everything works. Expect hiccups.
* If you encounter bugs, feel free to complain — or better, submit a pull request.
* Project updates will roll out over time.

**Like it?** Star the repo. Hate it? Fork it and make something better.

---

## 📬 Contact

📧 **Email:** [smorenitez2@proton.me](mailto:smorenitez2@proton.me)
💻 Project page: [ai.smoresxo.shop](https://smoresxo.shop)
