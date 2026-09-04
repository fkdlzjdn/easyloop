// Dedicated ROSBridge publisher for Jog. Keeping this timer off the UI thread
// prevents large map/camera rendering from starving cmd_vel delivery.
let socket = null;
let config = null;
let publishTimer = null;
let reconnectTimer = null;
let active = false;
let lastHeartbeatAt = 0;
let advertised = false;
let connectionGeneration = 0;
let velocity = { lx: 0, ly: 0, az: 0 };

function postStatus(state, detail = '') {
  self.postMessage({ type: 'status', state, detail });
}

function zeroVelocity() {
  return { lx: 0, ly: 0, az: 0 };
}

function normalizeVelocity(value = {}) {
  const number = input => Number.isFinite(Number(input)) ? Number(input) : 0;
  return { lx: number(value.lx), ly: number(value.ly), az: number(value.az) };
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function advertise() {
  if (!config || advertised) return;
  advertised = send({
    op: 'advertise',
    id: config.advertiseId,
    topic: config.topic,
    type: config.messageType,
    queue_size: 1,
    latch: false
  });
}

function publish(value = velocity) {
  if (!config) return false;
  advertise();
  return send({
    op: 'publish',
    id: config.publishId,
    topic: config.topic,
    msg: {
      linear: { x: value.lx, y: value.ly, z: 0 },
      angular: { x: 0, y: 0, z: value.az }
    }
  });
}

function stopMotion(reason = '') {
  const wasActive = active;
  active = false;
  velocity = zeroVelocity();
  publish(velocity);
  if (wasActive && reason) postStatus('lease-expired', reason);
}

function tick() {
  if (!active) return;
  if (Date.now() - lastHeartbeatAt > config.leaseMs) {
    stopMotion(`heartbeat > ${config.leaseMs}ms`);
    return;
  }
  publish(velocity);
}

function startTimer() {
  if (publishTimer) clearInterval(publishTimer);
  publishTimer = setInterval(tick, config.intervalMs);
}

function closeSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (!socket) return;
  if (advertised) {
    send({ op: 'unadvertise', id: config?.advertiseId, topic: config?.topic });
  }
  advertised = false;
  try { socket.close(); } catch (error) { /* stale socket */ }
  socket = null;
}

function connect() {
  if (!config) return;
  closeSocket();
  const generation = ++connectionGeneration;
  postStatus('connecting');
  try {
    socket = new WebSocket(config.url);
  } catch (error) {
    postStatus('error', error?.message || String(error));
    reconnectTimer = setTimeout(connect, config.reconnectMs);
    return;
  }
  socket.onopen = () => {
    if (generation !== connectionGeneration) return;
    advertised = false;
    advertise();
    postStatus('ready');
  };
  socket.onclose = () => {
    if (generation !== connectionGeneration || !config) return;
    socket = null;
    advertised = false;
    postStatus('disconnected');
    reconnectTimer = setTimeout(connect, config.reconnectMs);
  };
  socket.onerror = () => postStatus('error', 'Jog WebSocket error');
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'configure') {
    stopMotion();
    config = {
      url: String(message.url || ''),
      topic: String(message.topic || ''),
      messageType: String(message.messageType || 'geometry_msgs/Twist'),
      intervalMs: Math.max(20, Number(message.intervalMs) || 50),
      leaseMs: Math.max(200, Number(message.leaseMs) || 350),
      reconnectMs: Math.max(250, Number(message.reconnectMs) || 750),
      advertiseId: `jog-advertise-${Date.now()}`,
      publishId: `jog-publish-${Date.now()}`
    };
    startTimer();
    connect();
    return;
  }
  if (message.type === 'command') {
    const nextVelocity = normalizeVelocity(message.velocity);
    const nextActive = Boolean(message.active);
    const changed = nextVelocity.lx !== velocity.lx
      || nextVelocity.ly !== velocity.ly
      || nextVelocity.az !== velocity.az;
    const wasActive = active;
    velocity = nextVelocity;
    active = nextActive;
    lastHeartbeatAt = Date.now();
    // Repeated main-thread messages act as heartbeats. The Worker timer owns
    // the 20Hz cadence; publish immediately only on start/direction/stop change.
    if (!active) publish(zeroVelocity());
    else if (!wasActive || changed) publish(velocity);
    return;
  }
  if (message.type === 'heartbeat') {
    if (active) lastHeartbeatAt = Date.now();
    return;
  }
  if (message.type === 'stop') {
    stopMotion();
    return;
  }
  if (message.type === 'shutdown') {
    stopMotion();
    if (publishTimer) clearInterval(publishTimer);
    publishTimer = null;
    closeSocket();
    config = null;
    self.close();
  }
};
