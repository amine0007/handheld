# Handheld — submission copy

## Name

Handheld

## Tagline (140 characters max)

Pinch both grips, lift the tray, and tilt it with your own hands: in Handheld the
board you hold *is* the physics world.

(118 characters of plain text; 122 as written with the emphasis markers.)

## Description (about 500 words)

Every marble labyrinth you have played in VR asks you to hold a controller and
watch a board. Handheld asks you to hold the board.

It is a bimanual marble labyrinth built for hand tracking on Meta Quest. There is
no table, no menu and no virtual joystick: a small brass-rimmed tray rests on a
stand in front of you, and pinching both grip pads lifts it into your hands. The
moment it leaves the stand the run starts, and from then on the tray's world
orientation *is* gravity. Each frame the system takes the tray's world quaternion,
inverts it, and rotates the real gravity vector into board space; the two
in-plane components drive the marble simulation. Tilt your hands ten degrees and
the marble feels ten degrees of slope. Because nothing else moves the marble, the
two-handed grip is not a control scheme bolted onto a game — it is the game.

The physics is a purpose-built fixed-step simulation, not a general engine. Six
deterministic mazes are generated at load time from fixed seeds: an 8x6 cell grid
carved with a breadth-first search, then braided to add loops, with trap holes
placed only on corridors the marble will actually use. Walls are axis-aligned
boxes in a typed array, so a frame costs no allocations and a long frame can never
tunnel the marble through a wall or over a hole. Difficulty comes from the maze,
never from the board: every level uses the same tray, so the thing in your hands
never changes size.

Progress is read at a glance. Amber rings are checkpoints, the green ring is the
goal, and a scoreboard floating just behind the tray shows level, clock, drops and
rings completed, plus a one-line hint that changes with the situation. Falling
into a trap hole costs a drop and returns the marble to the last checkpoint.
Losing your grip is not a way to lose the game: a released tray that drifts too
far from its stand eases back home.

Two hand gestures replace every button the genre normally needs. Tipping the tray
past 63 degrees for half a second drops the marble and restarts the level at a five
second penalty, so a hopeless corner is one flick away from a fresh attempt. And
because the tray is something you hold in front of you rather than look at, a
fingertip inside the rim can nudge a stalled marble — the grip pads sit outside
the rim, so holding the board can never be mistaken for poking it.

Clearing all six mazes ends the run with a summary; tipping the tray again starts
a new one. It runs on the Immersive Web SDK with hand tracking as the primary
input, and works with controllers too. No locomotion, no comfort tricks needed:
you stand in one place, and the whole experience lives in the thirty centimetres
between your two hands.

## Hand interactions

| Interaction | What the player does | How it is implemented |
| --- | --- | --- |
| Lift and start | Pinch both grip pads and lift | `TwoHandsGrabbable` on the tray (`rotate` + `translate`), `Grabbed` reads as "holding" |
| Tilt | Rotate the tray with both hands | Tray world quaternion inverted onto world gravity → board-local gravity for the marble |
| Poke | Touch the marble inside the rim with a fingertip | `playerSpaceEntities.indexTipSpaces`, transformed into tray space, gated to inside the rim and under 3 cm |
| Tip reset | Turn the tray over | Up-axis cosine < 0.45 held for 0.45 s → drop marble, restart route, +5 s |
| Release | Let go anywhere | Tray eases back to its stand if it strays past 0.55 m or below 0.42 m |
| Panel | Ray to the title card | `RayInteractable` with Enter/Exit XR buttons |

## Three-minute video shot list

The build ships an attract mode for exactly this: open the deployed build with
`?demo` and one hands-free take covers shots 3 to 7 — the lift, real ring
captures with the HUD counting up, a trap-hole drop and checkpoint respawn, a
deliberate tip reset with the penalty, every later maze, and the completion
summary followed by the restart. Nothing is faked: the tray is posed, the marble
still falls to gravity, and the scoreboard is live. Talk over it for the
remaining beats, or record those with a headset.

Record it in one go at about 60 fps: the six mazes take roughly seventy seconds,
including the scripted drop and the tip reset, then the summary and the restart.

