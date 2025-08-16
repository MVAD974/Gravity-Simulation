// Get canvas element and its drawing context
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Resize the canvas to fill the browser window
function resizeCanvas() { 
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Global simulation variables
let bodies = []; // Array to hold all bodies in the simulation
let G = 0.1; // Gravitational constant
let timeRate = 1; // Time rate for the simulation
let previewBody = null; // Temporary body preview while dragging
let isDragging = false; // Flag to track if the mouse is dragging
let startX, startY; // Starting position for drag
let baryOffsetX = 0,
  baryOffsetY = 0; // Stores the offset due to the move of the baycenter
// Global variables for smooth barycenter animation
let displayBarycenterX = canvas.width / 2;
let displayBarycenterY = canvas.height / 2;
let smoothingFactor = 0.1; // Adjust between 0 and 1 for desired smoothness (marche pas non ?)
let trailOpacity = 0.05; // Opacity for the trail effect
let maxTrailLength = 100; // Default maximum trail length
let isPaused = false; // Pause state
let showGrid = true; // Grid toggle
let showVelocityArrows = true; // Velocity arrows toggle
let showMassNumbers = true; // Mass numbers toggle
let simTime = 0; // Simulation time in seconds

// Zoom and pan variables
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

// Update simulation parameters from controls
document.getElementById("timeRate").addEventListener("input", (e) => {
  timeRate = parseFloat(e.target.value);
  document.getElementById("timeRateValue").innerText = timeRate;
});
document.getElementById("gravityStrength").addEventListener("input", (e) => {
  G = parseFloat(e.target.value);
  document.getElementById("gravityValue").innerText = G;
});
document.getElementById("massInput").addEventListener("input", (e) => {
  document.getElementById("massValue").innerText = e.target.value;
});
document.getElementById("trailLength").addEventListener("input", (e) => {
  maxTrailLength = parseInt(e.target.value); // Update maxTrailLength
  document.getElementById("trailLengthValue").innerText = maxTrailLength;
});

// Enhanced Body class with velocity vector and label
class Body {
  constructor(x, y, vx, vy, mass, color) {
    this.x = x;
    this.y = y;
    this.oldX = x - vx; // Previous position for Verlet integration
    this.oldY = y - vy;
    this.vx = vx;
    this.vy = vy;
    this.ax = 0; // Current acceleration
    this.ay = 0;
    this.mass = mass;
    this.color = color || "white";
    this.radius = Math.cbrt(mass) * 2;
    this.trail = [];
    this.futurePath = [];
    this.id = Math.random().toString(36).slice(2, 8); // Unique id for label
  }

  // Draw the body on the canvas
  draw(ctx) {
    // Add glow effect for massive bodies
    if (this.mass > 500) {
      const glowIntensity = Math.min(20, this.mass / 50);
      ctx.save();
      ctx.shadowColor = this.color;
      ctx.shadowBlur = glowIntensity;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + glowIntensity/4, 0, Math.PI * 2);
      ctx.fillStyle = this.color + '20'; // Semi-transparent outer glow
      ctx.fill();
      ctx.restore();
    }
    
    // Draw body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = Math.min(12, this.mass / 100);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Draw velocity vector as an arrow if speed is big enough
    if (showVelocityArrows) {
      const vScale = 40; // Make the arrow even longer
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 0.2) { // Only draw if velocity is significant
        const vx = this.vx * vScale;
        const vy = this.vy * vScale;
        const fromX = this.x;
        const fromY = this.y;
        const toX = this.x + vx;
        const toY = this.y + vy;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Draw arrowhead
        const angle = Math.atan2(vy, vx);
        const headlen = 10;
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 7), toY - headlen * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 7), toY - headlen * Math.sin(angle + Math.PI / 7));
        ctx.lineTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 7), toY - headlen * Math.sin(angle - Math.PI / 7));
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
    // Draw label (mass)
    if (showMassNumbers) {
      ctx.font = 'bold 13px Segoe UI, Arial';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(this.mass), this.x, this.y - this.radius - 8);
    }
  }

  // Draw the trail as a line with fade effect
  drawTrail(ctx) {
    if (this.trail.length > 1) {
      for (let i = 1; i < this.trail.length; i++) {
        const alpha = i / this.trail.length; // Fade from 0 to 1
        const width = 1 + (alpha * 2); // Trail gets thicker towards current position
        
        ctx.beginPath();
        ctx.moveTo(this.trail[i-1].x, this.trail[i-1].y);
        ctx.lineTo(this.trail[i].x, this.trail[i].y);
        
        // Create alpha value for CSS color
        const alphaHex = Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.strokeStyle = this.color + alphaHex;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
  }

  // Add a point to the trail
  addTrailPoint() {
    this.trail.push({ x: this.x, y: this.y });
    // Limit the trail length to avoid memory issues
    if (this.trail.length > maxTrailLength) {
      this.trail.shift();
    }
  }

  // Draw the predicted future path as a dashed line
  drawFuturePath(ctx) {
    if (this.futurePath.length > 0) {
      ctx.beginPath();
      ctx.setLineDash([5, 5]); // Set dash pattern
      ctx.moveTo(this.x, this.y);
      for (let pos of this.futurePath) {
        ctx.lineTo(pos.x, pos.y);
      }
      ctx.strokeStyle = this.color;
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash pattern
    }
  }
}

// Function to precompute the future path of a body
// This simulates the motion for a given number of steps
function computeFuturePath(body, steps = 100) {
  let futurePositions = [];
  // Copy the body's current state
  let temp = {
    x: body.x,
    y: body.y,
    vx: body.vx,
    vy: body.vy,
    mass: body.mass,
  };
  for (let i = 0; i < steps; i++) {
    let ax = 0,
      ay = 0;
    // Compute gravitational acceleration from each existing body
    for (let other of bodies) {
      if (other === body) continue; // Skip self-interaction
      let dx = other.x - temp.x;
      let dy = other.y - temp.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      let force = (G * temp.mass * other.mass) / (distance * distance + 25);
      ax += (force * dx) / distance / temp.mass;
      ay += (force * dy) / distance / temp.mass;
    }
    // Update temporary velocity and position
    temp.vx += ax * timeRate;
    temp.vy += ay * timeRate;
    temp.x += temp.vx * timeRate;
    temp.y += temp.vy * timeRate;
    // Record the new position
    futurePositions.push({ x: temp.x, y: temp.y });
  }
  return futurePositions;
}

// Linearly interpolate between two colors
function lerpColor(color1, color2, t) {
  // Parse the colors into RGB components
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);

  // Interpolate each color channel
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);

  // Convert back to hex format
  return rgbToHex(r, g, b);
}

