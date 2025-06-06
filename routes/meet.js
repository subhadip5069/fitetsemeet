import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index');
});

router.get('/join/:email/:room', (req, res) => {
  const { email, room } = req.params;
  res.render('room', { roomId: room, email });
});

router.get('/create-room', (req, res) => {
  const newRoom = uuidv4();
  res.redirect(`/join/demo@fitetse.com/${newRoom}`);
});

export default router;