1. **0:00–0:12 — Cold open.** Headset view on the stand: tray resting, scoreboard
   at 1/6, marble on the start ring. No talking; let the room read.
2. **0:12–0:25 — Hook.** Title card over the tray: "Handheld — the board is the
   physics world." One line of context, then straight to hands.
3. **0:25–0:55 — Learn by lifting.** Both hands enter frame, pinch the grip pads,
   lift the tray off the stand. Clock starts. Small tilts; the marble rolls. Say
   the one-sentence rule: "the tray's orientation is gravity."
4. **0:55–1:35 — Play level one.** Real checkpoint captures, one trap-hole drop
   and the checkpoint respawn, one fingertip poke. Cut the scoreboard in the
   corner so clock/drops/rings move on screen.
5. **1:35–1:55 — Tip reset.** Deliberately over-tilt, marble falls, penalty shows,
   route restarts. This is the "no buttons" moment.
6. **1:55–2:25 — Later mazes.** Fast cuts of a long level and the hardest one,
   including one tip-recover and one goal capture with the green ring lighting up.
7. **2:25–2:40 — Completion.** Summary state, tip to restart, tray back on the
   stand. Shows the loop closes.
8. **2:40–3:00 — Behind the curtain.** Ten seconds of board-local gravity code,
   then the hand-interaction table, then the URL/QR. End on the tray in hands.

`docs/screenshots/attract.png` is a 1280x720 frame straight out of the attract
mode take, level two at `2/6`, with the tray lifted and tilted; it works as the
submission thumbnail.

Record at 4K if possible, capture the headset view plus a second camera on the
hands when the real device is available.

### Capturing the attract mode take

The hands-free loop is about 70 s long, so a single take covers the whole video
brief: record from level one's lift to the summary's restart and stop there.

1. Open the *deployed* build with `?demo` — not `npm run dev`. The dev server
   injects the IWER runtime, which draws its own floating **Enter XR** pill over
   the top of the welcome panel; it is absent from `dist` and from the Pages
   build, so nothing on the production URL has to be hidden.
2. Press `F11` first: fullscreen removes the tab strip and the address bar, which
   otherwise show a localhost URL in the frame.
3. Record the **screen**, not the window. `Win+Alt+R` captures the active window
   rect, which is taller than the page once the chrome is hidden and leaves a
   band of black pixels (112 px in one take) across the top. A display capture,
   or a recording region drawn around the page only, keeps the frame edge to edge.
   The app itself is fine: the canvas tracks `window.innerWidth/innerHeight`
   through any resize, anchored at the top left.
4. Move the pointer completely off the app — the bottom-right corner of the
   desktop, or another display. It sits in the frame for the whole take
   otherwise, frozen over the room.
5. Let the run reach level one before you start recording — the attract mode
   keeps looping, so it is easy to catch the tail of the previous run.
6. Stop after the summary tips back into a new run. That is roughly 70 s: six
   mazes, one scripted trap-hole drop, one tip reset, the summary and the restart.
   A good take reads `1/6` at `0:00` on the first second, `6/6` with `3/3` rings
   at about `0:11` of level time, and back to `1/6` before the file ends.

Check the frame, not just the playthrough: the picture must fill the video edge
to edge, the cursor must be gone, and no overlay should touch the HUD. Game Bar
audio is captured but quiet — the synthesised cues peak around -30 dBFS — so
raise the system volume before the take rather than re-recording a good run.

Keep the file out of git — the raw Game Bar capture is 60–100 MB. Publish it to
YouTube as a public video (the competition rules ask for a publicly visible demo
link), or re-encode it down to a few megabytes and use `git add -f` if it has to
live beside the build.

## Links

- Playable build: <https://amine0007.github.io/handheld/> — plain `/` is the
  hands-only game, `?demo` runs the hands-free attract mode, `?keys` maps the
  arrow keys to the tray. WebXR needs HTTPS, which Pages provides.
- Source: <https://github.com/amine0007/handheld>
- Video: `https://www.youtube.com/watch?v=VCA0u0vdaRI