// Helper function to convert hex color to RGB
function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

// Helper function to convert RGB to hex color
function rgbToHex(r, g, b) {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Merge bodies when they collide
function mergeBodies(bodyA, bodyB) {
  // Calculate the new mass and velocity after merging
  let newMass = bodyA.mass + bodyB.mass;
  let newVx = (bodyA.vx * bodyA.mass + bodyB.vx * bodyB.mass) / newMass;
  let newVy = (bodyA.vy * bodyA.mass + bodyB.vy * bodyB.mass) / newMass;
  // lerp the color of the two bodies
  let newColor = lerpColor(bodyA.color, bodyB.color, bodyB.mass / newMass);
  // Create a new merged body at the average position
  let newBody = new Body(
    (bodyA.x + bodyB.x) / 2,
    (bodyA.y + bodyB.y) / 2,
    newVx,
    newVy,
    newMass,
    newColor
  );
  // Set proper old positions for Verlet integration
  newBody.oldX = newBody.x - newVx;
  newBody.oldY = newBody.y - newVy;
  return newBody;
}

// Add an initial large body (e.g., a sun) at the center
bodies.push(
  new Body(canvas.width / 2, canvas.height / 2, 0, 0, 1000, "#ffff00")
);

// Enhanced collision effect: more realistic particle physics
let collisionEffects = [];
function spawnCollisionEffect(x, y, color, energy = 1) {
  const particleCount = Math.min(30, Math.max(10, energy * 20));
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * 2 * Math.PI + Math.random() * 0.5;
    const speed = (1 + Math.random() * 3) * energy;
    const size = 2 + Math.random() * 3;
    const lifetime = 1 + Math.random() * 0.5;
    collisionEffects.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      maxAlpha: 1,
      color,
      size,
      lifetime,
      age: 0,
      gravity: -0.1 // Slight upward bias for visual appeal
    });
  }
}

