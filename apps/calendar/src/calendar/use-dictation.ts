import { intlLocale } from "@delyra/ui";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictado por voz (Web Speech API) para el alta rápida. Lo transcribe el propio navegador con su
 * servicio de voz (en Chrome, el de Google; en Safari, el de Apple): Delyra no recibe el audio,
 * solo el texto que acaba en el campo. Sin soporte (Firefox), el botón no aparece.
 */

interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationError = "denied" | "no-speech" | "failed";

export function useDictation({
  onText,
  onError,
}: {
  /** Texto reconocido hasta ahora (`final` cuando ha terminado la frase). */
  onText: (text: string, final: boolean) => void;
  onError: (error: DictationError) => void;
}) {
  const supported = recognitionConstructor() !== null;
  const [listening, setListening] = useState(false);
  const current = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError });
  useEffect(() => {
    handlers.current = { onText, onError };
  }, [onText, onError]);

  const stop = useCallback(() => current.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor || current.current) return;
    const recognition = new Ctor();
    recognition.lang = intlLocale();
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.addEventListener("result", (event) => {
      const results = (event as SpeechRecognitionEvent).results;
      let text = "";
      let final = false;
      for (const result of Array.from(results)) {
        text += result[0]?.transcript ?? "";
        final = result.isFinal;
      }
      handlers.current.onText(text.trim(), final);
    });
    recognition.addEventListener("error", (event) => {
      const code = (event as SpeechRecognitionErrorEvent).error;
      if (code === "aborted") return;
      handlers.current.onError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "denied"
          : code === "no-speech"
            ? "no-speech"
            : "failed",
      );
    });
    recognition.addEventListener("end", () => {
      current.current = null;
      setListening(false);
    });
    current.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      current.current = null;
      setListening(false);
      handlers.current.onError("failed");
    }
  }, []);

  // Al desmontar (cambiar de página o de idioma) se deja de escuchar.
  useEffect(() => () => current.current?.abort(), []);

  return { supported, listening, start, stop };
}
