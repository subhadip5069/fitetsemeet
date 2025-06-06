const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/join', (req, res) => {
  const { email = 'guest', code } = req.query;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log(`Invalid email: ${email}`);
    return res.render('join', { error: 'Please enter a valid email.' });
  }
  if (code) {
    if (!/^[a-zA-Z0-9-]{6,36}$/.test(code)) {
      console.log(`Invalid meeting code: ${code}`);
      return res.render('join', { error: 'Invalid meeting code. Use 6-36 alphanumeric characters or hyphens.' });
    }
    if (!rooms[code]) {
      rooms[code] = { participants: [] };
      console.log(`Created room: ${code}`);
    }
    console.log(`User ${email} joining room: ${code}`);
    res.render('meeting', { email, roomId: code });
  } else {
    res.render('join', { error: req.query.code ? 'Please enter a meeting code.' : '' });
  }
});

app.get('/join/:email/:code', (req, res) => {
  const { email, code } = req.params;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log(`Invalid email: ${email}`);
    return res.render('join', { error: 'Please enter a valid email.' });
  }
  if (!/^[a-zA-Z0-9-]{6,36}$/.test(code)) {
    console.log(`Invalid meeting code: ${code}`);
    return res.render('join', { error: 'Invalid meeting code. Use 6-36 alphanumeric characters or hyphens.' });
  }
  if (!rooms[code]) {
    rooms[code] = { participants: [] };
    console.log(`Created room: ${code}`);
  }
  console.log(`User ${email} joining room: ${code}`);
  res.render('meeting', { email, roomId: code });
});

app.get('/create', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { participants: [] };
  console.log(`Created new meeting: ${roomId}`);
  res.redirect(`/join/guest/${roomId}`);
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, email }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { participants: [] };
    }
    rooms[roomId].participants.push({ id: socket.id, email });
    console.log(`User ${email} (socket ${socket.id}) joined room: ${roomId}`);

    const existingParticipants = rooms[roomId].participants.filter(p => p.id !== socket.id);
    socket.emit('existing-participants', existingParticipants);
    socket.to(roomId).emit('user-connected', { id: socket.id, email });

    socket.on('offer', ({ sdp, target, sender }) => {
      console.log(`Offer from ${sender} to ${target} in room ${roomId}`);
      io.to(target).emit('offer', { sdp, callerId: sender, callerEmail: email });
    });

    socket.on('answer', ({ sdp, target, sender }) => {
      console.log(`Answer from ${sender} to ${target} in room ${roomId}`);
      io.to(target).emit('answer', { sdp, callerId: sender });
    });

    socket.on('ice-candidate', ({ candidate, target, sender }) => {
      console.log(`ICE candidate from ${sender} to ${target} in room ${roomId}`);
      io.to(target).emit('ice-candidate', { candidate, callerId: sender });
    });

    socket.on('chat-message', (message) => {
      console.log(`Chat message from ${email} in room ${roomId}: ${message}`);
      io.to(roomId).emit('chat-message', { email, message });
    });

    socket.on('disconnect', () => {
      rooms[roomId].participants = rooms[roomId].participants.filter(p => p.id !== socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      console.log(`User ${email} (socket ${socket.id}) left room: ${roomId}`);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});