function drawCollisionEffects(ctx) {
  for (let eff of collisionEffects) {
    ctx.save();
    ctx.globalAlpha = eff.alpha;
    ctx.beginPath();
    ctx.arc(eff.x, eff.y, eff.size, 0, 2 * Math.PI);
    ctx.fillStyle = eff.color;
    ctx.fill();
    // Add subtle glow effect
    ctx.shadowColor = eff.color;
    ctx.shadowBlur = eff.size * 2;
    ctx.fill();
    ctx.restore();
  }
}

function updateCollisionEffects() {
  for (let eff of collisionEffects) {
    eff.x += eff.vx;
    eff.y += eff.vy;
    eff.vy += eff.gravity; // Apply gravity to particles
    eff.vx *= 0.995; // Air resistance
    eff.vy *= 0.995;
    eff.age += 0.016; // Approximate frame time
    eff.alpha = eff.maxAlpha * (1 - eff.age / eff.lifetime);
    eff.size *= 0.99; // Particles shrink over time
  }
  collisionEffects = collisionEffects.filter(eff => eff.alpha > 0.01);
}

// Update the simulation: compute forces and update positions of all bodies
function update() {
  // First pass: compute gravitational acceleration for all bodies
  for (let i = 0; i < bodies.length; i++) {
    let bodyA = bodies[i];
    bodyA.ax = 0;
    bodyA.ay = 0;

    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      let bodyB = bodies[j];
      let dx = bodyB.x - bodyA.x;
      let dy = bodyB.y - bodyA.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      // Add softening parameter to prevent singularities
      let force = (G * bodyA.mass * bodyB.mass) / (distance * distance + 25);
      bodyA.ax += (force * dx) / distance / bodyA.mass;
      bodyA.ay += (force * dy) / distance / bodyA.mass;
    }
  }

  // Second pass: update positions using Verlet integration for better stability
  for (let body of bodies) {
    const dt = timeRate;
    const dt2 = dt * dt;
    
    // Store current position
    const currentX = body.x;
    const currentY = body.y;
    
    // Verlet integration: x_new = 2*x_current - x_old + a*dt^2
    body.x = 2 * body.x - body.oldX + body.ax * dt2;
    body.y = 2 * body.y - body.oldY + body.ay * dt2;
    
    // Update old position
    body.oldX = currentX;
    body.oldY = currentY;
    
    // Update velocity for display purposes: v = (x_new - x_old) / (2*dt)
    if (dt > 0) {
      body.vx = (body.x - body.oldX) / (2 * dt);
      body.vy = (body.y - body.oldY) / (2 * dt);
    }
    
    body.addTrailPoint(); // Add the current position to the trail
  }
  
  // Collision Detection and Merging:
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const distance = Math.hypot(dx, dy);
      if (distance < (bodies[i].radius + bodies[j].radius)) {
        // Calculate collision energy for particle effect
        const relativeVx = bodies[i].vx - bodies[j].vx;
        const relativeVy = bodies[i].vy - bodies[j].vy;
        const relativeSpeed = Math.hypot(relativeVx, relativeVy);
        const totalMass = bodies[i].mass + bodies[j].mass;
        const collisionEnergy = Math.min(5, relativeSpeed * totalMass * 0.001);
        
        // Merge bodies[i] and bodies[j]
        const newBody = mergeBodies(bodies[i], bodies[j]);
        // Calculate collision point in world coordinates
        const collisionWorldX = (bodies[i].x + bodies[j].x) / 2;
        const collisionWorldY = (bodies[i].y + bodies[j].y) / 2;
        // Convert to screen coordinates (taking into account barycenter translation)
        const collisionScreenX = collisionWorldX + (canvas.width / 2 - displayBarycenterX);
        const collisionScreenY = collisionWorldY + (canvas.height / 2 - displayBarycenterY);
        // Spawn collision effect at correct screen position with energy-based intensity
        spawnCollisionEffect(collisionScreenX, collisionScreenY, newBody.color, collisionEnergy);
        // Remove colliding bodies from the array
        bodies.splice(j, 1);
        bodies.splice(i, 1);
        bodies.push(newBody);
        // Restart checking for collisions since bodies array changed
        i = -1;
        break;
      }
    }
  }
}

