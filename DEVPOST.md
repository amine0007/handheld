# Handheld — Devpost runbook

**Competition:** Meta VR Start Developer Competition 2026 —
<https://start-developer-competition-26.devpost.com/>

**Rules:** <https://start-developer-competition-26.devpost.com/rules>

**Entry period:** 24 Sep 2026 10:00 PT → **18 Nov 2026 12:00 PT** (21:00 Paris)

**Judging:** on or around 18 Nov → 9 Dec 2026. Winners announced ~11 Dec.

**Eligibility:** Meta VR Start member at submission time, 18+, a Meta account with
Developer Access, and not resident in Brazil, Quebec or a sanctioned region. Join
Start before you open the form: <https://developers.meta.com/vr/discover/programs/start/>

Everything below is written to be pasted. The long copy stays in
[`SUBMISSION.md`](SUBMISSION.md) so the two cannot drift; this file only adds what
the Devpost fields and the rules ask for on top of it.

## What the rules require, and what we hand over

| Rules | Requirement | Our answer |
| --- | --- | --- |
| §4.8 | IWSDK / WebXR builds: "a link will be required for judges to access and test your application"; GitHub Pages is the documented host | <https://amine0007.github.io/handheld/> |
| §4.9 | Link to the GitHub page for IWSDK builds | <https://github.com/amine0007/handheld> |
| §4.9 | Demo video under three minutes, publicly visible on YouTube or Vimeo | `https://youtu.be/<id>` — 71 s |
| §4.9 | Text description: inspiration, how it was built, future plans, target launch date | `SUBMISSION.md` + the two blocks further down |
| §4.9 | Track and Division | Gaming · New Experience |
| §4.6 | Reachable until the winner announcement | Pages and the repo stay public and undeleted |
| §4.10–13 | Original work, no Meta funding, public tools, Meta policies | IWSDK 1.1 + Three.js, no third-party assets |

## Video

The rules ask for "less than three (3) minutes … footage of your Project as viewed
on a Meta Quest device or via XR Simulator or another equivalent emulator … made
publicly visible on YouTube or Vimeo".

- File: `Handheld — Bimanual Marble Labyrinth.mp4` — 1920x1080, 71.15 s, one
  uncut pass of the attract mode (`?demo`) that closes its own loop on `1/6 · 0:00`.
- Upload **public**, not unlisted: the wording is "publicly visible", and the
  Devpost player embeds the YouTube frame for judges.
- Raise the audio about +10 dB first. The synthesised cues peak at -28.7 dBFS,
  which is quiet on laptop speakers but clean, so it is a gain, not a re-record.
- Title: `Handheld — Bimanual Marble Labyrinth (Meta Quest hand tracking)`.
- Description: three lines — what it is, the URL to try, and "built with IWSDK,
  hand tracking only, no controllers".
- Honesty note for the description or the form: the take is the production build
  running in a browser with the demo driver standing in for the hands. If a
  headset is available, add a 20–30 s shot in Quest Browser at the Pages URL (or
  record the whole take there) — that is literally the footage §4.9 describes.

## Form field by field

### Name

```
Handheld
```

### Tagline (140 characters)

```
Pinch both grips, lift the tray, and tilt it with your own hands: in Handheld the board you hold is the physics world.
```

118 characters, one line — the tagline field is single-line, so it must not be
wrapped. The `*is*` emphasis of the Markdown source is dropped because Devpost
taglines are plain text.

### Track

```
Gaming
```

It is a seated, hands-first puzzle. Entertainment is the weaker read: there is no
content to watch, the tray is the whole game.

### Division

```
New Experience
```

Written from scratch inside the competition window: the first commit lands on
13 Nov 2026 and the build is live the same day — no pre-existing codebase, no early
access build, nothing shipped before 24 Sep 2026.

### About the project

Paste the description from [`SUBMISSION.md`](SUBMISSION.md) under "Description
(about 500 words)": it already covers inspiration, what the experience is and how
it is built. Two things §4.9 asks for are not in it yet — paste these after it.

#### Future plans

Three additions, in the order they would ship. First, boards that are not only
about slope: hairpins and chicanes where the marble has to be flicked rather than
rolled, which the simulation can take because walls are axis-aligned boxes in a
typed array and nothing is allocated per frame. Second, a ghost run per level,
recorded from the player's own best route and replayed on the tray with a
translucent marble, so the reason to come back is beating your own hands. Third, a
passthrough mode that anchors the tray to the player's real table, which turns the
stand into something you can put down anywhere.

