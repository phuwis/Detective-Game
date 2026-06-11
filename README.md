# 🕵️‍♂️ Whodunit? - Online Mystery Board Game

An immersive, real-time multiplayer social deduction game built for amateur detectives and master criminal minds. Gather your friends, step into the mansion, examine the evidence, and deduce who the killer is before the clock runs out!

[![Node.js Version](https://img.shields.io/badge/node->%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/socket.io-4.7.5-blue.svg)](https://socket.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎮 Game Features

- **Real-Time Syncing:** Powered by Socket.io for instant phase shifts, vote tracking, and live chat logs.
- **Dynamic Scaling Timers:** Game duration automatically adjusts based on your lobby size.
- **The Mansion Checklist:** Keeps track of your session history so you never get the same murder case twice.
- **Interactive Leaderboard:** A sleek Floating Action Button (FAB) available on all screens to track player scores in real-time.
- **Anti-Disconnect Protection:** Accidentally refreshed your browser? No worries, you will instantly rejoin your room with your secret role and scores intact.

---

## ⚖️ Custom Scoring System

The stakes are high, and the scoring favors the cleverest minds:

### 👥 Small Lobbies (3-4 Players)

- **Innocents & Detectives Win:** Everyone on the good side gets +1 point.
- **Killer Wins:** High risk, high reward! The single Killer gets +2 points.

### 🏰 Large Lobbies (5+ Players)

- **Innocents & Detectives Win:** Everyone on the good side gets +1 point.
- **Killer Wins:** The master manipulator gets +1 point.

---

## 🔄 Game Phases

1. **Phase 1: Interrogation (💬)** – The Detective questions suspects. Innocents must stick to their secret alibis, while the Killer lies to survive.
2. **Phase 2: Crime Scene Investigation (🔍)** – Global evidence is revealed to everyone. The timeline tightens.
3. **Phase 3: The Verdict (⚖️)** – Time is up! The Detective must make the final arrest. Will justice prevail, or will the killer walk free?

---

## 🚀 Tech Stack

- **Frontend:** Vanilla HTML5, CSS3 (Modern Dark Theme), JavaScript (ES6)
- **Backend:** Node.js, Express.js
- **Networking:** Socket.io (WebSockets)

---

## 🛠️ Installation & Local Setup

Get the mansion up and running on your local machine in less than 2 minutes:

1. **Clone the repository:**

```bash
git clone [https://github.com/your-username/your-repo-name.git](https://github.com/your-username/your-repo-name.git)

cd your-repo-name
```

2. **Install dependencies:**

```Bash
npm install
```

3. **Configure your Cases:**
   Make sure your cases.json is configured in the root directory.

4. **Fire up the server:**

```
Bash
npm start
```

The mansion doors will open beautifully at http://localhost:3000

## 📁 Project Structure

```Plaintext
├── api/
│   └── index.js       # Express server & Socket.io game logic
├── cases.json         # The murder mystery archive (scenarios, clues, solutions)
├── index.html         # Sleek dark-themed UI & client socket handler
└── package.json       # Dependencies and start scripts

```

## 📝 License

Distributed under the MIT License. See LICENSE for more information.