// Draw background grid
function drawGrid(ctx, spacing = 100, color = "#222") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  for (let x = -canvas.width; x < canvas.width * 2; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, -canvas.height);
    ctx.lineTo(x, canvas.height * 2);
    ctx.stroke();
  }
  for (let y = -canvas.height; y < canvas.height * 2; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(-canvas.width, y);
    ctx.lineTo(canvas.width * 2, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// Draw the simulation scene with the trail effect and preview
function draw() {
  // Clear the canvas with a semi-transparent rectangle for the trail effect.
  ctx.fillStyle = `rgba(0, 0, 0, 0.9)`; // Use adjustable opacity
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Compute the mass barycenter of all bodies.
  let totalMass = 0,
    barycenterX = 0,
    barycenterY = 0;
  for (let body of bodies) {
    totalMass += body.mass;
    barycenterX += body.x * body.mass;
    barycenterY += body.y * body.mass;
  }
  if (totalMass > 0) {
    barycenterX /= totalMass;
    barycenterY /= totalMass;
  }
  // Smoothly update the display barycenter
  displayBarycenterX += smoothingFactor * (barycenterX - displayBarycenterX);
  displayBarycenterY += smoothingFactor * (barycenterY - displayBarycenterY);

  // Store for potential further use
  baryOffsetX = displayBarycenterX;
  baryOffsetY = displayBarycenterY;

  // Save the context and apply transformations
  ctx.save();
  
  // Apply zoom and pan transformations
  ctx.translate(canvas.width / 2 + panX, canvas.height / 2 + panY);
  ctx.scale(zoomLevel, zoomLevel);
  ctx.translate(-displayBarycenterX, -displayBarycenterY);

  // Draw grid if enabled
  if (showGrid) drawGrid(ctx);

  // Draw simulation elements (future paths, bodies, and preview body) in world space.
  for (let body of bodies) {
    body.drawFuturePath(ctx);
  }
  for (let body of bodies) {
    body.drawTrail(ctx); // Draw the trail
    body.draw(ctx);
  }
  if (previewBody) {
    previewBody.drawFuturePath(ctx);
    previewBody.draw(ctx);
  }
  // Restore context to return to screen coordinates.
  ctx.restore();
  drawCollisionEffects(ctx);
}

// Main animation loop: update physics and redraw the scene
let frameCount = 0;
let lastFrameTime = performance.now();
let fps = 60;

function loop() {
  const currentTime = performance.now();
  const deltaTime = currentTime - lastFrameTime;
  frameCount++;
  
  // Update FPS every 60 frames
  if (frameCount % 60 === 0) {
    fps = Math.round(1000 / (deltaTime));
  }
  lastFrameTime = currentTime;
  
  if (!isPaused) {
    update();
    simTime += 0.016 * timeRate; // Approximate frame time
  }
  draw();
  updateCollisionEffects();

  // Update stats
  const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
  const avgSpeed = bodies.length ? (bodies.reduce((sum, b) => sum + Math.hypot(b.vx, b.vy), 0) / bodies.length).toFixed(2) : 0;
  const totalEnergy = bodies.reduce((sum, b) => sum + 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy), 0);
  
  document.getElementById("bodiesCount").textContent = `Bodies: ${bodies.length}`;
  document.getElementById("simTime").textContent = `Time: ${simTime.toFixed(1)}s`;
  if (!document.getElementById("extraStats")) {
    const stats = document.getElementById("stats");
    const span = document.createElement("span");
    span.id = "extraStats";
    stats.appendChild(span);
  }
  document.getElementById("extraStats").textContent = ` | Mass: ${Math.round(totalMass)} | Speed: ${avgSpeed} | Energy: ${Math.round(totalEnergy)} | FPS: ${fps} | Zoom: ${zoomLevel.toFixed(1)}x`;
  requestAnimationFrame(loop);
}
loop();

// Mouse event listeners for interactive creation of a new body

// Helper function to convert screen coordinates to world coordinates
function screenToWorld(screenX, screenY) {
  const worldX = (screenX - canvas.width / 2 - panX) / zoomLevel + displayBarycenterX;
  const worldY = (screenY - canvas.height / 2 - panY) / zoomLevel + displayBarycenterY;
  return { x: worldX, y: worldY };
}

// Mouse wheel zoom
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoomLevel = Math.max(0.1, Math.min(5, zoomLevel * zoomFactor));
  
  // Zoom towards mouse position
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left - canvas.width / 2;
  const mouseY = e.clientY - rect.top - canvas.height / 2;
  
  panX = mouseX - (mouseX - panX) * (newZoomLevel / zoomLevel);
  panY = mouseY - (mouseY - panY) * (newZoomLevel / zoomLevel);
  zoomLevel = newZoomLevel;
});

