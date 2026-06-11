const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// 🟢 แก้ไขจุดนี้: บอกให้ Express วิ่งออกไปดึงไฟล์หน้าเว็บข้างนอกโฟลเดอร์ api (ดึงขึ้นไป 1 ระดับ)
app.use(express.static(path.join(__dirname, "../")));

// 🟢 แก้ไขจุดนี้: ส่งไฟล์ index.html ที่อยู่ชั้นนอกสุด (Root) ออกไปให้ผู้เล่นได้อย่างถูกต้อง ไม่หลงทาง
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../index.html"));
});

// โหลดข้อมูลคดีจากไฟล์ cases.json (ที่อยู่ชั้นนอกสุดของโปรเจกต์เช่นกัน)
let allCases = [];
try {
  const casePath = path.join(__dirname, "../cases.json");
  const data = fs.readFileSync(casePath, "utf8");
  allCases = JSON.parse(data);
  console.log(`Successfully loaded ${allCases.length} cases from JSON file.`);
} catch (err) {
  console.error("Error reading cases.json file:", err);
}

// ตัวแปรเก็บข้อมูลระบบเกม
let players = {};
let rooms = {};
let timers = {};

io.on("connection", (socket) => {
  // 1. ผู้เล่นเข้าร่วมห้องเกม
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

  // 2. เมื่อหัวหน้าห้องกดเริ่มเกม
  socket.on("startGame", (room) => {
    const roomPlayers = Object.keys(players).filter(
      (id) => players[id].room === room,
    );
    if (roomPlayers.length < 3) {
      socket.emit("errorMsg", "ต้องมีผู้เล่นอย่างน้อย 3 คนขึ้นไปครับ");
      return;
    }

    if (allCases.length === 0) {
      socket.emit(
        "errorMsg",
        "ระบบหาไฟล์เนื้อเรื่องไม่พบ หรือคดียังไม่ได้ถูกสร้างในคลังข้อมูลครับ",
      );
      return;
    }

    // สุ่มคดีจากไฟล์ JSON 1 คดี
    const randomCase = allCases[Math.floor(Math.random() * allCases.length)];
    rooms[room].currentCase = randomCase;

    rooms[room].started = true;
    rooms[room].phase = 1;
    // สุ่มวัตถุพยานชิ้นกลางของคดีนั้นๆ มาใช้ในเฟส 2
    rooms[room].evidence =
      randomCase.globalEvidences[
        Math.floor(Math.random() * randomCase.globalEvidences.length)
      ];

    // 🟢 ระบบคำนวณเวลาที่เหมาะสมอัตโนมัติตามจำนวนคนในห้อง
    const totalPlayers = roomPlayers.length;
    let phase1Time = 420; // ค่าเริ่มต้นสำหรับ 5-6 คน (7 นาที)
    let phase2Time = 300; // (5 นาที)
    let phase3Time = 180; // (3 นาที)

    if (totalPlayers <= 4) {
      phase1Time = 240; // 4 นาที
      phase2Time = 180; // 3 นาที
      phase3Time = 120; // 2 นาที
    } else if (totalPlayers >= 7) {
      phase1Time = 720; // 12 นาที
      phase2Time = 480; // 8 นาที
      phase3Time = 240; // 4 นาที
    }

    rooms[room].phase2Duration = phase2Time;
    rooms[room].phase3Duration = phase3Time;

    // สุ่มตำแหน่ง ฆาตกร และ นักสืบ (ห้ามเป็นคนซ้ำกัน)
    const killerIndex = Math.floor(Math.random() * roomPlayers.length);
    let detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    while (detectiveIndex === killerIndex) {
      detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    }

    const killerId = roomPlayers[killerIndex];
    const detectiveId = roomPlayers[detectiveIndex];

    // ผสมบทบาทพยานผู้บริสุทธิ์ไม่ให้ซ้ำกัน
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

      // ส่งบทบาทลับให้แต่ละบุคคลคนนั้นเห็นคนเดียว
      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    // ส่งชื่อเรื่องและซับไตเติลคดีไปอัปเดตหน้าเว็บทุกคนพร้อมกัน
    io.to(room).emit("caseDetails", {
      title: randomCase.caseTitle,
      subtitle: randomCase.caseSubtitle,
    });

    io.to(room).emit("gameStarted");

    // สั่งสตาร์ทเวลานับถอยหลังเฟส 1 ทันทีตามเวลาที่คำนวณได้
    startPhaseTimer(room, 1, phase1Time);
    updateRoomPlayers(room);
  });

  // 🟢 แก้ไขระบบเปลี่ยนเฟสเกม (แก้บั๊กกดปุ่มเข้าเฟส 3 แล้วนิ่ง)
  socket.on("nextPhase", (room) => {
    if (rooms[room] && rooms[room].started) {
      // ตรวจสอบว่าถ้าอยู่เฟส 1 ให้ข้ามไปเฟส 2
      if (rooms[room].phase === 1) {
        startPhaseTimer(room, 2, rooms[room].phase2Duration);
      }
      // ตรวจสอบว่าถ้าอยู่เฟส 2 ให้ข้ามไปเฟส 3
      else if (rooms[room].phase === 2) {
        startPhaseTimer(room, 3, rooms[room].phase3Duration);
      }
    }
  });

  // 4. ระบบนักสืบโหวตจับกุมคนร้าย (อัปเดตเพิ่มการส่งโพยเฉลยคดี)
  socket.on("votePlayer", ({ room, targetName }) => {
    const player = players[socket.id];
    if (player && player.role.includes("นักสืบ")) {
      clearInterval(timers[room]); // หยุดเวลานาฬิกาถอยหลัง
      io.to(room).emit("timerUpdate", {
        minutes: 0,
        seconds: 0,
        expired: true,
      });

      // ประกาศชื่อผู้ถูกจับกุมในช่องแชทบันทึกคำให้การตามปกติ
      io.to(room).emit(
        "announceVote",
        `⚖️ **[ปิดคดีอย่างเป็นทางการ!]** นักสืบ ${player.name} ได้ทุบโต๊ะชี้ตัวจับกุมผู้ต้องสงสัยหลักคือ: **${targetName}** ! สมาชิกทุกคนเปิดเผยบทบาทจริงในแชทเพื่อตรวจสอบผลลัพธ์ได้เลย!`,
      );

      // 🟢 ดึงข้อมูลเฉลยจากคดีปัจจุบันในห้องนั้นออกมา
      const currentCaseSolution =
        rooms[room].currentCase?.caseSolution || "ไม่พบข้อมูลเฉลยสำหรับคดีนี้";

      // 🟢 ส่งสัญญาณบอกทุกหน้าจอให้เปิด Pop-up เฉลยพร้อมๆ กัน
      io.to(room).emit("showSolutionPopup", {
        targetName: targetName,
        solutionText: currentCaseSolution,
      });
    }
  });

  // 5. เมื่อมีผู้เล่นคนใดออกจากเกม
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

// ฟังก์ชันหัวใจหลักในการคุมนาฬิกานับถอยหลังแบบเรียลไทม์
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

      // ถ้าหมดเวลา ให้เปลี่ยนเฟสอัตโนมัติด้วยเวลาที่คำนวณไว้ตั้งแต่แรกตามขนาดกลุ่มผู้เล่น
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

// เปิดพอร์ตสัญญาณระบบหลัก
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running beautifully on port ${PORT}`);
});
