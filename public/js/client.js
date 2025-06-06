const socket = io();
let localStream;
let peerConnections = {};
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let rotationAngle = 0;
let unreadMessages = 0;
let mainStream = null;
let mainStreamId = 'local';

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function startMeeting(roomId, email) {
  console.log(`Starting meeting for ${email} in room ${roomId}`);
  socket.emit('join-room', { roomId, email });

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    mainStream = localStream;
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.playsInline = true;
    console.log('Local stream initialized:', localStream.getVideoTracks().length > 0 ? 'Video track present' : 'No video track');
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Failed to access camera and microphone. Please check permissions.');
    return;
  }

  socket.on('existing-participants', (participants) => {
    console.log('Existing participants:', participants);
    participants.forEach(({ id, email }) => {
      createPeerConnection(id, email, roomId, true);
    });
  });

  socket.on('user-connected', ({ id, email }) => {
    console.log(`User connected: ${email} (socket ${id})`);
    createPeerConnection(id, email, roomId, false);
  });

  socket.on('offer', async ({ sdp, callerId, callerEmail }) => {
    console.log(`Received offer from ${callerId} (${callerEmail})`);
    await createPeerConnection(callerId, callerEmail, roomId, false);
    const peerConnection = peerConnections[callerId].peerConnection;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { sdp: answer, target: callerId, sender: socket.id });
      console.log(`Sent answer to ${callerId}`);
    } catch (err) {
      console.error(`Error handling offer from ${callerId}:`, err);
    }
  });

  socket.on('answer', async ({ sdp, callerId }) => {
    console.log(`Received answer from ${callerId}`);
    const peerConnection = peerConnections[callerId]?.peerConnection;
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log(`Set remote description for ${callerId}`);
      } catch (err) {
        console.error(`Error handling answer from ${callerId}:`, err);
      }
    }
  });

  socket.on('ice-candidate', async ({ candidate, callerId }) => {
    console.log(`Received ICE candidate from ${callerId}`);
    const peerConnection = peerConnections[callerId]?.peerConnection;
    if (peerConnection) {
      try {
        if (candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`Added ICE candidate from ${callerId}`);
        }
      } catch (err) {
        console.error(`Error adding ICE candidate from ${callerId}:`, err);
      }
    }
  });

  socket.on('user-disconnected', (id) => {
    console.log(`User disconnected: ${id}`);
    if (peerConnections[id]) {
      peerConnections[id].peerConnection.close();
      if (mainStreamId === id) {
        mainStream = localStream;
        mainStreamId = 'local';
        document.getElementById('local-video').srcObject = localStream;
        updateSelectedVideo('local');
      }
      const videoContainer = document.getElementById(`container-${id}`);
      if (videoContainer) videoContainer.remove();
      delete peerConnections[id];
    }
  });

  socket.on('chat-message', ({ email, message }) => {
    console.log(`Chat message from ${email}: ${message}`);
    const chatContainer = document.getElementById('chat-container');
    const chatPanel = document.getElementById('chat-panel');
    const chatBadge = document.getElementById('chat-badge');
    const messageElement = document.createElement('p');
    messageElement.textContent = `${email}: ${message}`);
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (!chatPanel.classList.contains('active')) {
      unreadMessages++;
      chatBadge.textContent = unreadMessages;
      chatBadge.parentElement.classList.add('has-messages');
    }
  });
}

async function createPeerConnection(id, email, roomId, initiateOffer) {
  if (peerConnections[id]) {
    console.log(`Peer connection for ${id} already exists`);
    return;
  }

  const peerConnection = new RTCPeerConnection(configuration);
  peerConnections[id] = { peerConnection, email, stream: null };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
    console.log(`Added ${track.kind} track to peer ${id}`);
  });

  const remoteVideo = document.createElement('video');
  remoteVideo.id = `video-${id}`;
  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.id = `container-${id}`;
  videoContainer.innerHTML = `<p>${email}</p>`;
  videoContainer.appendChild(remoteVideo);
  videoContainer.onclick = () => swapVideo(id);
  document.getElementById('participants').appendChild(videoContainer);
  console.log(`Created video container for ${id}`);

  peerConnection.ontrack = (event) => {
    console.log(`Received track from ${id}: ${event.track.kind}`);
    if (!peerConnections[id].stream) {
      peerConnections[id].stream = new MediaStream();
    }
    peerConnections[id].stream.addTrack(event.track);
    if (event.track.kind === 'audio') {
      event.track.enabled = true;
      console.log(`Enabled audio track for ${id}`);
    }
    remoteVideo.srcObject = peerConnections[id].stream;
    console.log(`Assigned stream to video-${id}`);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, target: id, sender: socket.id });
      console.log(`Sent ICE candidate to ${id}`);
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${id}: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      peerConnection.restartIce();
    }
  };

  if (initiateOffer) {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { sdp: offer, target: id, sender: socket.id });
      console.log(`Sent offer to ${id}`);
    } catch (err) {
      console.error(`Error creating offer for ${id}:`, err);
    }
  }
}