// On mousedown: record starting position and clear any existing preview
canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  if (e.button === 2) { // Right mouse button for panning
    isPanning = true;
    lastPanX = mouseX;
    lastPanY = mouseY;
    canvas.style.cursor = 'grabbing';
  } else if (e.button === 0) { // Left mouse button for creating bodies
    isDragging = true;
    const worldCoords = screenToWorld(mouseX, mouseY);
    startX = worldCoords.x;
    startY = worldCoords.y;
    previewBody = null;
  }
});

// On mousemove: handle panning or body creation preview
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  if (isPanning) {
    panX += mouseX - lastPanX;
    panY += mouseY - lastPanY;
    lastPanX = mouseX;
    lastPanY = mouseY;
  } else if (isDragging) {
    const worldCoords = screenToWorld(mouseX, mouseY);
    // Compute velocity based on the drag distance
    const vx = (worldCoords.x - startX) * 0.01;
    const vy = (worldCoords.y - startY) * 0.01;
    // Read mass and color from controls
    const mass = parseFloat(document.getElementById("massInput").value);
    const color = document.getElementById("colorInput").value;
    // Create or update the preview body
    previewBody = new Body(startX, startY, vx, vy, mass, color);
    // Compute its future path for previewing (simulate 100 steps)
    previewBody.futurePath = computeFuturePath(previewBody, 1000);
  }
});

// On mouseup: add the preview body to the simulation and clear the preview
canvas.addEventListener("mouseup", (e) => {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = 'default';
  } else if (isDragging && previewBody) {
    // Clear the computed future path so it no longer draws
    previewBody.futurePath = [];
    bodies.push(previewBody);
  }
  isDragging = false;
  previewBody = null;
});

