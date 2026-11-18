// AP-023: dictation for description fields on the phone. The browser's own speech recognition turns speech into text;
// the app keeps only the text. These helpers are the parts that do not need a browser.

export const VOICE_LANGUAGES = [
  { code: "hi-IN", label: "हिंदी", name: "Hindi" },
  { code: "en-IN", label: "English", name: "English" }
] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["code"];

export const VOICE_NOTICE = "Your browser's speech service may process the audio. Only the text is saved here.";

export function parseVoiceLanguage(value: unknown): VoiceLanguage {
  return value === "en-IN" ? "en-IN" : "hi-IN";
}

/** Adds a dictated phrase to what is already typed: one space between, control characters removed, capped at the field's limit. */
export function appendDictation(existing: string, transcript: string, maxLength: number): string {
  const spoken = transcript.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!spoken) return existing;
  const base = existing.replace(/\s+$/, "");
  const joined = base ? `${base} ${spoken}` : spoken;
  return joined.length > maxLength ? joined.slice(0, maxLength).replace(/\s+\S*$/, "") || joined.slice(0, maxLength) : joined;
}

type RecognitionCtor = new () => unknown;
/** The browser's speech recognition constructor, or null where it does not exist (the microphone is then not shown). */
export function speechRecognitionCtor(scope: unknown): RecognitionCtor | null {
  const w = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | null | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}