function swapVideo(id) {
  const mainVideo = document.getElementById('local-video');
  const newStream = id === 'local' ? localStream : peerConnections[id]?.stream;
  if (!newStream) {
    console.warn(`No stream found for ${id}`);
    return;
  }
  mainVideo.srcObject = newStream;
  mainStream = newStream;
  mainStreamId = id;
  console.log(`Swapped main video to ${id}`);
  updateSelectedVideo(id);
}

function updateSelectedVideo(id) {
  document.querySelectorAll('.video-container').forEach(container => {
    container.classList.remove('selected');
  });
  const selectedContainer = id === 'local' ? null : document.getElementById(`container-${id}`);
  if (selectedContainer) {
    selectedContainer.classList.add('selected');
  }
}

function toggleVideo() {
  const enabled = localStream.getVideoTracks()[0].enabled;
  localStream.getVideoTracks()[0].enabled = !enabled;
  console.log('Video toggled to:', !enabled);
  const btn = document.getElementById('video-btn');
  btn.classList.toggle('off', !enabled);
  btn.querySelector('i').classList.toggle('fa-video', enabled);
  btn.querySelector('i').classList.toggle('fa-video-slash', !enabled);
}

function toggleAudio() {
  const enabled = localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = !enabled;
  console.log('Audio toggled to:', !enabled);
  const btn = document.getElementById('audio-btn');
  btn.classList.toggle('off', !enabled);
  btn.querySelector('i').classList.toggle('fa-microphone', enabled);
  btn.querySelector('i').classList.toggle('fa-microphone-slash', !enabled);
}

function rotateCamera() {
  rotationAngle = (rotationAngle + 90) % 360;
  document.getElementById('local-video').style.transform = `rotate(${rotationAngle}deg)`;
  console.log(`Rotated camera to ${rotationAngle}deg`);
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach(({ peerConnection }) => {
      const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
      sender.replaceTrack(screenTrack);
    });
    if (mainStreamId === 'local') {
      mainStream = screenStream;
      document.getElementById('local-video').srcObject = screenStream;
    }
    screenTrack.onended = () => {
      Object.values(peerConnections).forEach(({ peerConnection }) => {
        const videoTrack = localStream.getVideoTracks()[0];
        peerConnection.getSenders().find(s => s.track.kind === 'video').replaceTrack(videoTrack);
      });
      if (mainStreamId === 'local') {
        mainStream = localStream;
        document.getElementById('local-video').srcObject = localStream;
      }
    };
    console.log('Started screen sharing');
  } catch (err) {
    console.error('Error sharing screen:', err);
  }
}

function toggleRecording() {
  if (!isRecording) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1280;
    canvas.height = 720;
    const streams = [mainStream, ...Object.values(peerConnections).map(p => p.stream)].filter(s => s);
    let xOffset = 0;
    const videos = streams.map(stream => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      return video;
    });
    function draw() {
      xOffset = 0;
      videos.forEach(video => {
        ctx.drawImage(video, xOffset, 0, canvas.width / videos.length, canvas.height);
        xOffset += canvas.width / videos.length;
      });
      requestAnimationFrame(draw);
    }
    videos.forEach(video => {
      video.onloadedmetadata = () => {
        draw();
      };
    });
    const canvasStream = canvas.captureStream();
    mediaRecorder = new MediaRecorder(canvasStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${new Date().toISOString()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    };
    mediaRecorder.start();
    isRecording = true;
    document.getElementById('record-btn').classList.add('off');
    console.log('Started recording');
  } else {
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('record-btn').classList.remove('off');
    console.log('Stopped recording');
  }
}

function hangup() {
  localStream?.getTracks().forEach(track => track.stop());
  Object.values(peerConnections).forEach(({ peerConnection }) => peerConnection.close());
  socket.disconnect();
  window.location.href = '/';
  console.log('Hung up');
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (message) {
    socket.emit('chat-message', message);
    input.value = '';
    console.log('Sent chat message');
  }
}

function toggleChat() {
  const chatPanel = document.getElementById('chat-panel');
  const chatBadge = document.getElementById('chat-badge');
  chatPanel.classList.toggle('active');
  if (chatPanel.classList.contains('active')) {
    unreadMessages = 0;
    chatBadge.textContent = '0';
    chatBadge.parentElement.classList.remove('has-messages');
  }
  console.log(`Chat panel ${chatPanel.classList.contains('active') ? 'opened' : 'closed'}`);
}
