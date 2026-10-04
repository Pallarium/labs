/* Keyboard + mouse. Exposes held state and one-frame "pressed" edges. */

const held = new Set();
const pressedThisFrame = new Set();

export const Input = {
  mx: 0, my: 0,          // screen space
  wx: 0, wy: 0,          // world space (filled by camera each frame)
  fire: false,
  alt: false,
  init(canvas) {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(c)) e.preventDefault();
      held.add(c); pressedThisFrame.add(c);
    });
    addEventListener("keyup", (e) => held.delete(e.code));
    addEventListener("blur", () => { held.clear(); Input.fire = false; Input.alt = false; });

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      Input.mx = (e.clientX - r.left) * (canvas.width / r.width);
      Input.my = (e.clientY - r.top) * (canvas.height / r.height);
    };
    canvas.addEventListener("mousemove", pos);
    canvas.addEventListener("mousedown", (e) => {
      pos(e);
      if (e.button === 0) Input.fire = true;
      if (e.button === 2) { Input.alt = true; pressedThisFrame.add("AltFire"); }
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) Input.fire = false;
      if (e.button === 2) Input.alt = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  },

  down(code) { return held.has(code); },
  pressed(code) { return pressedThisFrame.has(code); },

  /** normalized move vector from WASD / arrows */
  move() {
    let x = 0, y = 0;
    if (held.has("KeyA") || held.has("ArrowLeft")) x -= 1;
    if (held.has("KeyD") || held.has("ArrowRight")) x += 1;
    if (held.has("KeyW") || held.has("ArrowUp")) y -= 1;
    if (held.has("KeyS") || held.has("ArrowDown")) y += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
    return { x, y };
  },

  endFrame() { pressedThisFrame.clear(); },
};
