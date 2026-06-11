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

// บอกให้ Express วิ่งออกไปดึงไฟล์หน้าเว็บข้างนอกโฟลเดอร์ api (ดึงขึ้นไป 1 ระดับ)
app.use(express.static(path.join(__dirname, "../")));

// ส่งไฟล์ index.html ที่อยู่ชั้นนอกสุด (Root) ออกไปให้ผู้เล่นได้อย่างถูกต้อง ไม่หลงทาง
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
  // 1. ผู้เล่นเข้าร่วมห้องเกม (เวอร์ชันปลอดภัย แก้บั๊กห้อง undefined ตอนรีเฟรช)
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);

    // 🟢 แก้จุดตาย: ต้องเช็กและสร้างโครงสร้างห้องมารองรับก่อนเสมอ เพื่อไม่ให้บึ้มตอนรีเฟรช
    if (!rooms[room]) {
      rooms[room] = {
        started: false,
        phase: 1,
        evidence: "",
        phase2Duration: 300,
        phase3Duration: 180,
        currentCase: null,
        playersData: {},
        playedCases: [],
      };
    }

    // ตรวจสอบสถานะการเชื่อมต่อ (กรณีรีเฟรชหน้าจอคืนชีพกลับมา)
    if (rooms[room].playersData[name]) {
      // ทำการผูก Socket ID ใบใหม่ให้กับโปรไฟล์เดิมทันทีเพื่อคงแต้มคะแนนไว้
      players[socket.id] = rooms[room].playersData[name];
      console.log(
        `🔄 ผู้เล่น ${name} รีเฟรชหน้าจอและเชื่อมต่อกลับเข้าห้อง ${room} สำเร็จ`,
      );

      // ส่งข้อมูลบทบาทและคดีเดิมกลับไปให้หน้าจอเขาทันที
      socket.emit("receiveRole", {
        role: players[socket.id].role,
        clue: players[socket.id].clue,
      });

      if (rooms[room].currentCase) {
        socket.emit("caseDetails", {
          title: rooms[room].currentCase.caseTitle,
          subtitle: rooms[room].currentCase.caseSubtitle,
        });
        socket.emit("phaseChanged", {
          phase: rooms[room].phase,
          evidence: rooms[room].evidence,
        });
      }
    } else {
      // กรณีเป็นผู้เล่นใหม่แกะกล่องกดเข้าห้องมาปกติ
      if (rooms[room].started) {
        socket.emit(
          "errorMsg",
          "ห้องนี้เริ่มเกมไปแล้วครับ คุณไม่สามารถเข้าร่วมกลางคันได้",
        );
        return;
      }

      // บันทึกโปรไฟล์ลงตัวแปรหลัก + ตั้งค่าเริ่มต้นคะแนนเป็น 0 แต้ม
      players[socket.id] = {
        name,
        room,
        role: "",
        clue: "",
        isAlive: true,
        score: 0,
      };
      // สำรองโปรไฟล์ไว้ในห้องนี้กันรีเฟรชหลุด
      rooms[room].playersData[name] = players[socket.id];
    }

    updateRoomPlayers(room);
    sendChecklistToRoom(room);
  });

  // 2. เมื่อหัวหน้าห้องกดเริ่มเกม
  socket.on("startGame", (room) => {
    if (!rooms[room]) return;

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

    // คัดกรองเลือกเฉพาะคดีที่ห้องนี้ยังไม่เคยสืบสวน
    const availableCases = allCases.filter(
      (c) => !rooms[room].playedCases.includes(c.caseTitle),
    );

    if (availableCases.length === 0) {
      socket.emit(
        "errorMsg",
        "คุณสืบสวนครบทุกคดีในคลังแล้ว! กรุณากดปุ่ม 'รีเฟรชล้างคดีทั้งหมด' บนหน้าจอเพื่อเริ่มสุ่มใหม่ตั้งแต่ต้นครับ",
      );
      return;
    }

    // สุ่มคดีจากคดีที่เหลืออยู่
    const randomCase =
      availableCases[Math.floor(Math.random() * availableCases.length)];
    rooms[room].currentCase = randomCase;
    rooms[room].playedCases.push(randomCase.caseTitle);

    // อัปเดตหน้าตา Checklist
    sendChecklistToRoom(room);

    rooms[room].started = true;
    rooms[room].phase = 1;

    // สุ่มวัตถุพยานชิ้นกลางของคดีนี้
    rooms[room].evidence =
      randomCase.globalEvidences[
        Math.floor(Math.random() * randomCase.globalEvidences.length)
      ];

    // คำนวณเวลาอัตโนมัติตามจำนวนคนในห้อง
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

    // สุ่มตำแหน่ง ฆาตกร และ นักสืบ
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

      // เซฟสถานะบทบาทเข้าฐานข้อมูลห้องเพื่อรองรับระบบเช็กผลแต้มภายหลัง
      rooms[room].playersData[players[id].name].role = players[id].role;
      rooms[room].playersData[players[id].name].clue = players[id].clue;

      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    io.to(room).emit("caseDetails", {
      title: randomCase.caseTitle,
      subtitle: randomCase.caseSubtitle,
    });

    io.to(room).emit("gameStarted");
    startPhaseTimer(room, 1, phase1Time);
    updateRoomPlayers(room);
  });

  // 3. ระบบเปลี่ยนเฟสเกม
  socket.on("nextPhase", (room) => {
    if (rooms[room] && rooms[room].started) {
      if (rooms[room].phase === 1) {
        startPhaseTimer(room, 2, rooms[room].phase2Duration);
      } else if (rooms[room].phase === 2) {
        startPhaseTimer(room, 3, rooms[room].phase3Duration);
      }
    }
  });

  // 4. ระบบนักสืบโหวตจับกุมคนร้าย และคำนวณคะแนนตามขนาดห้องเกม
  socket.on("votePlayer", ({ room, targetName }) => {
    const player = players[socket.id];
    if (player && player.role.includes("นักสืบ") && rooms[room]) {
      clearInterval(timers[room]);
      io.to(room).emit("timerUpdate", {
        minutes: 0,
        seconds: 0,
        expired: true,
      });

      const roomPlayersIds = Object.keys(players).filter(
        (id) => players[id].room === room,
      );
      const totalPlayersCount = roomPlayersIds.length;

      // ค้นหาหาตัวฆาตกรตัวจริงในตานั้นๆ
      let killerId = "";
      let killerName = "";

      roomPlayersIds.forEach((id) => {
        const isTargetInnocent = rooms[room].currentCase.innocentScenarios.some(
          (i) => players[id].role === i.roleName,
        );
        if (!isTargetInnocent && !players[id].role.includes("นักสืบ")) {
          killerId = id;
          killerName = players[id].name;
        }
      });

      // ตัดสินผลลัพธ์คดี
      const isDetectiveCorrect = targetName === killerName;
      let winners = [];

      if (isDetectiveCorrect) {
        // ฝั่งคนดีชนะร่วมกัน (นักสืบ + พยานทุกคน ได้คนละ 1 คะแนน)
        roomPlayersIds.forEach((id) => {
          if (id !== killerId) {
            players[id].score += 1;
            winners.push(players[id].name);
          }
        });
      } else {
        // ฝั่งฆาตกรชนะคนเดียว (คิดแต้มแบ่งตามจำนวนผู้เล่นในห้อง)
        if (killerId) {
          const killerBonus = totalPlayersCount <= 4 ? 2 : 1;
          players[killerId].score += killerBonus;
          winners.push(killerName);
        }
      }

      const currentCaseSolution =
        rooms[room].currentCase?.caseSolution || "ไม่พบข้อมูลเฉลยคดี";

      // อัปเดตข้อมูลคะแนนกลับเข้าไปในข้อมูลประจำห้อง
      roomPlayersIds.forEach((id) => {
        if (rooms[room].playersData[players[id].name]) {
          rooms[room].playersData[players[id].name].score = players[id].score;
        }
      });

      // ประกาศผลลัพธ์รอบการจับกุม
      io.to(room).emit("showSolutionPopup", {
        targetName: targetName,
        solutionText: currentCaseSolution,
        winners: winners,
      });

      updateRoomPlayers(room);
    }
  });

  // 5. เมื่อมีผู้เล่นขาดการเชื่อมต่อ
  socket.on("disconnect", () => {
    const pData = players[socket.id];
    if (pData) {
      const room = pData.room;
      const name = pData.name;
      delete players[socket.id];

      updateRoomPlayers(room);
      io.to(room).emit(
        "announceVote",
        `📢 สัญญาณของ ${name} ขาดหายไปชั่วคราว (กำลังรอการเชื่อมต่อใหม่...)`,
      );
    }
  });

  // 6. พาทุกคนกลับหน้าล็อบบี้
  socket.on("backToLobby", (room) => {
    if (rooms[room]) {
      rooms[room].started = false;
      rooms[room].phase = 1;
      rooms[room].evidence = "";
      rooms[room].currentCase = null;

      const roomPlayersIds = Object.keys(players).filter(
        (id) => players[id].room === room,
      );
      roomPlayersIds.forEach((id) => {
        players[id].role = "";
        players[id].clue = "";
        if (rooms[room].playersData[players[id].name]) {
          rooms[room].playersData[players[id].name].role = "";
          rooms[room].playersData[players[id].name].clue = "";
        }
      });

      io.to(room).emit("returnedToLobby");
      updateRoomPlayers(room);
      sendChecklistToRoom(room);
    }
  });

  // 7. รีเซ็ตประวัติแฟ้มคดี
  socket.on("resetRoomCases", (room) => {
    if (rooms[room]) {
      rooms[room].playedCases = [];
      sendChecklistToRoom(room);
      io.to(room).emit(
        "announceVote",
        "🔄 [ระบบประจำคฤหาสน์]: ล้างประวัติแฟ้มคดีเรียบร้อย! สามารถสุ่มเจอคดีเดิมได้อีกครั้ง",
      );
    }
  });
});

function startPhaseTimer(room, phase, totalSeconds) {
  if (timers[room]) clearInterval(timers[room]);
  if (!rooms[room]) return;

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

// 🟢 แก้ไขฟังก์ชัน: แนบส่งวัตถุคะแนนดิบ (rawPlayersData) กลับไปหน้าเว็บด้วย
function updateRoomPlayers(room) {
  if (!rooms[room]) return;
  const roomPlayers = Object.values(players)
    .filter((p) => p.room === room)
    .map((p) => p.name);

  io.to(room).emit("roomData", {
    players: roomPlayers,
    started: rooms[room].started,
    rawPlayersData: rooms[room].playersData, // 👈 ตัวแปรนี้จะเอาไปใช้เรนเดอร์ตารางคะแนนลอยตัวครับ
  });
}

function sendChecklistToRoom(room) {
  if (!rooms[room] || !allCases) return;
  const checklist = allCases.map((c) => ({
    title: c.caseTitle,
    played: rooms[room].playedCases
      ? rooms[room].playedCases.includes(c.caseTitle)
      : false,
  }));
  io.to(room).emit("updateChecklist", { checklist });
}

module.exports = app;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running beautifully on port ${PORT}`);
});
