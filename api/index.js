const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(__dirname));

let players = {}; // เก็บรายชื่อผู้เล่น { socketId: { name, room, role, clue, isAlive } }
let rooms = {}; // เก็บสถานะห้อง { roomName: { started: false, killerId: null } }

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

io.on("connection", (socket) => {
  // 1. เข้าร่วมห้อง
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    players[socket.id] = { name, room, role: "", clue: "", isAlive: true };

    if (!rooms[room]) {
      rooms[room] = { started: false };
    }

    updateRoomPlayers(room);
  });

  // 2. หัวหน้าห้องกดเริ่มเกม
  socket.on("startGame", (room) => {
    const roomPlayers = Object.keys(players).filter(
      (id) => players[id].room === room,
    );

    if (roomPlayers.length < 3) {
      socket.emit("errorMsg", "ต้องมีผู้เล่นอย่างน้อย 3 คนขึ้นไปครับ");
      return;
    }

    rooms[room].started = true;

    // สุ่มฆาตกร 1 คน
    const killerIndex = Math.floor(Math.random() * roomPlayers.length);
    const killerId = roomPlayers[killerIndex];

    roomPlayers.forEach((id, index) => {
      if (id === killerId) {
        players[id].role = "🔴 ฆาตกร (Killer)";
        players[id].clue =
          killerClues[Math.floor(Math.random() * killerClues.length)];
      } else {
        players[id].role = "🟢 ผู้บริสุทธิ์ (Innocent)";
        players[id].clue =
          innocentClues[Math.floor(Math.random() * innocentClues.length)];
      }
      // ส่งบทบาทให้เฉพาะบุคคลนั้นๆ (ไม่ให้คนอื่นเห็น)
      io.to(id).emit("receiveRole", {
        role: players[id].role,
        clue: players[id].clue,
      });
    });

    // แจ้งทุกคนในห้องว่าเกมเริ่มแล้ว
    io.to(room).emit("gameStarted");
    updateRoomPlayers(room);
  });

  // 3. โหวตผู้ต้องสงสัย
  socket.on("votePlayer", ({ room, targetName }) => {
    io.to(room).emit(
      "announceVote",
      `${players[socket.id].name} โหวตสงสัย ${targetName}`,
    );
  });

  // 4. เมื่อผู้เล่นออกหรือตัดการเชื่อมต่อ
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