// Disable context menu on right-click
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  switch(e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      isPaused = !isPaused;
      document.getElementById("pauseBtn").textContent = isPaused ? "Resume" : "Pause";
      break;
    case 'c':
      clearSimulation();
      break;
    case 'p':
      loadPreset();
      break;
    case 's':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        saveSimulation();
      }
      break;
    case 'l':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        loadSimulation();
      }
      break;
    case 'g':
      showGrid = !showGrid;
      document.getElementById("gridToggle").checked = showGrid;
      break;
    case 'v':
      showVelocityArrows = !showVelocityArrows;
      document.getElementById("velocityToggle").checked = showVelocityArrows;
      const velocityLegend = document.getElementById("velocityLegend");
      velocityLegend.style.display = showVelocityArrows ? "inline-flex" : "none";
      break;
    case 'm':
      showMassNumbers = !showMassNumbers;
      document.getElementById("massToggle").checked = showMassNumbers;
      break;
    case 'r':
      // Reset zoom and pan
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      break;
  }
});

function clearSimulation() {
  // Option 1: Clear only the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Option 2: Reset simulation state and clear canvas
  bodies = []; 
  previewBody = null;
  simTime = 0;
  collisionEffects = [];

  // Optionally, if you want to restart with the initial body (e.g. a sun), uncomment below:
  // bodies.push(new Body(canvas.width / 2, canvas.height / 2, 0, 0, 1000, "yellow"));

  // Force a redraw to update the cleared state
  draw();
}

// Preset scenarios for educational purposes
const presetScenarios = [
  {
    name: "Solar System",
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, mass: 2000, color: "#ffff00" }, // Sun
      { x: 150, y: 0, vx: 0, vy: 3, mass: 20, color: "#ff6b35" }, // Planet 1
      { x: 250, y: 0, vx: 0, vy: 2.5, mass: 30, color: "#4a90e2" }, // Planet 2
      { x: 350, y: 0, vx: 0, vy: 2, mass: 25, color: "#7ed321" }, // Planet 3
    ]
  },
  {
    name: "Binary Stars",
    bodies: [
      { x: -100, y: 0, vx: 0, vy: 2, mass: 800, color: "#ff3333" },
      { x: 100, y: 0, vx: 0, vy: -2, mass: 800, color: "#3333ff" },
      { x: 0, y: 200, vx: 1.5, vy: 0, mass: 15, color: "#ffffff" }, // Orbiting planet
    ]
  },
  {
    name: "Chaotic Three-Body",
    bodies: [
      { x: -50, y: -50, vx: 0.5, vy: 0.5, mass: 500, color: "#ff6b35" },
      { x: 50, y: -50, vx: -0.5, vy: 0.5, mass: 500, color: "#4a90e2" },
      { x: 0, y: 50, vx: 0, vy: -1, mass: 500, color: "#7ed321" },
    ]
  },
  {
    name: "Galaxy Formation",
    bodies: generateGalaxyPreset()
  }
];

function generateGalaxyPreset() {
  const galaxyBodies = [];
  const centerMass = 3000;
  galaxyBodies.push({ x: 0, y: 0, vx: 0, vy: 0, mass: centerMass, color: "#ffff00" });
  
  // Generate spiral arms
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * 4 * Math.PI; // 2 spiral arms
    const radius = 100 + i * 15;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    // Calculate orbital velocity
    const orbitalSpeed = Math.sqrt(G * centerMass / radius) * 0.8; // Slightly slower for stability
    const vx = -Math.sin(angle) * orbitalSpeed;
    const vy = Math.cos(angle) * orbitalSpeed;
    
    galaxyBodies.push({
      x, y, vx, vy,
      mass: 20 + Math.random() * 30,
      color: `hsl(${200 + Math.random() * 60}, 70%, ${50 + Math.random() * 30}%)`
    });
  }
  
  return galaxyBodies;
}

let currentPresetIndex = 0;
function loadPreset() {
  clearSimulation();
  const preset = presetScenarios[currentPresetIndex];
  
  // Convert relative positions to screen coordinates
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  preset.bodies.forEach(bodyData => {
    const body = new Body(
      centerX + bodyData.x,
      centerY + bodyData.y,
      bodyData.vx,
      bodyData.vy,
      bodyData.mass,
      bodyData.color
    );
    bodies.push(body);
  });
  
  // Move to next preset for next time
  currentPresetIndex = (currentPresetIndex + 1) % presetScenarios.length;
  
  // Show which preset was loaded
  const presetBtn = document.getElementById("presetBtn");
  presetBtn.textContent = `Next: ${presetScenarios[currentPresetIndex].name}`;
  setTimeout(() => {
    presetBtn.textContent = "Presets";
  }, 2000);
}

