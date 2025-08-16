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

// Update simulation parameters from controls
document.getElementById("timeRate").addEventListener("input", (e) => {
  timeRate = parseFloat(e.target.value);
  document.getElementById("timeRateValue").innerText = timeRate;
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
    this.vx = vx;
    this.vy = vy;
    this.mass = mass;
    this.color = color || "white";
    this.radius = Math.cbrt(mass) * 2;
    this.trail = [];
    this.futurePath = [];
    this.id = Math.random().toString(36).slice(2, 8); // Unique id for label
  }

  // Draw the body on the canvas
  draw(ctx) {
    // Draw body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
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

  // Draw the trail as a line
  drawTrail(ctx) {
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let point of this.trail) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.stroke();
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
  return newBody;
}

// Add an initial large body (e.g., a sun) at the center
bodies.push(
  new Body(canvas.width / 2, canvas.height / 2, 0, 0, 1000, "#ffff00")
);

// Collision effect: flash and particle burst
let collisionEffects = [];
function spawnCollisionEffect(x, y, color) {
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * 2 * Math.PI;
    const speed = 2 + Math.random() * 2;
    collisionEffects.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      color
    });
  }
}
function drawCollisionEffects(ctx) {
  for (let eff of collisionEffects) {
    ctx.save();
    ctx.globalAlpha = eff.alpha;
    ctx.beginPath();
    ctx.arc(eff.x, eff.y, 3, 0, 2 * Math.PI);
    ctx.fillStyle = eff.color;
    ctx.fill();
    ctx.restore();
  }
}
function updateCollisionEffects() {
  for (let eff of collisionEffects) {
    eff.x += eff.vx;
    eff.y += eff.vy;
    eff.alpha -= 0.04;
  }
  collisionEffects = collisionEffects.filter(eff => eff.alpha > 0);
}

// Update the simulation: compute forces and update positions of all bodies
function update() {
  // Loop through each body and compute gravitational acceleration
  for (let i = 0; i < bodies.length; i++) {
    let bodyA = bodies[i];
    let ax = 0;
    let ay = 0;

    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      let bodyB = bodies[j];
      let dx = bodyB.x - bodyA.x;
      let dy = bodyB.y - bodyA.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      let force = (G * bodyA.mass * bodyB.mass) / (distance * distance + 25);
      ax += (force * dx) / distance / bodyA.mass;
      ay += (force * dy) / distance / bodyA.mass;
    }

    // Update velocity using the computed acceleration
    bodyA.vx += ax * timeRate;
    bodyA.vy += ay * timeRate;
  }

  // Update positions based on velocities and add trail points
  for (let body of bodies) {
    body.x += body.vx * timeRate;
    body.y += body.vy * timeRate;
    body.addTrailPoint(); // Add the current position to the trail
  }
  
  // Collision Detection and Merging:
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[i].x - bodies[j].x;
      const dy = bodies[i].y - bodies[j].y;
      const distance = Math.hypot(dx, dy);
      if (distance < (bodies[i].radius + bodies[j].radius)) {
        // Merge bodies[i] and bodies[j]
        const newBody = mergeBodies(bodies[i], bodies[j]);
        // Calculate collision point in world coordinates
        const collisionWorldX = (bodies[i].x + bodies[j].x) / 2;
        const collisionWorldY = (bodies[i].y + bodies[j].y) / 2;
        // Convert to screen coordinates (taking into account barycenter translation)
        const collisionScreenX = collisionWorldX + (canvas.width / 2 - displayBarycenterX);
        const collisionScreenY = collisionWorldY + (canvas.height / 2 - displayBarycenterY);
        // Spawn collision effect at correct screen position
        spawnCollisionEffect(collisionScreenX, collisionScreenY, newBody.color);
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

  // Save the context and translate so the barycenter is centered.
  ctx.save();
  ctx.translate(
    canvas.width / 2 - displayBarycenterX,
    canvas.height / 2 - displayBarycenterY
  );

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
function loop() {
  if (!isPaused) {
    update();
    simTime += 0.016 * timeRate; // Approximate frame time
  }
  draw();
  updateCollisionEffects();

  // Update stats
  const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
  const avgSpeed = bodies.length ? (bodies.reduce((sum, b) => sum + Math.hypot(b.vx, b.vy), 0) / bodies.length).toFixed(2) : 0;
  document.getElementById("bodiesCount").textContent = `Bodies: ${bodies.length}`;
  document.getElementById("simTime").textContent = `Time: ${simTime.toFixed(1)}s`;
  if (!document.getElementById("extraStats")) {
    const stats = document.getElementById("stats");
    const span = document.createElement("span");
    span.id = "extraStats";
    stats.appendChild(span);
  }
  document.getElementById("extraStats").textContent = ` | Total Mass: ${Math.round(totalMass)} | Avg Speed: ${avgSpeed}`;
  requestAnimationFrame(loop);
}
loop();

// Mouse event listeners for interactive creation of a new body

// On mousedown: record starting position and clear any existing preview
canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  const rect = canvas.getBoundingClientRect();
  startX = e.clientX - rect.left - (canvas.width / 2 - baryOffsetX);
  startY = e.clientY - rect.top - (canvas.height / 2 - baryOffsetY);
  previewBody = null;
});

// On mousemove: if dragging, update the preview body and compute its future path
canvas.addEventListener("mousemove", (e) => {
  if (isDragging) {
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left - (canvas.width / 2 - baryOffsetX);
    const currentY = e.clientY - rect.top - (canvas.height / 2 - baryOffsetY);
    // Compute velocity based on the drag distance
    const vx = (currentX - startX) * 0.01;
    const vy = (currentY - startY) * 0.01;
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
  if (isDragging && previewBody) {
    // Clear the computed future path so it no longer draws
    previewBody.futurePath = [];
    bodies.push(previewBody);
  }
  isDragging = false;
  previewBody = null;
});

function clearSimulation() {
  // Option 1: Clear only the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Option 2: Reset simulation state and clear canvas
  bodies = []; 
  previewBody = null;
  simTime = 0;

  // Optionally, if you want to restart with the initial body (e.g. a sun), uncomment below:
  // bodies.push(new Body(canvas.width / 2, canvas.height / 2, 0, 0, 1000, "yellow"));

  // Force a redraw to update the cleared state
  draw();
}

// Attach event listener after DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("clearBtn").addEventListener("click", clearSimulation);
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
