import { useCallback, useEffect, useRef, useState } from "react";
import "./VoiceAgent.css";

const GREETING = "Hey, how can I help you?";
const WAKE_STORAGE_KEY = "voice-agent-wake-armed";

// End-of-command detection is silence-based rather than a fixed budget, so a
// slow or paused sentence is never cut off mid-thought.
const START_TIMEOUT_MS = 8000; // nothing said at all → give up
const SILENCE_TIMEOUT_MS = 1700; // quiet this long after speech → they're done
const MAX_UTTERANCE_MS = 25000; // hard backstop

// A reply ending in a question means the exchange isn't over — stay open and
// listen again instead of closing, up to this many turns.
const MAX_FOLLOW_UPS = 5;

/**
 * Chrome silently truncates a single utterance somewhere past ~15 seconds, so
 * long replies are spoken as a queue of sentence-sized pieces instead.
 */
function chunkForSpeech(text, maxChars = 180) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    // A single sentence longer than the cap still has to go somewhere.
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** Questions keep the conversation open; statements end it. */
function isQuestion(text) {
  return /\?\s*$/.test(String(text || "").trim());
}

/**
 * Wake matching, deliberately forgiving. The recogniser punctuates freely
 * ("Hey, agent."), and a quiet or accented "Hey Agent" degrades into a
 * predictable family of mishears rather than nothing at all. Leading \b keeps
 * it off ordinary speech — "the agent" has no word boundary before its "he".
 */
const WAKE_RE = /\b(hey|hay|hi|ay)\s*(agents?|agend|agenda|ancient|augent|edgend)\b/;

/** Punctuation → space, then collapse, so word boundaries stay meaningful. */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWakePhrase(text) {
  const spaced = normalize(text);
  // Also test with spaces removed, for when the recogniser runs the two words
  // together as a single token ("heyagent").
  return WAKE_RE.test(spaced) || WAKE_RE.test(spaced.replace(/ /g, ""));
}

// Opt-in transcript logging: append ?voicedebug to the URL to see exactly
// what the recogniser heard, which is the only way to tune the list above.
const VOICE_DEBUG =
  typeof window !== "undefined" && /[?&]voicedebug/.test(window.location.search);

const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// iOS Safari exposes webkitSpeechRecognition but will only start it from
// inside a user gesture, and drops out of continuous mode almost immediately —
// so the always-on wake word is never armed there. The mic button is the way in.
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const SUPPORTS_SPEECH = !!SpeechRecognitionCtor;
const SUPPORTS_WAKE = SUPPORTS_SPEECH && !IS_IOS;
const SUPPORTS_TTS = typeof window !== "undefined" && "speechSynthesis" in window;

/** Agent replies are markdown — spoken aloud the syntax turns into noise. */
function toSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/[*_#>]/g, "")
    .replace(/°C/g, " degrees")
    .replace(/\s+/g, " ")
    .trim();
}