// Save/Load functionality
function saveSimulation() {
  const simulationState = {
    bodies: bodies.map(body => ({
      x: body.x,
      y: body.y,
      vx: body.vx,
      vy: body.vy,
      mass: body.mass,
      color: body.color,
      oldX: body.oldX,
      oldY: body.oldY
    })),
    simTime: simTime,
    G: G,
    timeRate: timeRate,
    zoomLevel: zoomLevel,
    panX: panX,
    panY: panY,
    timestamp: Date.now()
  };
  
  const dataStr = JSON.stringify(simulationState, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(dataBlob);
  link.download = `gravity-simulation-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
  link.click();
  
  // Show feedback
  const saveBtn = document.getElementById("saveBtn");
  saveBtn.textContent = "Saved!";
  setTimeout(() => {
    saveBtn.textContent = "Save";
  }, 2000);
}

function loadSimulation() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const simulationState = JSON.parse(e.target.result);
          
          // Clear current simulation
          clearSimulation();
          
          // Restore bodies
          simulationState.bodies.forEach(bodyData => {
            const body = new Body(
              bodyData.x, bodyData.y,
              bodyData.vx, bodyData.vy,
              bodyData.mass, bodyData.color
            );
            body.oldX = bodyData.oldX || body.x - body.vx;
            body.oldY = bodyData.oldY || body.y - body.vy;
            bodies.push(body);
          });
          
          // Restore simulation parameters
          simTime = simulationState.simTime || 0;
          G = simulationState.G || 0.1;
          timeRate = simulationState.timeRate || 1;
          zoomLevel = simulationState.zoomLevel || 1;
          panX = simulationState.panX || 0;
          panY = simulationState.panY || 0;
          
          // Update UI controls
          document.getElementById("gravityStrength").value = G;
          document.getElementById("gravityValue").textContent = G;
          document.getElementById("timeRate").value = timeRate;
          document.getElementById("timeRateValue").textContent = timeRate;
          
          // Show feedback
          const loadBtn = document.getElementById("loadBtn");
          loadBtn.textContent = "Loaded!";
          setTimeout(() => {
            loadBtn.textContent = "Load";
          }, 2000);
          
        } catch (error) {
          alert("Error loading simulation file: " + error.message);
        }
      };
      reader.readAsText(file);
    }
  };
  input.click();
}

// Attach event listener after DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("clearBtn").addEventListener("click", clearSimulation);
  document.getElementById("presetBtn").addEventListener("click", loadPreset);
  document.getElementById("saveBtn").addEventListener("click", saveSimulation);
  document.getElementById("loadBtn").addEventListener("click", loadSimulation);
  
  const menu = document.getElementById("menu");
  const menuBtn = document.getElementById("menuBtn");

  menuBtn.addEventListener("click", () => {
    menu.classList.toggle("hidden");
  });
  // Add event listeners for new controls
  const pauseBtn = document.getElementById("pauseBtn");
  pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? "Resume" : "Pause";
  });
  const gridToggle = document.getElementById("gridToggle");
  gridToggle.addEventListener("change", (e) => {
    showGrid = e.target.checked;
  });

  // Add event listeners for new display toggles
  const velocityToggle = document.getElementById("velocityToggle");
  velocityToggle.addEventListener("change", (e) => {
    showVelocityArrows = e.target.checked;
    // Update velocity legend visibility
    const velocityLegend = document.getElementById("velocityLegend");
    velocityLegend.style.display = showVelocityArrows ? "inline-flex" : "none";
  });

  const massToggle = document.getElementById("massToggle");
  massToggle.addEventListener("change", (e) => {
    showMassNumbers = e.target.checked;
  });
});
