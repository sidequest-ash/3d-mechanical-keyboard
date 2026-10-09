# 3D Mechanical Keyboard

A 3D mechanical keyboard in the browser that types along with yours. Press a key on your real keyboard and the same key goes down on screen, stays down while you hold it, and springs back when you let go, with Gateron Brown switch sounds. Whatever you type shows up in the text block above it.

## Features

- **Mirrors your keyboard.** Keys are matched by physical position (`KeyboardEvent.code`), so left and right Shift, ⌘, ⌥, the arrows and all punctuation land on the right key, whatever your layout.
- **Real switch sounds.** Gateron Brown mode plays 30 real keystrokes, each with its own press and release sound, picked at random with a slight pitch change so typing never sounds looped. The big keys (Space, Enter, Shift, Backspace) use deeper strokes. There's also a synthesized "Clicky" mode, and Off.
- **Text block.** Everything you type appears above the keyboard. Enter starts a new line, Backspace deletes, and Clear empties it.
- **Click or tap keys** too. Hold the mouse button to hold a key.
- 65% layout with arrow keys, a press ripple, and light under each key.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:8003.

## Stack

Next.js 16, React Three Fiber, Drei, GSAP and the Web Audio API. Keycap legends are drawn on canvas textures, so no font files are fetched.

## Credits

Switch sounds were cut from a royalty-free recording, "Mechanical Keyboard Typing – Brown Switches" by danevaer. The cut-down sprite is in `public/sounds/gateron-brown.mp3`, and `app/gateron-brown.json` maps each stroke.
