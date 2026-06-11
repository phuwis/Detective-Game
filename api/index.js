const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "../")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../index.html"));
});

let players = {};
let rooms = {};

const innocentClues = [
  "คุณพบรอยเท้าเปื้อนโคลนเดินมุ่งหน้าไปทางสวนหลังบ้าน",
  "คุณได้ยินเสียงแก้วแตกจากห้องครัวตอนเวลา 23:00 น.",
  "คุณจำได้ว่าผู้ตายเคยมีปากเสียงกับใครบางคนเรื่องเงินทอง",
  "คุณพบกุญแจผีตกอยู่ใต้พรมเช็ดเท้าหน้าประตู",
  "ก่อนเกิดเหตุ คุณเห็นไฟในห้องทำงานปิดๆ เปิดๆ อยู่สองสามครั้ง",
];

const killerClues = [
  "คุณคือฆาตกร! คุณซ่อนอาวุธไว้ในตู้เสื้อผ้า จงเนียนไปกับคนอื่น",
  "คุณคือฆาตกร! คุณแอบตัดสายไฟก่อนลงมือ จงหาข้ออ้างเรื่องเวลาที่หายไป",
  "คุณคือฆาตกร! คุณทำสร้อยข้อมือตกไว้ในที่เกิดเหตุ จงเบี่ยงเบนความสนใจ",
];

// รายการหลักฐานกลางที่จะสุ่มใน Phase 2
const globalEvidences = [
  "🎯 พบรอยเลือดกลุ่มกรุ๊ป B ตกอยู่บนพรมเช็ดเท้า (ซึ่งไม่ใช่กรุ๊ปเลือดของผู้ตาย!)",
  "🎯 มีคนพบจดหมายขู่กรรโชกทรัพย์ฉีกขาดอยู่ในถังขยะห้องโถง",
  "🎯 ผลชันสูตรชี้ว่าผู้ตายถูกวางยาพิษชนิดออกฤทธิ์ช้าในแก้วไวน์",
  "🎯 กล้องวงจรปิดหน้าบ้านถูกผ้าดำคลุมไว้ตั้งแต่เวลา 22:30 น.",
];

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    players[socket.id] = { name, room, role: "", clue: "", isAlive: true };

    if (!rooms[room]) {
      rooms[room] = { started: false, phase: 1, evidence: "" };
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

    rooms[room].started = true;
    rooms[room].phase = 1; // เริ่มที่ เฟส 1
    rooms[room].evidence =
      globalEvidences[Math.floor(Math.random() * globalEvidences.length)];

    const killerIndex = Math.floor(Math.random() * roomPlayers.length);
    let detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    while (detectiveIndex === killerIndex) {
      detectiveIndex = Math.floor(Math.random() * roomPlayers.length);
    }

    const killerId = roomPlayers[killerIndex];
    const detectiveId = roomPlayers[detectiveIndex];

    roomPlayers.forEach((id, index) => {
      if (id === killerId) {
        players[id].role = "🔴 ฆาตกร (Killer)";
        players[id].clue =
          killerClues[Math.floor(Math.random() * killerClues.length)];
      } else if (id === detectiveId) {
        players[id].role = "🔵 นักสืบ (Detective)";
        players[id].clue =
          "คุณคือนักสืบเพียงคนเดียว! จงทำหน้าที่สืบสวนตาม Phase ของเกมให้ดีเพื่อจับตัวคนร้าย";
      } else {
        players[id].role = "🟢 ผู้บริสุทธิ์ (Innocent)";
        players[id].clue =
          innocentClues[Math.floor(Math.random() * innocentClues.length)];
      }

      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    io.to(room).emit("gameStarted");
    io.to(room).emit("phaseChanged", { phase: 1 });
    updateRoomPlayers(room);
  });

  // ระบบเปลี่ยนเฟสเกม (ควบคุมโดยนักสืบ)
  socket.on("nextPhase", (room) => {
    if (rooms[room] && rooms[room].started) {
      if (rooms[room].phase < 3) {
        rooms[room].phase += 1;
        io.to(room).emit("phaseChanged", {
          phase: rooms[room].phase,
          evidence: rooms[room].evidence,
        });
        io.to(room).emit(
          "announceVote",
          `📢 ระบบ: ตัวเกมเข้าสู่ **Phase ${rooms[room].phase}** เรียบร้อยแล้ว!`,
        );
      }
    }
  });

  socket.on("votePlayer", ({ room, targetName }) => {
    const player = players[socket.id];
    if (player && player.role === "🔵 นักสืบ (Detective)") {
      io.to(room).emit(
        "announceVote",
        `⚖️ **[คดีสิ้นสุด!]** นักสืบ ${player.name} ได้โหวตชี้ตัวจับกุมฆาตกรไปที่: **${targetName}** ! สรุปผลลัพธ์ในวงสนทนากันได้เลย!`,
      );
    }
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      const room = players[socket.id].room;
      const name = players[socket.id].name;
      delete players[socket.id];
      updateRoomPlayers(room);
      io.to(room).emit("announceVote", `📢 ${name} ได้ออกจากเกมไปแล้ว`);
    }
  });
});

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
