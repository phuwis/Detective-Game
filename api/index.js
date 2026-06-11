const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs"); // 🟢 เพิ่ม Library สำหรับอ่านไฟล์ JSON

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "./")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "./index.html"));
});

// โหลดข้อมูลคดีจากไฟล์ JSON เข้ามาเก็บในตัวแปรระบบ
let allCases = [];
try {
  const data = fs.readFileSync(path.join(__dirname, "./cases.json"), "utf8");
  allCases = JSON.parse(data);
  console.log(`Successfully loaded ${allCases.length} cases from JSON file.`);
} catch (err) {
  console.error("Error reading cases.json file:", err);
}

let players = {};
let rooms = {};
let timers = {};

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    players[socket.id] = { name, room, role: "", clue: "", isAlive: true };
    if (!rooms[room]) {
      rooms[room] = {
        started: false,
        phase: 1,
        evidence: "",
        phase2Duration: 300,
        phase3Duration: 180,
        currentCase: null,
      };
    }
    updateRoomPlayers(room);
  });

  socket.on("startGame", (room) => {
    const roomPlayers = Object.keys(players).filter(
      (id) => players[id].room === room,
    );
    if (roomPlayers.length < 3) {
      socket.emit("errorMsg", "ต้องมีผู้เล่นอย่างน้อย 3 คนขึ้นไปครับ");
      return;
    }

    // 🟢 สุ่มเลือกคดีจากไฟล์ JSON 1 คดีสำหรับเกมรอบนี้
    const randomCase = allCases[Math.floor(Math.random() * allCases.length)];
    rooms[room].currentCase = randomCase;

    rooms[room].started = true;
    rooms[room].phase = 1;
    // สุ่มหลักฐานของคดีที่เลือกมา
    rooms[room].evidence =
      randomCase.globalEvidences[
        Math.floor(Math.random() * randomCase.globalEvidences.length)
      ];

    // คำนวณเวลาที่เหมาะสมตามจำนวนผู้เล่น
    const totalPlayers = roomPlayers.length;
    let phase1Time = 420;
    let phase2Time = 300;
    let phase3Time = 180;

    if (totalPlayers <= 4) {
      phase1Time = 240;
      phase2Time = 180;
      phase3Time = 120;
    } else if (totalPlayers >= 7) {
      phase1Time = 720;
      phase2Time = 480;
      phase3Time = 240;
    }

    rooms[room].phase2Duration = phase2Time;
    rooms[room].phase3Duration = phase3Time;

    // สุ่มหาตำแหน่งฆาตกร และ นักสืบ
    const killerIndex = Math.floor(Math.random() * roomPlayers.length);
    let detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    while (detectiveIndex === killerIndex) {
      detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    }

    const killerId = roomPlayers[killerIndex];
    const detectiveId = roomPlayers[detectiveIndex];

    // ผสมบทบาทผู้บริสุทธิ์ของคดีนั้นๆ
    let shuffledInnocents = [...randomCase.innocentScenarios].sort(
      () => 0.5 - Math.random(),
    );
    let innocentCount = 0;

    roomPlayers.forEach((id) => {
      if (id === killerId) {
        const kScenario =
          randomCase.killerScenarios[
            Math.floor(Math.random() * randomCase.killerScenarios.length)
          ];
        players[id].role = kScenario.roleName;
        players[id].clue = kScenario.clue;
      } else if (id === detectiveId) {
        players[id].role = "🔵 นักสืบเอกชน (Detective)";
        players[id].clue = randomCase.detectiveClue;
      } else {
        const iScenario =
          shuffledInnocents[innocentCount % shuffledInnocents.length];
        players[id].role = iScenario.roleName;
        players[id].clue = iScenario.clue;
        innocentCount++;
      }

      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    // ส่งข้อมูลหัวข้อคดีไปอัปเดตฝั่งหน้าเว็บผู้เล่นทุกคน
    io.to(room).emit("caseDetails", {
      title: randomCase.caseTitle,
      subtitle: randomCase.caseSubtitle,
    });

    io.to(room).emit("gameStarted");
    startPhaseTimer(room, 1, phase1Time);
    updateRoomPlayers(room);
  });

  socket.on("nextPhase", (room) => {
    if (rooms[room] && rooms[room].started) {
      if (rooms[room].phase === 1)
        startPhaseTimer(room, 2, rooms[room].phase2Duration);
      else if (rooms[room].phase === 2)
        startPhaseTimer(room, 3, rooms[room].phase3Duration);
    }
  });

  socket.on("votePlayer", ({ room, targetName }) => {
    const player = players[socket.id];
    if (player && player.role.includes("นักสืบ")) {
      clearInterval(timers[room]);
      io.to(room).emit("timerUpdate", {
        minutes: 0,
        seconds: 0,
        expired: true,
      });
      io.to(room).emit(
        "announceVote",
        `⚖️ **[ปิดคดีอย่างเป็นทางการ!]** นักสืบ ${player.name} ได้ทุบโต๊ะชี้ตัวจับกุมผู้ต้องสงสัยหลักคือ: **${targetName}** ! สมาชิกทุกคนเปิดเผยบทบาทจริงในแชทเพื่อตรวจสอบผลลัพธ์ได้เลย!`,
      );
    }
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      const room = players[socket.id].room;
      const name = players[socket.id].name;
      delete players[socket.id];
      updateRoomPlayers(room);
      io.to(room).emit("announceVote", `📢 ${name} ได้ออกจากห้องสอบสวนไปแล้ว`);
    }
  });
});

function startPhaseTimer(room, phase, totalSeconds) {
  if (timers[room]) clearInterval(timers[room]);
  rooms[room].phase = phase;
  let timeLeft = totalSeconds;

  io.to(room).emit("phaseChanged", {
    phase: phase,
    evidence: rooms[room].evidence,
  });

  timers[room] = setInterval(() => {
    timeLeft--;
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;

    if (timeLeft <= 0) {
      clearInterval(timers[room]);
      io.to(room).emit("timerUpdate", {
        minutes: 0,
        seconds: 0,
        expired: true,
      });
      io.to(room).emit(
        "announceVote",
        `⚠️ **[หมดเวลา!]** เวลาของ Phase ${phase} ได้สิ้นสุดลงแล้ว!`,
      );
      if (phase === 1) startPhaseTimer(room, 2, rooms[room].phase2Duration);
      else if (phase === 2)
        startPhaseTimer(room, 3, rooms[room].phase3Duration);
    } else {
      io.to(room).emit("timerUpdate", {
        minutes: mins,
        seconds: secs,
        expired: false,
      });
    }
  }, 1000);
}

function updateRoomPlayers(room) {
  const roomPlayers = Object.values(players)
    .filter((p) => p.room === room)
    .map((p) => p.name);
  io.to(room).emit("roomData", {
    players: roomPlayers,
    started: rooms[room]?.started,
  });
}

module.exports = app;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running beautifully on port ${PORT}`);
});