#### Target launch date

Q2 2027, as a hand-tracking-only release on the Meta Horizon Store. The experience
is complete and deployed; what is left is on-device QA across Quest 3 and 3S, the
store listing, and the age-rating paperwork.

### Hand interactions (optional field)

| Interaction | What the player does | How it is implemented |
| --- | --- | --- |
| Lift and start | Pinch both grip pads, then lift | `TwoHandsGrabbable` on the tray (`rotate` + `translate`, no `scale`); `Grabbed` gates the state machine |
| Tilt | Rotate the tray with both hands | Tray world quaternion inverted onto world gravity; the board-local result drives the marble |
| Poke | Touch the marble inside the rim | `playerSpaceEntities.indexTipSpaces` converted to tray space, gated to inside the rim and under 3 cm |
| Tip reset | Turn the tray over | Up-axis cosine under 0.45 held for 0.45 s: marble drops, route restarts at a five second penalty |
| Panel | Aim at the welcome card | `RayInteractable`, hands or controller |

The whole experience is hands-only end to end: there is no controller-only verb and
nothing behind a menu. Lift, tilt, poke and tip are the only four actions, and all
four are hand poses, which is also why the game can be explained in one sentence.

### What excites you about the future of VR (optional field)

Hands are the first input that needs no teaching: nobody has to be told how to tilt
a tray. That is what makes small physical games possible — the interface is an
object you already know how to hold, and the hardware disappears behind it. In a
few years the VR apps worth returning to will be the ones built on a physical act
(holding, tilting, handing something to someone) rather than on a controller the
player had to learn first.

### Try it out

| Label | Link |
| --- | --- |
| Playable build (WebXR, HTTPS) | <https://amine0007.github.io/handheld/> |
| Source (IWSDK 1.1) | <https://github.com/amine0007/handheld> |

How judges should open it:

- **Headset:** Quest Browser at the build URL, then tap *Enter XR* on the welcome
  card. Hand tracking on, controllers down; no install, no APK.
- **Laptop, no headset:** the same URL with `?demo` for the hands-free attract
  mode, or `?keys` to tilt with the arrow keys and tip with space.

### Built with

```
Immersive Web SDK (IWSDK 1.1, @iwsdk/core) · Three.js · WebXR hand input ·
TypeScript · Vite · UIKitML · GitHub Pages
```

### Gallery

| File | Use |
| --- | --- |
| `docs/screenshots/attract.png` | thumbnail, 1280x720, tray lifted over the board |
| `docs/screenshots/scene.png` | the tray resting on its stand |
| `docs/screenshots/tray.png` | the maze up close: brass rim, deck, marble |

Add two or three frames from the video if a bigger gallery helps — one at `2/6`, one
mid-drop, one on the summary — so the gallery reads lift → play → finish.

### Team

One entrant: the Devpost account holder, whose own Start membership covers the
entry. Give name, email and role (design, code, art and audio are the same person
here) in the field the form provides.

## Submission day

1. `Join hackathon` on Devpost with the account whose email matches the Start
   membership — a non-member submission is ineligible (§2d).
2. Upload the video public on YouTube, paste the id into `SUBMISSION.md`, push.
3. Open the Pages build in Quest Browser and lift the tray once: the only build
   judges will touch must work hands-only on the first try. Check the same URL in
   the IWER emulator for the `?demo` and `?keys` paths.
4. Fill every field above and submit **before 18 Nov 2026 12:00 PT** (21:00 Paris).
   Devpost stops accepting entries at that minute.
5. After the deadline, do not edit the submission and do not push a new build to
   the deployed branch: §Judging warns that modifications may disqualify the entry.
   Keep the video and the Pages site up until the winners are announced (~11 Dec).

## Why each criterion lands

| Criterion | The evidence already in the build |
| --- | --- |
| Innovation & Creativity | The tray you hold *is* the physics world: board-local gravity from the tray's world quaternion, so the genre's controller becomes the board itself |
| Experience Design | Four hand verbs, no menu, no locomotion; a released tray eases home instead of being lost; the loop closes on itself in 71 s |
| Technical Implementation | IWSDK hand tracking, `TwoHandsGrabbable` bimanual grip, fingertip poke, tip gesture; a fixed-step simulation with typed-array walls so a long frame cannot tunnel the marble through a wall or a hole |
| Polish & Presentation | UIKitML scoreboard with live level/clock/drops/rings, procedural cues, one uncut 1080p take, in-app attract mode that also serves as the demo driver |

