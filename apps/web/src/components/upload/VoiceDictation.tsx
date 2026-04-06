import { useState, useRef } from 'react';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
  resultIndex: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface Props {
  onTranscript: (text: string) => void;
}

export function VoiceDictation({ onTranscript }: Props) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lang, setLang] = useState('ru-RU');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const supported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    let finalTranscript = transcript;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          if ((result as unknown as { isFinal: boolean }).isFinal) {
            finalTranscript += result[0].transcript + ' ';
          } else {
            interim += result[0].transcript;
          }
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = () => {
      setRecording(false);
    };

    recognition.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const handleSend = () => {
    if (transcript.trim()) {
      onTranscript(transcript.trim());
      setTranscript('');
    }
  };

  if (!supported) {
    return <div className="text-xs text-gray-400">Voice dictation not supported in this browser</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            recording
              ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-200'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>
        <div>
          <div className="text-sm font-medium text-gray-700">
            {recording ? 'Recording...' : 'Voice Dictation'}
          </div>
          <div className="text-xs text-gray-400">
            {recording ? 'Click to stop' : 'Click microphone to start'}
          </div>
        </div>
        <select
          className="ml-auto text-xs border border-gray-200 rounded px-2 py-1 bg-white"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={recording}
        >
          <option value="ru-RU">Russian</option>
          <option value="en-US">English</option>
        </select>
      </div>

      {transcript && (
        <div>
          <textarea
            className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-indigo-300"
            rows={4}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setTranscript('')}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
            >
              Clear
            </button>
            <button
              onClick={handleSend}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
            >
              Send to Inbox
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
