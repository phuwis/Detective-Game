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
  // 1. ผู้เล่นเข้าร่วมห้องเกม (อัปเดตระบบป้องกันการหลุดเมื่อรีเฟรชหน้าจอ)
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);

    // กรณีรีเฟรชหน้าจอ (ดึงโปรไฟล์และคะแนนเดิมกลับมา)
    if (rooms[room].playersData[name]) {
      players[socket.id] = rooms[room].playersData[name];
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
      if (rooms[room].started) {
        socket.emit("errorMsg", "ห้องนี้เริ่มเกมไปแล้วครับ");
        return;
      }
      // 🟢 เพิ่มตัวแปร score: 0 ให้ผู้เล่นใหม่
      players[socket.id] = {
        name,
        room,
        role: "",
        clue: "",
        isAlive: true,
        score: 0,
      };
      rooms[room].playersData[name] = players[socket.id];
    }

    updateRoomPlayers(room);

    // 🟢 ส่งข้อมูล Checklist คดีไปอัปเดตหน้าจอทันทีที่มีการเชื่อมต่อเข้าห้อง
    sendChecklistToRoom(room);

    // 🟢 ตรวจสอบว่าชื่อผู้เล่นคนนี้เคยอยู่ในห้องนี้อยู่แล้วหรือไม่ (กรณีรีเฟรชกลับมา)
    if (rooms[room].playersData[name]) {
      // ทำการผูก Socket ID ใบใหม่ให้กับโปรไฟล์เดิมทันที
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
        // ส่งอัปเดตเฟสปัจจุบันให้เขาคนเดียวเพื่อปรับหน้าเว็บให้ทันเพื่อน
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

      // บันทึกโปรไฟล์ลงตัวแปรหลัก
      players[socket.id] = { name, room, role: "", clue: "", isAlive: true };
      // สำรองโปรไฟล์ไว้ในห้องนี้กันรีเฟรช
      rooms[room].playersData[name] = players[socket.id];
    }

    updateRoomPlayers(room);
  });

  // 2. เมื่อหัวหน้าห้องกดเริ่มเกม
  // 2. เมื่อหัวหน้าห้องกดเริ่มเกม (เวอร์ชันอัปเกรดระบบ Checklist ป้องกันคดีซ้ำ)
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

    // 🟢 2.2 จุดแก้ไขหลัก: คัดกรองเลือกเฉพาะคดีที่ห้องนี้ยังไม่เคยสืบสวน
    const availableCases = allCases.filter(
      (c) => !rooms[room].playedCases.includes(c.caseTitle),
    );

    // ถ้าสุ่มเล่นจนครบทั้ง 10 คดีแล้ว ระบบจะแจ้งเตือนให้กดล้างประวัติก่อน
    if (availableCases.length === 0) {
      socket.emit(
        "errorMsg",
        "คุณสืบสวนครบทุกคดีในคลังแล้ว! กรุณากดปุ่ม 'รีเฟรชล้างคดีทั้งหมด' บนหน้าจอเพื่อเริ่มสุ่มใหม่ตั้งแต่ต้นครับ",
      );
      return;
    }

    // สุ่มคดีจาก "คดีที่เหลืออยู่เท่านั้น" (ด่านไหนเล่นแล้วจะไม่หลุดมาตรงนี้)
    const randomCase =
      availableCases[Math.floor(Math.random() * availableCases.length)];
    rooms[room].currentCase = randomCase;

    // 🟢 บันทึกชื่อคดีที่ถูกสุ่มได้ในรอบนี้ เข้าเซฟลิสต์ของห้อง เพื่อไม่ให้โดนสุ่มซ้ำในตาถัดไป
    rooms[room].playedCases.push(randomCase.caseTitle);

    // อัปเดตหน้าตา Checklist ให้หน้าเว็บแสดงผลเป็น 🟩 เล่นแล้ว
    sendChecklistToRoom(room);

    // ปรับสถานะห้องว่าเริ่มเกมแล้ว
    rooms[room].started = true;
    rooms[room].phase = 1;

    // สุ่มวัตถุพยานชิ้นกลางของคดีนี้มาเตรียมไว้ใช้ในเฟส 2
    rooms[room].evidence =
      randomCase.globalEvidences[
        Math.floor(Math.random() * randomCase.globalEvidences.length)
      ];

    // ระบบคำนวณเวลาอัตโนมัติตามจำนวนคนในห้อง
    const totalPlayers = roomPlayers.length;
    let phase1Time = 420; // 7 นาที (5-6 คน)
    let phase2Time = 300; // 5 นาที
    let phase3Time = 180; // 3 นาที

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

      // ส่งบทบาทให้แต่ละคนแบบลับๆ
      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    // ส่งชื่อเรื่องคดีไปอัปเดตหน้าเว็บทุกคน
    io.to(room).emit("caseDetails", {
      title: randomCase.caseTitle,
      subtitle: randomCase.caseSubtitle,
    });

    io.to(room).emit("gameStarted");

    // สั่งสตาร์ทเวลานับถอยหลังเฟส 1
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
  // 4. ระบบนักสืบโหวตจับกุมคนร้าย และคำนวณคะแนนแพ้-ชนะอย่างเป็นทางการ
  socket.on("votePlayer", ({ room, targetName }) => {
    const player = players[socket.id];
    if (player && player.role.includes("นักสืบ")) {
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

      // ค้นหาว่าใครในห้องนี้ที่เป็น "ฆาตกร" ตัวจริง
      let killerId = "";
      let killerName = "";
      roomPlayersIds.forEach((id) => {
        // อิงจากชื่อบทบาทที่มีคำว่า ฆาตกร หรือตรวจสอบจากเงื่อนไขที่คุณตั้งไว้ตอนแจกบทบาท
        // สมมติว่าระบบเช็กจากชื่อ Role ที่ไม่มีคำว่า "นักสืบ" และ "พยาน" หรือมีคำระบุพิเศษ
        // วิธีที่ชัวร์ที่สุด: เช็กว่า role ของคนนั้น 'ไม่ใช่นักสืบ' และ 'ไม่มีใน innocentScenarios' ของคดีปัจจุบัน
        // ในที่นี้เราจะเช็กจากคำคีย์เวิร์ดของ Role ที่คุณเซ็ตไว้ฝั่งเซิร์ฟเวอร์ครับ เช่น "ฆาตกร" หรือบทบาทคนร้าย
        // เพื่อความแม่นยำสูงสุด ให้เช็กว่าบทบาทของเขาตรงกับ killerScenarios ในด่านนั้นๆ หรือไม่
        const isTargetInnocent = rooms[room].currentCase.innocentScenarios.some(
          (i) => players[id].role === i.roleName,
        );
        if (!isTargetInnocent && !players[id].role.includes("นักสืบ")) {
          killerId = id;
          killerName = players[id].name;
        }
      });

      // 🟢 ตัดสินผลลัพธ์คดี
      const isDetectiveCorrect = targetName === killerName;
      let winners = [];

      if (isDetectiveCorrect) {
        // ฝั่งคนดีชนะ (นักสืบ + พยานทุกคน)
        roomPlayersIds.forEach((id) => {
          if (id !== killerId) {
            players[id].score += 1; // ได้คนละ 1 คะแนนเท่ากันทุกกรณี
            winners.push(players[id].name);
          }
        });
      } else {
        // ฝั่งฆาตกรชนะคนเดียว
        if (killerId) {
          // คิดแต้มตามจำนวนคน: เล่น 3-4 คนได้ 2 คะแนน | เล่น 5 คนขึ้นไปได้ 1 คะแนน
          const killerBonus = totalPlayersCount <= 4 ? 2 : 1;
          players[killerId].score += killerBonus;
          winners.push(killerName);
        }
      }

      // ดึงโพยเฉลยคดี
      const currentCaseSolution =
        rooms[room].currentCase?.caseSolution || "ไม่พบข้อมูลเฉลย";

      // อัปเดตข้อมูลตารางคะแนนล่าสุดเข้าประวัติห้องเกม
      roomPlayersIds.forEach((id) => {
        rooms[room].playersData[players[id].name].score = players[id].score;
      });

      // 🟢 ส่งสัญญาณปิดคดี และประกาศรายชื่อผู้ชนะอย่างเป็นทางการ
      io.to(room).emit("showSolutionPopup", {
        targetName: targetName,
        solutionText: currentCaseSolution,
        winners: winners, // ส่งรายชื่อคนชนะไปให้หน้าบ้านตรวจสอบผลแพ้ชนะของตัวเอง
      });

      // ส่งประวัติคะแนนชุดใหม่ไปให้ทุกหน้าจอเปิดอัปเดต
      updateRoomPlayers(room);
    }
  });

  // 5. เมื่อมีผู้เล่นขาดการเชื่อมต่อ
  socket.on("disconnect", () => {
    const pData = players[socket.id];
    if (pData) {
      const room = pData.room;
      const name = pData.name;

      // 🟢 ไม่ลบข้อมูลออกจาก rooms[room].playersData เพื่อเปิดโอกาสให้รีเฟรชกลับมาได้
      // แต่ลบเฉพาะตัวจับคู่ socket.id ตัวเก่าทิ้ง
      delete players[socket.id];

      updateRoomPlayers(room);
      io.to(room).emit(
        "announceVote",
        `📢 สัญญาณของ ${name} ขาดหายไปชั่วคราว (กำลังรอการเชื่อมต่อใหม่...)`,
      );
    }
  });

  // 🟢 ฟังก์ชันรองรับปุ่มกลับหน้า Lobby หลังจบเกม
  socket.on("backToLobby", (room) => {
    if (rooms[room]) {
      rooms[room].started = false;
      rooms[room].phase = 1;
      rooms[room].evidence = "";
      rooms[room].currentCase = null;

      // ล้างข้อมูลบทบาทและคำใบ้เก่าของทุกคนในห้องเพื่อเตรียมสุ่มใหม่รอบหน้า
      const roomPlayers = Object.keys(players).filter(
        (id) => players[id].room === room,
      );
      roomPlayers.forEach((id) => {
        players[id].role = "";
        players[id].clue = "";
      });

      // สั่งให้หน้าจอทุกคนเด้งกลับหน้า Lobby พร้อมกัน
      io.to(room).emit("returnedToLobby");
      updateRoomPlayers(room);
      sendChecklistToRoom(room);
    }
  });

  // 🟢 ฟังก์ชันรองรับปุ่มรีเฟรชล้างคดีทั้งหมด
  socket.on("resetRoomCases", (room) => {
    if (rooms[room]) {
      rooms[room].playedCases = []; // ล้างประวัติให้เป็นอาร์เรย์ว่าง
      sendChecklistToRoom(room); // ส่ง Checklist เวอร์ชันว่างเปล่ากลับไปเคลียร์หน้าจอ
      io.to(room).emit(
        "announceVote",
        "🔄 [ระบบประจำคฤหาสน์]: ล้างประวัติแฟ้มคดีเรียบร้อย! สามารถสุ่มเจอคดีเดิมได้อีกครั้ง",
      );
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

// 🟢 ฟังก์ชันประกอบข้อมูลประวัติคดีเพื่อส่งให้ฝั่งหน้าบ้านเรนเดอร์ตาราง Checklist
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

// เปิดพอร์ตสัญญาณระบบหลัก
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running beautifully on port ${PORT}`);
});