/** Voice replies stay short — cut at a sentence boundary where we can. */
function shorten(text, maxChars) {
  const clean = toSpeech(text);
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return stop > maxChars * 0.4 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

/**
 * Ranked best-first. Chrome's bundled Google voices are markedly louder and
 * cleaner than the Windows SAPI ones, so they are worth reaching for
 * explicitly — a plain .find() over the OS list tends to land on Zira, which
 * is quiet and robotic.
 */
const VOICE_PREFS = [
  /^google us english$/i,
  /google.*(english|us)/i,
  /natural/i,
  /aria|jenny|michelle|guy/i,
  /samantha|alex/i,
  /zira|david|mark/i,
];

function pickVoice(voices) {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const us = english.filter((v) => /^en[-_]us$/i.test(v.lang));
  const pool = us.length ? us : english;
  for (const pref of VOICE_PREFS) {
    const hit = pool.find((v) => pref.test(v.name));
    if (hit) return hit;
  }
  return pool[0] || null;
}

const PHASE_LABEL = {
  greeting: "Speaking…",
  listening: "Listening…",
  processing: "Processing…",
  speaking: "Speaking…",
};

/**
 * All the speech plumbing, as a hook, so the controls can live inside the chat
 * input (the only part of the panel visible in every layout) while the overlay
 * renders at the top level.
 */
export function useVoiceAgent({ onSend }) {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [phase, setPhase] = useState("listening");
  const [caption, setCaption] = useState("");
  const [toast, setToast] = useState(null);
  const [wakeArmed, setWakeArmed] = useState(false);
  const [wakeLive, setWakeLive] = useState(false);

  const wakeRecRef = useRef(null);
  const cmdRecRef = useRef(null);
  const wakeStartedAtRef = useRef(0);
  const wakeRetriesRef = useRef(0);
  const startWakeRef = useRef(() => {});
  const restartTimerRef = useRef(null);
  const listenTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const maxUtteranceTimerRef = useRef(null);
  const exitTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const gotResultRef = useRef(false);
  const speakTokenRef = useRef(null);
  const speakGuardRef = useRef(null);
  const keepAliveRef = useRef(null);
  const turnRef = useRef(0);
  const lastQuestionRef = useRef("");
  const transcriptRef = useRef("");
  const listenForCommandRef = useRef(() => {});

  // Mirrors of state for the recogniser/synthesis callbacks, which fire long
  // after the closure that registered them was created.
  const openRef = useRef(false);
  const wakeArmedRef = useRef(false);
  const openAgentRef = useRef(() => {});
  const closeAgentRef = useRef(() => {});

  openRef.current = open;
  wakeArmedRef.current = wakeArmed;

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // ---------------------------------------------------------------- speech out

  const speak = useCallback((text, onDone) => {
    if (!SUPPORTS_TTS || !text) {
      onDone?.();
      return;
    }
    const synth = window.speechSynthesis;
    // Chrome drops an utterance queued in the same tick as a cancel(), so only
    // cancel when something is actually playing — and give it a beat after.
    const wasBusy = synth.speaking || synth.pending;
    if (wasBusy) synth.cancel();

    const voice = pickVoice(synth.getVoices());
    if (VOICE_DEBUG && voice) {
      // eslint-disable-next-line no-console
      console.log("[voice] speaking with:", voice.name, voice.lang);
    }

    const chunks = chunkForSpeech(text);
    const token = {};
    speakTokenRef.current = token;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(speakGuardRef.current);
      clearInterval(keepAliveRef.current);
      onDone?.();
    };

    // Chrome pauses long synthesis sessions on its own; a periodic resume()
    // is the standard workaround and is a no-op when nothing is paused.
    clearInterval(keepAliveRef.current);
    keepAliveRef.current = setInterval(() => {
      if (synth.speaking && !synth.paused) synth.resume();
    }, 6000);

    const speakChunk = (index) => {
      // A newer speak() call supersedes this queue.
      if (speakTokenRef.current !== token) return;
      if (index >= chunks.length) {
        finish();
        return;
      }

      const piece = chunks[index];
      const utterance = new SpeechSynthesisUtterance(piece);
      utterance.lang = voice ? voice.lang : "en-US";
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      // 1.0 is the ceiling the API allows; loudness beyond this is a system
      // volume matter, not something the page can raise.
      utterance.volume = 1;
      if (voice) utterance.voice = voice;

      let advanced = false;
      const next = () => {
        if (advanced || speakTokenRef.current !== token) return;
        advanced = true;
        clearTimeout(speakGuardRef.current);
        speakChunk(index + 1);
      };
      utterance.onend = next;
      utterance.onerror = next;

      synth.speak(utterance);

      // Safari occasionally never fires onend; a per-chunk ceiling keeps the
      // queue moving. Generous, since cutting speech short is the failure we
      // are trying to avoid.
      clearTimeout(speakGuardRef.current);
      speakGuardRef.current = setTimeout(next, 2500 + piece.length * 110);
    };

    if (wasBusy) setTimeout(() => speakChunk(0), 90);
    else speakChunk(0);
  }, []);

  // ------------------------------------------------------------- wake listener

  const stopWake = useCallback(() => {
    clearTimeout(restartTimerRef.current);
    const rec = wakeRecRef.current;
    wakeRecRef.current = null;
    setWakeLive(false);
    if (!rec) return;
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // already stopped
    }
  }, []);

  /**
   * Always start the recogniser on a timer rather than inline. abort() does
   * not release the audio device synchronously, and Chrome allows only one
   * live recogniser — so a stop immediately followed by a start makes
   * start() throw InvalidStateError. Deferring also collapses StrictMode's
   * mount → cleanup → mount into a single start.
   */
  const scheduleWake = useCallback((delay = 350) => {
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => startWakeRef.current(), delay);
  }, []);

  const startWake = useCallback(() => {
    if (VOICE_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[voice] startWake", {
        live: !!wakeRecRef.current,
        armed: wakeArmedRef.current,
        open: openRef.current,
        retries: wakeRetriesRef.current,
      });
    }
    if (!SUPPORTS_WAKE || wakeRecRef.current) return;
    if (!wakeArmedRef.current || openRef.current) return;

    const rec = new SpeechRecognitionCtor();
    rec.continuous = true;
    // Interim results for the wake word specifically: waiting for Chrome to
    // finalise a segment means it only fires a second or two after you stop
    // talking, which reads as broken. Command capture still uses finals only.
    rec.interimResults = true;
    // Ask for several candidate transcripts per segment and match against all
    // of them. A quiet or accented "Hey Agent" is often not the recogniser's
    // top guess but is reliably somewhere in the top few — this is most of the
    // difference between having to shout and being heard at a normal volume.
    rec.maxAlternatives = 5;
    rec.lang = "en-US";
    wakeRecRef.current = rec;
    wakeStartedAtRef.current = Date.now();

    rec.onstart = () => {
      if (VOICE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[voice] wake onstart — listening");
      }
      if (wakeRecRef.current !== rec) return;
      wakeStartedAtRef.current = Date.now();
      wakeRetriesRef.current = 0;
      setWakeLive(true);
    };

    rec.onresult = (event) => {
      if (wakeRecRef.current !== rec || openRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        for (let alt = 0; alt < result.length; alt += 1) {
          const raw = result[alt].transcript;
          if (VOICE_DEBUG) {
            // eslint-disable-next-line no-console
            console.log(
              `[voice] ${result.isFinal ? "final" : "interim"} alt${alt}:`,
              JSON.stringify(raw),
              "→",
              normalize(raw)
            );
          }
          if (isWakePhrase(raw)) {
            openAgentRef.current();
            return;
          }
        }
      }
    };

    rec.onerror = (event) => {
      if (wakeRecRef.current !== rec) return;
      if (VOICE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[voice] wake error:", event.error);
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setWakeArmed(false);
        try {
          localStorage.removeItem(WAKE_STORAGE_KEY);
        } catch {
          // storage unavailable — the toggle just won't be remembered
        }
        showToast("Microphone access is blocked. Allow it in your browser settings to use voice.");
      } else if (event.error === "network") {
        // Chrome does recognition server-side, so no connectivity means a
        // live mic that silently never returns a transcript — worth saying.
        showToast("Speech recognition needs an internet connection.");
      }
      // no-speech / aborted / audio-capture are routine; onend restarts us.
    };

    rec.onend = () => {
      if (wakeRecRef.current !== rec) return;
      wakeRecRef.current = null;
      setWakeLive(false);
      if (!wakeArmedRef.current || openRef.current) return;

      // Chrome ends the session on its own after every stretch of quiet, so
      // restarting is the normal path. Ending before onstart ever fired is
      // not — count those and give up rather than looping in silence, which
      // leaves the indicator dark with nothing explaining why.
      const lived = Date.now() - wakeStartedAtRef.current;
      const stillborn = lived < 500;
      if (VOICE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`[voice] wake onend after ${lived}ms`, stillborn ? "(stillborn)" : "");
      }
      if (stillborn) {
        wakeRetriesRef.current += 1;
        if (wakeRetriesRef.current > 6) {
          setWakeArmed(false);
          showToast("The wake word listener keeps stopping. Use the mic button instead.");
          return;
        }
      }
      scheduleWake(stillborn ? 1200 : 250);
    };

    try {
      rec.start();
    } catch (err) {
      // Almost always InvalidStateError from a previous session still
      // releasing the mic — transient, so retry. Permission failures arrive
      // through onerror instead, not here.
      if (VOICE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[voice] wake start() threw:", err?.name, err?.message);
      }
      wakeRecRef.current = null;
      setWakeLive(false);
      wakeRetriesRef.current += 1;
      if (wakeRetriesRef.current <= 6) {
        scheduleWake(400 * wakeRetriesRef.current);
      } else {
        setWakeArmed(false);
        showToast("Couldn't start the wake word listener. Use the mic button instead.");
      }
    }
  }, [scheduleWake, showToast]);

  startWakeRef.current = startWake;

  // ---------------------------------------------------------- command capture

  const clearListenTimers = useCallback(() => {
    clearTimeout(listenTimerRef.current);
    clearTimeout(silenceTimerRef.current);
    clearTimeout(maxUtteranceTimerRef.current);
  }, []);

  const stopCommand = useCallback(() => {
    clearListenTimers();
    const rec = cmdRecRef.current;
    cmdRecRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // already stopped
    }
  }, [clearListenTimers]);

  const closeAgent = useCallback(() => {
    stopCommand();
    // Invalidate the chunk queue first: cancel() fires onend on the current
    // utterance, which would otherwise be read as "advance to the next chunk"
    // and keep the agent talking after the overlay is gone.
    speakTokenRef.current = null;
    clearTimeout(speakGuardRef.current);
    clearInterval(keepAliveRef.current);
    if (SUPPORTS_TTS) window.speechSynthesis.cancel();
    lastQuestionRef.current = "";
    setOpen(false);
    setExiting(true);
    clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      setCaption("");
    }, 260);
  }, [stopCommand]);
  closeAgentRef.current = closeAgent;

  const handleCommand = useCallback(
    async (transcript) => {
      setPhase("processing");
      setCaption(transcript);
      turnRef.current += 1;

      // /chat is stateless — it accepts a message and nothing else. So when
      // this turn answers a question the agent just asked, the question is
      // folded into the message itself. Same endpoint, same request shape.
      const pending = lastQuestionRef.current;
      const message = pending ? `You just asked me: "${pending}"\nMy answer: ${transcript}` : transcript;

      let reply = "";
      try {
        reply = (await onSend(message)) || "Done.";
      } catch {
        reply = "I couldn't reach the bridge server.";
      }
      if (!openRef.current) return;

      // Generous: the brevity rule in the system prompt is what keeps replies
      // short. Truncating here too was cutting sentences off mid-word.
      const spoken = shorten(reply, 600);
      const wantsFollowUp = isQuestion(spoken) && turnRef.current < MAX_FOLLOW_UPS;
      lastQuestionRef.current = wantsFollowUp ? spoken : "";

      setPhase("speaking");
      setCaption(shorten(reply, 180));
      speak(spoken, () => {
        if (!openRef.current) return;
        // The agent asked something — stay open and listen rather than making
        // them say the wake word again to answer.
        if (wantsFollowUp) listenForCommandRef.current();
        else closeAgentRef.current();
      });
    },
    [onSend, speak]
  );

  const listenForCommand = useCallback(() => {
    if (!SUPPORTS_SPEECH) {
      closeAgentRef.current();
      return;
    }
    stopCommand();
    gotResultRef.current = false;
    transcriptRef.current = "";

    const rec = new SpeechRecognitionCtor();
    // Continuous with interim results, ended by our own silence timer rather
    // than by the browser. Left to itself Chrome stops at the first natural
    // pause, which clips anyone who thinks mid-sentence.
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    cmdRecRef.current = rec;

    const endTurn = () => {
      try {
        cmdRecRef.current?.stop();
      } catch {
        // already stopping; onend still fires
      }
    };

    rec.onresult = (event) => {
      if (cmdRecRef.current !== rec) return;

      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) transcriptRef.current = `${transcriptRef.current} ${text}`.trim();
        else interim += text;
      }

      gotResultRef.current = true;
      // Show what is being heard as it arrives, so the wait reads as progress.
      setCaption(`${transcriptRef.current} ${interim}`.trim());

      // Any speech at all restarts the silence countdown.
      clearTimeout(listenTimerRef.current);
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(endTurn, SILENCE_TIMEOUT_MS);
    };

    rec.onerror = (event) => {
      if (VOICE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[voice] command error:", event.error);
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        gotResultRef.current = true; // suppress the "didn't catch that" path
        showToast("Microphone access is blocked. Allow it in your browser settings to use voice.");
        closeAgentRef.current();
      }
    };

    rec.onend = () => {
      if (cmdRecRef.current !== rec) return;
      cmdRecRef.current = null;
      clearListenTimers();
      if (!openRef.current) return;

      const said = transcriptRef.current.trim();
      if (said) {
        handleCommand(said);
        return;
      }
      setPhase("speaking");
      setCaption("I didn't catch that.");
      speak("I didn't catch that.", () => {
        if (openRef.current) closeAgentRef.current();
      });
    };

    try {
      rec.start();
      setPhase("listening");
      setCaption("");
      clearListenTimers();
      // Nothing said at all — don't hold the mic open indefinitely.
      listenTimerRef.current = setTimeout(endTurn, START_TIMEOUT_MS);
      // Backstop for a mic that keeps hearing noise and never goes quiet.
      maxUtteranceTimerRef.current = setTimeout(endTurn, MAX_UTTERANCE_MS);
    } catch {
      cmdRecRef.current = null;
      closeAgentRef.current();
    }
  }, [clearListenTimers, handleCommand, showToast, speak, stopCommand]);

  listenForCommandRef.current = listenForCommand;

  const openAgent = useCallback(() => {
    if (openRef.current) return;
    stopWake();
    clearTimeout(exitTimerRef.current);
    setExiting(false);
    setOpen(true);
    openRef.current = true;
    turnRef.current = 0;
    lastQuestionRef.current = "";
    setPhase("greeting");
    setCaption("");
    speak(GREETING, () => {
      if (openRef.current) listenForCommand();
    });
  }, [listenForCommand, speak, stopWake]);
  openAgentRef.current = openAgent;

  /** The button press doubles as the gesture iOS needs to unlock audio. */
  const handleMicPress = useCallback(() => {
    if (SUPPORTS_TTS) {
      // A zero-length utterance inside the gesture is what unlocks
      // speechSynthesis on iOS; without it the greeting is silently dropped.
      try {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      } catch {
        // non-fatal
      }
    }
    if (!SUPPORTS_SPEECH) {
      showToast("This browser doesn't support speech recognition. Try Chrome, or type in the chat.");
      return;
    }
    openAgent();
  }, [openAgent, showToast]);

  const toggleWake = useCallback(() => {
    setWakeArmed((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(WAKE_STORAGE_KEY, "1");
        else localStorage.removeItem(WAKE_STORAGE_KEY);
      } catch {
        // storage unavailable — the toggle just won't be remembered
      }
      return next;
    });
  }, []);

  // ------------------------------------------------------------------ effects

  // Chrome populates the voice list asynchronously — touching it on mount
  // means a real en-US voice is available by the time the greeting plays.
  useEffect(() => {
    if (!SUPPORTS_TTS) return;
    window.speechSynthesis.getVoices();
  }, []);

  // Re-arm across reloads. Mic permission is remembered per origin, so this
  // starts cleanly without a gesture once the user has granted it before.
  useEffect(() => {
    if (!SUPPORTS_WAKE) return;
    try {
      if (localStorage.getItem(WAKE_STORAGE_KEY) === "1") setWakeArmed(true);
    } catch {
      // storage unavailable
    }
  }, []);

  // Single owner of the wake listener: it runs exactly when armed and closed.
  // Chrome allows only one live recogniser, so it must yield while the
  // overlay is capturing a command.
  useEffect(() => {
    if (!SUPPORTS_WAKE) return undefined;
    if (VOICE_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[voice] wake effect", { wakeArmed, open, exiting });
    }
    if (wakeArmed && !open && !exiting) {
      wakeRetriesRef.current = 0;
      scheduleWake();
    } else {
      stopWake();
    }
    return stopWake;
  }, [wakeArmed, open, exiting, scheduleWake, stopWake]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeAgentRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(
    () => () => {
      clearTimeout(restartTimerRef.current);
      clearTimeout(listenTimerRef.current);
      clearTimeout(silenceTimerRef.current);
      clearTimeout(maxUtteranceTimerRef.current);
      clearTimeout(exitTimerRef.current);
      clearTimeout(toastTimerRef.current);
      clearTimeout(speakGuardRef.current);
      clearInterval(keepAliveRef.current);
      speakTokenRef.current = null;
      if (SUPPORTS_TTS) window.speechSynthesis.cancel();
    },
    []
  );

  // ------------------------------------------------------------------ surface

  return {
    // Overlay state, consumed by <VoiceAgent />.
    open,
    exiting,
    phase,
    caption,
    toast,
    close: closeAgent,
    // Controls, consumed by the chat input.
    supportsSpeech: SUPPORTS_SPEECH,
    supportsWake: SUPPORTS_WAKE,
    wakeArmed,
    wakeLive,
    startTalking: handleMicPress,
    toggleWake,
  };
}

/** Microphone glyph, shared by the chat button and any other trigger. */
export function MicIcon({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" fill="currentColor" />
      <path
        d="M18 11a6 6 0 0 1-12 0M12 17v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The full-screen agent overlay plus its toast. Presentational only. */
export default function VoiceAgent({ voice }) {
  const { open, exiting, phase, caption, toast, close } = voice;
  const label = PHASE_LABEL[phase] || "Listening…";

  return (
    <>
      {toast && <div className="va-toast">{toast}</div>}

      {(open || exiting) && (
        <div
          className={`va-overlay ${open ? "va-overlay--in" : "va-overlay--out"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Voice agent"
        >
          <button type="button" className="va-close" onClick={close} aria-label="Close voice agent">
            ×
          </button>

          <div className={`va-stage va-stage--${phase}`}>
            <div className="va-orb-wrap">
              {phase === "speaking" && (
                <>
                  <span className="va-ring" />
                  <span className="va-ring va-ring--delayed" />
                </>
              )}
              <div className="va-orb" />
            </div>

            <div className="va-status" aria-live="polite">
              {label}
            </div>
            {caption && <div className="va-caption">{caption}</div>}
          </div>
        </div>
      )}
    </>
  );
}
